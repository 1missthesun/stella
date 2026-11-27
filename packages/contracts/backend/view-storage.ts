// Each Stella View's saved key-value storage (`useStorage` / `stella.storage`), kept per owner so a
// view shows the same values on every device. A view is named by `<conversationId>/<slug>`, the
// same on every device and wherever its file lives. Writes are per key, last writer wins in the
// order the server applies them; `seq` is that order (per view), so a device can tell an older
// snapshot from one that already has its write.

/** Caps the server enforces (and devices check first, so a view hears why a write fails). */
export const VIEW_STORAGE_LIMITS = {
  /** All of one view's values, as JSON. */
  maxViewBytes: 256 * 1024,
  /** Live keys in one view. */
  maxKeys: 500,
  maxKeyLength: 200,
  maxViewIdLength: 300,
  /** Keys one write may change. */
  maxChanges: 500,
} as const;

/** One key's change: a JSON value, or null to remove the key. */
export type ViewStorageChange = { key: string; value: unknown };

export type ViewStorageWrite = {
  viewId: string;
  /** Remove every key first (stella.storage.clear()), then apply `changes`. */
  clear?: boolean;
  changes: ViewStorageChange[];
  /**
   * A device's values from before this view synced: each is written only when the server has
   * never had that key (not even a removal), so the first device to sync brings its data along
   * and a later one doesn't overwrite what's already there.
   */
  seed?: ViewStorageChange[];
};

export type ViewStorageState = {
  viewId: string;
  /** The newest write the server has applied to this view; 0 when it has none. */
  seq: number;
  values: Record<string, unknown>;
};

export type ViewStorageCalls = {
  "viewStorage.write": {
    args: ViewStorageWrite;
    result: { seq: number };
  };
};

export type ViewStorageViews = {
  "viewStorage.get": { args: { viewId: string }; result: ViewStorageState };
};
