import type { ExtensionStorage } from "../../shared/config";
import { hashString } from "./random";

export const resolveSeed = (storage: ExtensionStorage): number => {
  const mode = storage.config.canvas2d.mode;
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
