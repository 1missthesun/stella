import { getAuthToken } from "@/global/auth/services/auth-token";
import { conversationBrainChanged } from "@/features/execution-placement/conversation-brain-signal";
import { conversationJournalAdvanced } from "./journal-advanced";
import type { JournalRecord } from "@stella/contracts/conversation-protocol";
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
  type ConversationViewState,
} from "@stella/contracts/conversation-store-reducer";
import {
  ConversationSocket,
  type ConversationSocketCursor,
  type ConversationSocketEvent,
} from "./conversation-socket";
import {
  pendingPrompts,
  type CloudConversationOutboxAuthority,
} from "./conversation-outbox";
import type { CloudConversationCacheAuthority } from "@stella/contracts/cloud-conversation-cache";
import { cloudConversationCacheClient } from "./cloud-conversation-cache-client";
import { ConversationCachePersister } from "./conversation-cache-persister";
import {
  cloudReadinessNow,
  reportCloudReadiness,
} from "./cloud-readiness-timing";

export type ConversationState = ConversationViewState & {
  recordsSource?: "none" | "cached-stale" | "canonical";
};

const initialState = (conversationId: string): ConversationState => ({
  ...initialConversationViewState(conversationId),
  recordsSource: "none",
});

const OLDER_CONTINUE_RETRY_MS = 3_500;
const OLDER_CONTINUE_RETRIES = 20;

class ConversationStore {
  readonly conversationId: string;
  readonly accountScope: string;
  readonly ownerGeneration: string;
  readonly authority: CloudConversationOutboxAuthority;
  private state: ConversationState;
  private readonly listeners = new Set<() => void>();
  private socket: ConversationSocket | null = null;
  private subscribers = 0;
  private baseUrl: string | null = null;
  private olderTimer: ReturnType<typeof setTimeout> | null = null;
  private olderPartial: {
    nextSeq: number;
    toSeq: number;
    records: JournalRecord[];
  } | null = null;
  private olderRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private teardownTimer: ReturnType<typeof setTimeout> | null = null;
  private authorityRetired = false;
  private cacheHydrationStarted = false;
  private cacheHydrated = false;
  private cacheContainsUnverifiedRecords = false;
  private readonly cache: ConversationCachePersister;

