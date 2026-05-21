import type { ExtensionStorage, SeedMode } from "../../shared/config";
import { hashString } from "./random";

export const resolveSeed = (storage: ExtensionStorage, mode: SeedMode): number => {
  const base = storage.config.globalSeed || hashString(storage.config.seedText || "brosdk");
  switch (mode) {
    case "page":
      return base ^ hashString(`${location.href}:${Date.now()}:${Math.random()}`);
    case "domain":
      return base ^ hashString(location.hostname || location.href);
    case "browser":
      return base ^ storage.config.browserSeed;
    case "global":
      return base;
    case "value":
      return base;
    case "default":
    default:
      return 0;
  }
};

export const resolveCanvasSeed = (storage: ExtensionStorage): number => {
  return resolveSeed(storage, storage.config.canvas2d.mode);
};

export const resolveAudioSeed = (storage: ExtensionStorage): number => {
  return resolveSeed(storage, storage.config.audio.mode);
};

export const resolveWebGLSeed = (storage: ExtensionStorage): number => {
  return resolveSeed(storage, storage.config.webgl.mode);
};
