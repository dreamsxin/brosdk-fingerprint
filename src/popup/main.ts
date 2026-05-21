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

const randomSeedText = () => {
  const bytes = new Uint32Array(2);
  crypto.getRandomValues(bytes);
  return `${bytes[0].toString(36)}${bytes[1].toString(36)}`;
};

type ProtectionView = {
  name: string;
  enabled: boolean;
  implemented: boolean;
  mode?: string;
  details: string[];
};

const makeProtectionViews = (): ProtectionView[] => {
  if (!storage) return [];
  const globalEnabled = storage.config.enabled;
  const canvas = storage.config.canvas2d;
  const audio = storage.config.audio;
  const stealth = storage.config.stealth;

  return [
    {
      name: "Canvas 2D",
      enabled: globalEnabled && canvas.enabled,
      implemented: true,
      mode: canvas.mode,
      details: [
        `seed: ${storage.config.seedText}`,
        `export noise score >= ${canvas.exportNoiseScore}`,
        canvas.perturbText ? "text on" : "text off",
        canvas.perturbCurves ? "curves on" : "curves off",
        canvas.perturbGradients ? "gradients tracked" : "gradients off",
        canvas.perturbImages ? "images on" : "images tracked only",
        canvas.perturbReadback ? "readback pixels on" : "readback pixels off",
        canvas.perturbExportPixels ? "export pixels on" : "export pixels off"
      ]
    },
    {
      name: "Audio",
      enabled: globalEnabled && audio.enabled,
      implemented: true,
      mode: audio.mode,
      details: [
        `seed: ${storage.config.seedText}`,
        `offline buffer noise score >= ${audio.bufferNoiseScore}`,
        audio.perturbCompressor ? "compressor on" : "compressor off",
        audio.perturbAnalyser ? "analyser on" : "analyser off"
      ]
    },
    {
      name: "Native function stealth",
      enabled: globalEnabled && stealth.enabled,
      implemented: true,
      details: [
        "toString masking",
        "descriptor and ownKeys filtering",
        stealth.recordNativeChecks ? "native checks recorded" : "native checks hidden"
      ]
    },
    {
      name: "WebGL",
      enabled: false,
      implemented: false,
      details: ["planned: metadata bucketization and risk-based readPixels noise"]
    },
    {
      name: "WebGPU",
      enabled: false,
      implemented: false,
      details: ["planned: capability bucketization and readback noise"]
    },
    {
      name: "Fonts",
      enabled: false,
      implemented: false,
      details: ["planned: bulk measurement detection and local-font probing protection"]
    },
    {
      name: "Navigator / headers",
      enabled: false,
      implemented: false,
      details: ["planned: stable values and request header consistency"]
    }
  ];
};

const renderProtections = () => {
  const container = $("protections");
  container.textContent = "";
  for (const item of makeProtectionViews()) {
    const row = document.createElement("div");
    row.className = "protection";

    const statusClass = !item.implemented ? "planned" : item.enabled ? "on" : "off";
    const statusText = !item.implemented ? "planned" : item.enabled ? "on" : "off";
    const modeTag = item.mode ? `<span class="tag mode">mode: ${item.mode}</span>` : "";
    const details = item.details.map((detail) => `<span class="tag">${detail}</span>`).join("");

    row.innerHTML = `
      <div class="protection-head">
        <span class="protection-title">${item.name}</span>
        <span class="tag ${statusClass}">${statusText}</span>
      </div>
      <div class="protection-meta">
        ${modeTag}
        ${details}
      </div>
      <div class="protection-desc">${item.implemented ? "Implemented in current build." : "Not active in current build."}</div>
    `;
    container.appendChild(row);
  }
};

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
  $<HTMLInputElement>("seed-input").value = storage.config.seedText;
  renderProtections();

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

$("random-seed").addEventListener("click", () => {
  $<HTMLInputElement>("seed-input").value = randomSeedText();
});

$("save-seed").addEventListener("click", async () => {
  if (!storage) return;
  const seedText = $<HTMLInputElement>("seed-input").value.trim() || randomSeedText();
  storage = await send("config.setSeed", { seedText });
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