  constructor(
    conversationId: string,
    accountScope: string,
    ownerGeneration: string,
  ) {
    this.conversationId = conversationId;
    this.accountScope = accountScope;
    this.ownerGeneration = ownerGeneration;
    this.authority = Object.freeze({ accountScope, ownerGeneration });
    this.state = initialState(conversationId);
    this.cache = new ConversationCachePersister({
      authority: this.cacheAuthority,
      isCurrent: () => this.isCurrentCacheAuthority(),
      snapshot: () =>
        this.state.recordsSource === "canonical" && this.state.epoch !== null
          ? {
              epoch: this.state.epoch,
              headSeq: this.state.headSeq,
              floorSeq: this.state.floorSeq,
              title: this.state.title,
              records: this.state.records,
            }
          : null,
    });
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

  activateCache(): void {
    if (this.authorityRetired || this.cacheHydrationStarted) return;
    this.cacheHydrationStarted = true;
    const cacheReadStartedAt = cloudReadinessNow();
    const generation = this.cache.generation;
    void this.cache
      .read()
      .then((cached) => {
        if (this.authorityRetired || generation !== this.cache.generation) {
          return;
        }
        this.cacheHydrated = true;
        this.cache.observe(cached);
        reportCloudReadiness("cloud.cache-read", {
          startedAt: cacheReadStartedAt,
          outcome: cached ? "hit" : "miss",
        });
        if (this.state.recordsSource === "canonical") {
          const incompatible =
            cached !== null &&
            (this.state.epoch === null ||
              cached.epoch !== this.state.epoch ||
              cached.headSeq > this.state.headSeq ||
              (cached.records[0]?.seq ?? cached.floorSeq) <
                this.state.floorSeq);
          if (incompatible) this.purgeCache();
          else this.scheduleCacheWrite();
          return;
        }
        if (!cached) return;
        if (this.state.epoch !== null) {
          const firstCachedSeq = cached.records[0]?.seq ?? cached.floorSeq;
          const compatibleWithReady =
            cached.epoch === this.state.epoch &&
            cached.headSeq <= this.state.headSeq &&
            firstCachedSeq >= this.state.floorSeq;
          if (!compatibleWithReady) {
            this.purgeCache();
            return;
          }
          if (cached.records.length) {
            this.cacheContainsUnverifiedRecords = true;
            this.patch({
              records: cached.records,
              recordsSource: "cached-stale",
              hasOlder: firstCachedSeq > this.state.floorSeq,
              loadingOlder: false,
              olderNotice: null,
            });
          }
          return;
        }
        this.cacheContainsUnverifiedRecords = cached.records.length > 0;
        this.patch({
          title: cached.title,
          epoch: cached.epoch,
          headSeq: cached.headSeq,
          floorSeq: cached.floorSeq,
          records: cached.records,
          recordsSource: "cached-stale",
          hasOlder:
            (cached.records[0]?.seq ?? cached.floorSeq) > cached.floorSeq,
          loadingOlder: false,
          olderNotice: null,
          live: null,
        });
      })
      .catch(() => {
        reportCloudReadiness("cloud.cache-read", {
          startedAt: cacheReadStartedAt,
          outcome: "unavailable",
        });
      })
      .finally(() => {
        if (generation === this.cache.generation) {
          this.cacheHydrated = true;
          this.ensureSocket();
        }
      });
  }

  setConfig(baseUrl: string | null, resolved: boolean): void {
    if (this.authorityRetired) return;
    const next = baseUrl?.replace(/\/+$/, "") || null;
    if (next !== this.baseUrl) {
      const replacedAuthority = this.baseUrl !== null;
      this.baseUrl = next;
      if (this.socket) {
        this.socket.stop();
        this.socket = null;
      }
      if (replacedAuthority) {
        this.purgeCache();
        this.state = initialState(this.conversationId);
        this.emit();
      }
      this.ensureSocket();
    }
    if (!next && resolved && this.state.status !== "blocked") {
      this.purgeCache();
      this.patch({
        status: "blocked",
        statusMessage: "Live cloud chat isn't available on this deployment.",
        statusRetryable: false,
        records: EMPTY_RECORDS,
        recordsSource: "none",
        epoch: null,
        headSeq: -1,
        live: null,
        hasOlder: false,
      });
    }
  }

  get idle(): boolean {
    return this.subscribers <= 0;
  }

  retry(): void {
    this.socket?.retryNow();
  }

  retireAuthority(): void {
    this.authorityRetired = true;
    this.socket?.stop();
    this.socket = null;
    this.baseUrl = null;
    if (this.olderTimer) clearTimeout(this.olderTimer);
    this.olderTimer = null;
    this.dropOlderPartial();
    this.cache.retire();
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
    if (
      this.cacheContainsUnverifiedRecords ||
      this.state.loadingOlder ||
      !this.state.hasOlder
    ) {
      return;
    }
    const oldest = this.state.records[0]?.seq;
    if (oldest === undefined || oldest <= this.state.floorSeq) {
      this.patch({ hasOlder: false });
      return;
    }
    if (olderWouldExceedRetainedLimit(this.state.records)) {
      this.patch({ hasOlder: false, olderNotice: OLDER_LIMIT_NOTICE });
      return;
    }
    this.dropOlderPartial();
    if (!this.socket?.requestOlder(oldest)) return;
    this.patch({ loadingOlder: true, olderNotice: null });
    this.armOlderTimer();
  }

  private armOlderTimer(): void {
    if (this.olderTimer) clearTimeout(this.olderTimer);
    this.olderTimer = setTimeout(() => {
      this.olderTimer = null;
      this.dropOlderPartial();
      if (this.state.loadingOlder) this.patch({ loadingOlder: false });
    }, OLDER_TIMEOUT_MS);
  }

  private dropOlderPartial(): void {
    this.olderPartial = null;
    if (this.olderRetryTimer) clearTimeout(this.olderRetryTimer);
    this.olderRetryTimer = null;
  }

  private requestOlderRemainder(attempt: number): void {
    const partial = this.olderPartial;
    if (!partial) return;
    this.armOlderTimer();
    if (this.socket?.requestOlderRange(partial.nextSeq, partial.toSeq)) return;
    if (this.socket && attempt < OLDER_CONTINUE_RETRIES) {
      this.olderRetryTimer = setTimeout(() => {
        this.olderRetryTimer = null;
        this.requestOlderRemainder(attempt + 1);
      }, OLDER_CONTINUE_RETRY_MS);
      return;
    }
    if (this.olderTimer) clearTimeout(this.olderTimer);
    this.olderTimer = null;
    this.dropOlderPartial();
    this.patch({
      hasOlder: true,
      loadingOlder: false,
      olderNotice: OLDER_INCOMPLETE_NOTICE,
    });
  }

  private ensureSocket(): void {
    if (
      this.authorityRetired ||
      this.socket ||
      this.subscribers <= 0 ||
      !this.baseUrl ||
      !this.cacheHydrated
    ) {
      return;
    }
    const initialCursor: ConversationSocketCursor | undefined =
      this.state.recordsSource === "cached-stale" && this.state.epoch !== null
        ? {
            epoch: this.state.epoch,
            lastSeq: this.state.headSeq,
            headSeq: this.state.headSeq,
            floorSeq: this.state.floorSeq,
            windowStartSeq: this.state.records[0]?.seq ?? this.state.floorSeq,
          }
        : undefined;
    this.socket = new ConversationSocket({
      conversationId: this.conversationId,
      baseUrl: this.baseUrl,
      getToken: (options) => getAuthToken(options ?? {}),
      onEvent: (event) => this.onEvent(event),
      ...(initialCursor ? { initialCursor } : {}),
    });
    this.socket.start();
  }

  private teardown(): void {
    this.socket?.stop();
    this.socket = null;
    if (this.olderTimer) clearTimeout(this.olderTimer);
    this.olderTimer = null;
    this.dropOlderPartial();
    this.patch({
      status: "idle",
      live: null,
      loadingOlder: false,
      recordsSource:
        this.state.recordsSource === "none" ? "none" : "cached-stale",
    });
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private patch(next: Partial<ConversationState>): void {
    this.state = { ...this.state, ...next };
    this.emit();
  }

  private onEvent(event: ConversationSocketEvent): void {
    if (this.authorityRetired) return;
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
        const terminal = event.status === "blocked" && !event.retryable;
        if (terminal) this.purgeCache();
        this.patch({
          status: event.status,
          statusMessage: message,
          statusRetryable: event.retryable,
          ...(terminal
            ? {
                records: EMPTY_RECORDS,
                recordsSource: "none" as const,
                epoch: null,
                headSeq: -1,
                live: null,
                hasOlder: false,
              }
            : event.status === "live"
              ? {}
              : this.state.recordsSource === "none"
                ? { recordsSource: "none" as const }
                : { recordsSource: "cached-stale" as const }),
        });
        return;
      }
      case "ready": {
        const epochChanged =
          this.state.epoch !== null && this.state.epoch !== event.ready.epoch;
        const cachedOutsideCanonicalWindow =
          this.state.recordsSource === "cached-stale" &&
          (this.state.headSeq > event.ready.headSeq ||
            (this.state.records[0]?.seq ?? event.ready.floorSeq) <
              event.ready.floorSeq);
        const dropCached = epochChanged || cachedOutsideCanonicalWindow;
        const records = dropCached ? EMPTY_RECORDS : this.state.records;
        if (dropCached) this.purgeCache();
        const oldest = records[0]?.seq ?? event.ready.windowStartSeq;
        this.cacheContainsUnverifiedRecords = false;
        this.patch({
          title: event.ready.title,
          epoch: event.ready.epoch,
          headSeq: event.ready.headSeq,
          floorSeq: event.ready.floorSeq,
          recordsSource: "canonical",
          hasOlder: oldest > event.ready.floorSeq,
          ...(dropCached
            ? {
                records,
                loadingOlder: false,
                olderNotice: null,
              }
            : {}),
          live: liveTurnFromReady(event.ready.live),
        });
        this.scheduleCacheWrite();
        conversationBrainChanged(this.conversationId);
        conversationJournalAdvanced(this.conversationId);
        return;
      }
      case "brain":
        conversationBrainChanged(this.conversationId);
        return;
      case "records":
        this.appendRecords(event.records);
        conversationJournalAdvanced(this.conversationId);
        return;
      case "older":
        this.prependRecords(event.records, {
          complete: event.complete,
          fromSeq: event.fromSeq,
          toSeq: event.toSeq,
        });
        return;
      case "reset":
        this.dropOlderPartial();
        this.purgeCache();
        this.patch({
          records: EMPTY_RECORDS,
          recordsSource: "none",
          live: null,
          epoch: null,
          headSeq: -1,
          hasOlder: false,
          loadingOlder: false,
          olderNotice: null,
        });
        return;
      case "gap":
        this.patch({ hasOlder: true });
        return;
      case "tool":
        this.patch({ live: liveTurnWithTool(this.state.live, event) });
        return;
    }
  }

