import { record } from "../../core/record";
import { nativeProxy } from "../../core/stealth";

const SYSTEM_COLOR_NAMES = new Set([
  "accentcolor",
  "accentcolortext",
  "activetext",
  "buttonface",
  "buttontext",
  "canvas",
  "canvastext",
  "field",
  "fieldtext",
  "graytext",
  "highlight",
  "highlighttext",
  "linktext",
  "mark",
  "marktext",
  "visitedtext",
  "window",
  "windowtext"
]);

const installGetterRecord = (owner: object | undefined, property: string, key: string, level: "low" | "high" = "low") => {
  if (!owner) return;
  const descriptor = Object.getOwnPropertyDescriptor(owner, property);
  if (!descriptor || typeof descriptor.get !== "function" || !descriptor.configurable) return;
  const rawGet = descriptor.get;
  Object.defineProperty(owner, property, {
    ...descriptor,
    get: nativeProxy(rawGet, {
      apply(target, thisArg, args) {
        record(key, level);
        return Reflect.apply(target, thisArg, args);
      }
    })
  });
};

export const installSystemDetection = () => {
  const rawGetComputedStyle = window.getComputedStyle;
  if (typeof rawGetComputedStyle === "function") {
    window.getComputedStyle = nativeProxy(rawGetComputedStyle, {
      apply(target, thisArg, args: [Element, string | null | undefined]) {
        const [element, pseudoElt] = args;
        const inlineColor = element instanceof HTMLElement ? element.style.color.trim().toLowerCase() : "";
        const inlineBackground = element instanceof HTMLElement ? element.style.backgroundColor.trim().toLowerCase() : "";
        if (SYSTEM_COLOR_NAMES.has(inlineColor) || SYSTEM_COLOR_NAMES.has(inlineBackground)) {
          record("system.colors", "low");
        }
        if (element instanceof HTMLElement && (element === document.body || element === document.documentElement)) {
          record("css.computedStyle.root", "low");
        }
        return Reflect.apply(target, thisArg, [element, pseudoElt]);
      }
    }) as typeof window.getComputedStyle;
  }

  const rawCreateEvent = Document.prototype.createEvent;
  if (typeof rawCreateEvent === "function") {
    Document.prototype.createEvent = nativeProxy(rawCreateEvent, {
      apply(target, thisArg, args: [string]) {
        if (String(args[0]).toLowerCase() === "touchevent") record("screen.touchEventProbe", "low");
        return Reflect.apply(target, thisArg, args);
      }
    }) as typeof rawCreateEvent;
  }

  const rawCreateElement = Document.prototype.createElement;
  if (typeof rawCreateElement === "function") {
    Document.prototype.createElement = nativeProxy(rawCreateElement, {
      apply(target, thisArg, args: Parameters<Document["createElement"]>) {
        const tagName = String(args[0] ?? "").toLowerCase();
        if (tagName === "iframe") record("system.iframeProbe", "low");
        if (tagName === "canvas") record("system.canvasElementProbe", "low");
        return Reflect.apply(target, thisArg, args);
      }
    }) as typeof rawCreateElement;
  }

  const rawMatchMedia = window.matchMedia;
  if (typeof rawMatchMedia === "function") {
    window.matchMedia = nativeProxy(rawMatchMedia, {
      apply(target, thisArg, args: [string]) {
        record("system.matchMedia", "low");
        return Reflect.apply(target, thisArg, args);
      }
    }) as typeof window.matchMedia;
  }

  const rawCSSSupports = CSS?.supports;
  if (typeof rawCSSSupports === "function") {
    CSS.supports = nativeProxy(rawCSSSupports, {
      apply(target, thisArg, args) {
        record("css.supports", "low");
        return Reflect.apply(target, thisArg, args);
      }
    }) as typeof CSS.supports;
  }

  const cssStyleProto = typeof CSSStyleDeclaration !== "undefined" ? CSSStyleDeclaration.prototype : undefined;
  for (const property of ["length", "cssText"]) {
    installGetterRecord(cssStyleProto, property, `css.styleDeclaration.${property}`, "low");
  }

  const rawPerformanceTiming = Object.getOwnPropertyDescriptor(Performance.prototype, "timing");
  if (rawPerformanceTiming?.get && rawPerformanceTiming.configurable) {
    const rawGet = rawPerformanceTiming.get;
    Object.defineProperty(Performance.prototype, "timing", {
      ...rawPerformanceTiming,
      get: nativeProxy(rawGet, {
        apply(target, thisArg, args) {
          record("performance.timing", "low");
          return Reflect.apply(target, thisArg, args);
        }
      })
    });
  }

  installGetterRecord(Performance.prototype, "navigation", "performance.navigation", "low");
  installGetterRecord(
    Performance.prototype,
    "memory",
    "performance.memory",
    "low"
  );

  const documentProto = Document.prototype;
  for (const property of ["characterSet", "compatMode", "documentURI", "hidden", "visibilityState", "referrer", "images", "all"]) {
    installGetterRecord(documentProto, property, `document.${property}`, "low");
  }

  const windowProto = Window.prototype;
  for (const property of [
    "innerWidth",
    "innerHeight",
    "outerWidth",
    "outerHeight",
    "screenX",
    "screenY",
    "pageXOffset",
    "pageYOffset",
    "devicePixelRatio",
    "isSecureContext",
    "visualViewport",
    "localStorage",
    "sessionStorage"
  ]) {
    installGetterRecord(windowProto, property, `window.${property}`, "low");
  }

  for (const property of ["toolbar", "locationbar", "menubar", "scrollbars", "external", "netscape"]) {
    installGetterRecord(windowProto, property, `window.legacy.${property}`, "low");
  }
};
