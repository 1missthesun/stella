import type { PiChatSend } from "@stella/contracts/pi-chat";

/**
 * Messages typed on this computer that its runtime hasn't taken yet: kept in
 * localStorage from the moment they are sent until the runtime has them
 * (after which they live in its durable transcript), so one sent while the
 * runtime restarts, or in the second before an Update relaunch, goes out once
 * it is back instead of vanishing. The runtime dedupes by request id, so a
 * replay of one it already took is harmless.
 */
export type QueuedSend = {
  conversationId: string;
  requestId: string;
  text: string;
  send?: PiChatSend;
  createdAtMs: number;
  /** Set when the runtime refused it; the row offers Retry and Remove. */
  failed?: string;
};

type Deliver = (entry: QueuedSend) => Promise<unknown>;

const PREFIX = "stella:desktop-send-outbox:v1:";
const MAX_ENTRY_CHARS = 1_000_000;
const MAX_QUEUED = 64;
const RETRY_MS = [1_000, 2_000, 4_000, 8_000];

const RUNTIME_GONE =
  /Stella runtime not available|runtime client is not connected|Stella's runtime is (?:not available|restarting)|Stella runtime is restarting|The Stella runtime is not running|Runtime worker is not running|RPC peer is closed/i;

/** The runtime isn't there to take a message right now (starting, restarting, relaunching). */
export const runtimeUnavailable = (error: unknown): boolean =>
  RUNTIME_GONE.test(error instanceof Error ? error.message : String(error));

const storage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

const parse = (raw: string | null): QueuedSend | null => {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<QueuedSend>;
    return typeof value.conversationId === "string" &&
      typeof value.requestId === "string" &&
      typeof value.text === "string" &&
      typeof value.createdAtMs === "number"
      ? (value as QueuedSend)
      : null;
  } catch {
    return null;
  }
};

let entries: readonly QueuedSend[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const delivering = new Set<string>();
let deliver: Deliver | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let attempt = 0;
let active: string | null = null;
const removed = new Set<string>();

const emit = (next: readonly QueuedSend[]) => {
  entries = next;
  for (const listener of listeners) listener();
};

const load = () => {
  if (loaded) return;
  loaded = true;
  const store = storage();
  if (!store) return;
  const found: QueuedSend[] = [];
  for (let index = 0; index < store.length; index += 1) {
    const key = store.key(index);
    if (!key?.startsWith(PREFIX)) continue;
    const entry = parse(store.getItem(key));
    if (entry && key === PREFIX + entry.requestId) found.push(entry);
  }
  entries = found.sort((a, b) => a.createdAtMs - b.createdAtMs);
};

const write = (entry: QueuedSend): boolean => {
  const store = storage();
  if (!store) return false;
  const raw = JSON.stringify(entry);
  if (raw.length > MAX_ENTRY_CHARS) return false;
  try {
    store.setItem(PREFIX + entry.requestId, raw);
    return true;
  } catch {
    return false;
  }
};

const erase = (requestId: string) => {
  try {
    storage()?.removeItem(PREFIX + requestId);
  } catch {
    // A row that can't be erased is replayed later and deduped by the runtime.
  }
  emit(entries.filter((entry) => entry.requestId !== requestId));
};

const waiting = (conversationId: string) =>
  entries.filter((entry) => entry.conversationId === conversationId && !entry.failed);

const scheduleRetry = () => {
  clearTimeout(retryTimer);
  const delay = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)];
  attempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    if (active) void desktopSendOutbox.flush(active);
  }, delay);
};

export const desktopSendOutbox = {
  subscribe(listener: () => void): () => void {
    load();
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): readonly QueuedSend[] {
    load();
    return entries;
  },
  /** Where queued messages go: the runtime's submit for one conversation. */
  setDeliver(next: Deliver): void {
    deliver = next;
  },
  /** The runtime takes messages only for the chat on screen, so only its queue is sent. */
  setActive(conversationId: string | null): void {
    active = conversationId;
    if (conversationId) void this.flush(conversationId);
  },
  /** A live send is handing this one over; a flush leaves it alone. */
  claim(requestId: string): void {
    delivering.add(requestId);
  },
  release(requestId: string): void {
    delivering.delete(requestId);
  },
  /** The user removed it: its bubble goes too. */
  wasRemoved(requestId: string): boolean {
    return removed.has(requestId);
  },
  /** Saves a message before it is handed to the runtime; false when it can't be saved (too large, no storage). */
  keep(entry: QueuedSend): boolean {
    load();
    if (entries.some((queued) => queued.requestId === entry.requestId)) return true;
    if (entries.length >= MAX_QUEUED || !write(entry)) return false;
    emit([...entries, entry]);
    return true;
  },
  /** The runtime took it (or it never needs sending again). */
  taken(requestId: string): void {
    if (entries.some((entry) => entry.requestId === requestId)) erase(requestId);
  },
  /** Messages sent earlier in this conversation still wait, so this one goes after them. */
  behind(conversationId: string, requestId: string): boolean {
    load();
    const queue = waiting(conversationId);
    const index = queue.findIndex((entry) => entry.requestId === requestId);
    return index > 0 || (index === -1 && queue.length > 0);
  },
  isQueued(requestId: string): boolean {
    return entries.some((entry) => entry.requestId === requestId && !entry.failed);
  },
  remove(requestId: string): void {
    removed.add(requestId);
    erase(requestId);
  },
  retry(requestId: string): void {
    const entry = entries.find((queued) => queued.requestId === requestId);
    if (!entry) return;
    const { failed: _failed, ...rest } = entry;
    write(rest);
    emit(entries.map((queued) => (queued.requestId === requestId ? rest : queued)));
    attempt = 0;
    void this.flush(entry.conversationId);
  },
  /** Sends what waits for `conversationId`, oldest first, stopping while the runtime is away. */
  async flush(conversationId: string): Promise<void> {
    load();
    const send = deliver;
    if (!send) return;
    for (const entry of waiting(conversationId)) {
      if (delivering.has(entry.requestId)) return;
      delivering.add(entry.requestId);
      try {
        await send(entry);
        attempt = 0;
        erase(entry.requestId);
      } catch (error) {
        if (runtimeUnavailable(error)) {
          scheduleRetry();
          return;
        }
        const failed = {
          ...entry,
          failed: (error instanceof Error ? error.message : String(error)).slice(0, 500) || "Not sent.",
        };
        write(failed);
        emit(entries.map((queued) => (queued.requestId === entry.requestId ? failed : queued)));
      } finally {
        delivering.delete(entry.requestId);
      }
    }
  },
  /** Retries queued messages soon (the runtime just went away mid-send). */
  later(): void {
    scheduleRetry();
  },
};
