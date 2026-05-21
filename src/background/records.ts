import type { FingerprintRecord } from "../shared/messages";

const recordsByTab = new Map<number, Map<string, FingerprintRecord>>();

export const pushRecord = (tabId: number, key: string, level: "low" | "high") => {
  let tabRecords = recordsByTab.get(tabId);
  if (!tabRecords) {
    tabRecords = new Map();
    recordsByTab.set(tabId, tabRecords);
  }
  const current = tabRecords.get(key);
  if (current) {
    current.count += 1;
    if (level === "high") current.level = "high";
  } else {
    tabRecords.set(key, { key, count: 1, level });
  }
};

export const getRecords = (tabId: number): FingerprintRecord[] => {
  return [...(recordsByTab.get(tabId)?.values() ?? [])].sort((a, b) => {
    if (a.level !== b.level) return a.level === "high" ? -1 : 1;
    return a.key.localeCompare(b.key);
  });
};

export const clearRecords = (tabId: number) => {
  recordsByTab.delete(tabId);
};

