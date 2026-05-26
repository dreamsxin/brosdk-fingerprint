import type { ExtensionStorage } from "../../../shared/config";
import { record } from "../../core/record";
import { nativeProxy, registerFunction } from "../../core/stealth";
import { resolveCanvasSeed } from "../../core/seed";
import { addPoint, addRegion, addRisk, createPathState, createProfile, type Canvas2DProfile } from "./profile";
import { perturbImageData, perturbNumber } from "./perturb";

type Canvas2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type CanvasLike = HTMLCanvasElement | OffscreenCanvas;
type CanvasMethod = (...args: unknown[]) => unknown;

const profiles = new WeakMap<CanvasLike, Canvas2DProfile>();
const rawContextProfiles = new WeakMap<Canvas2DContext, Canvas2DProfile>();
const proxyContextProfiles = new WeakMap<object, Canvas2DProfile>();
const contextProxies = new WeakMap<Canvas2DContext, Canvas2DContext>();
const proxyToRawContexts = new WeakMap<object, Canvas2DContext>();
const wrapperCache = new WeakMap<Canvas2DContext, Map<PropertyKey, Function>>();
const riskyStyles = new WeakSet<object>();

let silentCanvasReadback = 0;

const getProfileForCanvas = (canvas: CanvasLike): Canvas2DProfile => {
  let profile = profiles.get(canvas);
  if (!profile) {
    profile = createProfile();
    profiles.set(canvas, profile);
  }
  return profile;
};

const getProfileForContext = (ctx: Canvas2DContext): Canvas2DProfile => {
  const proxied = proxyContextProfiles.get(ctx as object);
  if (proxied) return proxied;

  let profile = rawContextProfiles.get(ctx);
  if (!profile) {
    profile = getProfileForCanvas(ctx.canvas as CanvasLike);
    rawContextProfiles.set(ctx, profile);
  }
  return profile;
};

export const getRawCanvas2DContext = (ctx: unknown): Canvas2DContext | undefined => {
  if (!ctx || (typeof ctx !== "object" && typeof ctx !== "function")) return undefined;
  return proxyToRawContexts.get(ctx as object);
};

const isPureColor = (value: unknown): boolean => typeof value === "string";

const hasRiskyPaintState = (ctx: Canvas2DContext): boolean => {
  return ctx.shadowBlur !== 0 ||
    ctx.filter !== "none" ||
    ctx.globalAlpha !== 1 ||
    ctx.globalCompositeOperation !== "source-over";
};

const markPaintState = (profile: Canvas2DProfile, ctx: Canvas2DContext) => {
  if (ctx.shadowBlur !== 0 || ctx.filter !== "none") {
    profile.hasShadow = true;
    addRisk(profile, 15, "paint.shadow");
  }
  if (ctx.globalAlpha !== 1 || ctx.globalCompositeOperation !== "source-over") {
    profile.hasComposite = true;
    addRisk(profile, 15, "paint.composite");
  }
};

const perturbTextArgs = (args: unknown[], seed: number, salt: string) => {
  if (typeof args[1] === "number") args[1] = perturbNumber(args[1], seed, `${salt}:x`, 0.016);
  if (typeof args[2] === "number") args[2] = perturbNumber(args[2], seed, `${salt}:y`, 0.016);
};

const bindRaw = <T extends Function>(raw: T, ctx: Canvas2DContext): T => {
  return raw.bind(ctx) as unknown as T;
};

const createWrapper = (
  ctx: Canvas2DContext,
  key: PropertyKey,
  raw: Function,
  apply: (target: CanvasMethod, args: unknown[]) => unknown
): Function => {
  let cached = wrapperCache.get(ctx);
  if (!cached) {
    cached = new Map();
    wrapperCache.set(ctx, cached);
  }

  const existing = cached.get(key);
  if (existing) return existing;

  const wrapped = nativeProxy(raw as CanvasMethod, {
    apply(target, _thisArg, args) {
      return apply(target, Array.from(args));
    }
  });
  registerFunction(wrapped, raw);
  cached.set(key, wrapped);
  return wrapped;
};

