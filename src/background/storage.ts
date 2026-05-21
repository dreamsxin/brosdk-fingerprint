import { DEFAULT_STORAGE, normalizeStorage, type ExtensionStorage } from "../shared/config";

let cache: ExtensionStorage | undefined;

export const getStorage = async (): Promise<ExtensionStorage> => {
  if (cache) return cache;
  const raw = await chrome.storage.local.get();
  cache = normalizeStorage(raw);
  await chrome.storage.local.set(cache);
  return cache;
};

export const saveStorage = async (storage: ExtensionStorage): Promise<ExtensionStorage> => {
  cache = storage;
  await chrome.storage.local.set(storage);
  return storage;
};

export const initStorage = async (): Promise<void> => {
  const raw = await chrome.storage.local.get();
  const storage = normalizeStorage(Object.keys(raw).length ? raw : DEFAULT_STORAGE);
  cache = storage;
  await chrome.storage.local.set(storage);
};

