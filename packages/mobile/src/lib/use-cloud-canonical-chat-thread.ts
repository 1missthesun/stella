import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";
import {
  cloudOfflineNoticeDueAt,
  idleCloudOfflineWindow,
  nextCloudOfflineWindow,
  shouldShowCloudOfflineNotice,
  type CloudOfflineWindow,
  type CloudSocketStatus,
} from "@stella/contracts/cloud-connection-notice";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AppState } from "react-native";
import { useChatDraftSelector } from "./chat-draft-store";
import { postJson } from "./http";
import { notifySuccess } from "./haptics";
import { ReplyArrivalHaptics } from "./reply-arrival-haptics";
import { authClient } from "./auth-client";
import { clearCachedToken, getTokenOwnerForSubject } from "./auth-token";
import {
  observeCloudConversationIdentity,
  type CloudConversationIdentity,
} from "./cloud-conversation-auth";
import {
  CloudAuthorityError,
  loadCloudConversationAuthority,
  type CloudAuthorityIssue,
  type CloudChatBootstrap,
  type CloudConversationAuthority,
} from "./cloud-conversation-authority";
import { CloudConversationAuthorityStore } from "./cloud-conversation-authority-store";
import {
  readMobileCloudConversationCache,
  readMobileCloudJournalCache,
  rebuildMobileCloudConversationCache,
} from "./cloud-conversation-cache";
import { cancelCanonicalCloudExecution } from "./cloud-canonical-execution";
import {
  conversationStore,
  retireCloudConversationClientAuthority,
  setCloudConversationAppActive,
  type ConversationState,
  type ConversationStore,
} from "./cloud-conversation-store";
import {
  activeCloudTurnId,
  canonicalCloudDispatchIdForTurn,
  canonicalCloudDispatchIds,
  mergeCanonicalCloudMessages,
  projectCloudConversationMessages,
  latestDestinationSwitch,
  rebindCanonicalCloudMessages,
} from "./cloud-journal-projection";
import { getBackendClient } from "./backend";
import { env } from "../config/env";
import {
  AUTOMATIC_EXECUTION_TARGET,
  cancelAutomaticExecution,
  getAutomaticExecutionStatus,
  type AutomaticExecutionTarget,
} from "./execution-placement";
import { collectActivityHubArtifacts } from "./activity-hub-model";
import { useTurnHandoff } from "./use-turn-handoff";
import { createTurnStatusWake } from "./turn-status-wake";
import { canonicalWorkingState } from "./canonical-working-state";
import {
  applyAgentLedger,
  collectJournalTasks,
  markAuthoritativeRunning,
  settleUnlistedTasks,
} from "./journal-tasks";
import { useConversationAgentLedger } from "./use-conversation-agent-ledger";
import { mergeJournalTasks } from "./mobile-task-merge";
import { planCloudTranscriptDisplay } from "./cloud-transcript-display";
import { useChatAttachmentPreviews } from "./use-chat-attachment-previews";
import { useClaudeUsageLimitNotice } from "./claude-usage-limit-notice";
import { useStellaUsageLimitNotice } from "./stella-usage-limit-notice";
import { reuseEqualChatMessages } from "./structural-sharing";
import { TrailingTask } from "./trailing-task";
import type { ChatMessage } from "../types";
import { SentMessageAnchors } from "@stella/contracts/sent-message-anchors";
import type { ChatThreadId } from "./offline-chat-storage";
import type { StoredPhoneAccess } from "./phone-access";
import {
  useChatThread,
  type ChatThread,
  type ChatTransport,
} from "./use-chat-thread";


const safeAuthorityIssue = (error: unknown): CloudAuthorityIssue => {
  if (error instanceof CloudAuthorityError) {
    return { message: error.message, retryable: error.retryable };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/sign in|session|authentication|unauthorized/i.test(message)) {
    return {
      message: "Stella could not verify this account. Sign in again.",
      retryable: true,
    };
  }
  if (/transfer|migration|being linked|ownership/i.test(message)) {
    return {
      message:
        "Your cloud conversations are still moving to this account. Try again shortly.",
      retryable: true,
    };
  }
  return {
    message: "Stella could not load this cloud conversation. Try again.",
    retryable: true,
  };
};

