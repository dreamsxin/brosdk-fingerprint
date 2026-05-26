import { record } from "../../core/record";
import { nativeProxy } from "../../core/stealth";

const installGetterRecord = (owner: object | undefined, property: string, key: string, level: "low" | "high" = "low") => {
  if (!owner) return;
  const descriptor = Object.getOwnPropertyDescriptor(owner, property);
  if (!descriptor || typeof descriptor.get !== "function" || !descriptor.configurable) return;
  const rawGet = descriptor.get;
  const wrappedGet = nativeProxy(rawGet, {
    apply(target, thisArg, args) {
      record(key, level);
      return Reflect.apply(target, thisArg, args);
    }
  });
  Object.defineProperty(owner, property, {
    ...descriptor,
    get: wrappedGet
  });
};

const installMethodRecord = (owner: object | undefined, property: string, key: string, level: "low" | "high" = "low") => {
  if (!owner) return;
  const descriptor = Object.getOwnPropertyDescriptor(owner, property);
  if (!descriptor || typeof descriptor.value !== "function" || !descriptor.configurable) return;
  const raw = descriptor.value;
  Object.defineProperty(owner, property, {
    ...descriptor,
    value: nativeProxy(raw, {
      apply(target, thisArg, args) {
        record(key, level);
        return Reflect.apply(target, thisArg, args);
      }
    })
  });
};

type NavigatorWithExperimentalSurfaces = Navigator & {
  userAgentData?: {
    getHighEntropyValues?: (hints: string[]) => Promise<unknown>;
  };
  connection?: object;
  getBattery?: () => Promise<unknown>;
};

export const installIdentityDetection = () => {
  const navProto = Navigator.prototype;
  for (const property of [
    "userAgent",
    "platform",
    "languages",
    "language",
    "hardwareConcurrency",
    "deviceMemory",
    "webdriver",
    "plugins",
    "mimeTypes",
    "pdfViewerEnabled",
    "maxTouchPoints",
    "doNotTrack",
    "cookieEnabled",
    "onLine",
    "userAgentData",
    "connection",
    "mediaDevices",
    "gpu",
    "credentials",
    "storage",
    "bluetooth"
  ]) {
    installGetterRecord(navProto, property, `navigator.${property}`, property === "webdriver" ? "high" : "low");
  }

  installMethodRecord(navProto, "getBattery", "battery.getBattery", "low");
  installMethodRecord(navProto, "requestMediaKeySystemAccess", "navigator.requestMediaKeySystemAccess", "low");

  const screenProto = Screen.prototype;
  for (const property of ["width", "height", "availWidth", "availHeight", "colorDepth", "pixelDepth", "orientation"]) {
    installGetterRecord(screenProto, property, `screen.${property}`, "low");
  }

  const rawGetTimezoneOffset = Date.prototype.getTimezoneOffset;
  if (typeof rawGetTimezoneOffset === "function") {
    Date.prototype.getTimezoneOffset = nativeProxy(rawGetTimezoneOffset, {
      apply(target, thisArg, args) {
        record("timezone.getTimezoneOffset", "low");
        return Reflect.apply(target, thisArg, args);
      }
    }) as typeof Date.prototype.getTimezoneOffset;
  }

  const rawDateTimeFormat = Intl.DateTimeFormat;
  if (typeof rawDateTimeFormat === "function") {
    Intl.DateTimeFormat = nativeProxy(rawDateTimeFormat, {
      apply(target, thisArg, args) {
        record("timezone.intlDateTimeFormat", "low");
        return Reflect.apply(target, thisArg, args);
      },
      construct(target, args, newTarget) {
        record("timezone.intlDateTimeFormat", "low");
        return Reflect.construct(target, args, newTarget);
      }
    }) as typeof Intl.DateTimeFormat;
  }

  if (navigator.permissions?.query) {
    const rawQuery = navigator.permissions.query;
    navigator.permissions.query = nativeProxy(rawQuery, {
      apply(target, thisArg, args: [PermissionDescriptor]) {
        const permissionDesc = args[0];
        record(`permissions.${String(permissionDesc && permissionDesc.name)}`, "low");
        return Reflect.apply(target, thisArg, args);
      }
    }) as typeof navigator.permissions.query;
  }

  const experimentalNavigator = navigator as NavigatorWithExperimentalSurfaces;
  const userAgentData = experimentalNavigator.userAgentData;
  if (userAgentData && typeof userAgentData.getHighEntropyValues === "function") {
    installMethodRecord(
      Object.getPrototypeOf(userAgentData),
      "getHighEntropyValues",
      "navigator.userAgentData.getHighEntropyValues",
      "high"
    );
  }

  const connection = experimentalNavigator.connection;
  const connectionProto = connection ? Object.getPrototypeOf(connection) : undefined;
  for (const property of ["effectiveType", "rtt", "downlink", "saveData", "type"]) {
    installGetterRecord(connectionProto, property, `network.${property}`, "low");
  }

  const mediaDevices = navigator.mediaDevices;
  if (mediaDevices) {
    installMethodRecord(Object.getPrototypeOf(mediaDevices), "enumerateDevices", "mediaDevices.enumerateDevices", "high");
    installMethodRecord(Object.getPrototypeOf(mediaDevices), "getUserMedia", "mediaDevices.getUserMedia", "high");
  }
};