  private appendRecords(incoming: readonly JournalRecord[]): void {
    const appended = appendJournalRecords(this.state, incoming, {
      replaceRetained: this.cacheContainsUnverifiedRecords,
    });
    if (!appended) return;
    for (const record of appended.fresh) {
      pendingPrompts.resolve(this.authority, record);
    }
    this.cacheContainsUnverifiedRecords = false;
    this.patch({
      records: appended.records,
      recordsSource: "canonical",
      hasOlder: appended.hasOlder,
      live: liveTurnAfterRecords(this.state.live, appended.fresh),
      headSeq: appended.headSeq,
    });
    this.scheduleCacheWrite();
  }

  private prependRecords(
    incoming: readonly JournalRecord[],
    range?: { complete?: boolean; fromSeq?: number; toSeq?: number },
  ): void {
    const partial = this.olderPartial;
    const continuesPartial =
      partial !== null &&
      range?.fromSeq === partial.nextSeq &&
      range.toSeq === partial.toSeq;
    if (partial !== null && !continuesPartial) return;
    if (this.olderTimer) clearTimeout(this.olderTimer);
    this.olderTimer = null;
    if (this.cacheContainsUnverifiedRecords) {
      this.dropOlderPartial();
      this.patch({ loadingOlder: false });
      return;
    }
    if (continuesPartial) this.dropOlderPartial();
    const fromSeq = range?.fromSeq;
    const toSeq = range?.toSeq;
    const lastSeq = incoming.at(-1)?.seq;
    if (
      range?.complete === false &&
      fromSeq !== undefined &&
      toSeq !== undefined &&
      incoming.every((record, index) => record.seq === fromSeq + index) &&
      lastSeq !== undefined &&
      lastSeq < toSeq
    ) {
      this.dropOlderPartial();
      this.olderPartial = {
        nextSeq: lastSeq + 1,
        toSeq,
        records: (continuesPartial ? partial.records : []).concat(incoming),
      };
      this.requestOlderRemainder(0);
      return;
    }
    if (!olderRangeIsComplete(incoming, range)) {
      this.patch({
        hasOlder: true,
        loadingOlder: false,
        olderNotice: OLDER_INCOMPLETE_NOTICE,
      });
      return;
    }
    const prepended = prependOlderRecords(
      this.state,
      continuesPartial ? partial.records.concat(incoming) : incoming,
    );
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
      recordsSource: "canonical",
      hasOlder: prepended.hasOlder,
      loadingOlder: false,
      olderNotice: null,
    });
    this.scheduleCacheWrite();
  }

  private get cacheAuthority(): CloudConversationCacheAuthority {
    return {
      accountScope: this.accountScope,
      ownerGeneration: this.ownerGeneration,
      conversationId: this.conversationId,
    };
  }

  private isCurrentCacheAuthority(): boolean {
    return (
      !this.authorityRetired &&
      activeOwnerGenerationByAccount.get(this.accountScope) ===
        this.ownerGeneration
    );
  }

  private scheduleCacheWrite(): void {
    if (
      !this.cacheHydrated ||
      !this.isCurrentCacheAuthority() ||
      this.state.recordsSource !== "canonical"
    ) {
      return;
    }
    this.cache.schedule();
  }

  private purgeCache(): void {
    this.cache.purge();
    this.cacheContainsUnverifiedRecords = false;
    this.cacheHydrated = true;
  }
}

