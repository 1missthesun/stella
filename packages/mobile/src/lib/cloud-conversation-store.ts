import type { AgentActivityEntry } from "@stella/contracts/conversation-agent-activity";
import {
  MAX_CLIENT_RECORDS,
  type JournalRecord,
} from "@stella/contracts/conversation-protocol";
import {
  ConversationSocket,
  type ConversationSocketEvent,
} from "@stella/contracts/conversation-socket";
import {
  EMPTY_JOURNAL_RECORDS as EMPTY_RECORDS,
  MAX_RETAINED_STORES,
  OLDER_EXHAUSTED_NOTICE,
  OLDER_INCOMPLETE_NOTICE,
  OLDER_LIMIT_NOTICE,
  OLDER_TIMEOUT_MS,
  TEARDOWN_GRACE_MS,
  appendJournalRecords,
  initialConversationViewState,
  liveTurnAfterRecords,
  liveTurnFromReady,
  liveTurnWithTool,
  olderRangeIsComplete,
  olderWouldExceedRetainedLimit,
  prependOlderRecords,
  trimRetainedRecords,
  type ConversationViewState,
} from "@stella/contracts/conversation-store-reducer";

let appActive = true;

export const setCloudConversationAppActive = (active: boolean): void => {
  appActive = active;
  if (!active) {
    for (const store of stores.values()) store.trimRetained();
    return;
  }
  for (const store of stores.values()) store.wake();
};

export type { LiveTurn } from "@stella/contracts/conversation-store-reducer";

export type ConversationState = ConversationViewState & {
  activity: "idle" | "running";
  runningAgents: readonly AgentActivityEntry[];
  runningAgentsAtMs: number;
};

const EMPTY_AGENTS: readonly AgentActivityEntry[] = [];

const EMIT_COALESCE_MS = 16;
/**
 * Appends may run this far past the retention cap; the window is cut back
 * once the chat goes quiet (or the app leaves the foreground), so an arrival
 * in a full chat only appends instead of also dropping the oldest records.
 */
const RETAINED_OVERFLOW = 400;
const TRIM_IDLE_MS = 8_000;
const TURN_END_HOLD_MS = 120;

const awaitsTurnEnd = (
  record: JournalRecord | undefined,
  liveTurnId: string | null,
): record is JournalRecord =>
  record?.kind === "message" &&
  record.role === "assistant" &&
  !record.hidden &&
  record.turnId === liveTurnId &&
  record.payload.stopReason !== "toolUse";

const initialState = (conversationId: string): ConversationState => ({
  ...initialConversationViewState(conversationId),
  activity: "idle",
  runningAgents: EMPTY_AGENTS,
  runningAgentsAtMs: 0,
});

const HYDRATE_TIMEOUT_MS = 1_500;

export type ConversationStoreSeed = {
  epoch: number;
  headSeq: number;
  floorSeq: number;
  records: readonly JournalRecord[];
};

