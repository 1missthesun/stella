// A view's storage synced through Stella Cloud, the same on every platform: each device keeps the
// values on its own disk first (so a view works offline and opens instantly), sends each change to
// the owner's store, and takes every newer server snapshot pushed back, so all devices showing the
// view converge on the server's order (last writer per key wins).
//
// - A change is applied locally and saved at once, then queued. Queued changes go out one batch at
//   a time (the newest value per key) and stay queued until the server confirms them, across
//   restarts: an offline device replays them when it hears from the server again.
// - A snapshot older than a write this device has had confirmed is stale and skipped; otherwise
//   it replaces the local values, with the device's unconfirmed changes laid over it. Each key
//   that changed reaches the running view as a storage message, as another tab's change does.
// - A view's values from before it synced (its old storage, kept by file path) are sent once as a
//   seed: they fill only keys the server has never had.
import { VIEW_STORAGE_LIMITS, type ViewStorageState, type ViewStorageWrite } from "@stella/contracts/backend/view-storage";
import type { ViewStorage } from "./session";

export { VIEW_STORAGE_LIMITS, type ViewStorageState, type ViewStorageWrite };

/** The owner's store, as this device reaches it (a BackendClient's `call` and `watch`). */
export type ViewStorageRemote = {
  write(args: ViewStorageWrite): Promise<{ seq: number }>;
  watch(viewId: string, onValue: (state: ViewStorageState) => void, onError?: (error: unknown) => void): () => void;
};

/** A BackendClient (any platform's) as a ViewStorageRemote. */
export type ViewStorageBackend = {
  call(name: "viewStorage.write", args: ViewStorageWrite): Promise<{ seq: number }>;
  watch(view: "viewStorage.get", args: { viewId: string }, onValue: (state: ViewStorageState) => void, onError?: (error: unknown) => void): () => void;
};

export const backendViewStorageRemote = (client: ViewStorageBackend): ViewStorageRemote => ({
  write: (args) => client.call("viewStorage.write", args),
  watch: (viewId, onValue, onError) => client.watch("viewStorage.get", { viewId }, onValue, onError),
});

/** What a device keeps for one synced view. */
export type ViewStorageRecord = {
  v: 1;
  values: Record<string, unknown>;
  /** Changes the server hasn't confirmed: key → value, null for a removal. */
  pending: Record<string, unknown>;
  /** A clear the server hasn't confirmed (applied before `pending`). */
  clear?: boolean;
  /** Values from before the view synced, not yet sent. */
  seed?: Record<string, unknown>;
  /** The newest server write these values include. */
  seq: number;
};

/** Where a device keeps its synced views (a folder, IndexedDB, the phone's storage). */
export type ViewStorageDisk = {
  read(viewId: string): Promise<ViewStorageRecord | null>;
  write(viewId: string, record: ViewStorageRecord): Promise<void>;
};

/** `<conversationId>/<slug>`: the same on every device, wherever the view's file is. */
export const syncedViewId = (conversationId: string, slug: string): string | null => {
  const s = slug.trim();
  const c = conversationId.trim();
  if (!c || !s || !/^[\w.:-]{1,160}$/u.test(c) || !/^[\w.-]{1,128}$/u.test(s)) return null;
  return `${c}/${s}`;
};

/** A view's slug from its file path (`…/water-tracker.view.tsx` → `water-tracker`). */
export const viewSlugFromPath = (filePath: string): string =>
  (filePath.split(/[\\/]/u).pop() ?? filePath).replace(/\.view\.(tsx|ts|jsx|js)$/iu, "");

const SAVE_DELAY_MS = 120;
/** Shortest gap between two writes to the server: a slider drag sends its latest value, not every step. */
const SEND_GAP_MS = 40;
const RETRY_MIN_MS = 1_000;
const RETRY_MAX_MS = 30_000;

const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const json = (v: unknown): string => JSON.stringify(v ?? null) ?? "null";
const encoder = typeof TextEncoder === "undefined" ? null : new TextEncoder();
const sizeOf = (key: string, value: unknown): number => {
  const text = key + json(value);
  return encoder ? encoder.encode(text).length : text.length;
};
const isFatal = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "BAD_REQUEST" || code === "FORBIDDEN" || code === "NOT_FOUND";
};