const methodFromPrototype = (key: keyof CanvasRenderingContext2D): Function | undefined => {
  const value = CanvasRenderingContext2D.prototype[key];
  return typeof value === "function" ? value : undefined;
};

const createProtectedContext = (ctx: CanvasRenderingContext2D, config: ExtensionStorage["config"]["canvas2d"], seed: number) => {
  const existing = contextProxies.get(ctx);
  if (existing) return existing as CanvasRenderingContext2D;

  const profile = getProfileForContext(ctx);
  const proxy = new Proxy(ctx, {
    get(target, prop, receiver) {
      if (prop === "createLinearGradient" || prop === "createRadialGradient") {
        const raw = methodFromPrototype(prop);
        if (!raw) return Reflect.get(target, prop, receiver);
        return createWrapper(target, prop, raw, (native, args) => {
          const result = Reflect.apply(native, target, args);
          riskyStyles.add(result as object);
          profile.hasGradient = true;
          addRisk(profile, 25, prop === "createLinearGradient" ? "gradient.linear" : "gradient.radial");
          record("canvas2d.gradient", "high");
          return result;
        });
      }

      if (prop === "createPattern") {
        const raw = methodFromPrototype(prop);
        if (!raw) return Reflect.get(target, prop, receiver);
        return createWrapper(target, prop, raw, (native, args) => {
          const result = Reflect.apply(native, target, args);
          if (result) riskyStyles.add(result as object);
          profile.hasPattern = true;
          addRisk(profile, 25, "pattern");
          record("canvas2d.pattern", "high");
          return result;
        });
      }

      if (prop === "fillRect") {
        const raw = methodFromPrototype(prop);
        if (!raw) return Reflect.get(target, prop, receiver);
        return createWrapper(target, prop, raw, (native, args) => {
          markPaintState(profile, target);
          if (!isPureColor(target.fillStyle) || riskyStyles.has(target.fillStyle as object)) {
            profile.hasOnlySolidFill = false;
            addRisk(profile, 25, "fill.risky");
            record("canvas2d.fill.risky", "high");
          } else if (hasRiskyPaintState(target)) {
            profile.hasOnlySolidFill = false;
            record("canvas2d.fill.state", "low");
          }
          return Reflect.apply(native, target, args);
        });
      }

      if (prop === "beginPath") {
        const raw = methodFromPrototype(prop);
        if (!raw) return Reflect.get(target, prop, receiver);
        return createWrapper(target, prop, raw, (native, args) => {
          profile.path = createPathState();
          return Reflect.apply(native, target, args);
        });
      }

      if (prop === "moveTo") {
        const raw = methodFromPrototype(prop);
        if (!raw) return Reflect.get(target, prop, receiver);
        return createWrapper(target, prop, raw, (native, args) => {
          const x = Number(args[0]);
          const y = Number(args[1]);
          profile.path.current = { x, y };
          addPoint(profile.path, x, y);
          return Reflect.apply(native, target, args);
        });
      }

      if (prop === "lineTo") {
        const raw = methodFromPrototype(prop);
        if (!raw) return Reflect.get(target, prop, receiver);
        return createWrapper(target, prop, raw, (native, args) => {
          const current = profile.path.current;
          const x = Number(args[0]);
          const y = Number(args[1]);
          if (current) {
            const axisAligned = current.x === x || current.y === y;
            const integerCoords = Number.isInteger(current.x) && Number.isInteger(current.y) && Number.isInteger(x) && Number.isInteger(y);
            if (!axisAligned || !integerCoords) {
              profile.path.hasNonAxisLine = true;
              profile.path.hasAxisAlignedOnly = false;
              profile.hasOnlyAxisAlignedLines = false;
              addRisk(profile, 10, "line.non-axis");
              record("canvas2d.line.non-axis", "low");
              if (config.perturbCurves) {
                args[0] = perturbNumber(x, seed, `line:x:${x}:${y}`, 0.01);
                args[1] = perturbNumber(y, seed, `line:y:${x}:${y}`, 0.01);
              }
            }
          }
          profile.path.current = { x: Number(args[0]), y: Number(args[1]) };
          addPoint(profile.path, Number(args[0]), Number(args[1]));
          return Reflect.apply(native, target, args);
        });
      }

      if (prop === "arc" || prop === "arcTo" || prop === "ellipse" || prop === "bezierCurveTo" || prop === "quadraticCurveTo") {
        const raw = methodFromPrototype(prop);
        if (!raw) return Reflect.get(target, prop, receiver);
        return createWrapper(target, prop, raw, (native, args) => {
          profile.hasCurve = true;
          profile.hasAntialiasShape = true;
          profile.path.hasCurve = true;
          addRisk(profile, 25, `curve.${String(prop)}`);
          record(`canvas2d.${String(prop)}`, "high");
          if (config.perturbCurves) {
            for (let i = 0; i < args.length; i++) {
              if (typeof args[i] === "number") {
                args[i] = perturbNumber(args[i] as number, seed, `${String(prop)}:${i}:${args[i]}`, 0.012);
              }
            }
          }
          return Reflect.apply(native, target, args);
        });
      }

      if (prop === "fill" || prop === "stroke") {
        const raw = methodFromPrototype(prop);
        if (!raw) return Reflect.get(target, prop, receiver);
        return createWrapper(target, prop, raw, (native, args) => {
          markPaintState(profile, target);
          const paintStyle = prop === "fill" ? target.fillStyle : target.strokeStyle;
          if (riskyStyles.has(paintStyle as object) || profile.path.hasCurve || profile.path.hasNonAxisLine) {
            addRisk(profile, profile.path.hasCurve ? 25 : 10, profile.path.hasCurve ? `path.${String(prop)}.curve` : `path.${String(prop)}.line`);
            record(`canvas2d.path.${String(prop)}`, profile.path.hasCurve ? "high" : "low");
          }
          if (prop === "fill" && Number.isFinite(profile.path.minX)) {
            addRegion(profile, {
              x: profile.path.minX,
              y: profile.path.minY,
              width: profile.path.maxX - profile.path.minX + 2,
              height: profile.path.maxY - profile.path.minY + 2,
              reason: "path"
            });
          }
          return Reflect.apply(native, target, args);
        });
      }

      if (prop === "fillText" || prop === "strokeText") {
        const raw = methodFromPrototype(prop);
        if (!raw) return Reflect.get(target, prop, receiver);
        return createWrapper(target, prop, raw, (native, args) => {
          profile.hasText = true;
          addRisk(profile, 40, `${String(prop)}:${target.font}:${String(args[0]).slice(0, 64)}`);
          record(`canvas2d.${String(prop)}`, "high");
          addRegion(profile, {
            x: Number(args[1]) || 0,
            y: (Number(args[2]) || 0) - 32,
            width: Math.max(32, String(args[0]).length * 18),
            height: 48,
            reason: "text"
          });
          if (config.perturbText) perturbTextArgs(args, seed, `${String(prop)}:${target.font}:${args[0]}`);
          return Reflect.apply(native, target, args);
        });
      }

      if (prop === "drawImage") {
        const raw = methodFromPrototype(prop);
        if (!raw) return Reflect.get(target, prop, receiver);
        return createWrapper(target, prop, raw, (native, args) => {
          profile.hasImage = true;
          addRisk(profile, 20, "drawImage");
          record("canvas2d.drawImage", config.perturbImages ? "high" : "low");
          if (config.perturbImages && typeof args[1] === "number" && typeof args[2] === "number") {
            const originalX = args[1];
            const originalY = args[2];
            args[1] = perturbNumber(originalX, seed, `drawImage:x:${originalX}:${originalY}`, 0.01);
            args[2] = perturbNumber(originalY, seed, `drawImage:y:${originalX}:${originalY}`, 0.01);
          }
          return Reflect.apply(native, target, args);
        });
      }

      if (prop === "getImageData") {
        const raw = methodFromPrototype(prop);
        if (!raw) return Reflect.get(target, prop, receiver);
        return createWrapper(target, prop, raw, (native, args) => {
          if (!silentCanvasReadback) {
            record("canvas2d.getImageData", profile.riskScore >= config.exportNoiseScore ? "high" : "low");
          }
          const imageData = Reflect.apply(native, target, args) as ImageData;
          if (config.perturbReadback && profile.riskScore >= config.exportNoiseScore) {
            return perturbImageData(imageData, profile, seed);
          }
          return imageData;
        });
      }

      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function") return bindRaw(value, target);
      return value;
    }
  });

  proxyContextProfiles.set(proxy, profile);
  proxyToRawContexts.set(proxy, ctx);
  contextProxies.set(ctx, proxy as Canvas2DContext);
  return proxy as CanvasRenderingContext2D;
};

