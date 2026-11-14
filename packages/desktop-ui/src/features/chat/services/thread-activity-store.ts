import type { DesktopThreadActivityRecord as ThreadActivityRecord } from "@/features/chat/thread-activity-types";
import {
  onPiChatEvents,
  piChatAgents,
  piChatAvailable,
} from "@/features/chat/pi/pi-chat-store";

const EMPTY_RECORDS: ThreadActivityRecord[] = [];

const PUSH_REFRESH_DEBOUNCE_MS = 120;
const LOAD_RETRY_BASE_MS = 1_000;
const LOAD_RETRY_MAX_ATTEMPTS = 5;
const RETAINED_CONVERSATION_LIMIT = 10;

const PI_AGENT_POLL_MS = 2_000;
const piAgentsRunning = new Set<string>();

export const listThreadActivity = async (
  conversationId: string,
): Promise<ThreadActivityRecord[]> => {
  if (!piChatAvailable()) return EMPTY_RECORDS;
  const records = await piChatAgents(conversationId);
  if (records.some((record) => record.status === "running" && !record.waitingFor)) {
    piAgentsRunning.add(conversationId);
  } else {
    piAgentsRunning.delete(conversationId);
  }
  return records.sort(
    (a, b) => a.startedAt - b.startedAt || a.threadId.localeCompare(b.threadId),
  );
};

const subscribeToThreadActivityUpdates = (
  listener: (conversationId: string) => void,
): (() => void) => {
  if (!piChatAvailable()) return () => {};
  return onPiChatEvents(({ conversationId, events }) => {
    if (
      events.some(
        (event) =>
          event.type === "entry_appended" ||
          event.type === "message_end" ||
          event.type === "tool_execution_end",
      )
    ) {
      listener(conversationId);
    }
  });
};

export type ThreadActivitySnapshot = {
  records: ThreadActivityRecord[];
  hasLoaded: boolean;
  error: Error | null;
};

type ThreadActivityEntry = {
  conversationId: string;
  snapshot: ThreadActivitySnapshot;
  listeners: Set<(snapshot: ThreadActivitySnapshot) => void>;
  recordsByThreadId: Map<string, ThreadActivityRecord>;
  recordListeners: Map<
    string,
    Set<(record: ThreadActivityRecord | null, hasLoaded: boolean) => void>
  >;
  hasHydrated: boolean;
  loading: Promise<void> | null;
  pendingRefetch: boolean;
  refreshTimer: number | null;
  retryTimer: number | null;
  retryAttempt: number;
  requestGeneration: number;
  disposed: boolean;
};

const EMPTY_SNAPSHOT: ThreadActivitySnapshot = {
  records: EMPTY_RECORDS,
  hasLoaded: false,
  error: null,
};

const entries = new Map<string, ThreadActivityEntry>();
const retainedRecordsByConversation = new Map<string, ThreadActivityRecord[]>();
let unsubscribeUpdates: (() => void) | null = null;

const retainRecords = (
  conversationId: string,
  records: ThreadActivityRecord[],
) => {
  retainedRecordsByConversation.delete(conversationId);
  retainedRecordsByConversation.set(conversationId, records.slice());
  while (retainedRecordsByConversation.size > RETAINED_CONVERSATION_LIMIT) {
    const oldestConversationId = retainedRecordsByConversation
      .keys()
      .next().value;
    if (typeof oldestConversationId !== "string") break;
    retainedRecordsByConversation.delete(oldestConversationId);
  }
};

export const getRetainedThreadActivitySnapshot = (
  conversationId: string,
): ThreadActivitySnapshot | null => {
  const records = retainedRecordsByConversation.get(conversationId);
  if (!records) return null;
  return { records: records.slice(), hasLoaded: false, error: null };
};

const recordsSignature = (records: ThreadActivityRecord[]): string =>
  records
    .map(
      (record) =>
        `${record.threadId}\u0000${record.source}\u0000${record.parentAgentId ?? ""}\u0000${record.status}\u0000${record.attemptGeneration ?? 0}\u0000${record.recordRevision ?? 0}\u0000${record.updatedAt}\u0000${record.description}\u0000${record.rootRunId ?? ""}\u0000${JSON.stringify(record.modelConfigSnapshot ?? null)}\u0000${record.assistantMessagesUpdatedSequence ?? ""}\u0000${JSON.stringify(record.assistantMessages ?? [])}\u0000${record.waitingFor ?? ""}\u0000${JSON.stringify(record.paused ?? null)}\u0000${record.longCall ? `${record.longCall.tool}@${record.longCall.since}` : ""}`,
    )
    .join("\n");

