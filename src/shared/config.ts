export type SeedMode = "default" | "value" | "page" | "domain" | "browser" | "global";

export type Canvas2DConfig = {
  enabled: boolean;
  mode: SeedMode;
  exportNoiseScore: number;
  perturbText: boolean;
  perturbCurves: boolean;
  perturbGradients: boolean;
  perturbImages: boolean;
  perturbReadback: boolean;
  perturbExportPixels: boolean;
};

export type AudioConfig = {
  enabled: boolean;
  mode: SeedMode;
  bufferNoiseScore: number;
  perturbCompressor: boolean;
  perturbAnalyser: boolean;
};

export type StealthConfig = {
  enabled: boolean;
  recordNativeChecks: boolean;
};

export type ExtensionConfig = {
  enabled: boolean;
  browserSeed: number;
  globalSeed: number;
  seedText: string;
  canvas2d: Canvas2DConfig;
  audio: AudioConfig;
  stealth: StealthConfig;
};

export type ExtensionStorage = {
  version: number;
  config: ExtensionConfig;
  whitelist: string[];
};

export const DEFAULT_STORAGE: ExtensionStorage = {
  version: 1,
  config: {
    enabled: true,
    browserSeed: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
    globalSeed: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
    seedText: Math.random().toString(36).slice(2, 12),
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

export const mergeDefaults = <T extends Record<string, unknown>>(defaults: T, value: unknown): T => {
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

export const normalizeStorage = (value: unknown): ExtensionStorage => {
  return mergeDefaults(DEFAULT_STORAGE, value);
};
