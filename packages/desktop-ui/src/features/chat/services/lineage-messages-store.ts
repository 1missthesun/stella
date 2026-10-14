import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  EventRecord,
  LocalChatUpdatedPayload,
  MessageRecord,
} from "@stella/contracts/local-chat";
import type { ConversationFocusRoot } from "@stella/contracts/reply-refs";
import { focusRootKey } from "./conversation-focus-store";
import { replyRefsFromPayload } from "../lib/reply-refs";
import { titleNamesThread } from "@stella/contracts/reply-context";
import {
  getSpawnedDescriptions,
  getSpawnedThreadIds,
} from "../hooks/use-event-rows";

export const LINEAGE_PAGE_SIZE = 80;
const REFRESH_DEBOUNCE_MS = 250;

export type LineageSnapshot = {
  messages: MessageRecord[];
  hasLoaded: boolean;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  error: Error | null;
};

const EMPTY_SNAPSHOT: LineageSnapshot = {
  messages: [],
  hasLoaded: false,
  hasOlder: false,
  isLoadingOlder: false,
  error: null,
};

type Entry = {
  key: string;
  conversationId: string;
  root: ConversationFocusRoot;
  snapshot: LineageSnapshot;
  listeners: Set<(snapshot: LineageSnapshot) => void>;
  inFlight: Promise<void> | null;
  refreshTimer: number | null;
  refreshQueued: boolean;
};

const entries = new Map<string, Entry>();
let updateUnsubscribe: (() => void) | null = null;

export type LineageSource = {
  messages: readonly MessageRecord[];
  hasOlder: boolean;
  isLoadingOlder?: boolean;
  loadOlder: () => void | boolean | Promise<unknown>;
  /**
   * Known tasks (thread id → description), used for legacy journals that
   * predate structured lifecycle records.
   */
  tasks?: ReadonlyArray<{ id: string; description: string }>;
};
const providedSources = new Map<string, LineageSource>();

const spawnDescription = (event: EventRecord): string | null => {
  if (event.type !== "tool_request") return null;
  const payload = event.payload as
    | { toolName?: unknown; args?: { description?: unknown } }
    | undefined;
  if (payload?.toolName !== "spawn_agent") return null;
  const description = payload.args?.description;
  return typeof description === "string" && description.trim()
    ? description.trim()
    : null;
};

const deriveLineage = (
  source: LineageSource,
  root: ConversationFocusRoot,
): { messages: MessageRecord[]; startLoaded: boolean } => {
  // A message root's chain includes its own turn's replies and every update
  // on the tasks that turn spawned; see `listLineageMessages` locally. The
  // turn's tasks are known by thread id when the journal carries one, else
  // by matching the spawn's description to a task title (the runtime's task
  // list, a cited title, or the thread id's slug) — the same rule reply
  // context applies, so the badge and this chain agree.
  const turnOf = (message: MessageRecord) =>
    root.kind === "message" && message.payload?.userMessageId === root.id;
  const ownAgentIds = new Set<string>();
  if (root.kind === "message") {
    const threadIdsByTitle = new Map<string, string[]>();
    const citedThreadIds = new Set<string>();
    const learn = (title: string | undefined, threadId: string) => {
      const key = title?.trim();
      if (!key) return;
      const known = threadIdsByTitle.get(key) ?? [];
      if (!known.includes(threadId)) known.push(threadId);
      threadIdsByTitle.set(key, known);
    };
    for (const task of source.tasks ?? []) learn(task.description, task.id);
    for (const message of source.messages) {
      for (const ref of replyRefsFromPayload(message.payload)) {
        if (ref.kind !== "agent") continue;
        citedThreadIds.add(ref.threadId);
        learn(ref.title, ref.threadId);
      }
    }
    const descriptions: string[] = [];
    for (const message of source.messages) {
      if (!turnOf(message)) continue;
      for (const id of getSpawnedThreadIds(message.toolEvents)) ownAgentIds.add(id);
      descriptions.push(...getSpawnedDescriptions(message.toolEvents));
    }
    for (const description of descriptions) {
      for (const id of threadIdsByTitle.get(description.trim()) ?? []) ownAgentIds.add(id);
      for (const id of citedThreadIds) if (titleNamesThread(description, id)) ownAgentIds.add(id);
    }
  }
  const cites = (message: MessageRecord) =>
    replyRefsFromPayload(message.payload).some((ref) =>
      root.kind === "message"
        ? (ref.kind === "message" && ref.id === root.id) ||
          (ref.kind === "agent" && ownAgentIds.has(ref.threadId))
        : ref.kind === "agent" && ref.threadId === root.threadId,
    );
  const taskDescription =
    root.kind === "agent"
      ? source.tasks?.find((task) => task.id === root.threadId)?.description?.trim()
      : undefined;
  const spawnedHere = (message: MessageRecord) =>
    root.kind === "agent" && message.toolEvents.some((event) =>
      (event.type === "agent-started" && event.payload?.agentId === root.threadId) ||
      (Boolean(taskDescription) && spawnDescription(event) === taskDescription),
    );
  const included = new Set<string>();
  const spawnTurnUserIds = new Set<string>();
  let rootLoaded = false;
  for (const message of source.messages) {
    const isRoot = root.kind === "message" && message._id === root.id;
    const spawned = spawnedHere(message);
    if (isRoot) rootLoaded = true;
    if (isRoot || turnOf(message) || cites(message) || spawned) {
      included.add(message._id);
      if (spawned) {
        const owner = message.payload?.userMessageId;
        if (typeof owner === "string" && owner) spawnTurnUserIds.add(owner);
      }
    }
  }
  const messages = source.messages.filter(
    (message) =>
      included.has(message._id) ||
      (message.type === "user_message" && spawnTurnUserIds.has(message._id)),
  );
  const loadedIds = new Set(messages.map((message) => message._id));
  const originalSpawnLoaded = (message: MessageRecord) => {
    const owner = message.payload?.userMessageId;
    return (
      typeof owner === "string" &&
      loadedIds.has(owner) &&
      message.toolEvents.some(
        (event) =>
          event.type === "agent-started" &&
          root.kind === "agent" &&
          event.payload?.agentId === root.threadId &&
          !event.payload?.isFollowUp,
      )
    );
  };
  return {
    messages,
    startLoaded:
      root.kind === "message"
        ? rootLoaded
        : messages.some(originalSpawnLoaded),
  };
};

