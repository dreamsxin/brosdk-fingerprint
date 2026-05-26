import type { ExtensionStorage } from "./config";
import type { FingerprintDetectionSummary } from "./detection";

export type FingerprintRecord = {
  key: string;
  count: number;
  level: "low" | "high";
};

export type ContentToBackgroundMessage =
  | { type: "record.push"; key: string; level: "low" | "high" }
  | { type: "badge.set"; count: number; high: boolean };

export type BackgroundMessage =
  | { type: "storage.get" }
  | { type: "config.setEnabled"; enabled: boolean }
  | { type: "config.setSeed"; seedText: string }
  | { type: "whitelist.toggle"; hostname: string }
  | { type: "records.get"; tabId: number }
  | { type: "detection.get"; tabId: number };

export type BackgroundResponseMap = {
  "storage.get": ExtensionStorage;
  "config.setEnabled": ExtensionStorage;
  "config.setSeed": ExtensionStorage;
  "whitelist.toggle": ExtensionStorage;
  "records.get": FingerprintRecord[];
  "detection.get": FingerprintDetectionSummary;
};

export const PAGE_MESSAGE_KEY = "__brosdk_fp__";

export type PageRecordMessage = {
  type: "record";
  key: string;
  level: "low" | "high";
};
