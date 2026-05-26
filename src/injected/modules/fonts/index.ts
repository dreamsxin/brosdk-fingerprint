import { record } from "../../core/record";
import { nativeProxy } from "../../core/stealth";

export const installFontDetection = () => {
  const rawMeasureText = CanvasRenderingContext2D.prototype.measureText;
  if (typeof rawMeasureText === "function") {
    CanvasRenderingContext2D.prototype.measureText = nativeProxy(rawMeasureText, {
      apply(target, thisArg, args: [string]) {
        record("fonts.measureText", "low");
        return Reflect.apply(target, thisArg, args);
      }
    }) as typeof rawMeasureText;
  }

  if (typeof FontFace === "function") {
    const RawFontFace = FontFace;
    window.FontFace = nativeProxy(RawFontFace, {
      construct(target, args, newTarget) {
        if (typeof args[1] === "string" && /^local\(/i.test(args[1].trim())) {
          record("fonts.localFontFace", "high");
        } else {
          record("fonts.fontFace", "low");
        }
        return Reflect.construct(target, args, newTarget);
      }
    }) as typeof FontFace;
  }

  const windowWithFonts = window as typeof window & {
    queryLocalFonts?: (...args: unknown[]) => Promise<unknown>;
  };
  if (typeof windowWithFonts.queryLocalFonts === "function") {
    const rawQueryLocalFonts = windowWithFonts.queryLocalFonts;
    windowWithFonts.queryLocalFonts = nativeProxy(rawQueryLocalFonts, {
      apply(target, thisArg, args) {
        record("fonts.queryLocalFonts", "high");
        return Reflect.apply(target, thisArg, args);
      }
    });
  }
};
