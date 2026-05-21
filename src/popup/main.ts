import "./styles.css";
import { domainMatches, getHostname } from "../shared/domain";
import type { BackgroundResponseMap } from "../shared/messages";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const send = <T extends keyof BackgroundResponseMap>(type: T, payload?: Record<string, unknown>) => {
  return chrome.runtime.sendMessage({ type, ...payload }) as Promise<BackgroundResponseMap[T]>;
};

let activeTab: chrome.tabs.Tab | undefined;
let hostname: string | undefined;
let storage: BackgroundResponseMap["storage.get"] | undefined;

const renderRecords = async () => {
  const container = $("records");
  if (!activeTab?.id) {
    container.textContent = "No active tab.";
    return;
  }
  const records = await send("records.get", { tabId: activeTab.id });
  if (!records.length) {
    container.textContent = "No records yet.";
    return;
  }
  container.textContent = "";
  for (const record of records) {
    const row = document.createElement("div");
    row.className = "record";
    row.innerHTML = `
      <span>${record.key}</span>
      <span>${record.count}</span>
      <span class="tag ${record.level}">${record.level}</span>
    `;
    container.appendChild(row);
  }
};

const render = () => {
  if (!storage) return;
  $("version").textContent = `v${chrome.runtime.getManifest().version}`;
  $("domain").textContent = hostname ?? "unsupported";
  $("canvas-mode").textContent = storage.config.canvas2d.mode;
  $("stealth").textContent = storage.config.stealth.enabled ? "enabled" : "disabled";

  const enabledButton = $<HTMLButtonElement>("toggle-enabled");
  enabledButton.textContent = storage.config.enabled ? "Enabled" : "Disabled";
  enabledButton.className = storage.config.enabled ? "primary" : "";

  const whitelistButton = $<HTMLButtonElement>("toggle-whitelist");
  const whitelisted = domainMatches(storage.whitelist, hostname);
  whitelistButton.textContent = whitelisted ? "Remove whitelist" : "Whitelist site";
  whitelistButton.className = whitelisted ? "warning" : "";
  whitelistButton.disabled = !hostname;
};

$("toggle-enabled").addEventListener("click", async () => {
  if (!storage) return;
  storage = await send("config.setEnabled", { enabled: !storage.config.enabled });
  render();
});

$("toggle-whitelist").addEventListener("click", async () => {
  if (!hostname) return;
  storage = await send("whitelist.toggle", { hostname });
  render();
});

void (async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tabs[0];
  hostname = getHostname(activeTab?.url);
  storage = await send("storage.get");
  render();
  await renderRecords();
  window.setInterval(renderRecords, 1500);
})();
