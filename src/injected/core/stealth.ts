import { record } from "./record";

type FunctionRecord = {
  raw: Function;
  source: string;
};

const functionMap = new WeakMap<Function, FunctionRecord>();
const hiddenKeys = new WeakMap<object, Set<PropertyKey>>();
const internalSymbols = new Set<symbol>();

let installed = false;

const originals = {
  functionToString: Function.prototype.toString,
  getOwnPropertyNames: Object.getOwnPropertyNames,
  getOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
  getOwnPropertyDescriptors: Object.getOwnPropertyDescriptors,
  getOwnPropertySymbols: Object.getOwnPropertySymbols,
  reflectOwnKeys: Reflect.ownKeys
};

export const hideKey = (target: object, key: PropertyKey) => {
  let keys = hiddenKeys.get(target);
  if (!keys) {
    keys = new Set();
    hiddenKeys.set(target, keys);
  }
  keys.add(key);
  if (typeof key === "symbol") internalSymbols.add(key);
};

const filterKeys = <T extends PropertyKey>(target: object, keys: T[]): T[] => {
  const hidden = hiddenKeys.get(target);
  if (!hidden && internalSymbols.size === 0) return keys;
  return keys.filter((key) => !hidden?.has(key) && !(typeof key === "symbol" && internalSymbols.has(key)));
};

const nativeSourceFor = (raw: Function, fallbackName?: string): string => {
  try {
    return originals.functionToString.call(raw);
  } catch {
    return `function ${fallbackName ?? raw.name ?? ""}() { [native code] }`;
  }
};

export const registerFunction = <T extends Function>(wrapped: T, raw: Function, source?: string): T => {
  functionMap.set(wrapped, {
    raw,
    source: source ?? nativeSourceFor(raw, raw.name)
  });

  try {
    Object.defineProperty(wrapped, "name", {
      value: raw.name,
      configurable: true
    });
  } catch {
    // Some engines reject redefining function metadata.
  }

  try {
    Object.defineProperty(wrapped, "length", {
      value: raw.length,
      configurable: true
    });
  } catch {
    // Some engines reject redefining function metadata.
  }

  return wrapped;
};

export const nativeProxy = <T extends Function>(raw: T, handler: ProxyHandler<T>): T => {
  const proxy = new Proxy(raw, handler);
  return registerFunction(proxy, raw) as T;
};

export const installStealth = (options: { recordNativeChecks: boolean }) => {
  if (installed) return;
  installed = true;

  const maybeRecord = (key: string) => {
    if (options.recordNativeChecks) record(`native-check.${key}`, "high");
  };

  Function.prototype.toString = registerFunction(function toString(this: Function) {
    const mapped = functionMap.get(this);
    if (mapped) {
      maybeRecord("toString");
      return mapped.source;
    }
    return originals.functionToString.call(this);
  }, originals.functionToString) as typeof Function.prototype.toString;

  Object.getOwnPropertyNames = registerFunction(function getOwnPropertyNames(target: object) {
    maybeRecord("ownKeys");
    return filterKeys(target, originals.getOwnPropertyNames(target));
  }, originals.getOwnPropertyNames) as typeof Object.getOwnPropertyNames;

  Object.getOwnPropertySymbols = registerFunction(function getOwnPropertySymbols(target: object) {
    maybeRecord("ownKeys");
    return filterKeys(target, originals.getOwnPropertySymbols(target));
  }, originals.getOwnPropertySymbols) as typeof Object.getOwnPropertySymbols;

  Reflect.ownKeys = registerFunction(function ownKeys(target: object) {
    maybeRecord("ownKeys");
    return filterKeys(target, originals.reflectOwnKeys(target));
  }, originals.reflectOwnKeys) as typeof Reflect.ownKeys;

  Object.getOwnPropertyDescriptor = registerFunction(function getOwnPropertyDescriptor(target: object, key: PropertyKey) {
    const hidden = hiddenKeys.get(target);
    if (hidden?.has(key) || (typeof key === "symbol" && internalSymbols.has(key))) {
      maybeRecord("descriptor");
      return undefined;
    }
    return originals.getOwnPropertyDescriptor(target, key);
  }, originals.getOwnPropertyDescriptor) as typeof Object.getOwnPropertyDescriptor;

  Object.getOwnPropertyDescriptors = registerFunction(function getOwnPropertyDescriptors(target: object) {
    maybeRecord("descriptor");
    const descriptors = originals.getOwnPropertyDescriptors(target);
    for (const key of Reflect.ownKeys(descriptors)) {
      const hidden = hiddenKeys.get(target);
      if (hidden?.has(key) || (typeof key === "symbol" && internalSymbols.has(key))) {
        delete descriptors[key as keyof typeof descriptors];
      }
    }
    return descriptors;
  }, originals.getOwnPropertyDescriptors) as typeof Object.getOwnPropertyDescriptors;
};

