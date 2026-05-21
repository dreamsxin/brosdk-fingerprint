import type { ExtensionStorage } from "../../../shared/config";
import { mulberry32 } from "../../core/random";
import { record } from "../../core/record";
import { resolveWebGLSeed } from "../../core/seed";
import { nativeProxy } from "../../core/stealth";
import { addWebGLRisk, createWebGLProfile, type WebGLProfile } from "./profile";

type WebGLAny = WebGLRenderingContext | WebGL2RenderingContext;
type WebGLPrototype = WebGLRenderingContext & WebGL2RenderingContext;

const profiles = new WeakMap<WebGLAny, WebGLProfile>();

const getProfile = (gl: WebGLAny): WebGLProfile => {
  let profile = profiles.get(gl);
  if (!profile) {
    profile = createWebGLProfile();
    profiles.set(gl, profile);
  }
  return profile;
};

const perturbPixels = (pixels: unknown, profile: WebGLProfile, seed: number) => {
  if (!(pixels instanceof Uint8Array || pixels instanceof Uint8ClampedArray)) return;
  if (!pixels.length || profile.riskScore <= 0) return;
  const random = mulberry32(seed ^ profile.riskScore ^ pixels.length);
  const step = pixels.length > 4096 ? 97 : 29;
  for (let i = 0; i < pixels.length; i += step) {
    pixels[i] = Math.max(0, Math.min(255, pixels[i] + (random() > 0.5 ? 1 : -1)));
  }
};

const installForPrototype = (
  proto: WebGLPrototype,
  storage: ExtensionStorage,
  seed: number
) => {
  const config = storage.config.webgl;

  const rawGetExtension = proto.getExtension;
  proto.getExtension = nativeProxy(rawGetExtension, {
    apply(target, thisArg: WebGLAny, args: Parameters<WebGLRenderingContext["getExtension"]>) {
      const name = String(args[0] ?? "");
      const profile = getProfile(thisArg);
      if (name === "WEBGL_debug_renderer_info") {
        addWebGLRisk(profile, 35, "extension.debug_renderer_info");
        record("webgl.debugRendererInfo", "high");
      } else {
        addWebGLRisk(profile, 5, `extension.${name}`);
        record("webgl.getExtension", "low");
      }
      return Reflect.apply(target, thisArg, args);
    }
  }) as typeof proto.getExtension;

  const rawGetSupportedExtensions = proto.getSupportedExtensions;
  proto.getSupportedExtensions = nativeProxy(rawGetSupportedExtensions, {
    apply(target, thisArg: WebGLAny, args) {
      const profile = getProfile(thisArg);
      addWebGLRisk(profile, 15, "supportedExtensions");
      record("webgl.getSupportedExtensions", "low");
      return Reflect.apply(target, thisArg, args);
    }
  }) as typeof proto.getSupportedExtensions;

  const rawGetParameter = proto.getParameter;
  proto.getParameter = nativeProxy(rawGetParameter, {
    apply(target, thisArg: WebGLAny, args: Parameters<WebGLRenderingContext["getParameter"]>) {
      const profile = getProfile(thisArg);
      const pname = args[0];
      const debugInfo = Reflect.apply(rawGetExtension, thisArg, ["WEBGL_debug_renderer_info"]) as WEBGL_debug_renderer_info | null;
      if (debugInfo && (pname === debugInfo.UNMASKED_VENDOR_WEBGL || pname === debugInfo.UNMASKED_RENDERER_WEBGL)) {
        addWebGLRisk(profile, 40, "parameter.unmasked_renderer");
        record("webgl.unmaskedRenderer", "high");
        if (config.spoofDebugInfo) {
          return pname === debugInfo.UNMASKED_VENDOR_WEBGL ? config.vendor : config.renderer;
        }
      } else {
        addWebGLRisk(profile, 5, `parameter.${pname}`);
      }
      return Reflect.apply(target, thisArg, args);
    }
  }) as typeof proto.getParameter;

  const rawGetShaderPrecisionFormat = proto.getShaderPrecisionFormat;
  proto.getShaderPrecisionFormat = nativeProxy(rawGetShaderPrecisionFormat, {
    apply(target, thisArg: WebGLAny, args) {
      const profile = getProfile(thisArg);
      addWebGLRisk(profile, 20, "shaderPrecision");
      record("webgl.shaderPrecision", "low");
      return Reflect.apply(target, thisArg, args);
    }
  }) as typeof proto.getShaderPrecisionFormat;

  const rawReadPixels = proto.readPixels;
  proto.readPixels = nativeProxy(rawReadPixels, {
    apply(target, thisArg: WebGLAny, args: Parameters<WebGLRenderingContext["readPixels"]>) {
      const profile = getProfile(thisArg);
      addWebGLRisk(profile, 35, "readPixels");
      record("webgl.readPixels", profile.riskScore >= config.readPixelsNoiseScore ? "high" : "low");
      const result = Reflect.apply(target, thisArg, args);
      if (config.perturbReadPixels && profile.riskScore >= config.readPixelsNoiseScore) {
        perturbPixels(args[6], profile, seed);
      }
      return result;
    }
  }) as typeof proto.readPixels;
};

export const installWebGL = (storage: ExtensionStorage) => {
  const config = storage.config.webgl;
  if (!storage.config.enabled || !config.enabled) return;

  const seed = resolveWebGLSeed(storage);
  if (!seed) return;

  if (typeof WebGLRenderingContext !== "undefined") {
    installForPrototype(WebGLRenderingContext.prototype as WebGLPrototype, storage, seed);
  }
  if (typeof WebGL2RenderingContext !== "undefined") {
    installForPrototype(WebGL2RenderingContext.prototype as WebGLPrototype, storage, seed);
  }
};