const applyProvidedSource = (entry: Entry, source: LineageSource) => {
  const lineage = deriveLineage(source, entry.root);
  const hasOlder = source.hasOlder && !lineage.startLoaded;
  setSnapshot(entry, {
    messages: sortMessages(lineage.messages),
    hasLoaded: true,
    hasOlder,
    isLoadingOlder: hasOlder && Boolean(source.isLoadingOlder),
    error: null,
  });
};

export const provideLineageSource = (
  conversationId: string,
  source: LineageSource | null,
): void => {
  if (!source) {
    providedSources.delete(conversationId);
    return;
  }
  providedSources.set(conversationId, source);
  for (const entry of entries.values()) {
    if (entry.conversationId === conversationId)
      applyProvidedSource(entry, source);
  }
};

const getApi = () =>
  typeof window === "undefined" ? undefined : window.electronAPI?.localChat;

const entryKey = (conversationId: string, root: ConversationFocusRoot) =>
  `${conversationId}\0${focusRootKey(root)}`;

const emit = (entry: Entry) => {
  for (const listener of entry.listeners) listener(entry.snapshot);
};

const setSnapshot = (entry: Entry, patch: Partial<LineageSnapshot>) => {
  entry.snapshot = { ...entry.snapshot, ...patch };
  emit(entry);
};

const sortMessages = (messages: MessageRecord[]) =>
  messages
    .slice()
    .sort(
      (a, b) =>
        (a.sequence ?? 0) - (b.sequence ?? 0) ||
        a.timestamp - b.timestamp ||
        a._id.localeCompare(b._id),
    );