const setSnapshot = (
  entry: ThreadActivityEntry,
  snapshot: ThreadActivitySnapshot,
) => {
  entry.snapshot = snapshot;
  entry.recordsByThreadId = new Map(
    snapshot.records.map((record) => [record.threadId, record]),
  );
  if (snapshot.hasLoaded && !snapshot.error) {
    retainRecords(entry.conversationId, snapshot.records);
  }
  for (const listener of entry.listeners) {
    listener({ ...snapshot });
  }
  for (const [threadId, listeners] of entry.recordListeners) {
    const record = entry.recordsByThreadId.get(threadId) ?? null;
    for (const listener of listeners) listener(record, snapshot.hasLoaded);
  }
};

const materializeAggregateSnapshot = (entry: ThreadActivityEntry) => {
  const records = Array.from(entry.recordsByThreadId.values()).sort(
    (a, b) =>
      a.startedAt - b.startedAt || a.threadId.localeCompare(b.threadId),
  );
  entry.snapshot = { ...entry.snapshot, records };
  return entry.snapshot;
};

const refreshEntry = (entry: ThreadActivityEntry): Promise<void> => {
  if (entry.loading) {
    entry.pendingRefetch = true;
    return entry.loading;
  }
  const requestGeneration = ++entry.requestGeneration;
  entry.pendingRefetch = false;
  if (entry.retryTimer !== null) {
    window.clearTimeout(entry.retryTimer);
    entry.retryTimer = null;
  }
  entry.loading = listThreadActivity(entry.conversationId)
    .then((records) => {
      if (entry.disposed || requestGeneration !== entry.requestGeneration) {
        return;
      }
      entry.hasHydrated = true;
      entry.retryAttempt = 0;
      if (
        piAgentsRunning.has(entry.conversationId) &&
        entry.refreshTimer === null
      ) {
        entry.refreshTimer = window.setTimeout(() => {
          entry.refreshTimer = null;
          if (entry.listeners.size > 0 || entry.recordListeners.size > 0) {
            void refreshEntry(entry);
          }
        }, PI_AGENT_POLL_MS);
      }
      if (
        entry.snapshot.hasLoaded &&
        !entry.snapshot.error &&
        recordsSignature(records) ===
          recordsSignature(entry.snapshot.records)
      ) {
        return;
      }
      setSnapshot(entry, {
        records: records,
        hasLoaded: true,
        error: null,
      });
    })
    .catch((error) => {
      if (entry.disposed || requestGeneration !== entry.requestGeneration) {
        return;
      }
      entry.snapshot = {
        ...entry.snapshot,
        hasLoaded: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
      for (const listener of entry.listeners) listener(entry.snapshot);
      for (const [threadId, listeners] of entry.recordListeners) {
        const record = entry.recordsByThreadId.get(threadId) ?? null;
        for (const listener of listeners) listener(record, false);
      }
      if (
        (entry.listeners.size > 0 || entry.recordListeners.size > 0) &&
        entry.retryTimer === null &&
        entry.retryAttempt < LOAD_RETRY_MAX_ATTEMPTS
      ) {
        const delayMs = LOAD_RETRY_BASE_MS * 2 ** entry.retryAttempt;
        entry.retryAttempt += 1;
        entry.retryTimer = window.setTimeout(() => {
          entry.retryTimer = null;
          if (entry.listeners.size > 0 || entry.recordListeners.size > 0) {
            void refreshEntry(entry);
          }
        }, delayMs);
      }
    })
    .finally(() => {
      if (entry.disposed || requestGeneration !== entry.requestGeneration) {
        return;
      }
      entry.loading = null;
      if (entry.pendingRefetch) {
        entry.pendingRefetch = false;
        void refreshEntry(entry);
      }
    });
  return entry.loading;
};

const handleThreadActivityUpdated = (conversationId: string) => {
  const entry = entries.get(conversationId);
  if (!entry || entry.refreshTimer !== null) return;
  entry.refreshTimer = window.setTimeout(() => {
    entry.refreshTimer = null;
    if (entry.listeners.size > 0 || entry.recordListeners.size > 0) {
      void refreshEntry(entry);
    }
  }, PUSH_REFRESH_DEBOUNCE_MS);
};

let runtimeReady = true;

const handleRuntimeAvailability = (snapshot: {
  connected: boolean;
  ready: boolean;
}) => {
  const ready = snapshot.connected && snapshot.ready;
  if (ready && !runtimeReady) {
    for (const entry of entries.values()) {
      if (!entry.snapshot.error) continue;
      entry.retryAttempt = 0;
      void refreshEntry(entry);
    }
  }
  runtimeReady = ready;
};

const ensureSubscription = () => {
  if (unsubscribeUpdates) return;
  const unsubscribeActivity = subscribeToThreadActivityUpdates(
    handleThreadActivityUpdated,
  );
  const unsubscribeAvailability =
    window.electronAPI?.agent?.onAvailability?.(handleRuntimeAvailability);
  unsubscribeUpdates = () => {
    unsubscribeActivity();
    unsubscribeAvailability?.();
  };
};

export const subscribeToThreadActivity = (
  conversationId: string,
  listener: (snapshot: ThreadActivitySnapshot) => void,
): (() => void) => {
  ensureSubscription();
  let entry = entries.get(conversationId);
  if (!entry) {
    const retainedSnapshot = getRetainedThreadActivitySnapshot(conversationId);
    entry = {
      conversationId,
      snapshot: retainedSnapshot ?? EMPTY_SNAPSHOT,
      listeners: new Set(),
      recordsByThreadId: new Map(
        (retainedSnapshot?.records ?? []).map((record) => [
          record.threadId,
          record,
        ]),
      ),
      recordListeners: new Map(),
      hasHydrated: false,
      loading: null,
      pendingRefetch: false,
      refreshTimer: null,
      retryTimer: null,
      retryAttempt: 0,
      requestGeneration: 0,
      disposed: false,
    };
    entries.set(conversationId, entry);
  }
  if (entry.listeners.size === 0 && entry.snapshot.hasLoaded) {
    materializeAggregateSnapshot(entry);
  }
  entry.listeners.add(listener);
  listener({ ...entry.snapshot });
  if (!entry.hasHydrated && !entry.loading) void refreshEntry(entry);

  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0 && entry.recordListeners.size === 0) {
      entry.disposed = true;
      entry.requestGeneration += 1;
      if (entry.refreshTimer !== null) window.clearTimeout(entry.refreshTimer);
      if (entry.retryTimer !== null) window.clearTimeout(entry.retryTimer);
      entries.delete(conversationId);
    }
    if (entries.size === 0 && unsubscribeUpdates) {
      unsubscribeUpdates();
      unsubscribeUpdates = null;
    }
  };
};