export type CloudAuthorityHookState =
  | { status: "loading"; authority: null; issue: null; retry: () => void }
  | {
      status: "failed";
      authority: null;
      issue: CloudAuthorityIssue;
      retry: () => void;
    }
  | {
      status: "ready";
      authority: CloudConversationAuthority;
      issue: null;
      retry: () => void;
    };

const readChatBootstrap = async (): Promise<CloudChatBootstrap> => {
  const bootstrap = await getBackendClient().call("conversations.bootstrap", {});
  return {
    status: "ready",
    ownerId: bootstrap.ownerId,
    ownerGeneration: bootstrap.ownerGeneration,
    conversationId: bootstrap.conversationId,
    realtime: {
      httpOrigin: env.backendUrl || null,
      socketOrigin: env.backendUrl ? env.backendUrl.replace(/^http/, "ws") : null,
      protocol: 1,
    },
  };
};

const resolveMobileCloudConversationAuthority = async (
  identity: CloudConversationIdentity,
): Promise<CloudConversationAuthority> => {
  const tokenOwner = await getTokenOwnerForSubject(
    identity.expectedSubject,
  );
  const ownerSubject = tokenOwner.subject;
  return loadCloudConversationAuthority(identity, ownerSubject, {
    getBootstrap: () => readChatBootstrap(),
  });
};

const authorityStore = new CloudConversationAuthorityStore({
  resolve: resolveMobileCloudConversationAuthority,
  describeFailure: safeAuthorityIssue,
  onIdentityChange: (identity) => {
    clearCachedToken();
    retireCloudConversationClientAuthority(identity.accountScope);
  },
});

export const primeCloudConversationAuthority = (
  identity: CloudConversationIdentity,
): void => {
  void authorityStore.ensure(identity);
};

export const resetCloudConversationAuthority = (): void => {
  authorityStore.reset();
};

export const useCloudConversationAuthoritySettled = (
  identityKey: string | null,
): boolean => {
  const entry = useSyncExternalStore(
    authorityStore.subscribe,
    authorityStore.getSnapshot,
    authorityStore.getSnapshot,
  );
  if (!identityKey) return true;
  return entry?.identityKey === identityKey && entry.status !== "loading";
};

const retryCloudConversationAuthority = (): void => {
  void authorityStore.retry();
};

