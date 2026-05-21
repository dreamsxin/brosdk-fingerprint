const PAGE_MESSAGE_KEY = "__brosdk_fp__";

const counters = new Map<string, number>();

export const record = (key: string, level: "low" | "high" = "low") => {
  counters.set(key, (counters.get(key) ?? 0) + 1);
  window.postMessage({
    [PAGE_MESSAGE_KEY]: {
      type: "record",
      key,
      level
    }
  }, "*");
};
