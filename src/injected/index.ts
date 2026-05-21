import type { ExtensionStorage } from "../shared/config";
import { installStealth } from "./core/stealth";
import { installAudio } from "./modules/audio";
import { installCanvas2D } from "./modules/canvas2d";

const defaultStorage: ExtensionStorage = {
  version: 1,
  config: {
    enabled: true,
    browserSeed: 0,
    globalSeed: 311415926,
    seedText: "default",
    canvas2d: {
      enabled: true,
      mode: "domain",
      exportNoiseScore: 50,
      perturbText: true,
      perturbCurves: true,
      perturbGradients: true,
      perturbImages: false,
      perturbReadback: false,
      perturbExportPixels: false
    },
    audio: {
      enabled: true,
      mode: "domain",
      bufferNoiseScore: 80,
      perturbCompressor: true,
      perturbAnalyser: true
    },
    stealth: {
      enabled: true,
      recordNativeChecks: true
    }
  },
  whitelist: []
};

const isObject = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

const mergeDefaults = <T extends Record<string, unknown>>(defaults: T, value: unknown): T => {
  if (!isObject(value)) return structuredClone(defaults);
  const result: Record<string, unknown> = structuredClone(defaults);
  for (const [key, incoming] of Object.entries(value)) {
    const current = result[key];
    if (isObject(current) && isObject(incoming)) {
      result[key] = mergeDefaults(current, incoming);
    } else if (key in result) {
      result[key] = incoming;
    }
  }
  return result as T;
};

const readStorage = (): ExtensionStorage | undefined => {
  const script = document.currentScript as HTMLScriptElement | null;
  const raw = script?.dataset.brosdkFingerprint;
  if (!raw) return undefined;
  try {
    return mergeDefaults(defaultStorage, JSON.parse(raw));
  } catch {
    return undefined;
  }
};

const storage = readStorage();

if (storage?.config.enabled) {
  if (storage.config.stealth.enabled) {
    installStealth(storage.config.stealth);
  }
  installCanvas2D(storage);
  installAudio(storage);
}