const stores = new Map<string, ConversationStore>();
const activeOwnerGenerationByAccount = new Map<string, string>();
const UNRESOLVED_OWNER_GENERATION = "__unresolved_owner_generation__";

export const conversationStore = (
  conversationId: string,
  accountScope: string,
  ownerGeneration = activeOwnerGenerationByAccount.get(accountScope) ??
    UNRESOLVED_OWNER_GENERATION,
): ConversationStore => {
  const storeKey = `${accountScope}\u0000${ownerGeneration}\u0000${conversationId}`;
  const existing = stores.get(storeKey);
  if (existing) {
    if (activeOwnerGenerationByAccount.get(accountScope) === ownerGeneration) {
      existing.activateCache();
    }
    return existing;
  }
  const created = new ConversationStore(
    conversationId,
    accountScope,
    ownerGeneration,
  );
  stores.set(storeKey, created);
  if (activeOwnerGenerationByAccount.get(accountScope) === ownerGeneration) {
    created.activateCache();
  }
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
): void => {
  for (const [key, store] of stores) {
    if (store.accountScope === accountScope) continue;
    store.retireAuthority();
    stores.delete(key);
  }
  for (const scope of activeOwnerGenerationByAccount.keys()) {
    if (scope !== accountScope) activeOwnerGenerationByAccount.delete(scope);
  }
  pendingPrompts.retainAccountScope(accountScope);
  void cloudConversationCacheClient.retainAccount(accountScope);
};

export const activateCloudConversationClientAuthority = (
  authority: CloudConversationOutboxAuthority,
): boolean => {
  activeOwnerGenerationByAccount.set(
    authority.accountScope,
    authority.ownerGeneration,
  );
  for (const [key, store] of stores) {
    if (
      store.accountScope === authority.accountScope &&
      store.ownerGeneration === authority.ownerGeneration
    ) {
      continue;
    }
    store.retireAuthority();
    stores.delete(key);
  }
  void cloudConversationCacheClient.activateAuthority(authority).then(() => {
    if (
      activeOwnerGenerationByAccount.get(authority.accountScope) !==
      authority.ownerGeneration
    ) {
      return;
    }
    for (const store of stores.values()) {
      if (
        store.accountScope === authority.accountScope &&
        store.ownerGeneration === authority.ownerGeneration
      ) {
        store.activateCache();
      }
    }
  });
  return pendingPrompts.activateAuthority(authority);
};

export type { ConversationStore };
