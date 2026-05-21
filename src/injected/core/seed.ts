import type { ExtensionStorage, SeedMode } from "../../shared/config";
import { hashString } from "./random";

export const resolveSeed = (storage: ExtensionStorage, mode: SeedMode): number => {
  switch (mode) {
    case "page":
      return hashString(`${location.href}:${Date.now()}:${Math.random()}`);
    case "domain":
      return hashString(location.hostname || location.href);
    case "browser":
      return storage.config.browserSeed;
    case "global":
      return storage.config.globalSeed;
    case "value":
      return storage.config.globalSeed;
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
