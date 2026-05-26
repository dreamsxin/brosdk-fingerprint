import { record } from "../../core/record";
import { nativeProxy } from "../../core/stealth";

const classifyOwnKeysTarget = (target: object): string | undefined => {
  if (target === window) return "window";
  if (target === navigator) return "navigator";
  if (target === screen) return "screen";
  if (target === document) return "document";
  if (target === Function.prototype) return "functionPrototype";
  if (target === Object.prototype) return "objectPrototype";
  if (target instanceof Navigator) return "navigatorInstance";
  if (target instanceof Screen) return "screenInstance";
  return undefined;
};

const recordStorageAccess = (name: string, key: unknown) => {
  if (typeof key !== "string") return;
  const normalized = key.toLowerCase();
  if (
    normalized.includes("fingerprint") ||
    normalized.includes("fp") ||
    normalized.includes("canvas") ||
    normalized.includes("webgl") ||
    normalized.includes("leak") ||
    normalized.includes("browser")
  ) {
    record(`storage.${name}.fingerprintKey`, "low");
  } else {
    record(`storage.${name}`, "low");
  }
};

const storageNameFor = (storage: unknown): "localStorage" | "sessionStorage" | "storage" => {
  try {
    if (storage === window.localStorage) return "localStorage";
  } catch {
    // Access may throw in blocked storage contexts.
  }
  try {
    if (storage === window.sessionStorage) return "sessionStorage";
  } catch {
    // Access may throw in blocked storage contexts.
  }
  return "storage";
};

const installStorageDetection = () => {
  let storage: Storage | undefined;
  try {
    storage = window.Storage ? window.localStorage : undefined;
  } catch {
    storage = undefined;
  }
  if (!storage) return;
  const proto = Object.getPrototypeOf(storage) as Storage | undefined;
  if (!proto) return;
  for (const key of ["getItem", "setItem", "removeItem"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, key);
    if (!descriptor || typeof descriptor.value !== "function" || !descriptor.configurable) continue;
    const raw = descriptor.value;
    Object.defineProperty(proto, key, {
      ...descriptor,
      value: nativeProxy(raw, {
        apply(target, thisArg, args) {
          recordStorageAccess(`${storageNameFor(thisArg)}.${key}`, args[0]);
          return Reflect.apply(target, thisArg, args);
        }
      })
    });
  }
};

export const installRuntimeDetection = () => {
  const rawObjectKeys = Object.keys;
  Object.keys = nativeProxy(rawObjectKeys, {
    apply(target, thisArg, args: [object]) {
      const kind = classifyOwnKeysTarget(args[0]);
      if (kind) record(`runtime.objectKeys.${kind}`, kind === "navigator" || kind === "screen" ? "high" : "low");
      return Reflect.apply(target, thisArg, args);
    }
  }) as typeof Object.keys;

  const rawQuerySelector = Document.prototype.querySelector;
  if (typeof rawQuerySelector === "function") {
    Document.prototype.querySelector = nativeProxy(rawQuerySelector, {
      apply(target, thisArg, args: [string]) {
        if (/^iframe$/i.test(String(args[0]))) record("runtime.iframeLookup", "low");
        return Reflect.apply(target, thisArg, args);
      }
    }) as typeof rawQuerySelector;
  }

  const rawAddEventListener = EventTarget.prototype.addEventListener;
  if (typeof rawAddEventListener === "function") {
    EventTarget.prototype.addEventListener = nativeProxy(rawAddEventListener, {
      apply(target, thisArg, args: Parameters<EventTarget["addEventListener"]>) {
        const type = String(args[0] ?? "").toLowerCase();
        if (type === "deviceorientation" || type === "devicemotion") {
          record(`sensor.${type}`, "low");
        }
        return Reflect.apply(target, thisArg, args);
      }
    }) as typeof rawAddEventListener;
  }

  const rtcConstructors = ["RTCPeerConnection", "webkitRTCPeerConnection", "mozRTCPeerConnection"] as const;
  const windowWithRTC = window as typeof window & Record<string, unknown>;
  for (const key of rtcConstructors) {
    const raw = windowWithRTC[key];
    if (typeof raw !== "function") continue;
    Object.defineProperty(window, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: nativeProxy(raw, {
        construct(target, args, newTarget) {
          record("webrtc.peerConnection", "high");
          return Reflect.construct(target, args, newTarget);
        }
      })
    });
  }

  if (typeof speechSynthesis !== "undefined" && typeof speechSynthesis.getVoices === "function") {
    const rawGetVoices = speechSynthesis.getVoices;
    speechSynthesis.getVoices = nativeProxy(rawGetVoices, {
      apply(target, thisArg, args) {
        record("speechSynthesis.getVoices", "low");
        return Reflect.apply(target, thisArg, args);
      }
    }) as typeof speechSynthesis.getVoices;
  }

  installStorageDetection();

  const rawIndexedDB = Object.getOwnPropertyDescriptor(Window.prototype, "indexedDB");
  if (rawIndexedDB?.get && rawIndexedDB.configurable) {
    Object.defineProperty(Window.prototype, "indexedDB", {
      ...rawIndexedDB,
      get: nativeProxy(rawIndexedDB.get, {
        apply(target, thisArg, args) {
          record("storage.indexedDB", "low");
          return Reflect.apply(target, thisArg, args);
        }
      })
    });
  }

  const navigatorWithStorage = navigator as Navigator & {
    storage?: {
      estimate?: (...args: unknown[]) => Promise<unknown>;
      persist?: (...args: unknown[]) => Promise<unknown>;
      persisted?: (...args: unknown[]) => Promise<unknown>;
    };
  };
  const storageManager = navigatorWithStorage.storage;
  if (storageManager) {
    const proto = Object.getPrototypeOf(storageManager);
    for (const key of ["estimate", "persist", "persisted"] as const) {
      const raw = proto?.[key];
      if (typeof raw !== "function") continue;
      proto[key] = nativeProxy(raw, {
        apply(target, thisArg, args) {
          record(`storage.${key}`, "low");
          return Reflect.apply(target, thisArg, args);
        }
      });
    }
  }

  const windowWithRequestFileSystem = window as typeof window & {
    requestFileSystem?: (...args: unknown[]) => unknown;
    webkitRequestFileSystem?: (...args: unknown[]) => unknown;
  };
  for (const key of ["requestFileSystem", "webkitRequestFileSystem"] as const) {
    const raw = windowWithRequestFileSystem[key];
    if (typeof raw !== "function") continue;
    windowWithRequestFileSystem[key] = nativeProxy(raw, {
      apply(target, thisArg, args) {
        record(`storage.${key}`, "low");
        return Reflect.apply(target, thisArg, args);
      }
    });
  }
};
