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
      configurable: true,
      enumerable: false
    });
  } catch {
    // Some engines reject redefining function metadata.
  }

  try {
    Object.defineProperty(wrapped, "length", {
      value: raw.length,
      configurable: true,
      enumerable: false
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

  const toStringProxy = nativeProxy(originals.functionToString, {
    apply(target, thisArg: Function, args) {
      const mapped = functionMap.get(thisArg);
      if (mapped) {
        maybeRecord("toString");
        return mapped.source;
      }
      return Reflect.apply(target, thisArg, args);
    }
  });
  Function.prototype.toString = toStringProxy as typeof Function.prototype.toString;

  Object.getOwnPropertyNames = nativeProxy(originals.getOwnPropertyNames, {
    apply(target, thisArg, args: [object]) {
      maybeRecord("ownKeys");
      return filterKeys(args[0], Reflect.apply(target, thisArg, args));
    }
  }) as typeof Object.getOwnPropertyNames;

  Object.getOwnPropertySymbols = nativeProxy(originals.getOwnPropertySymbols, {
    apply(target, thisArg, args: [object]) {
      maybeRecord("ownKeys");
      return filterKeys(args[0], Reflect.apply(target, thisArg, args));
    }
  }) as typeof Object.getOwnPropertySymbols;

  Reflect.ownKeys = nativeProxy(originals.reflectOwnKeys, {
    apply(target, thisArg, args: [object]) {
      maybeRecord("ownKeys");
      return filterKeys(args[0], Reflect.apply(target, thisArg, args));
    }
  }) as typeof Reflect.ownKeys;

  Object.getOwnPropertyDescriptor = nativeProxy(originals.getOwnPropertyDescriptor, {
    apply(target, thisArg, args: [object, PropertyKey]) {
      const [objectTarget, key] = args;
      const hidden = hiddenKeys.get(objectTarget);
      if (hidden?.has(key) || (typeof key === "symbol" && internalSymbols.has(key))) {
        maybeRecord("descriptor");
        return undefined;
      }
      return Reflect.apply(target, thisArg, args);
    }
  }) as typeof Object.getOwnPropertyDescriptor;

  Object.getOwnPropertyDescriptors = nativeProxy(originals.getOwnPropertyDescriptors, {
    apply(target, thisArg, args: [object]) {
      maybeRecord("descriptor");
      const objectTarget = args[0];
      const descriptors = Reflect.apply(target, thisArg, args);
      const hidden = hiddenKeys.get(objectTarget);
      for (const key of Reflect.ownKeys(descriptors)) {
        if (hidden?.has(key) || (typeof key === "symbol" && internalSymbols.has(key))) {
          delete descriptors[key as keyof typeof descriptors];
        }
      }
      return descriptors;
    }
  }) as typeof Object.getOwnPropertyDescriptors;
};
