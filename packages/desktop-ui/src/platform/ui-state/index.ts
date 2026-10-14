import {
  UI_STATE_DEV_ENDPOINT,
  UI_STATE_DEV_EVENT,
  type UiStateChanges,
  type UiStateDevChangedEvent,
} from "@stella/contracts/ui-state";

const FLUSH_DELAY_MS = 10;

const hasWindow = typeof window !== "undefined";

const memory = new Map<string, string>(
  Object.entries((hasWindow ? window.__stellaUiState : undefined) ?? {}),
);

type WriteAdapter = {
  flushChanges: (changes: UiStateChanges) => void;
  clear: () => void;
};

type ExternalChangeListener = (key: string, value: string | null) => void;

const externalChangeListeners = new Set<ExternalChangeListener>();

const applyRemoteChanges = (changes: UiStateChanges) => {
  for (const [key, value] of Object.entries(changes)) {
    const oldValue = memory.get(key) ?? null;
    if (value === null) {
      if (!memory.has(key)) continue;
      memory.delete(key);
    } else {
      if (oldValue === value) continue;
      memory.set(key, value);
    }
    for (const listener of externalChangeListeners) listener(key, value);
  }
};

const createElectronAdapter = (): WriteAdapter | null => {
  const api = window.electronAPI?.uiState;
  if (!api) return null;
  api.onChanged(applyRemoteChanges);
  return {
    flushChanges: (changes) => api.apply(changes),
    clear: () => api.clear(),
  };
};

const createDevServerAdapter = (): WriteAdapter | null => {
  const hot = import.meta.hot;
  if (!hot) return null;
  const clientId = Math.random().toString(36).slice(2);
  hot.on(UI_STATE_DEV_EVENT, (data: UiStateDevChangedEvent) => {
    if (data.clientId === clientId) return;
    applyRemoteChanges(data.changes);
  });
  const post = (body: Record<string, unknown>) => {
    void fetch(UI_STATE_DEV_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, ...body }),
      keepalive: true,
    }).catch(() => {});
  };
  return {
    flushChanges: (changes) => post({ changes }),
    clear: () => post({ clear: true }),
  };
};

const createBrowserStorageAdapter = (): WriteAdapter | null => {
  if (window.electronAPI || import.meta.hot) return null;
  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    return null;
  }
  const managedKeys = new Set(memory.keys());
  window.addEventListener("storage", (event) => {
    if (!event.key || event.key.startsWith("better-auth")) return;
    applyRemoteChanges({ [event.key]: event.newValue });
  });
  return {
    flushChanges: (changes) => {
      try {
        for (const [key, value] of Object.entries(changes)) {
          if (key.startsWith("better-auth")) continue;
          if (value === null) {
            storage.removeItem(key);
            managedKeys.delete(key);
          } else {
            storage.setItem(key, value);
            managedKeys.add(key);
          }
        }
      } catch {
        // Restricted/private browsing can revoke storage after the adapter
        // was created.
      }
    },
    clear: () => {
      try {
        for (const key of managedKeys) {
          if (!key.startsWith("better-auth")) storage.removeItem(key);
        }
        managedKeys.clear();
      } catch {
        // Storage access can throw (restricted/private browsing); clearing is
        // best-effort.
      }
    },
  };
};

const noopAdapter: WriteAdapter = {
  flushChanges: () => {},
  clear: () => {},
};

const adapter = hasWindow
  ? (createElectronAdapter() ??
    createDevServerAdapter() ??
    createBrowserStorageAdapter() ??
    noopAdapter)
  : noopAdapter;

let pending: UiStateChanges = {};
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const flushPending = () => {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const changes = pending;
  pending = {};
  if (Object.keys(changes).length > 0) {
    adapter.flushChanges(changes);
  }
};

const queueChange = (key: string, value: string | null) => {
  pending[key] = value;
  if (flushTimer === null) {
    flushTimer = setTimeout(flushPending, FLUSH_DELAY_MS);
  }
};

if (hasWindow) {
  window.addEventListener("pagehide", flushPending);
}

// ── One-time legacy migration ───────────────────────────────────────────────

// First boot after the localStorage → shared-store cut: the file is empty but
// this origin still holds the user's state. Import it once; the flush
// persists it to ~/.stella/ui-state.json for every host. Legacy Better Auth
// blobs stay out — session state belongs to the main process, never here.
if (hasWindow && memory.size === 0) {
  try {
    const legacy = window.localStorage;
    for (let i = 0; legacy && i < legacy.length; i++) {
      const key = legacy.key(i);
      if (key === null || key.startsWith("better-auth")) continue;
      const value = legacy.getItem(key);
      if (value === null) continue;
      memory.set(key, value);
      queueChange(key, value);
    }
  } catch {
    // localStorage can throw in restricted contexts; fresh state is fine.
  }
}

export const uiState = {
  getItem(key: string): string | null {
    return memory.get(key) ?? null;
  },

  setItem(key: string, value: string): void {
    const normalized = String(value);
    if (memory.get(key) === normalized) return;
    memory.set(key, normalized);
    queueChange(key, normalized);
  },

  removeItem(key: string): void {
    if (!memory.has(key)) return;
    memory.delete(key);
    queueChange(key, null);
  },

  clear(): void {
    memory.clear();
    pending = {};
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    adapter.clear();
  },

  keys(): string[] {
    return [...memory.keys()];
  },

  onExternalChange(listener: ExternalChangeListener): () => void {
    externalChangeListeners.add(listener);
    return () => {
      externalChangeListeners.delete(listener);
    };
  },
};
