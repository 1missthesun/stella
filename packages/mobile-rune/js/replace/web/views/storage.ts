// A view's `useStorage` on the phone, in place of the web's IndexedDB (web/views/storage.ts): one
// JSON file per view in the app's documents (`stella-views/`), written a moment after the last
// change, as the desktop writes its storage.json. Not the app's key-value store: the UI reads all
// of that at launch, and a view may keep up to 256 KB.
import type { ViewStorage } from "@stella/views/session";
import { normalizeViewStorageRecord, type ViewStorageDisk } from "@stella/views/storage-sync";

const LOCAL = "local:";
const SYNCED = "synced:v2:";
const WRITE_DELAY_MS = 150;

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

const fileOf = (key: string) => `${__native.env.documents}/stella-views/${encodeURIComponent(key)}.json`;

function readKey(key: string): unknown {
  try {
    const text = __native.readText(fileOf(key));
    return text === null ? null : (JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

function writeKey(key: string, value: unknown) {
  if (!__native.writeFile(fileOf(key), JSON.stringify(value))) console.warn("[views] couldn't save a view's storage");
}

const read = (viewKey: string): Record<string, unknown> => {
  const value = readKey(LOCAL + viewKey);
  return isMap(value) ? value : {};
};

/** The saved storage of the view `viewKey` (its file path's key, as on the desktop and the web). */
export function browserStorage(viewKey: string): ViewStorage {
  let values: Record<string, unknown> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const load = () => (values ??= read(viewKey));
  const flush = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (values) writeKey(LOCAL + viewKey, values);
    }, WRITE_DELAY_MS);
  };
  return {
    load: async () => ({ ...load() }),
    set: async (key, value) => {
      load()[key] = value;
      flush();
    },
    remove: async (key) => {
      delete load()[key];
      flush();
    },
    clear: async () => {
      values = {};
      flush();
    },
    // One app, one process: nothing else here writes a view's storage.
    subscribe: () => () => undefined,
  };
}

/** What the view kept here before it synced (by its file's key), for its first sync. */
export const legacyBrowserStorage = async (viewKey: string): Promise<Record<string, unknown> | null> => {
  const values = read(viewKey);
  return Object.keys(values).length > 0 ? values : null;
};

/** Synced views' storage on this phone, per account (`synced:v2:<account>:<viewId>`). */
const syncedKey = (viewId: string, account: string | null) => `${SYNCED}${account ?? ""}:${viewId}`;
export const browserSyncedDisk = (): ViewStorageDisk => ({
  read: async (viewId, account) => normalizeViewStorageRecord(readKey(syncedKey(viewId, account))),
  write: async (viewId, record, account) => writeKey(syncedKey(viewId, account), record),
});