export const normalizeViewStorageRecord = (raw: unknown): ViewStorageRecord | null => {
  if (!isMap(raw) || raw.v !== 1 || !isMap(raw.values)) return null;
  return {
    v: 1,
    values: raw.values,
    pending: isMap(raw.pending) ? raw.pending : {},
    ...(raw.clear === true ? { clear: true } : {}),
    ...(isMap(raw.seed) && Object.keys(raw.seed).length > 0 ? { seed: raw.seed } : {}),
    seq: typeof raw.seq === "number" && Number.isFinite(raw.seq) ? raw.seq : 0,
  };
};

type Listener = (key: string, value: unknown) => void;
type Log = (message: string, detail?: unknown) => void;

/** One view's synced storage. Shared by every session showing the view on this device. */
export class SyncedViewStorage implements ViewStorage {
  private values: Record<string, unknown> = {};
  private sizes = new Map<string, number>();
  private bytes = 0;
  private pending = new Map<string, unknown>();
  private clearing = false;
  /** Counts clears, so a clear made while one is in flight isn't confirmed by it. */
  private clears = 0;
  private seed: Record<string, unknown> | null = null;
  private seq = 0;
  /** The newest write the server confirmed to this device: snapshots before it are stale. */
  private confirmed = 0;
  private ready: Promise<void>;
  private loaded = false;
  private listeners = new Set<Listener>();
  private remote: ViewStorageRemote | null = null;
  private unwatch: (() => void) | null = null;
  private sending = false;
  private sendTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSentAt = 0;
  private retryMs = RETRY_MIN_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** When the newest change was made here, for measuring how long it takes to reach the server. */
  private onSynced: ((seq: number) => void) | null = null;

  constructor(
    readonly viewId: string,
    private readonly disk: ViewStorageDisk,
    legacy: () => Promise<Record<string, unknown> | null>,
    private readonly log: Log = () => {},
  ) {
    this.ready = this.open(legacy);
  }

  private async open(legacy: () => Promise<Record<string, unknown> | null>) {
    let record: ViewStorageRecord | null = null;
    try {
      record = await this.disk.read(this.viewId);
    } catch (error) {
      this.log("couldn't read a view's saved storage", error);
    }
    if (record) {
      this.values = { ...record.values };
      this.pending = new Map(Object.entries(record.pending));
      this.clearing = record.clear === true;
      if (this.clearing) this.clears = 1;
      this.seed = record.seed ?? null;
      this.seq = record.seq;
    } else {
      // First time on this device: what the view kept before it synced comes along, once.
      const old = await legacy().catch(() => null);
      if (old && Object.keys(old).length > 0) {
        this.values = { ...old };
        this.seed = { ...old };
        this.save();
      }
    }
    for (const [key, value] of Object.entries(this.values)) this.sized(key, value);
    this.loaded = true;
    this.kick();
  }

  // ------------------------------------------------------------ ViewStorage

  async load(): Promise<Record<string, unknown>> {
    await this.ready;
    return { ...this.values };
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.ready;
    if (value === undefined || value === null) return this.remove(key);
    if (key.length > VIEW_STORAGE_LIMITS.maxKeyLength) throw new Error(`Storage keys are at most ${VIEW_STORAGE_LIMITS.maxKeyLength} characters.`);
    const size = sizeOf(key, value);
    const bytes = this.bytes - (this.sizes.get(key) ?? 0) + size;
    if (bytes > VIEW_STORAGE_LIMITS.maxViewBytes) throw new Error(`This view's storage is full: a view keeps at most ${VIEW_STORAGE_LIMITS.maxViewBytes / 1024} KB.`);
    if (!(key in this.values) && this.sizes.size >= VIEW_STORAGE_LIMITS.maxKeys) throw new Error(`A view keeps at most ${VIEW_STORAGE_LIMITS.maxKeys} storage keys.`);
    this.values[key] = value;
    this.sized(key, value);
    this.pending.set(key, value);
    this.changedHere();
  }

  async remove(key: string): Promise<void> {
    await this.ready;
    delete this.values[key];
    this.sized(key, undefined);
    this.pending.set(key, null);
    this.changedHere();
  }

  async clear(): Promise<void> {
    await this.ready;
    this.values = {};
    this.sizes.clear();
    this.bytes = 0;
    this.pending.clear();
    this.seed = null;
    this.clearing = true;
    this.clears += 1;
    this.changedHere();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    this.watch();
    return () => {
      this.listeners.delete(listener);
      this.maybeUnwatch();
    };
  }

  // ------------------------------------------------------------ sync