export const subscribeToThreadActivityRecord = (
  conversationId: string,
  threadId: string,
  listener: (record: ThreadActivityRecord | null, hasLoaded: boolean) => void,
): (() => void) => {
  ensureSubscription();
  let entry = entries.get(conversationId);
  if (!entry) {
    const retainedSnapshot = getRetainedThreadActivitySnapshot(conversationId);
    entry = {
      conversationId,
      snapshot: retainedSnapshot ?? EMPTY_SNAPSHOT,
      listeners: new Set(),
      recordsByThreadId: new Map(
        (retainedSnapshot?.records ?? []).map((record) => [
          record.threadId,
          record,
        ]),
      ),
      recordListeners: new Map(),
      hasHydrated: false,
      loading: null,
      pendingRefetch: false,
      refreshTimer: null,
      retryTimer: null,
      retryAttempt: 0,
      requestGeneration: 0,
      disposed: false,
    };
    entries.set(conversationId, entry);
  }
  let listeners = entry.recordListeners.get(threadId);
  if (!listeners) {
    listeners = new Set();
    entry.recordListeners.set(threadId, listeners);
  }
  listeners.add(listener);
  listener(
    entry.recordsByThreadId.get(threadId) ?? null,
    entry.snapshot.hasLoaded,
  );
  if (!entry.hasHydrated && !entry.loading) void refreshEntry(entry);

  return () => {
    listeners?.delete(listener);
    if (listeners?.size === 0) entry!.recordListeners.delete(threadId);
    if (entry!.listeners.size === 0 && entry!.recordListeners.size === 0) {
      entry!.disposed = true;
      entry!.requestGeneration += 1;
      if (entry!.refreshTimer !== null)
        window.clearTimeout(entry!.refreshTimer);
      if (entry!.retryTimer !== null) window.clearTimeout(entry!.retryTimer);
      entries.delete(conversationId);
    }
    if (entries.size === 0 && unsubscribeUpdates) {
      unsubscribeUpdates();
      unsubscribeUpdates = null;
    }
  };
};

