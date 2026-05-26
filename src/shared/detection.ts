import type { FingerprintRecord } from "./messages";

export type FingerprintSurface =
  | "canvas2d"
  | "audio"
  | "webgl"
  | "native"
  | "webgpu"
  | "fonts"
  | "identity"
  | "unknown";

export type DetectionLevel = "none" | "low" | "medium" | "high";

export type SurfaceDetection = {
  surface: FingerprintSurface;
  label: string;
  score: number;
  level: DetectionLevel;
  count: number;
  highCount: number;
  signals: string[];
  records: FingerprintRecord[];
};

export type FingerprintDetectionSummary = {
  level: DetectionLevel;
  score: number;
  totalCount: number;
  highCount: number;
  activeSurfaces: number;
  signals: string[];
  surfaces: SurfaceDetection[];
};

const SURFACE_LABELS: Record<FingerprintSurface, string> = {
  canvas2d: "Canvas 2D",
  audio: "Audio",
  webgl: "WebGL",
  native: "Native checks",
  webgpu: "WebGPU",
  fonts: "Fonts",
  identity: "Identity APIs",
  unknown: "Other"
};

const surfaceForKey = (key: string): FingerprintSurface => {
  if (key.startsWith("canvas2d.")) return "canvas2d";
  if (key.startsWith("audio.")) return "audio";
  if (key.startsWith("webgl.")) return "webgl";
  if (key.startsWith("native-check.")) return "native";
  if (key.startsWith("webgpu.")) return "webgpu";
  if (key.startsWith("fonts.") || key.startsWith("font.")) return "fonts";
  if (
    key.startsWith("navigator.") ||
    key.startsWith("screen.") ||
    key.startsWith("system.") ||
    key.startsWith("timezone.") ||
    key.startsWith("permissions.") ||
    key.startsWith("battery.") ||
    key.startsWith("network.") ||
    key.startsWith("mediaDevices.") ||
    key.startsWith("runtime.") ||
    key.startsWith("performance.") ||
    key.startsWith("css.") ||
    key.startsWith("storage.") ||
    key.startsWith("document.") ||
    key.startsWith("window.") ||
    key.startsWith("webrtc.") ||
    key.startsWith("sensor.") ||
    key.startsWith("speechSynthesis.")
  ) {
    return "identity";
  }
  return "unknown";
};

const levelForScore = (score: number): DetectionLevel => {
  if (score >= 90) return "high";
  if (score >= 45) return "medium";
  if (score > 0) return "low";
  return "none";
};

const hasKey = (records: FingerprintRecord[], key: string) => records.some((record) => record.key === key);

const hasPrefix = (records: FingerprintRecord[], prefix: string) => records.some((record) => record.key.startsWith(prefix));

const hasAny = (records: FingerprintRecord[], keys: string[]) => keys.some((key) => hasKey(records, key));

const collectSurfaceSignals = (surface: FingerprintSurface, records: FingerprintRecord[]): string[] => {
  const signals: string[] = [];
  if (!records.length) return signals;

  if (surface === "canvas2d") {
    if (hasAny(records, ["canvas2d.toDataURL", "canvas2d.toBlob", "canvas2d.getImageData"])) {
      signals.push("canvas readback/export");
    }
    if (hasAny(records, ["canvas2d.fillText", "canvas2d.strokeText"])) signals.push("canvas text fingerprint path");
    if (hasPrefix(records, "canvas2d.path.") || hasPrefix(records, "canvas2d.arc") || hasPrefix(records, "canvas2d.ellipse")) {
      signals.push("canvas curve/path entropy");
    }
    if (hasKey(records, "canvas2d.gradient")) signals.push("canvas gradient entropy");
    if (hasKey(records, "canvas2d.drawImage")) signals.push("canvas drawImage replay/scale path");
  }

  if (surface === "audio") {
    if (hasAny(records, ["audio.offlineContext", "audio.startRendering"])) signals.push("offline audio rendering");
    if (hasAny(records, ["audio.oscillator", "audio.compressor", "audio.analyser"])) signals.push("audio fingerprint graph");
    if (hasAny(records, ["audio.getChannelData", "audio.copyFromChannel"])) signals.push("audio buffer readback");
  }

  if (surface === "webgl") {
    if (hasAny(records, ["webgl.debugRendererInfo", "webgl.unmaskedRenderer"])) signals.push("unmasked GPU renderer query");
    if (hasAny(records, ["webgl.getSupportedExtensions", "webgl.shaderPrecision"])) signals.push("WebGL capability enumeration");
    if (hasKey(records, "webgl.readPixels")) signals.push("WebGL pixel readback");
  }

  if (surface === "native") {
    signals.push("native function or hook detection");
  }

  if (surface === "webgpu") {
    signals.push("WebGPU adapter/capability probing");
  }

  if (surface === "fonts") {
    if (hasKey(records, "fonts.measureText")) signals.push("font metric probing");
    if (hasKey(records, "fonts.localFontFace")) signals.push("local font probing");
    if (hasKey(records, "fonts.queryLocalFonts")) signals.push("local font enumeration");
    if (!signals.length) signals.push("font probing");
  }

  if (surface === "identity") {
    if (hasPrefix(records, "navigator.")) signals.push("navigator identity probing");
    if (hasPrefix(records, "screen.")) signals.push("screen capability probing");
    if (hasKey(records, "screen.touchEventProbe")) signals.push("touch capability probing");
    if (hasPrefix(records, "system.")) signals.push("system color probing");
    if (hasPrefix(records, "timezone.")) signals.push("timezone probing");
    if (hasPrefix(records, "permissions.")) signals.push("permission state probing");
    if (hasPrefix(records, "battery.")) signals.push("battery API probing");
    if (hasPrefix(records, "network.")) signals.push("network information probing");
    if (hasPrefix(records, "mediaDevices.")) signals.push("media device enumeration");
    if (hasPrefix(records, "webrtc.")) signals.push("WebRTC local network probing");
    if (hasPrefix(records, "runtime.")) signals.push("runtime/realm enumeration");
    if (hasPrefix(records, "performance.")) signals.push("performance timing probing");
    if (hasPrefix(records, "css.")) signals.push("CSS feature/style probing");
    if (hasPrefix(records, "storage.")) signals.push("storage/quota/privacy-mode probing");
    if (hasPrefix(records, "document.")) signals.push("document environment probing");
    if (hasPrefix(records, "window.")) signals.push("window feature probing");
    if (hasPrefix(records, "sensor.")) signals.push("sensor capability probing");
    if (hasPrefix(records, "speechSynthesis.")) signals.push("speech voice probing");
    if (!signals.length) signals.push("navigator/screen/timezone identity probing");
  }

  if (!signals.length) signals.push("fingerprint API access");
  return signals;
};