  /** Starts (or moves) syncing through `remote`; null keeps the view local until one comes. */
  setRemote(remote: ViewStorageRemote | null): void {
    if (remote === this.remote) return;
    this.unwatch?.();
    this.unwatch = null;
    this.remote = remote;
    this.retryMs = RETRY_MIN_MS;
    this.watch();
    this.kick();
  }

  /** Whether every change made here has reached the server. */
  get synced(): boolean {
    return this.pending.size === 0 && !this.clearing && !this.seed && !this.sending;
  }

  /** Calls `fn` with the server's seq once every change made so far has been confirmed. */
  whenSynced(fn: (seq: number) => void): void {
    this.onSynced = fn;
    if (this.synced) {
      this.onSynced = null;
      fn(this.confirmed);
    }
  }

  private watch() {
    if (this.unwatch || !this.remote || (this.listeners.size === 0 && this.synced)) return;
    const remote = this.remote;
    this.unwatch = remote.watch(
      this.viewId,
      (state) => {
        if (this.remote === remote) void this.ready.then(() => this.heard(state));
      },
      (error) => this.log("view storage sync failed", error),
    );
  }

  private maybeUnwatch() {
    if (this.listeners.size > 0 || !this.synced) return;
    this.unwatch?.();
    this.unwatch = null;
  }

  private heard(state: ViewStorageState) {
    if (!isMap(state?.values) || typeof state.seq !== "number") return;
    if (state.seq < this.confirmed || state.seq < this.seq) return;
    const next: Record<string, unknown> = this.clearing ? {} : { ...state.values };
    if (this.seed) for (const [key, value] of Object.entries(this.seed)) if (!(key in next)) next[key] = value;
    for (const [key, value] of this.pending) {
      if (value === null) delete next[key];
      else next[key] = value;
    }
    const changed: string[] = [];
    for (const key of new Set([...Object.keys(this.values), ...Object.keys(next)])) {
      if (json(this.values[key]) !== json(next[key])) changed.push(key);
    }
    const seqMoved = state.seq !== this.seq;
    this.seq = state.seq;
    this.values = next;
    if (changed.length > 0) {
      for (const key of changed) this.sized(key, next[key]);
      for (const key of changed) for (const listener of this.listeners) listener(key, key in next ? next[key] : null);
    }
    if (changed.length > 0 || seqMoved) this.save();
    // Hearing from the server again (a reconnect) is the moment to replay what's still queued.
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.kick();
  }

  private changedHere() {
    this.save();
    this.watch();
    this.kick();
  }

  private kick() {
    if (!this.loaded || !this.remote || this.sending || this.sendTimer || this.retryTimer || this.synced) return;
    const wait = Math.max(0, this.lastSentAt + SEND_GAP_MS - Date.now());
    this.sendTimer = setTimeout(() => {
      this.sendTimer = null;
      void this.send();
    }, wait);
  }

  private async send() {
    const remote = this.remote;
    if (!remote || this.sending || this.synced) return;
    const sent = new Map(this.pending);
    const sentClear = this.clearing ? this.clears : 0;
    const sentSeed = this.seed;
    const args: ViewStorageWrite = {
      viewId: this.viewId,
      ...(sentClear ? { clear: true } : {}),
      changes: [...sent].map(([key, value]) => ({ key, value })),
      ...(sentSeed ? { seed: Object.entries(sentSeed).map(([key, value]) => ({ key, value })) } : {}),
    };
    this.sending = true;
    this.lastSentAt = Date.now();
    try {
      const { seq } = await remote.write(args);
      this.confirm(sent, sentClear, sentSeed, seq);
      this.retryMs = RETRY_MIN_MS;
    } catch (error) {
      if (isFatal(error)) {
        // The server won't ever take this batch (too big, malformed): drop it, and let the next
        // snapshot bring this device back to the server's values.
        this.log("the server refused a view storage write", error);
        this.confirm(sent, sentClear, sentSeed, this.confirmed);
      } else {
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          this.kick();
        }, this.retryMs);
        this.retryMs = Math.min(RETRY_MAX_MS, this.retryMs * 2);
      }
    } finally {
      this.sending = false;
    }
    if (this.synced) {
      const fn = this.onSynced;
      this.onSynced = null;
      fn?.(this.confirmed);
      this.maybeUnwatch();
    } else this.kick();
  }

  private confirm(sent: Map<string, unknown>, sentClear: number, sentSeed: Record<string, unknown> | null, seq: number) {
    for (const [key, value] of sent) if (this.pending.has(key) && Object.is(this.pending.get(key), value)) this.pending.delete(key);
    if (sentClear && this.clearing && this.clears === sentClear) this.clearing = false;
    if (sentSeed && this.seed === sentSeed) this.seed = null;
    this.confirmed = Math.max(this.confirmed, seq);
    this.save();
  }

  private sized(key: string, value: unknown) {
    this.bytes -= this.sizes.get(key) ?? 0;
    if (value === undefined || value === null) this.sizes.delete(key);
    else {
      const size = sizeOf(key, value);
      this.sizes.set(key, size);
      this.bytes += size;
    }
  }

  private save() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const record: ViewStorageRecord = {
        v: 1,
        values: this.values,
        pending: Object.fromEntries(this.pending),
        ...(this.clearing ? { clear: true } : {}),
        ...(this.seed ? { seed: this.seed } : {}),
        seq: this.seq,
      };
      void this.disk.write(this.viewId, record).catch((error: unknown) => this.log("couldn't save a view's storage", error));
    }, SAVE_DELAY_MS);
  }

  /** Writes what's waiting to be saved now (the app is closing). */
  flushToDisk(): Promise<void> {
    if (!this.saveTimer) return Promise.resolve();
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    return this.disk
      .write(this.viewId, {
        v: 1,
        values: this.values,
        pending: Object.fromEntries(this.pending),
        ...(this.clearing ? { clear: true } : {}),
        ...(this.seed ? { seed: this.seed } : {}),
        seq: this.seq,
      })
      .catch((error: unknown) => this.log("couldn't save a view's storage", error));
  }
}

