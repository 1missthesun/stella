// A view's `useStorage` on the web: one IndexedDB record per view (its key-value map), written a
// moment after the last change, as the desktop writes its storage.json. Other tabs of the app hear
// each change on a BroadcastChannel, so a view open in two tabs stays the same in both.
import type { ViewStorage } from "@stella/views/session";
import { normalizeViewStorageRecord, type ViewStorageDisk } from "@stella/views/storage-sync";

const DB = "stella-views";
const STORE = "storage";
/** Synced views (storage-sync.ts), by their `<conversationId>/<slug>`. */
const SYNCED = "synced";
const WRITE_DELAY_MS = 150;

let opened: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (opened) return opened;
  opened = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      if (!request.result.objectStoreNames.contains(SYNCED)) request.result.createObjectStore(SYNCED);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB didn't open"));
  }).catch((error: unknown) => {
    opened = null;
    throw error;
  });
  return opened;
}

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

async function readFrom(store: string, key: string): Promise<unknown> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction(store, "readonly").objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"));
  });
}

const read = async (key: string): Promise<Record<string, unknown>> => {
  const value = await readFrom(STORE, key);
  return isMap(value) ? value : {};
};

async function write(key: string, values: unknown, store = STORE): Promise<void> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(store, "readwrite");
    tx.objectStore(store).put(values, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
  });
}

type Change = { view: string; key: string; value: unknown; from: string };

const tabId = Math.random().toString(36).slice(2);
let channel: BroadcastChannel | null = null;
const listeners = new Map<string, Set<(key: string, value: unknown) => void>>();

function changes(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === "undefined") return channel;
  channel = new BroadcastChannel(DB);
  channel.onmessage = (event: MessageEvent<Change>) => {
    const change = event.data;
    if (!change || change.from === tabId) return;
    for (const listener of listeners.get(change.view) ?? []) listener(change.key, change.value);
  };
  return channel;
}

/** The saved storage of the view `viewKey` (the desktop's key for its file path, so the two match). */
export function browserStorage(viewKey: string): ViewStorage {
  let values: Record<string, unknown> | null = null;
  let loading: Promise<Record<string, unknown>> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const load = (): Promise<Record<string, unknown>> => {
    if (values) return Promise.resolve(values);
    loading ??= read(viewKey)
      .catch(() => ({}))
      .then((read) => (values ??= read));
    return loading;
  };
  const flush = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (values) void write(viewKey, values).catch((error: unknown) => console.warn("[views] couldn't save a view's storage", error));
    }, WRITE_DELAY_MS);
  };
  const changed = (key: string, value: unknown) => changes()?.postMessage({ view: viewKey, key, value: value ?? null, from: tabId } satisfies Change);
  return {
    load: async () => ({ ...(await load()) }),
    set: async (key, value) => {
      (await load())[key] = value;
      flush();
      changed(key, value);
    },
    remove: async (key) => {
      delete (await load())[key];
      flush();
      changed(key, null);
    },
    clear: async () => {
      const keys = Object.keys(await load());
      values = {};
      flush();
      for (const key of keys) changed(key, null);
    },
    subscribe: (listener) => {
      changes();
      let set = listeners.get(viewKey);
      if (!set) listeners.set(viewKey, (set = new Set()));
      const heard = (key: string, value: unknown) => {
        if (values) {
          if (value === null || value === undefined) delete values[key];
          else values[key] = value;
        }
        listener(key, value);
      };
      set.add(heard);
      return () => {
        set.delete(heard);
      };
    },
  };
}

/** What the view kept here before it synced (by its file's key), for its first sync. */
export const legacyBrowserStorage = (viewKey: string): Promise<Record<string, unknown> | null> =>
  read(viewKey).then(
    (values) => (Object.keys(values).length > 0 ? values : null),
    () => null,
  );

/** Synced views' storage in this browser, per account (records from before that are keyed by the view id alone). */
const syncedKey = (viewId: string, account: string | null) => (account === null ? viewId : `${account}\n${viewId}`);
export const browserSyncedDisk = (): ViewStorageDisk => ({
  read: async (viewId, account) => normalizeViewStorageRecord(await readFrom(SYNCED, syncedKey(viewId, account))),
  write: (viewId, record, account) => write(syncedKey(viewId, account), record, SYNCED),
});
