import type { ExtensionStorage } from "../../../shared/config";
import { stableNoise } from "../../core/random";
import { record } from "../../core/record";
import { nativeProxy, registerFunction } from "../../core/stealth";
import { resolveCanvasSeed } from "../../core/seed";
import { addPoint, addRegion, addRisk, createPathState, createProfile, type Canvas2DProfile } from "./profile";
import { perturbImageData, perturbNumber } from "./perturb";

const profiles = new WeakMap<HTMLCanvasElement | OffscreenCanvas, Canvas2DProfile>();
const contextProfiles = new WeakMap<CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, Canvas2DProfile>();
const riskyStyles = new WeakSet<object>();
let silentCanvasReadback = 0;

const getProfileForCanvas = (canvas: HTMLCanvasElement | OffscreenCanvas): Canvas2DProfile => {
  let profile = profiles.get(canvas);
  if (!profile) {
    profile = createProfile();
    profiles.set(canvas, profile);
  }
  return profile;
};

const getProfileForContext = (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D): Canvas2DProfile => {
  let profile = contextProfiles.get(ctx);
  if (!profile) {
    profile = getProfileForCanvas(ctx.canvas as HTMLCanvasElement | OffscreenCanvas);
    contextProfiles.set(ctx, profile);
  }
  return profile;
};

const isPureColor = (value: unknown): boolean => {
  return typeof value === "string";
};

const hasRiskyPaintState = (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D): boolean => {
  return ctx.shadowBlur !== 0 ||
    ctx.filter !== "none" ||
    ctx.globalAlpha !== 1 ||
    ctx.globalCompositeOperation !== "source-over";
};