export const installCanvas2D = (storage: ExtensionStorage) => {
  const config = storage.config.canvas2d;
  if (!storage.config.enabled || !config.enabled) return;

  const seed = resolveCanvasSeed(storage);
  if (!seed) return;

  const rawGetContext = HTMLCanvasElement.prototype.getContext;
  const rawToDataURL = HTMLCanvasElement.prototype.toDataURL;
  const rawToBlob = HTMLCanvasElement.prototype.toBlob;
  const rawGetImageData = CanvasRenderingContext2D.prototype.getImageData;
  const rawPutImageData = CanvasRenderingContext2D.prototype.putImageData;

  HTMLCanvasElement.prototype.getContext = nativeProxy(rawGetContext, {
    apply(target, thisArg: HTMLCanvasElement, args: Parameters<HTMLCanvasElement["getContext"]>) {
      const result = Reflect.apply(target, thisArg, args);
      if (args[0] !== "2d" || !result) return result;
      rawContextProfiles.set(result as CanvasRenderingContext2D, getProfileForCanvas(thisArg));
      return createProtectedContext(result as CanvasRenderingContext2D, config, seed);
    }
  }) as typeof HTMLCanvasElement.prototype.getContext;

  if (config.perturbExportPixels) {
    HTMLCanvasElement.prototype.toDataURL = nativeProxy(rawToDataURL, {
      apply(target, thisArg: HTMLCanvasElement, args) {
        const profile = getProfileForCanvas(thisArg);
        record("canvas2d.toDataURL", profile.riskScore >= config.exportNoiseScore ? "high" : "low");
        if (profile.riskScore < config.exportNoiseScore) return Reflect.apply(target, thisArg, args);

        const ctx = Reflect.apply(rawGetContext, thisArg, ["2d", { willReadFrequently: true }]) as CanvasRenderingContext2D | null;
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

    HTMLCanvasElement.prototype.toBlob = nativeProxy(rawToBlob, {
      apply(target, thisArg: HTMLCanvasElement, args) {
        const profile = getProfileForCanvas(thisArg);
        record("canvas2d.toBlob", profile.riskScore >= config.exportNoiseScore ? "high" : "low");
        const originalCallback = args[0];
        let ctx: CanvasRenderingContext2D | null = null;
        let original: ImageData | undefined;
        if (profile.riskScore >= config.exportNoiseScore) {
          ctx = Reflect.apply(rawGetContext, thisArg, ["2d", { willReadFrequently: true }]) as CanvasRenderingContext2D | null;
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
          args[0] = function wrappedToBlobCallback(this: unknown, blob: Blob | null) {
            if (ctx && original) Reflect.apply(rawPutImageData, ctx, [original, 0, 0]);
            return Reflect.apply(originalCallback, this, [blob]);
          };
        }
        return Reflect.apply(target, thisArg, args);
      }
    }) as typeof HTMLCanvasElement.prototype.toBlob;

    registerFunction(HTMLCanvasElement.prototype.toDataURL, rawToDataURL);
    registerFunction(HTMLCanvasElement.prototype.toBlob, rawToBlob);
  }

  registerFunction(HTMLCanvasElement.prototype.getContext, rawGetContext);
};
