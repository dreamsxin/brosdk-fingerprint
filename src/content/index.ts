import type { BackgroundResponseMap, PageRecordMessage } from "../shared/messages";

const PAGE_MESSAGE_KEY = "__brosdk_fp__";

const domainMatches = (whitelist: string[], hostname: string | undefined): boolean => {
  if (!hostname) return false;
  return whitelist.some((domain) => {
    const clean = domain.trim().toLowerCase();
    const host = hostname.toLowerCase();
    return host === clean || host.endsWith(`.${clean}`);
  });
};

type InjectedPayload = {
  storage: BackgroundResponseMap["storage.get"];
  scriptUrl: string;
};

const sendToBackground = <T extends keyof BackgroundResponseMap>(type: T, payload?: Record<string, unknown>) => {
  return chrome.runtime.sendMessage({ type, ...payload }) as Promise<BackgroundResponseMap[T]>;
};

const injectMainWorld = (payload: InjectedPayload) => {
  const script = document.createElement("script");
  script.src = payload.scriptUrl;
  script.dataset.brosdkFingerprint = JSON.stringify(payload.storage);
  script.onload = () => script.remove();
  (document.documentElement || document.head || document.body).appendChild(script);
};

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window) return;
  const message = event.data?.[PAGE_MESSAGE_KEY] as PageRecordMessage | undefined;
  if (!message || message.type !== "record") return;
  void chrome.runtime.sendMessage({
    type: "record.push",
    key: message.key,
    level: message.level
  });
});

void (async () => {
  const storage = await sendToBackground("storage.get");
  const hostname = location.hostname;
  if (!storage.config.enabled || domainMatches(storage.whitelist, hostname)) return;

  injectMainWorld({
    storage,
    scriptUrl: chrome.runtime.getURL("injected.js")
  });
})();