const markPaintState = (profile: Canvas2DProfile, ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => {
  if (ctx.shadowBlur !== 0 || ctx.filter !== "none") {
    profile.hasShadow = true;
    addRisk(profile, 15, "paint.shadow");
  }
  if (ctx.globalAlpha !== 1 || ctx.globalCompositeOperation !== "source-over") {
    profile.hasComposite = true;
    addRisk(profile, 15, "paint.composite");
  }
};

const perturbTextArgs = (args: IArguments | unknown[], seed: number, salt: string) => {
  if (typeof args[1] === "number") args[1] = perturbNumber(args[1], seed, `${salt}:x`, 0.016);
  if (typeof args[2] === "number") args[2] = perturbNumber(args[2], seed, `${salt}:y`, 0.016);
};

export const installCanvas2D = (storage: ExtensionStorage) => {
  const config = storage.config.canvas2d;
  if (!storage.config.enabled || !config.enabled) return;

  const seed = resolveCanvasSeed(storage);
  if (!seed) return;

  const rawGetContext = HTMLCanvasElement.prototype.getContext;

  HTMLCanvasElement.prototype.getContext = nativeProxy(rawGetContext, {
    apply(target, thisArg: HTMLCanvasElement, args: Parameters<HTMLCanvasElement["getContext"]>) {
      const result = Reflect.apply(target, thisArg, args);
      if (args[0] === "2d" && result) {
        contextProfiles.set(result as CanvasRenderingContext2D, getProfileForCanvas(thisArg));
      }
      return result;
    }
  }) as typeof HTMLCanvasElement.prototype.getContext;

  const proto = CanvasRenderingContext2D.prototype;

  const rawCreateLinearGradient = proto.createLinearGradient;
  proto.createLinearGradient = nativeProxy(rawCreateLinearGradient, {
    apply(target, thisArg, args) {
      const result = Reflect.apply(target, thisArg, args);
      riskyStyles.add(result);
      const profile = getProfileForContext(thisArg);
      profile.hasGradient = true;
      addRisk(profile, 25, "gradient.linear");
      record("canvas2d.gradient", "high");
      return result;
    }
  }) as typeof proto.createLinearGradient;

  const rawCreateRadialGradient = proto.createRadialGradient;
  proto.createRadialGradient = nativeProxy(rawCreateRadialGradient, {
    apply(target, thisArg, args) {
      const result = Reflect.apply(target, thisArg, args);
      riskyStyles.add(result);
      const profile = getProfileForContext(thisArg);
      profile.hasGradient = true;
      addRisk(profile, 25, "gradient.radial");
      record("canvas2d.gradient", "high");
      return result;
    }
  }) as typeof proto.createRadialGradient;

  const rawCreatePattern = proto.createPattern;
  proto.createPattern = nativeProxy(rawCreatePattern, {
    apply(target, thisArg, args) {
      const result = Reflect.apply(target, thisArg, args);
      if (result) riskyStyles.add(result);
      const profile = getProfileForContext(thisArg);
      profile.hasPattern = true;
      addRisk(profile, 25, "pattern");
      record("canvas2d.pattern", "high");
      return result;
    }
  }) as typeof proto.createPattern;

  const rawFillRect = proto.fillRect;
  proto.fillRect = nativeProxy(rawFillRect, {
    apply(target, thisArg, args: Parameters<CanvasRenderingContext2D["fillRect"]>) {
      const profile = getProfileForContext(thisArg);
      markPaintState(profile, thisArg);
      if (!isPureColor(thisArg.fillStyle) || riskyStyles.has(thisArg.fillStyle)) {
        profile.hasOnlySolidFill = false;
        addRisk(profile, 25, "fill.risky");
        record("canvas2d.fill.risky", "high");
      } else if (hasRiskyPaintState(thisArg)) {
        profile.hasOnlySolidFill = false;
        record("canvas2d.fill.state", "low");
      }
      return Reflect.apply(target, thisArg, args);
    }
  }) as typeof proto.fillRect;

  const rawBeginPath = proto.beginPath;
  proto.beginPath = nativeProxy(rawBeginPath, {
    apply(target, thisArg, args) {
      getProfileForContext(thisArg).path = createPathState();
      return Reflect.apply(target, thisArg, args);
    }
  }) as typeof proto.beginPath;

  const rawMoveTo = proto.moveTo;
  proto.moveTo = nativeProxy(rawMoveTo, {
    apply(target, thisArg, args: Parameters<CanvasRenderingContext2D["moveTo"]>) {
      const path = getProfileForContext(thisArg).path;
      path.current = { x: args[0], y: args[1] };
      addPoint(path, args[0], args[1]);
      return Reflect.apply(target, thisArg, args);
    }
  }) as typeof proto.moveTo;

  const rawLineTo = proto.lineTo;
  proto.lineTo = nativeProxy(rawLineTo, {
    apply(target, thisArg, args: Parameters<CanvasRenderingContext2D["lineTo"]>) {
      const profile = getProfileForContext(thisArg);
      const path = profile.path;
      const current = path.current;
      if (current) {
        const axisAligned = current.x === args[0] || current.y === args[1];
        const integerCoords = Number.isInteger(current.x) && Number.isInteger(current.y) && Number.isInteger(args[0]) && Number.isInteger(args[1]);
        if (!axisAligned || !integerCoords) {
          path.hasNonAxisLine = true;
          path.hasAxisAlignedOnly = false;
          profile.hasOnlyAxisAlignedLines = false;
          addRisk(profile, 10, "line.non-axis");
          record("canvas2d.line.non-axis", "low");
          if (config.perturbCurves) {
            args[0] = perturbNumber(args[0], seed, `line:x:${args[0]}:${args[1]}`, 0.01);
            args[1] = perturbNumber(args[1], seed, `line:y:${args[0]}:${args[1]}`, 0.01);
          }
        }
      }
      path.current = { x: args[0], y: args[1] };
      addPoint(path, args[0], args[1]);
      return Reflect.apply(target, thisArg, args);
    }
  }) as typeof proto.lineTo;

  const curveHooks = ["arc", "arcTo", "ellipse", "bezierCurveTo", "quadraticCurveTo"] as const;
  for (const key of curveHooks) {
    const raw = proto[key] as Function;
    (proto[key] as Function) = nativeProxy(raw, {
      apply(target, thisArg: CanvasRenderingContext2D, args: unknown[]) {
        const profile = getProfileForContext(thisArg);
        profile.hasCurve = true;
        profile.hasAntialiasShape = true;
        profile.path.hasCurve = true;
        addRisk(profile, 25, `curve.${key}`);
        record(`canvas2d.${key}`, "high");
        if (config.perturbCurves) {
          for (let i = 0; i < args.length; i++) {
            if (typeof args[i] === "number") {
              args[i] = perturbNumber(args[i] as number, seed, `${key}:${i}:${args[i]}`, 0.012);
            }
          }
        }
        return Reflect.apply(target, thisArg, args);
      }
    });
  }

  const rawFill = proto.fill;
  proto.fill = nativeProxy(rawFill, {
    apply(target, thisArg, args) {
      const profile = getProfileForContext(thisArg);
      markPaintState(profile, thisArg);
      if (riskyStyles.has(thisArg.fillStyle) || profile.path.hasCurve) {
        addRisk(profile, profile.path.hasCurve ? 25 : 15, profile.path.hasCurve ? "path.fill.curve" : "path.fill.style");
        record("canvas2d.path.fill", "high");
      }
      if (Number.isFinite(profile.path.minX)) {
        addRegion(profile, {
          x: profile.path.minX,
          y: profile.path.minY,
          width: profile.path.maxX - profile.path.minX + 2,
          height: profile.path.maxY - profile.path.minY + 2,
          reason: "path"
        });
      }
      return Reflect.apply(target, thisArg, args);
    }
  }) as typeof proto.fill;

  const rawStroke = proto.stroke;
  proto.stroke = nativeProxy(rawStroke, {
    apply(target, thisArg, args) {
      const profile = getProfileForContext(thisArg);
      markPaintState(profile, thisArg);
      if (riskyStyles.has(thisArg.strokeStyle) || profile.path.hasCurve || profile.path.hasNonAxisLine) {
        addRisk(profile, profile.path.hasCurve ? 25 : 10, profile.path.hasCurve ? "path.stroke.curve" : "path.stroke.line");
        record("canvas2d.path.stroke", profile.path.hasCurve ? "high" : "low");
      }
      return Reflect.apply(target, thisArg, args);
    }
  }) as typeof proto.stroke;

  const rawMeasureText = proto.measureText;
  proto.measureText = nativeProxy(rawMeasureText, {
    apply(target, thisArg, args: Parameters<CanvasRenderingContext2D["measureText"]>) {
      const profile = getProfileForContext(thisArg);
      profile.hasText = true;
      addRisk(profile, 20, `measureText:${thisArg.font}:${String(args[0]).slice(0, 64)}`);
      record("canvas2d.measureText", "high");
      const metrics = Reflect.apply(target, thisArg, args);
      if (!config.perturbText) return metrics;
      const widthNoise = stableNoise(seed, `measure:${thisArg.font}:${args[0]}`, 0.018);
      return new Proxy(metrics, {
        get(targetMetrics, prop, receiver) {
          if (prop === "width") return targetMetrics.width + widthNoise;
          return Reflect.get(targetMetrics, prop, receiver);
        }
      });
    }
  }) as typeof proto.measureText;

  for (const key of ["fillText", "strokeText"] as const) {
    const raw = proto[key];
    proto[key] = nativeProxy(raw, {
      apply(target, thisArg, args) {
        const profile = getProfileForContext(thisArg);
        profile.hasText = true;
        addRisk(profile, 40, `${key}:${thisArg.font}:${String(args[0]).slice(0, 64)}`);
        record(`canvas2d.${key}`, "high");
        addRegion(profile, {
          x: Number(args[1]) || 0,
          y: (Number(args[2]) || 0) - 32,
          width: Math.max(32, String(args[0]).length * 18),
          height: 48,
          reason: "text"
        });
        if (config.perturbText) perturbTextArgs(args, seed, `${key}:${thisArg.font}:${args[0]}`);
        return Reflect.apply(target, thisArg, args);
      }
    }) as typeof raw;
  }

  const rawDrawImage = proto.drawImage;
  proto.drawImage = nativeProxy(rawDrawImage, {
    apply(target, thisArg, args) {
      const profile = getProfileForContext(thisArg);
      profile.hasImage = true;
      addRisk(profile, 20, "drawImage");
      record("canvas2d.drawImage", config.perturbImages ? "high" : "low");
      if (config.perturbImages && typeof args[1] === "number" && typeof args[2] === "number") {
        args[1] = perturbNumber(args[1], seed, `drawImage:x:${args[1]}:${args[2]}`, 0.01);
        args[2] = perturbNumber(args[2], seed, `drawImage:y:${args[1]}:${args[2]}`, 0.01);
      }
      return Reflect.apply(target, thisArg, args);
    }
  }) as typeof proto.drawImage;

  const rawGetImageData = proto.getImageData;
  const rawPutImageData = proto.putImageData;
  proto.getImageData = nativeProxy(rawGetImageData, {
    apply(target, thisArg, args) {
      const profile = getProfileForContext(thisArg);
      if (!silentCanvasReadback) {
        record("canvas2d.getImageData", profile.riskScore >= config.exportNoiseScore ? "high" : "low");
      }
      const imageData = Reflect.apply(target, thisArg, args);
      if (profile.riskScore >= config.exportNoiseScore) {
        return perturbImageData(imageData, profile, seed);
      }
      return imageData;
    }
  }) as typeof proto.getImageData;

  const rawToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = nativeProxy(rawToDataURL, {
    apply(target, thisArg, args) {
      const profile = getProfileForCanvas(thisArg);
      record("canvas2d.toDataURL", profile.riskScore >= config.exportNoiseScore ? "high" : "low");
      if (profile.riskScore < config.exportNoiseScore) return Reflect.apply(target, thisArg, args);
      const ctx = thisArg.getContext("2d", { willReadFrequently: true });
      let original: ImageData | undefined;
      if (ctx) {
        let source: ImageData;
        try {
          silentCanvasReadback++;
          source = Reflect.apply(rawGetImageData, ctx, [0, 0, thisArg.width, thisArg.height]) as ImageData;
        } finally {
          silentCanvasReadback--;
        }
        original = source;
        const perturbed = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
        Reflect.apply(rawPutImageData, ctx, [perturbImageData(perturbed, profile, seed), 0, 0]);
      }
      try {
        return Reflect.apply(target, thisArg, args);
      } finally {
        if (ctx && original) Reflect.apply(rawPutImageData, ctx, [original, 0, 0]);
      }
    }
  }) as typeof HTMLCanvasElement.prototype.toDataURL;

  const rawToBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = nativeProxy(rawToBlob, {
    apply(target, thisArg, args) {
      const profile = getProfileForCanvas(thisArg);
      record("canvas2d.toBlob", profile.riskScore >= config.exportNoiseScore ? "high" : "low");
      const originalCallback = args[0];
      let ctx: CanvasRenderingContext2D | null = null;
      let original: ImageData | undefined;
      if (profile.riskScore >= config.exportNoiseScore) {
        ctx = thisArg.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          let source: ImageData;
          try {
            silentCanvasReadback++;
            source = Reflect.apply(rawGetImageData, ctx, [0, 0, thisArg.width, thisArg.height]) as ImageData;
          } finally {
            silentCanvasReadback--;
          }
          original = source;
          const perturbed = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
          Reflect.apply(rawPutImageData, ctx, [perturbImageData(perturbed, profile, seed), 0, 0]);
        }
      }
      if (typeof originalCallback === "function" && original) {
        args[0] = function wrappedToBlobCallback(blob: Blob | null) {
          if (ctx && original) Reflect.apply(rawPutImageData, ctx, [original, 0, 0]);
          return originalCallback.call(this, blob);
        };
      }
      return Reflect.apply(target, thisArg, args);
    }
  }) as typeof HTMLCanvasElement.prototype.toBlob;

  registerFunction(HTMLCanvasElement.prototype.getContext, rawGetContext);
};