export const useCloudConversationAuthority = (): CloudAuthorityHookState => {
  const session = authClient.useSession();
  const identity = useMemo(
    () => observeCloudConversationIdentity(session.data),
    [session.data],
  );
  const identityKey = identity?.identityKey ?? null;
  const pending = session.isPending;

  useLayoutEffect(() => {
    if (pending || !identity) return;
    void authorityStore.ensure(identity);
    // `identity` is derived from the key; re-running on every session object
    // identity would only churn the (idempotent) ensure call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey, pending]);

  const entry = useSyncExternalStore(
    authorityStore.subscribe,
    authorityStore.getSnapshot,
    authorityStore.getSnapshot,
  );

  if (pending || !identity) {
    return {
      status: "loading",
      authority: null,
      issue: null,
      retry: retryCloudConversationAuthority,
    };
  }
  if (!entry || entry.identityKey !== identity.identityKey) {
    return {
      status: "loading",
      authority: null,
      issue: null,
      retry: retryCloudConversationAuthority,
    };
  }
  if (entry.status === "failed") {
    return {
      status: "failed",
      authority: null,
      issue: entry.issue,
      retry: retryCloudConversationAuthority,
    };
  }
  if (entry.status === "loading") {
    return {
      status: "loading",
      authority: null,
      issue: null,
      retry: retryCloudConversationAuthority,
    };
  }
  return {
    status: "ready",
    authority: entry.authority,
    issue: null,
    retry: retryCloudConversationAuthority,
  };
};

const EMPTY_STATE: ConversationState = {
  conversationId: "",
  status: "idle",
  statusMessage: null,
  statusRetryable: true,
  epoch: null,
  headSeq: -1,
  records: [],
  live: null,
  activity: "idle",
  runningAgents: [],
  runningAgentsAtMs: 0,
  title: "",
  floorSeq: 0,
  hasOlder: false,
  loadingOlder: false,
  olderNotice: null,
};

const emptySnapshot = () => EMPTY_STATE;

const CACHE_WRITE_SETTLE_MS = 1_500;
const CACHE_WRITE_MAX_DELAY_MS = 10_000;

const useStableChatMessages = (messages: ChatMessage[]): ChatMessage[] => {
  const previousRef = useRef<readonly ChatMessage[] | null>(null);
  const stable = useMemo(
    () => reuseEqualChatMessages(previousRef.current, messages),
    [messages],
  );
  useEffect(() => {
    previousRef.current = stable;
  }, [stable]);
  return stable;
};

const useSustainedCloudOffline = (status: CloudSocketStatus): boolean => {
  const [offlineWindow, setOfflineWindow] = useState<CloudOfflineWindow>(
    idleCloudOfflineWindow,
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    setOfflineWindow((current) =>
      nextCloudOfflineWindow(current, status, Date.now()),
    );
  }, [status]);
  useEffect(() => {
    const dueAt = cloudOfflineNoticeDueAt(offlineWindow, status);
    if (dueAt === null) return;
    const now = Date.now();
    if (now >= dueAt) {
      setNowMs((current) => (current >= dueAt ? current : now));
      return;
    }
    const timer = setTimeout(() => setNowMs(Date.now()), dueAt - now + 1);
    return () => clearTimeout(timer);
  }, [offlineWindow, status]);
  return shouldShowCloudOfflineNotice(offlineWindow, status, nowMs);
};

const STOP_CONFIRM_MS = 15_000;
const STOP_UNREACHABLE_MESSAGE =
  "Couldn’t stop this reply. Stella isn’t connected right now.";
const STOP_UNCONFIRMED_MESSAGE =
  "This reply is still running. Stella hasn’t confirmed the stop yet.";

const draftHasText = (draft: string): boolean => draft.trim().length > 0;

export const useCloudCanonicalChatThread = (
  authority: CloudConversationAuthority,
  options?: {
    reloadAuthority?: () => void;
    access?: StoredPhoneAccess | null;
    executionTarget?: AutomaticExecutionTarget;
    execution?: CloudExecutionSelection;
    threadId?: ChatThreadId;
  },
): ChatThread => {
  const reloadAuthority = options?.reloadAuthority;
  const access = options?.access ?? null;
  const executionTarget =
    options?.executionTarget ?? AUTOMATIC_EXECUTION_TARGET;
  const execution = options?.execution;
  const threadId = options?.threadId ?? "cloud";
  const [dispatchBindings, setDispatchBindings] = useState<
    ReadonlyMap<string, string | null>
  >(() => new Map());
  const [placementIssue, setPlacementIssue] =
    useState<CloudAuthorityIssue | null>(null);
  const onAdmission = useCallback(
    (event: {
      localMessageId: string;
      dispatchId: string;
      conversationId: string;
    }) => {
      if (event.conversationId !== authority.conversationId) {
        setPlacementIssue({
          message:
            "Stella placed this turn in a different conversation. Reconnect before sending again.",
          retryable: true,
        });
        return;
      }
      setDispatchBindings((current) => {
        if (current.get(event.localMessageId) === event.dispatchId) {
          return current;
        }
        const next = new Map(current);
        next.set(event.localMessageId, event.dispatchId);
        return next;
      });
    },
    [authority.conversationId],
  );
  const store = useMemo(
    () =>
      conversationStore(
        authority.conversationId,
        authority.accountScope,
        authority.ownerGeneration,
      ),
    [
      authority.accountScope,
      authority.conversationId,
      authority.ownerGeneration,
    ],
  );

  useLayoutEffect(() => {
    setDispatchBindings(new Map());
    setPlacementIssue(null);
    retireCloudConversationClientAuthority(
      authority.accountScope,
      authority.ownerGeneration,
    );
  }, [
    authority.accountScope,
    authority.conversationId,
    authority.ownerGeneration,
  ]);

  useLayoutEffect(() => {
    store.hydrate(() =>
      readMobileCloudJournalCache({
        accountScope: authority.accountScope,
        ownerGeneration: authority.ownerGeneration,
        conversationId: authority.conversationId,
        socketOrigin: authority.socketOrigin,
      }),
    );
  }, [
    authority.accountScope,
    authority.conversationId,
    authority.ownerGeneration,
    authority.socketOrigin,
    store,
  ]);

  useEffect(() => {
    store.setConfig(authority.socketOrigin, true);
    store.wake();
  }, [authority.socketOrigin, store]);

  useEffect(() => {
    const active =
      AppState.currentState === "active" || AppState.currentState === "unknown";
    setCloudConversationAppActive(active);
    const subscription = AppState.addEventListener("change", (next) => {
      setCloudConversationAppActive(next === "active" || next === "unknown");
    });
    return () => subscription.remove();
  }, []);

  const replyHaptics = useMemo(() => new ReplyArrivalHaptics(), [store, threadId]);
  useEffect(() => {
    const retireDuringReplay = () => {
      replyHaptics.observeConnection(store.getSnapshot());
    };
    const unsubscribe = store.subscribe(retireDuringReplay);
    const appState = AppState.addEventListener("change", (next) => {
      if (next !== "active" && next !== "unknown") replyHaptics.reset();
    });
    return () => {
      unsubscribe();
      appState.remove();
      replyHaptics.reset();
    };
  }, [replyHaptics, store]);

  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    emptySnapshot,
  );
  const lastSeq = state.records.at(-1)?.seq ?? -1;
  const caughtUp =
    state.epoch !== null && (state.headSeq < 0 || lastSeq >= state.headSeq);
  const authorityReady = !placementIssue && state.status === "live" && caughtUp;
  const pauseStatusInBackground = threadId !== "carplay";
  const [statusWake] = useState(() => createTurnStatusWake());
  useEffect(() => {
    if (!pauseStatusInBackground) {
      statusWake.setPaused(false);
      return;
    }
    statusWake.setPaused(
      AppState.currentState !== "active" && AppState.currentState !== "unknown",
    );
    const subscription = AppState.addEventListener("change", (next) => {
      statusWake.setPaused(next !== "active" && next !== "unknown");
    });
    return () => subscription.remove();
  }, [pauseStatusInBackground, statusWake]);
  const turnSignal = useMemo(() => {
    for (let index = state.records.length - 1; index >= 0; index -= 1) {
      const record = state.records[index]!;
      if (record.kind === "turn") {
        return `${record.turnId}:${record.phase}:${state.live?.turnId ?? ""}`;
      }
    }
    return `:${state.live?.turnId ?? ""}`;
  }, [state.live?.turnId, state.records]);
  useEffect(() => {
    if (caughtUp) statusWake.nudge();
  }, [caughtUp, statusWake, turnSignal]);
  const transport = useMemo<ChatTransport>(
    () => ({
      accountScope: authority.accountScope,
      ownerGeneration: authority.ownerGeneration,
      conversationId: authority.conversationId,
      authorityReady,
      access,
      executionTarget,
      ...(execution ? { execution } : {}),
      onAdmission,
      statusWake,
    }),
    [
      access,
      executionTarget,
      execution,
      authority.accountScope,
      authority.conversationId,
      authority.ownerGeneration,
      authorityReady,
      onAdmission,
      statusWake,
    ],
  );
  const local = useChatThread({ threadId, transport });
  const clientAuthorityReady = authorityReady && !local.authorityIssue;

  const composing = useChatDraftSelector(local.draftStore, draftHasText);
  useEffect(() => {
    if (!composing) return;
    void postJson(
      `/conversations/${encodeURIComponent(authority.conversationId)}/prewarm`,
      {},
      { timeoutMs: 10_000 },
    ).catch(() => undefined);
  }, [composing, authority.conversationId]);

  useEffect(() => {
    const activeIds = local.messages.flatMap((message) =>
      message.role === "user" &&
      (message.queued === true ||
        (local.sending &&
          local.messages
            .slice()
            .reverse()
            .find((candidate) => candidate.role === "user")?.id === message.id))
        ? [message.id]
        : [],
    );
    if (!activeIds.length) return;
    setDispatchBindings((current) => {
      let changed = false;
      const next = new Map(current);
      for (const id of activeIds) {
        if (next.has(id)) continue;
        changed = true;
        next.set(id, null);
      }
      return changed ? next : current;
    });
  }, [local.messages, local.sending]);

  const destinationSwitch = useMemo(
    () => latestDestinationSwitch(state.records),
    [state.records],
  );

  useClaudeUsageLimitNotice(
    threadId === "cloud" ? authority.conversationId : null,
    state.records,
  );
  useStellaUsageLimitNotice(
    threadId === "cloud" ? authority.conversationId : null,
    state.records,
  );

  const projected = useStableChatMessages(
    useMemo(
      () =>
        projectCloudConversationMessages({
          conversationId: authority.conversationId,
          records: state.records,
          hasOlder: state.hasOlder,
        }),
      [authority.conversationId, state.hasOlder, state.records],
    ),
  );

  const cacheAuthority = useMemo(
    () => ({
      accountScope: authority.accountScope,
      ownerGeneration: authority.ownerGeneration,
      conversationId: authority.conversationId,
      socketOrigin: authority.socketOrigin,
    }),
    [
      authority.accountScope,
      authority.conversationId,
      authority.ownerGeneration,
      authority.socketOrigin,
    ],
  );
  const [cachedProjection, setCachedProjection] = useState<{
    store: ConversationStore;
    messages: ChatMessage[];
  } | null>(null);
  useEffect(() => {
    if (threadId !== "cloud") return;
    const snapshot = store.getSnapshot();
    if (snapshot.epoch !== null || snapshot.records.length > 0) return;
    let active = true;
    void readMobileCloudConversationCache(cacheAuthority).then(
      (messages) => {
        if (!active || !messages) return;
        setCachedProjection({ store, messages });
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [cacheAuthority, store, threadId]);
  const cacheVisible =
    cachedProjection !== null &&
    cachedProjection.store === store &&
    state.epoch === null &&
    state.records.length === 0;
  const settledFailure =
    state.status === "blocked" || state.status === "offline";
  const paintedRef = useRef<{
    store: ConversationStore;
    messages: readonly ChatMessage[] | null;
    everShown: boolean;
  }>({ store, messages: null, everShown: false });
  const painted =
    paintedRef.current.store === store
      ? paintedRef.current
      : { store, messages: null, everShown: false };
  const display = planCloudTranscriptDisplay({
    caughtUp,
    settledFailure,
    cacheVisible,
    cached: cachedProjection?.messages ?? null,
    projected,
    lastShown: painted.messages,
    everShown: painted.everShown,
  });
  useEffect(() => {
    paintedRef.current = {
      store,
      messages: display.messages.length > 0 ? display.messages : painted.messages,
      everShown: painted.everShown || display.shown,
    };
  });
  const displayedProjection = display.messages;

  const acknowledgedDispatchIds = useMemo(
    () => canonicalCloudDispatchIds(state.records),
    [state.records],
  );
  const canonical = useMemo(
    () => rebindCanonicalCloudMessages(displayedProjection, dispatchBindings),
    [dispatchBindings, displayedProjection],
  );
  const sentAnchorsRef = useRef<{
    store: ConversationStore;
    anchors: SentMessageAnchors;
  }>({ store, anchors: new SentMessageAnchors() });
  if (sentAnchorsRef.current.store !== store) {
    sentAnchorsRef.current = { store, anchors: new SentMessageAnchors() };
  }
  const sentAnchors = sentAnchorsRef.current.anchors;
  const mergedMessages = useMemo(
    () =>
      mergeCanonicalCloudMessages({
        canonical,
        local: local.messages,
        dispatchBindings,
        acknowledgedDispatchIds,
        sentAnchors,
      }),
    [
      acknowledgedDispatchIds,
      canonical,
      dispatchBindings,
      local.messages,
      sentAnchors,
    ],
  );
  const messages = useStableChatMessages(
    useChatAttachmentPreviews(mergedMessages, JSON.stringify(cacheAuthority)),
  );

  useEffect(() => {
    if (!clientAuthorityReady || cacheVisible || threadId !== "cloud" ||
      (AppState.currentState !== "active" && AppState.currentState !== "unknown")) {
      replyHaptics.reset();
      return;
    }
    for (const _requestId of replyHaptics.take(messages, state.records)) notifySuccess();
  }, [cacheVisible, clientAuthorityReady, messages, replyHaptics, state.records, threadId]);

  const cacheWriteGenerationRef = useRef(0);
  const cacheWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [cacheWriteTask] = useState(
    () => new TrailingTask(CACHE_WRITE_SETTLE_MS, CACHE_WRITE_MAX_DELAY_MS),
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") cacheWriteTask.flush();
    });
    return () => {
      subscription.remove();
      cacheWriteTask.cancel();
    };
  }, [cacheWriteTask]);
  const records = state.records;
  useEffect(() => {
    if (!authorityReady || state.epoch === null) return;
    const generation = ++cacheWriteGenerationRef.current;
    const metadata = {
      version: 1 as const,
      accountScope: authority.accountScope,
      ownerGeneration: authority.ownerGeneration,
      socketOrigin: authority.socketOrigin,
      conversationId: authority.conversationId,
      epoch: state.epoch,
      headSeq: state.headSeq,
      floorSeq: state.floorSeq,
    };
    cacheWriteTask.schedule(() => {
      cacheWriteQueueRef.current = cacheWriteQueueRef.current
        .catch(() => undefined)
        .then(() =>
          rebuildMobileCloudConversationCache({
            metadata,
            messages: projected,
            records,
            isCurrent: () => generation === cacheWriteGenerationRef.current,
          }),
        );
    });
  }, [
    authority.accountScope,
    authority.conversationId,
    authority.ownerGeneration,
    authority.socketOrigin,
    authorityReady,
    cacheWriteTask,
    projected,
    records,
    state.epoch,
    state.floorSeq,
    state.headSeq,
  ]);
  useEffect(
    () => () => {
      cacheWriteGenerationRef.current += 1;
    },
    [authority.accountScope, authority.conversationId],
  );
  const activeTurnId = useMemo(
    () => activeCloudTurnId(state.records, state.live),
    [state.live, state.records],
  );
  const runningDispatchId = useMemo(
    () => canonicalCloudDispatchIdForTurn(state.records, activeTurnId),
    [activeTurnId, state.records],
  );
  const [stopIssue, setStopIssue] = useState<{
    turnId: string;
    message: string;
  } | null>(null);
  const stopRef = useRef<(options?: { direct?: boolean }) => void>(
    () => undefined,
  );
  const retryStop = useCallback(() => stopRef.current({ direct: true }), []);
  const sustainedOffline = useSustainedCloudOffline(state.status);
  const socketIssue = useMemo<CloudAuthorityIssue | null>(() => {
    if (state.status === "blocked") {
      return {
        message:
          state.statusMessage ??
          "Stella could not verify this cloud conversation.",
        retryable: state.statusRetryable,
      };
    }
    if (state.status === "offline" && sustainedOffline) {
      return {
        message:
          state.statusMessage ??
          "Cloud conversation history is offline. Reconnect to continue.",
        retryable: true,
      };
    }
    return null;
  }, [
    state.status,
    state.statusMessage,
    state.statusRetryable,
    sustainedOffline,
  ]);
  const issue =
    placementIssue ??
    (stopIssue && stopIssue.turnId === activeTurnId
      ? { message: stopIssue.message, retryable: true, retry: retryStop }
      : null) ??
    (local.authorityIssue
      ? {
          message: local.authorityIssue.message,
          retryable: local.authorityIssue.retryable,
        }
      : null) ??
    socketIssue;
  const retryAuthority = useCallback(() => {
    setPlacementIssue(null);
    local.authorityIssue?.retry();
    store.retry();
    reloadAuthority?.();
  }, [local.authorityIssue, reloadAuthority, store]);
  const authorityIssue: ChatThread["authorityIssue"] = issue
    ? {
        ...issue,
        retry: "retry" in issue ? issue.retry : retryAuthority,
      }
    : null;
  const storageLoaded = display.shown && !local.authorityIssue;

  const trackSend = useCallback(
    (send: () => { userMessageId: string } | null) => {
      if (!clientAuthorityReady) return null;
      const result = send();
      if (!result) return null;
      if (threadId === "cloud") replyHaptics.arm(result.userMessageId);
      setDispatchBindings((current) => {
        if (current.has(result.userMessageId)) return current;
        const next = new Map(current);
        next.set(result.userMessageId, null);
        return next;
      });
      return result;
    },
    [clientAuthorityReady, replyHaptics, threadId],
  );
  const localSend = local.send;
  const localSendPrompt = local.sendPrompt;
  const localStop = local.stop;
  const send = useCallback(() => trackSend(localSend), [localSend, trackSend]);
  const sendPrompt = useCallback(
    (prompt: string) =>
      localSendPrompt ? trackSend(() => localSendPrompt(prompt)) : null,
    [localSendPrompt, trackSend],
  );
  const loadOlderMessages = useCallback(async () => {
    store.loadOlder();
  }, [store]);
  const loadNewerMessages = useCallback(async () => undefined, []);
  const turnRunning = useMemo(
    () =>
      caughtUp === false
        ? state.activity === "running"
        : activeTurnId !== null,
    [activeTurnId, caughtUp, state.activity],
  );
  const handoffMessageId = useTurnHandoff({
    conversationId: authority.conversationId ?? null,
    sentMessageId: local.activeSendMessageId ?? null,
    sending: local.sending,
    turnRunning,
    records: state.records,
  });
  const sendMessageId = local.activeSendMessageId ?? handoffMessageId;
  const { sending, workingIndicator } = useMemo(
    () => canonicalWorkingState({
      records: state.records,
      live: state.live,
      localSending: local.sending || handoffMessageId !== null,
      localIndicator: local.workingIndicator,
      caughtUp,
      authoritativeActivity: state.activity,
      hasQueuedSend: local.messages.some((message) =>
        message.role === "user" && message.queued && !message.stopped),
      activeSendMessageId: sendMessageId,
      activeDispatchId: sendMessageId
        ? dispatchBindings.get(sendMessageId) ?? null
        : null,
    }),
    [caughtUp, dispatchBindings, handoffMessageId, local.sending, sendMessageId,
      local.workingIndicator, local.messages, state.activity, state.live,
      state.records],
  );
  const conversationArtifacts = useMemo(
    () => collectActivityHubArtifacts(messages),
    [messages],
  );
  const runningAgents = state.runningAgents;
  const journalTasks = useMemo(
    () => collectJournalTasks(state.records, runningAgents),
    [state.records, runningAgents],
  );
  const authoritativeTasks = useMemo(
    () => markAuthoritativeRunning(journalTasks, runningAgents),
    [journalTasks, runningAgents],
  );
  const localConversationTasks = local.conversationTasks;
  const foldedTasks = useMemo(
    () =>
      settleUnlistedTasks(
        markAuthoritativeRunning(
          mergeJournalTasks(authoritativeTasks, localConversationTasks),
          runningAgents,
        ),
        runningAgents,
        state.runningAgentsAtMs,
      ),
    [authoritativeTasks, localConversationTasks, runningAgents, state.runningAgentsAtMs],
  );
  const ledgerCheckIds = useMemo(
    () => [
      ...foldedTasks.filter((task) => task.status === "running").map((task) => task.id),
      ...runningAgents.map((agent) => agent.agentId),
    ],
    [foldedTasks, runningAgents],
  );
  const agentLedger = useConversationAgentLedger(
    authority.conversationId || null,
    ledgerCheckIds,
  );
  const conversationTasks = useMemo(
    () => applyAgentLedger(foldedTasks, agentLedger),
    [agentLedger, foldedTasks],
  );
  const canonicalCancellationRef = useRef<{
    dispatchId: string;
    controller: AbortController;
  } | null>(null);
  useEffect(
    () => () => {
      canonicalCancellationRef.current?.controller.abort();
      canonicalCancellationRef.current = null;
    },
    [authority.accountScope, authority.conversationId],
  );
  const activeTurnRef = useRef(activeTurnId);
  activeTurnRef.current = activeTurnId;
  const stopWatchRef = useRef<{
    turnId: string;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const clearStopWatch = useCallback(() => {
    if (stopWatchRef.current) clearTimeout(stopWatchRef.current.timer);
    stopWatchRef.current = null;
  }, []);
  useEffect(() => clearStopWatch, [clearStopWatch, store]);
  useEffect(() => {
    if (stopWatchRef.current && stopWatchRef.current.turnId !== activeTurnId) {
      clearStopWatch();
    }
    setStopIssue((current) =>
      current && current.turnId !== activeTurnId ? null : current,
    );
  }, [activeTurnId, clearStopWatch]);
  const stopTurnNow = useCallback((options?: { direct?: boolean }) => {
    replyHaptics.reset();
    localStop();
    const turnId = activeTurnId;
    if (!turnId) return;
    setStopIssue(null);
    const watch = () => {
      clearStopWatch();
      const timer = setTimeout(() => {
        stopWatchRef.current = null;
        if (activeTurnRef.current !== turnId) return;
        setStopIssue({ turnId, message: STOP_UNCONFIRMED_MESSAGE });
      }, STOP_CONFIRM_MS);
      stopWatchRef.current = { turnId, timer };
    };
    const stopTurn = () => {
      if (store.cancelTurn(turnId)) {
        watch();
        return;
      }
      setStopIssue({ turnId, message: STOP_UNREACHABLE_MESSAGE });
    };
    const dispatchId = runningDispatchId
      ? dispatchBindings.get(runningDispatchId) ?? runningDispatchId
      : null;
    if (!dispatchId || options?.direct) {
      stopTurn();
      return;
    }
    if (canonicalCancellationRef.current?.dispatchId === dispatchId) {
      return;
    }
    canonicalCancellationRef.current?.controller.abort();
    const controller = new AbortController();
    canonicalCancellationRef.current = {
      dispatchId,
      controller,
    };
    void cancelCanonicalCloudExecution({
      dispatchId,
      conversationId: authority.conversationId,
      readStatus: (dispatchId) =>
        getAutomaticExecutionStatus(dispatchId, {
          signal: controller.signal,
          builderOrigin: authority.socketOrigin,
        }),
      cancel: (command) =>
        cancelAutomaticExecution({
          ...command,
          signal: controller.signal,
          builderOrigin: authority.socketOrigin,
        }),
    })
      .then(
        () => {
          if (!controller.signal.aborted) watch();
        },
        () => {
          if (!controller.signal.aborted) stopTurn();
        },
      )
      .finally(() => {
        if (canonicalCancellationRef.current?.controller === controller) {
          canonicalCancellationRef.current = null;
        }
      });
  }, [
    activeTurnId,
    authority.conversationId,
    authority.socketOrigin,
    clearStopWatch,
    dispatchBindings,
    localStop,
    replyHaptics,
    runningDispatchId,
    store,
  ]);
  stopRef.current = stopTurnNow;
  const stop = useCallback(() => stopTurnNow(), [stopTurnNow]);

  return {
    ...local,
    conversationId: authority.conversationId,
    messages,
    sending,
    workingIndicator,
    storageLoaded,
    authorityReady: clientAuthorityReady,
    authorityIssue,
    hasOlderMessages: state.hasOlder,
    hasNewerMessages: false,
    historyPageLoading: state.loadingOlder,
    loadOlderMessages,
    loadNewerMessages,
    conversationArtifacts,
    conversationTasks,
    send,
    sendPrompt,
    stop,
    catchingUp: state.status === "connecting",
    destinationSwitch,
  };
};