/** Every synced view on this device, and the one connection to the owner's store they share. */
export class ViewStorageSync {
  private remote: ViewStorageRemote | null = null;
  private stores = new Map<string, SyncedViewStorage>();

  constructor(
    private readonly disk: ViewStorageDisk,
    private readonly log: Log = () => {},
  ) {}

  /** The connection to use (the signed-in account's backend), or null while signed out. */
  setRemote(remote: ViewStorageRemote | null): void {
    if (remote === this.remote) return;
    this.remote = remote;
    for (const store of this.stores.values()) store.setRemote(remote);
  }

  get connected(): boolean {
    return this.remote !== null;
  }

  /** The synced storage of `viewId`; `legacy` reads what the view kept before it synced. */
  storage(viewId: string, legacy: () => Promise<Record<string, unknown> | null> = async () => null): SyncedViewStorage {
    let store = this.stores.get(viewId);
    if (!store) {
      store = new SyncedViewStorage(viewId, this.disk, legacy, this.log);
      store.setRemote(this.remote);
      this.stores.set(viewId, store);
    }
    return store;
  }

  flushToDisk(): Promise<void> {
    return Promise.all([...this.stores.values()].map((store) => store.flushToDisk())).then(() => undefined);
  }
}

/**
 * A view's storage that can move to another store while the view runs: a view opens before its
 * host knows which conversation it belongs to (local storage first), and moves to its synced
 * storage once it does. Every key that differs reaches the running view as a storage message.
 */
export class MovableViewStorage implements ViewStorage {
  private listeners = new Set<Listener>();
  private off: (() => void) | null = null;
  private moving: Promise<void> = Promise.resolve();

  constructor(private current: ViewStorage) {
    this.follow();
  }

  get target(): ViewStorage {
    return this.current;
  }

  private follow() {
    this.off?.();
    this.off = null;
    if (this.listeners.size === 0) return;
    this.off =
      this.current.subscribe?.((key, value) => {
        for (const listener of this.listeners) listener(key, value);
      }) ?? null;
  }

  /** Moves to `next`, telling the view about every key that differs. */
  move(next: ViewStorage): Promise<void> {
    if (next === this.current) return this.moving;
    this.moving = this.moving.then(async () => {
      const before = await this.current.load().catch(() => ({}) as Record<string, unknown>);
      const after = await next.load().catch(() => ({}) as Record<string, unknown>);
      this.current = next;
      this.follow();
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (json(before[key]) === json(after[key])) continue;
        const value = key in after ? after[key] : null;
        for (const listener of this.listeners) listener(key, value);
      }
    });
    return this.moving;
  }

  load = async () => {
    await this.moving;
    return this.current.load();
  };
  set = async (key: string, value: unknown) => {
    await this.moving;
    return this.current.set(key, value);
  };
  remove = async (key: string) => {
    await this.moving;
    return this.current.remove(key);
  };
  clear = async () => {
    await this.moving;
    return this.current.clear();
  };
  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.follow();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.off?.();
        this.off = null;
      }
    };
  };
}