class ConversationStore {
  readonly conversationId: string;
  readonly accountScope: string;
  readonly ownerGeneration: string;
  private state: ConversationState;
  private readonly listeners = new Set<() => void>();
  private socket: ConversationSocket | null = null;
  private subscribers = 0;
  private baseUrl: string | null = null;
  private olderTimer: ReturnType<typeof setTimeout> | null = null;
  private teardownTimer: ReturnType<typeof setTimeout> | null = null;
  private hydration: Promise<void> | null = null;
  private hydrateRequested = false;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private lastEmitMs = 0;
  private turnEndHold: ReturnType<typeof setTimeout> | null = null;
  private trimTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    conversationId: string,
    accountScope: string,
    ownerGeneration: string,
  ) {
    this.conversationId = conversationId;
    this.accountScope = accountScope;
    this.ownerGeneration = ownerGeneration;
    this.state = initialState(conversationId);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    this.subscribers += 1;
    if (this.teardownTimer) {
      clearTimeout(this.teardownTimer);
      this.teardownTimer = null;
    }
    this.ensureSocket();
    return () => {
      this.listeners.delete(listener);
      this.subscribers -= 1;
      if (this.subscribers > 0) return;
      if (this.teardownTimer) clearTimeout(this.teardownTimer);
      this.teardownTimer = setTimeout(() => {
        this.teardownTimer = null;
        if (this.subscribers <= 0) this.teardown();
      }, TEARDOWN_GRACE_MS);
    };
  };

  getSnapshot = (): ConversationState => this.state;

  setConfig(baseUrl: string | null, resolved: boolean): void {
    const next = baseUrl?.replace(/\/+$/, "") || null;
    if (next !== this.baseUrl) {
      const replacedAuthority = this.baseUrl !== null;
      this.baseUrl = next;
      if (this.socket) {
        this.socket.stop();
        this.socket = null;
      }
      if (replacedAuthority) {
        this.state = initialState(this.conversationId);
        this.emit();
      }
      this.ensureSocket();
    }
    if (!next && resolved && this.state.status !== "blocked") {
      this.patch({
        status: "blocked",
        statusMessage: "Live cloud chat isn't available on this deployment.",
        statusRetryable: false,
      });
    }
  }

  hydrate(load: () => Promise<ConversationStoreSeed | null>): void {
    if (this.hydrateRequested) return;
    this.hydrateRequested = true;
    if (this.socket || this.state.epoch !== null || this.state.records.length) {
      return;
    }
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      this.hydration = null;
      this.ensureSocket();
    };
    const timer = setTimeout(settle, HYDRATE_TIMEOUT_MS);
    this.hydration = load()
      .then((seed) => {
        if (settled) return;
        clearTimeout(timer);
        if (seed) this.applySeed(seed);
      })
      .catch(() => undefined)
      .then(settle);
  }

  private applySeed(seed: ConversationStoreSeed): void {
    if (this.socket || this.state.epoch !== null || this.state.records.length) {
      return;
    }
    const records = seed.records;
    if (!records.length || records[records.length - 1]!.seq !== seed.headSeq) {
      return;
    }
    for (let index = 1; index < records.length; index += 1) {
      if (records[index]!.seq !== records[index - 1]!.seq + 1) return;
    }
    this.patch({
      epoch: seed.epoch,
      headSeq: seed.headSeq,
      floorSeq: seed.floorSeq,
      records: records.slice(-MAX_CLIENT_RECORDS),
      hasOlder: records[0]!.seq > seed.floorSeq,
    });
  }

  get idle(): boolean {
    return this.subscribers <= 0;
  }

  retry(): void {
    this.socket?.retryNow();
  }

  retireAuthority(): void {
    this.socket?.stop();
    this.socket = null;
    this.baseUrl = null;
    if (this.olderTimer) clearTimeout(this.olderTimer);
    this.olderTimer = null;
    this.state = initialState(this.conversationId);
    this.emit();
  }

  cancelTurn(turnId: string): boolean {
    return this.socket?.cancelTurn(turnId) ?? false;
  }

  wake(): void {
    this.socket?.wake();
  }

  loadOlder(): void {
    if (this.state.loadingOlder || !this.state.hasOlder) return;
    const oldest = this.state.records[0]?.seq;
    if (oldest === undefined || oldest <= this.state.floorSeq) {
      this.patch({ hasOlder: false });
      return;
    }
    if (olderWouldExceedRetainedLimit(this.state.records)) {
      this.patch({ hasOlder: false, olderNotice: OLDER_LIMIT_NOTICE });
      return;
    }
    if (!this.socket?.requestOlder(oldest)) return;
    this.patch({ loadingOlder: true, olderNotice: null });
    if (this.olderTimer) clearTimeout(this.olderTimer);
    this.olderTimer = setTimeout(() => {
      this.olderTimer = null;
      if (this.state.loadingOlder) this.patch({ loadingOlder: false });
    }, OLDER_TIMEOUT_MS);
  }

  private ensureSocket(): void {
    if (this.socket || this.subscribers <= 0 || !this.baseUrl) return;
    if (this.hydration) return;
    const lastSeq = this.state.records.at(-1)?.seq ?? -1;
    const initialCursor =
      this.state.epoch !== null && lastSeq >= 0
        ? {
            epoch: this.state.epoch,
            lastSeq,
            headSeq: lastSeq,
            floorSeq: this.state.floorSeq,
            windowStartSeq: this.state.records[0]!.seq,
          }
        : undefined;
    this.socket = new ConversationSocket({
      conversationId: this.conversationId,
      baseUrl: this.baseUrl,
      ...(initialCursor ? { initialCursor } : {}),
      getToken: async (options) => {
        const { getAuthToken } = await import("./auth-token");
        return getAuthToken(options);
      },
      isActive: () => appActive,
      onEvent: (event) => this.onEvent(event),
    });
    this.socket.start();
  }

  private releaseTurnEndHold(): void {
    if (!this.turnEndHold) return;
    clearTimeout(this.turnEndHold);
    this.turnEndHold = null;
  }

  trimRetained(): void {
    if (this.trimTimer) clearTimeout(this.trimTimer);
    this.trimTimer = null;
    const trimmed = trimRetainedRecords(this.state);
    if (trimmed) this.patch(trimmed);
  }

  private scheduleTrim(): void {
    if (this.state.records.length <= MAX_CLIENT_RECORDS) return;
    if (this.trimTimer) clearTimeout(this.trimTimer);
    this.trimTimer = setTimeout(() => {
      this.trimTimer = null;
      if (this.state.loadingOlder) {
        this.scheduleTrim();
        return;
      }
      this.trimRetained();
    }, TRIM_IDLE_MS);
  }

  private teardown(): void {
    this.releaseTurnEndHold();
    if (this.trimTimer) clearTimeout(this.trimTimer);
    this.trimTimer = null;
    this.socket?.stop();
    this.socket = null;
    if (this.olderTimer) clearTimeout(this.olderTimer);
    this.olderTimer = null;
    this.patch({ status: "idle", live: null, loadingOlder: false });
  }

  private emit(): void {
    if (this.emitTimer || this.turnEndHold) return;
    const sinceLast = Date.now() - this.lastEmitMs;
    if (sinceLast >= EMIT_COALESCE_MS) {
      this.notify();
      return;
    }
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.notify();
    }, EMIT_COALESCE_MS - sinceLast);
  }

  private notify(): void {
    this.lastEmitMs = Date.now();
    for (const listener of this.listeners) listener();
  }

  private patch(next: Partial<ConversationState>): void {
    this.state = { ...this.state, ...next };
    this.emit();
  }

  private onEvent(event: ConversationSocketEvent): void {
    switch (event.type) {
      case "status": {
        const message = event.message ?? null;
        if (
          this.state.status === event.status &&
          this.state.statusMessage === message &&
          this.state.statusRetryable === event.retryable
        ) {
          return;
        }
        this.patch({
          status: event.status,
          statusMessage: message,
          statusRetryable: event.retryable,
        });
        return;
      }
      case "ready": {
        const epochChanged =
          this.state.epoch !== null && this.state.epoch !== event.ready.epoch;
        const records = epochChanged ? EMPTY_RECORDS : this.state.records;
        const oldest = records[0]?.seq ?? event.ready.windowStartSeq;
        this.patch({
          title: event.ready.title,
          epoch: event.ready.epoch,
          headSeq: event.ready.headSeq,
          floorSeq: event.ready.floorSeq,
          activity: event.ready.activity === "running" ? "running" : "idle",
          runningAgents:
            event.ready.agents.length > 0 ? event.ready.agents : EMPTY_AGENTS,
          runningAgentsAtMs: event.ready.serverTimeMs,
          hasOlder: oldest > event.ready.floorSeq,
          ...(epochChanged
            ? {
                records,
                loadingOlder: false,
                olderNotice: null,
              }
            : {}),
          live: liveTurnFromReady(event.ready.live),
        });
        return;
      }
      case "agents":
        this.patch({
          runningAgents: event.agents.length > 0 ? event.agents : EMPTY_AGENTS,
          runningAgentsAtMs: event.atMs,
        });
        return;
      case "records":
        this.appendRecords(event.records);
        return;
      case "older":
        this.prependRecords(event.records, {
          complete: event.complete,
          fromSeq: event.fromSeq,
          toSeq: event.toSeq,
        });
        return;
      case "reset":
        this.patch({
          records: EMPTY_RECORDS,
          live: null,
          hasOlder: false,
          loadingOlder: false,
          olderNotice: null,
        });
        return;
      case "gap":
        this.patch({
          floorSeq: Math.max(this.state.floorSeq, event.toSeq + 1),
          hasOlder: true,
        });
        return;
      case "tool":
        this.patch({ live: liveTurnWithTool(this.state.live, event) });
        return;
    }
  }

  private appendRecords(incoming: readonly JournalRecord[]): void {
    const appended = appendJournalRecords(this.state, incoming, {
      overflow: RETAINED_OVERFLOW,
    });
    if (!appended) return;
    const heldTurnId = this.turnEndHold ? this.state.live?.turnId ?? null : null;
    const live = liveTurnAfterRecords(this.state.live, appended.fresh);
    if (heldTurnId !== null && live?.turnId !== heldTurnId) {
      this.releaseTurnEndHold();
    }
    this.state = {
      ...this.state,
      records: appended.records,
      hasOlder: appended.hasOlder,
      live,
      headSeq: appended.headSeq,
    };
    this.scheduleTrim();
    if (!this.turnEndHold && awaitsTurnEnd(appended.fresh.at(-1), live?.turnId ?? null)) {
      this.turnEndHold = setTimeout(() => {
        this.turnEndHold = null;
        this.emit();
      }, TURN_END_HOLD_MS);
      return;
    }
    this.emit();
  }

  private prependRecords(
    incoming: readonly JournalRecord[],
    range?: { complete?: boolean; fromSeq?: number; toSeq?: number },
  ): void {
    if (this.olderTimer) clearTimeout(this.olderTimer);
    this.olderTimer = null;
    if (!olderRangeIsComplete(incoming, range)) {
      this.patch({
        hasOlder: true,
        loadingOlder: false,
        olderNotice: OLDER_INCOMPLETE_NOTICE,
      });
      return;
    }
    const prepended = prependOlderRecords(this.state, incoming);
    if (!prepended) {
      this.patch({
        hasOlder: false,
        loadingOlder: false,
        olderNotice: OLDER_EXHAUSTED_NOTICE,
      });
      return;
    }
    this.patch({
      records: prepended.records,
      hasOlder: prepended.hasOlder,
      loadingOlder: false,
      olderNotice: null,
    });
  }
}

const stores = new Map<string, ConversationStore>();

export const conversationStore = (
  conversationId: string,
  accountScope: string,
  ownerGeneration = "unfenced",
): ConversationStore => {
  const storeKey = `${accountScope}\u0000${ownerGeneration}\u0000${conversationId}`;
  const existing = stores.get(storeKey);
  if (existing) return existing;
  const created = new ConversationStore(
    conversationId,
    accountScope,
    ownerGeneration,
  );
  stores.set(storeKey, created);
  if (stores.size > MAX_RETAINED_STORES) {
    for (const [id, store] of stores) {
      if (stores.size <= MAX_RETAINED_STORES) break;
      if (id !== storeKey && store.idle) stores.delete(id);
    }
  }
  return created;
};

export const retireCloudConversationClientAuthority = (
  accountScope: string,
  ownerGeneration?: string,
): void => {
  for (const [key, store] of stores) {
    if (
      store.accountScope === accountScope &&
      (ownerGeneration === undefined ||
        store.ownerGeneration === ownerGeneration)
    ) {
      continue;
    }
    store.retireAuthority();
    stores.delete(key);
  }
};

export type { ConversationStore };
