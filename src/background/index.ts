import { domainMatches, getHostname } from "../shared/domain";
import type { BackgroundMessage, ContentToBackgroundMessage } from "../shared/messages";
import { clearRecords, getRecords, pushRecord } from "./records";
import { getStorage, initStorage, saveStorage } from "./storage";

const setBadge = async (tabId: number) => {
  const records = getRecords(tabId);
  const high = records.some((record) => record.level === "high");
  const count = records.length;
  await chrome.action.setBadgeText({ tabId, text: count ? String(count) : "" });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: high ? "#b42318" : "#2563eb" });
};

chrome.runtime.onInstalled.addListener(() => {
  void initStorage();
});

chrome.runtime.onStartup.addListener(() => {
  void initStorage();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    clearRecords(tabId);
    void chrome.action.setBadgeText({ tabId, text: "" });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearRecords(tabId);
});

chrome.runtime.onMessage.addListener((message: BackgroundMessage | ContentToBackgroundMessage, sender, sendResponse) => {
  const run = async () => {
    switch (message.type) {
      case "record.push": {
        const tabId = sender.tab?.id;
        if (tabId == null) return undefined;
        pushRecord(tabId, message.key, message.level);
        await setBadge(tabId);
        return undefined;
      }
      case "badge.set":
        return undefined;
      case "storage.get":
        return await getStorage();
      case "config.setEnabled": {
        const storage = await getStorage();
        storage.config.enabled = message.enabled;
        return await saveStorage(storage);
      }
      case "whitelist.toggle": {
        const storage = await getStorage();
        const hostname = message.hostname.trim().toLowerCase();
        if (!hostname) return storage;
        if (domainMatches(storage.whitelist, hostname)) {
          storage.whitelist = storage.whitelist.filter((item) => item !== hostname);
        } else {
          storage.whitelist.push(hostname);
        }
        return await saveStorage(storage);
      }
      case "records.get":
        return getRecords(message.tabId);
      default:
        return undefined;
    }
  };

  run().then(sendResponse);
  return true;
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  const storage = await getStorage();
  const hostname = getHostname(tab?.url);
  if (domainMatches(storage.whitelist, hostname)) {
    await chrome.action.setBadgeText({ tabId, text: "WL" });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#667085" });
  }
});