const readAll = (entry: Entry): Promise<void> => {
  const provided = providedSources.get(entry.conversationId);
  if (provided) {
    applyProvidedSource(entry, provided);
    return Promise.resolve();
  }
  if (entry.inFlight) {
    entry.refreshQueued = true;
    return entry.inFlight;
  }
  const api = getApi();
  if (!api?.listLineageMessages) {
    setSnapshot(entry, { hasLoaded: true });
    return Promise.resolve();
  }
  const limit = Math.max(LINEAGE_PAGE_SIZE, entry.snapshot.messages.length);
  entry.inFlight = api
    .listLineageMessages({
      conversationId: entry.conversationId,
      root: entry.root,
      limit,
    })
    .then((window) => {
      setSnapshot(entry, {
        messages: sortMessages(window.messages),
        hasLoaded: true,
        hasOlder: window.hasOlder,
        error: null,
      });
    })
    .catch((error: unknown) => {
      setSnapshot(entry, {
        hasLoaded: true,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    })
    .finally(() => {
      entry.inFlight = null;
      if (entry.refreshQueued) {
        entry.refreshQueued = false;
        void readAll(entry);
      }
    });
  return entry.inFlight;
};

const readOlder = (entry: Entry): Promise<boolean> => {
  const provided = providedSources.get(entry.conversationId);
  if (provided) {
    if (!entry.snapshot.hasOlder || entry.snapshot.isLoadingOlder) {
      return Promise.resolve(false);
    }
    return Promise.resolve(provided.loadOlder()).then(
      () => true,
      () => false,
    );
  }
  const api = getApi();
  const oldest = entry.snapshot.messages[0];
  if (
    !api?.listLineageMessages ||
    !oldest ||
    typeof oldest.sequence !== "number" ||
    entry.inFlight ||
    !entry.snapshot.hasOlder
  ) {
    return Promise.resolve(false);
  }
  setSnapshot(entry, { isLoadingOlder: true });
  const beforeSequence = oldest.sequence;
  entry.inFlight = api
    .listLineageMessages({
      conversationId: entry.conversationId,
      root: entry.root,
      beforeSequence,
      limit: LINEAGE_PAGE_SIZE,
    })
    .then((window) => {
      const byId = new Map<string, MessageRecord>();
      for (const message of window.messages) byId.set(message._id, message);
      for (const message of entry.snapshot.messages) {
        byId.set(message._id, message);
      }
      setSnapshot(entry, {
        messages: sortMessages(Array.from(byId.values())),
        hasOlder: window.hasOlder,
        isLoadingOlder: false,
        error: null,
      });
    })
    .catch((error: unknown) => {
      setSnapshot(entry, {
        isLoadingOlder: false,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    })
    .finally(() => {
      entry.inFlight = null;
      if (entry.refreshQueued) {
        entry.refreshQueued = false;
        void readAll(entry);
      }
    });
  return entry.inFlight.then(() => true);
};

const scheduleRefresh = (entry: Entry) => {
  if (entry.refreshTimer !== null) window.clearTimeout(entry.refreshTimer);
  entry.refreshTimer = window.setTimeout(() => {
    entry.refreshTimer = null;
    void readAll(entry);
  }, REFRESH_DEBOUNCE_MS);
};

const handleLocalUpdate = (payload: LocalChatUpdatedPayload | null) => {
  if (!payload?.conversationId) return;
  if (providedSources.has(payload.conversationId)) return;
  for (const entry of entries.values()) {
    if (
      entry.conversationId === payload.conversationId &&
      entry.listeners.size > 0
    ) {
      scheduleRefresh(entry);
    }
  }
};

const syncUpdateSubscription = () => {
  const active = Array.from(entries.values()).some(
    (entry) => entry.listeners.size > 0,
  );
  if (active && !updateUnsubscribe) {
    updateUnsubscribe = getApi()?.onUpdated?.(handleLocalUpdate) ?? null;
  } else if (!active && updateUnsubscribe) {
    updateUnsubscribe();
    updateUnsubscribe = null;
  }
};

const evictIdle = () => {
  for (const [key, entry] of entries) {
    if (entry.listeners.size === 0 && !entry.inFlight) {
      if (entry.refreshTimer !== null) window.clearTimeout(entry.refreshTimer);
      entries.delete(key);
    }
  }
};

export const subscribeToLineageMessages = (
  conversationId: string,
  root: ConversationFocusRoot,
  listener: (snapshot: LineageSnapshot) => void,
): (() => void) => {
  const key = entryKey(conversationId, root);
  let entry = entries.get(key);
  if (!entry) {
    entry = {
      key,
      conversationId,
      root,
      snapshot: EMPTY_SNAPSHOT,
      listeners: new Set(),
      inFlight: null,
      refreshTimer: null,
      refreshQueued: false,
    };
    entries.set(key, entry);
  }
  entry.listeners.add(listener);
  syncUpdateSubscription();
  listener(entry.snapshot);
  if (!entry.snapshot.hasLoaded) void readAll(entry);
  return () => {
    entry.listeners.delete(listener);
    syncUpdateSubscription();
    evictIdle();
  };
};

export const loadOlderLineageMessages = (
  conversationId: string,
  root: ConversationFocusRoot,
): Promise<boolean> => {
  const entry = entries.get(entryKey(conversationId, root));
  return entry ? readOlder(entry) : Promise.resolve(false);
};

export const useLineageMessages = (
  conversationId: string | null | undefined,
  root: ConversationFocusRoot | null | undefined,
) => {
  const rootKey = root ? focusRootKey(root) : null;
  const [snapshot, setSnapshotState] =
    useState<LineageSnapshot>(EMPTY_SNAPSHOT);
  useEffect(() => {
    if (!conversationId || !root) {
      setSnapshotState(EMPTY_SNAPSHOT);
      return;
    }
    return subscribeToLineageMessages(conversationId, root, setSnapshotState);
    // `rootKey` stands in for the root object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, rootKey]);
  const loadOlder = useCallback(() => {
    if (!conversationId || !root) return false;
    return loadOlderLineageMessages(conversationId, root);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, rootKey]);
  return useMemo(() => ({ ...snapshot, loadOlder }), [snapshot, loadOlder]);
};