const scoreSurface = (surface: FingerprintSurface, records: FingerprintRecord[]): number => {
  const highCount = records.filter((record) => record.level === "high").reduce((sum, record) => sum + record.count, 0);
  const totalCount = records.reduce((sum, record) => sum + record.count, 0);
  const uniqueCount = records.length;
  let score = Math.min(30, uniqueCount * 4) + Math.min(30, highCount * 6) + Math.min(20, totalCount);

  if (surface === "canvas2d") {
    if (hasAny(records, ["canvas2d.toDataURL", "canvas2d.toBlob", "canvas2d.getImageData"])) score += 18;
    if (hasAny(records, ["canvas2d.fillText", "canvas2d.strokeText"])) score += 12;
    if (hasKey(records, "canvas2d.gradient")) score += 8;
    if (hasKey(records, "canvas2d.drawImage")) score += 8;
  }

  if (surface === "audio") {
    if (hasAny(records, ["audio.offlineContext", "audio.startRendering"])) score += 20;
    if (hasAny(records, ["audio.getChannelData", "audio.copyFromChannel"])) score += 12;
  }

  if (surface === "webgl") {
    if (hasAny(records, ["webgl.debugRendererInfo", "webgl.unmaskedRenderer"])) score += 18;
    if (hasKey(records, "webgl.readPixels")) score += 16;
  }

  if (surface === "fonts") {
    if (hasKey(records, "fonts.measureText")) score += 12;
    if (hasKey(records, "fonts.localFontFace")) score += 20;
    if (hasKey(records, "fonts.queryLocalFonts")) score += 24;
  }

  if (surface === "identity") {
    if (hasPrefix(records, "navigator.")) score += 10;
    if (hasPrefix(records, "screen.")) score += 8;
    if (hasPrefix(records, "system.")) score += 8;
    if (hasPrefix(records, "timezone.")) score += 8;
    if (hasPrefix(records, "permissions.")) score += 8;
    if (hasKey(records, "navigator.userAgentData.getHighEntropyValues")) score += 18;
    if (hasPrefix(records, "battery.")) score += 8;
    if (hasPrefix(records, "network.")) score += 6;
    if (hasPrefix(records, "mediaDevices.")) score += 16;
    if (hasPrefix(records, "webrtc.")) score += 16;
    if (hasPrefix(records, "runtime.objectKeys.")) score += 12;
    if (hasPrefix(records, "performance.")) score += 6;
    if (hasPrefix(records, "css.")) score += 8;
    if (hasPrefix(records, "storage.")) score += 10;
    if (hasPrefix(records, "document.")) score += 6;
    if (hasPrefix(records, "window.")) score += 8;
  }

  if (surface === "native") score += 25;
  if (surface === "unknown") score = Math.min(score, 35);
  return Math.min(100, score);
};

export const analyzeFingerprintRecords = (records: FingerprintRecord[]): FingerprintDetectionSummary => {
  const grouped = new Map<FingerprintSurface, FingerprintRecord[]>();
  for (const record of records) {
    const surface = surfaceForKey(record.key);
    const list = grouped.get(surface) ?? [];
    list.push(record);
    grouped.set(surface, list);
  }

  const surfaces = [...grouped.entries()]
    .map(([surface, surfaceRecords]) => {
      const score = scoreSurface(surface, surfaceRecords);
      const count = surfaceRecords.reduce((sum, record) => sum + record.count, 0);
      const highCount = surfaceRecords
        .filter((record) => record.level === "high")
        .reduce((sum, record) => sum + record.count, 0);
      return {
        surface,
        label: SURFACE_LABELS[surface],
        score,
        level: levelForScore(score),
        count,
        highCount,
        signals: collectSurfaceSignals(surface, surfaceRecords),
        records: [...surfaceRecords].sort((a, b) => {
          if (a.level !== b.level) return a.level === "high" ? -1 : 1;
          return b.count - a.count;
        })
      };
    })
    .sort((a, b) => b.score - a.score);

  const totalCount = records.reduce((sum, record) => sum + record.count, 0);
  const highCount = records.filter((record) => record.level === "high").reduce((sum, record) => sum + record.count, 0);
  const activeSurfaces = surfaces.filter((surface) => surface.surface !== "unknown").length;
  let score = Math.min(100, Math.max(0, ...surfaces.map((surface) => surface.score), 0));
  if (activeSurfaces >= 2) score = Math.min(100, score + 12);
  if (activeSurfaces >= 3) score = Math.min(100, score + 10);
  if (highCount >= 5) score = Math.min(100, score + 8);

  return {
    level: levelForScore(score),
    score,
    totalCount,
    highCount,
    activeSurfaces,
    signals: surfaces.flatMap((surface) => surface.signals).slice(0, 8),
    surfaces
  };
};
