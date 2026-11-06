import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, LayoutAnimation } from "react-native";
import type { TurnStatusWake } from "./turn-status-wake";
import {
  CHAT_TRANSCRIPT_MAX_LOADED,
  subscribeChatStorageCleanup,
  type ChatThreadId,
} from "./offline-chat-storage";
import {
  acknowledgeDesktopChatOutbox,
  enqueueDesktopChatOutbox,
  loadDesktopChatOutbox,
  setDesktopChatOutboxPhase,
  type DesktopChatOutboxAuthority,
} from "./desktop-chat-outbox";
import {
  restoreOutboxMessages,
  desktopChatOutboxPrompt,
  type DesktopChatOutboxAttachment,
  type DesktopChatOutboxPhase,
  type DesktopChatOutboxRecord,
} from "./desktop-chat-outbox-state";
import {
  isPermanentSendError,
  keepsThreadSending,
  messageSendStatus,
  nextSendState,
  occupiesSendSlot,
  type NotSentReason,
  type SendEvent,
  type SendState,
} from "./chat-send-state";
import {
  appendAttachments,
  attachmentPreviewUri,
  CHAT_ATTACHMENT_MAX_COUNT,
  type ComposerAttachment,
  type PickedAttachment,
} from "./chat-attachments";
import {
  attachmentUploadState,
  awaitAttachmentUpload,
  discardAttachmentUpload,
  retryAttachmentUpload,
  startAttachmentUpload,
  useAttachmentUploadsVersion,
} from "./attachment-uploads";
import { videoPosterUri } from "./video-poster";
import { clearFailedSend, registerFailedSend } from "./failed-sends";
import { hasAiConsent, requestAiConsent } from "./ai-consent";
import {
  getPreferredPhoneAccess,
  listStoredPairedPhoneAccess,
  type StoredPhoneAccess,
} from "./phone-access";
import {
  AUTOMATIC_EXECUTION_TARGET,
  AutomaticExecutionWaitAbortedError,
  automaticExecutionCancellationCommand,
  automaticExecutionResultText,
  bindAutomaticExecutionAdmission,
  cancelAutomaticExecution,
  readMainConversationId,
  isAutomaticExecutionPairCredentialRejection,
  requestAutomaticExecutionCancellation,
  submitAutomaticExecution,
  waitForAutomaticExecution,
  type AutomaticExecutionDispatch,
  type AutomaticExecutionTurnControl,
  type AutomaticExecutionTarget,
} from "./execution-placement";
import {
  unifiedChatPlacementAdmission,
  unifiedChatPlacementStatusText,
} from "./unified-chat-placement";
import {
  buildWorkingIndicatorState,
  IDLE_WORKING_ACTIVITY,
  type WorkingActivity,
  type WorkingIndicatorState,
} from "../components/working-indicator-state";
import { applyLiveAgentWorkState } from "./agent-work-live-state";
import { collectConversationTasks } from "./mobile-task-merge";
import { userFacingError } from "./user-facing-error";
import { createChatDraftStore, type ChatDraftStore } from "./chat-draft-store";
import {
  classifyComposerNotice,
  clearComposerNotices,
  showComposerNoticeForError,
} from "./composer-notice";
import type {
  ChatArtifact,
  ChatMessage,
  ComposerQuote,
  MobileTask,
} from "../types";

const AUTOMATIC_RETRY_MS = 1_500;
const ADMISSION_GIVE_UP_MS = 120_000;

class SendNotDeliveredError extends Error {
  constructor() {
    super("Stella couldn't send this message. Check your connection and try again.");
    this.name = "SendNotDeliveredError";
  }
}
class AttachmentUploadFailedError extends Error {
  constructor() {
    super("An attachment didn't upload.");
    this.name = "AttachmentUploadFailedError";
  }
}

const resolveAttachmentUploads = async (
  attachments: readonly DesktopChatOutboxAttachment[],
  signal: AbortSignal,
): Promise<{ path: string; kind: "image" | "file" }[]> => {
  const settled = await Promise.allSettled(
    attachments.map(async (entry) =>
      entry.upload
        ? await awaitAttachmentUpload(
            { ...entry.upload, name: entry.name, kind: entry.kind },
            entry.path,
          )
        : entry.path,
    ),
  );
  if (signal.aborted) throw new AutomaticExecutionWaitAbortedError();
  if (settled.some((result) => result.status === "rejected")) {
    throw new AttachmentUploadFailedError();
  }
  return settled.map((result, index) => ({
    path: (result as PromiseFulfilledResult<string>).value,
    kind: attachments[index]!.kind,
  }));
};

const composerNoticeHandlesError = (error: unknown) =>
  classifyComposerNotice(
    error instanceof Error ? error.message : typeof error === "string" ? error : "",
  ) !== null;

const waitForAutomaticRetry = (signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AutomaticExecutionWaitAbortedError());
      return;
    }
    const timer = setTimeout(resolve, AUTOMATIC_RETRY_MS);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new AutomaticExecutionWaitAbortedError());
      },
      { once: true },
    );
  });

let lastLocalIdOrder = 0;
const createId = () => {
  lastLocalIdOrder = Math.max(Date.now(), lastLocalIdOrder + 1);
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `mobile:${String(lastLocalIdOrder).padStart(16, "0")}:${random}`;
};

const composeQuotedText = (quotes: ComposerQuote[], typed: string): string => {
  if (quotes.length === 0) return typed;
  const blocks = quotes
    .map((quote) =>
      quote.text
        .trim()
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n"),
    )
    .join("\n\n");
  return typed ? `${blocks}\n\n${typed}` : blocks;
};

const composeRawQuotes = (quotes: ComposerQuote[]): string =>
  quotes
    .map((quote) => quote.text.trim())
    .filter((text) => text.length > 0)
    .join("\n\n");

const QUOTED_TEXT_PREVIEW_MAX_CHARS = 4_000;

const STOP_REASON = "Stopped from the mobile conversation.";

type QueuedSend = {
  structuredAttachments?: true;
  userMessageEventId?: string;
  dispatchId: string;
  userMessageId: string;
  text: string;
  displayText?: string;
  createdAt?: number;
  promptText?: string;
  selectedText?: string;
  attachments: DesktopChatOutboxAttachment[];
  queueSequence?: number;
  canonicalAuthorityLease?: number;
  executionTarget?: AutomaticExecutionTarget;
  execution?: CloudExecutionSelection;
};

type SendRun = {
  replyId: string;
  abort: AbortController;
  control: AutomaticExecutionTurnControl;
  submitAttempted: boolean;
  attachments?: { path: string; kind: "image" | "file" }[];
};

type SendEntry = {
  item: QueuedSend;
  state: SendState;
  run?: SendRun;
  waited?: boolean;
};

const queuedSendFromRecord = (
  record: DesktopChatOutboxRecord,
  canonicalAuthorityLease: number,
): QueuedSend => ({
  dispatchId: record.sendId,
  userMessageId: record.userMessageId,
  ...(record.userMessageEventId
    ? { userMessageEventId: record.userMessageEventId }
    : {}),
  ...(record.structuredAttachments === true
    ? { structuredAttachments: true }
    : {}),
  text: record.text,
  displayText: record.displayText,
  createdAt: record.createdAt,
  attachments: record.attachments,
  executionTarget: record.executionTarget ?? AUTOMATIC_EXECUTION_TARGET,
  ...(record.execution ? { execution: record.execution } : {}),
  queueSequence: record.sequence,
  canonicalAuthorityLease,
});

const restoredSendState = (record: DesktopChatOutboxRecord): SendState => {
  switch (record.phase.kind) {
    case "cancelling":
      return {
        kind: "cancelling",
        cancelRequestId: record.phase.cancelRequestId,
      };
    case "not_sent":
      return { kind: "not_sent", reason: record.phase.reason };
    case "pending":
      return { kind: "queued" };
  }
};

export type ChatTransport = {
  accountScope: string;
  ownerGeneration: string;
  conversationId: string;
  admissionOpen: boolean;
  access?: StoredPhoneAccess | null;
  executionTarget?: AutomaticExecutionTarget;
  execution?: CloudExecutionSelection;
  onAdmission?: (event: {
    localMessageId: string;
    dispatchId: string;
    conversationId: string;
  }) => void;
  statusWake?: TurnStatusWake;
};

export type ChatComposerThread = {
  messages: ChatMessage[];
  draftStore: ChatDraftStore;
  setDraft: ChatDraftStore["set"];
  attachments: ComposerAttachment[];
  addAttachments: (picked: readonly PickedAttachment[]) => { rejected: number };
  removeAttachment: (id: string) => void;
  retryAttachment: (id: string) => void;
  maxAttachments: number;
  quotes: ComposerQuote[];
  addQuote: (text: string) => void;
  removeQuote: (id: string) => void;
  sending: boolean;
  activeSendMessageId?: string | null;
  hasQueuedSend?: boolean;
  pendingSendIds?: readonly string[];
  workingIndicator: WorkingIndicatorState;
  storageLoaded: boolean;
  authorityIssue?: {
    message: string;
    retryable: boolean;
    retry: () => void;
  } | null;
  conversationTasks: MobileTask[];
  send: () => { userMessageId: string } | null;
  sendPrompt?: (prompt: string) => { userMessageId: string } | null;
  stop: () => void;
  releaseSettledSend?: (userMessageId: string) => void;
};

export type ComposerIssue = {
  message: string;
  retryable: boolean;
  retry: () => void;
};

export type ComposerGate =
  | { kind: "ready" }
  | { kind: "offline" }
  | { kind: "connecting" }
  | { kind: "catching_up" }
  | { kind: "blocked"; issue: ComposerIssue };

export type ChatThread = Omit<ChatComposerThread, "authorityIssue"> & {
  composerGate: ComposerGate;
  authorityIssue: (ComposerIssue & { blocksSending: boolean }) | null;
  conversationId?: string | null;
  hasOlderMessages: boolean;
  hasNewerMessages: boolean;
  historyPageLoading: boolean;
  loadOlderMessages: () => Promise<void>;
  loadNewerMessages: () => Promise<void>;
  conversationArtifacts: ChatArtifact[];
  catchingUp: boolean;
  destinationSwitch?: import("./cloud-journal-projection").DestinationSwitch | null;
};

export function useChatThread(opts: {
  threadId: ChatThreadId;
  transport: ChatTransport;
}): ChatComposerThread {
  const { threadId, transport } = opts;
  const canonicalAccountScope = transport.accountScope;
  const canonicalOwnerGeneration = transport.ownerGeneration;
  const canonicalConversationId = transport.conversationId;
  const canonicalAdmissionOpen = transport.admissionOpen;
  const canonicalAuthorityKey = JSON.stringify([
    canonicalAccountScope,
    canonicalOwnerGeneration,
    canonicalConversationId,
  ]);
  const canonicalOutboxAuthority = useMemo<DesktopChatOutboxAuthority>(
    () => ({
      accountScope: canonicalAccountScope,
      ownerGeneration: canonicalOwnerGeneration,
      conversationId: canonicalConversationId,
    }),
    [canonicalAccountScope, canonicalConversationId, canonicalOwnerGeneration],
  );
  const [hydrationAuthorityIssue, setHydrationAuthorityIssue] =
    useState<ChatComposerThread["authorityIssue"]>(null);
  const drainOperationalOutbox =
    canonicalAdmissionOpen && hydrationAuthorityIssue === null;
  const admissionEnabledRef = useRef(drainOperationalOutbox);
  admissionEnabledRef.current = drainOperationalOutbox;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const updateMessages = useCallback(
    (update: React.SetStateAction<ChatMessage[]>) => {
      const next =
        typeof update === "function"
          ? (update as (current: ChatMessage[]) => ChatMessage[])(
              messagesRef.current,
            )
          : update;
      messagesRef.current = next;
      setMessages(next);
    },
    [],
  );
  const [storageLoaded, setStorageLoaded] = useState(false);
  const [hydrationRetryGeneration, setHydrationRetryGeneration] = useState(0);
  const retryHydration = useCallback(() => {
    setHydrationRetryGeneration((generation) => generation + 1);
  }, []);
  const historyPageGenerationRef = useRef(0);
  const [draftStore] = useState(createChatDraftStore);
  const setDraft = draftStore.set;
  const [pickedAttachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const uploadsVersion = useAttachmentUploadsVersion();
  const attachments = useMemo<ComposerAttachment[]>(
    () =>
      pickedAttachments.map((entry) => {
        const state = attachmentUploadState(entry.id);
        return state?.status === "failed"
          ? { ...entry, failed: { message: state.message } }
          : entry;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pickedAttachments, uploadsVersion],
  );
  const attachmentsRef = useRef(pickedAttachments);
  attachmentsRef.current = pickedAttachments;
  const addAttachments = useCallback(
    (picked: readonly PickedAttachment[]): { rejected: number } => {
      const known = new Set(attachmentsRef.current.map((entry) => entry.id));
      const fresh = picked.filter((entry) => !known.has(entry.id));
      const merged = appendAttachments(attachmentsRef.current, fresh);
      const accepted = merged.attachments.slice(attachmentsRef.current.length);
      const started: ComposerAttachment[] = accepted.map((entry) => ({
        ...entry,
        drivePath: startAttachmentUpload(entry),
      }));
      setAttachments((current) => [...current, ...started]);
      for (const entry of started.filter((candidate) => candidate.video)) {
        void videoPosterUri(entry.uri).then((posterUri) => {
          if (!posterUri) return;
          setAttachments((current) =>
            current.map((candidate) =>
              candidate.id === entry.id ? { ...candidate, posterUri } : candidate,
            ),
          );
        });
      }
      return { rejected: merged.rejected };
    },
    [],
  );
  const retryAttachment = useCallback((id: string) => {
    retryAttachmentUpload(id);
  }, []);
  const removeAttachment = useCallback((id: string) => {
    discardAttachmentUpload(id);
    setAttachments((current) => current.filter((entry) => entry.id !== id));
  }, []);
  const [quotes, setQuotes] = useState<ComposerQuote[]>([]);
  const addQuote = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setQuotes((prev) => [...prev, { id: createId(), text: trimmed }]);
  }, []);
  const removeQuote = useCallback((id: string) => {
    setQuotes((prev) => prev.filter((q) => q.id !== id));
  }, []);
  const [appActive, setAppActive] = useState(
    () =>
      AppState.currentState !== "background" &&
      AppState.currentState !== "inactive",
  );
  const [workingActivity, setWorkingActivity] = useState<WorkingActivity>(
    IDLE_WORKING_ACTIVITY,
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      setAppActive(next === "active" || next === "unknown");
    });
    return () => subscription.remove();
  }, []);

  const patchActivity = useCallback((patch: Partial<WorkingActivity>) => {
    setWorkingActivity((current) => {
      for (const key of Object.keys(patch) as (keyof WorkingActivity)[]) {
        if (!Object.is(current[key], patch[key])) {
          return { ...current, ...patch };
        }
      }
      return current;
    });
  }, []);

  const sendsRef = useRef<Map<string, SendEntry>>(new Map());
  const [sendStates, setSendStates] = useState<ReadonlyMap<string, SendState>>(
    () => new Map(),
  );
  const publishSends = useCallback(() => {
    setSendStates(
      new Map(
        [...sendsRef.current].map(([id, entry]) => [id, entry.state] as const),
      ),
    );
  }, []);
  const transition = useCallback(
    (userMessageId: string, event: SendEvent): SendEntry | null => {
      const entry = sendsRef.current.get(userMessageId);
      if (!entry) return null;
      const next = nextSendState(entry.state, event);
      if (!next) return null;
      entry.state = next;
      if (next.kind === "settled" && !next.stopped) {
        sendsRef.current.delete(userMessageId);
      }
      publishSends();
      return entry;
    },
    [publishSends],
  );
  const dispatchRef = useRef<((userMessageId: string) => void) | null>(null);
  const cancelRef = useRef<((userMessageId: string) => void) | null>(null);
  const appActiveRef = useRef(appActive);
  appActiveRef.current = appActive;
  const canonicalAuthorityLeaseRef = useRef(1);
  const canonicalAuthorityKeyRef = useRef(canonicalAuthorityKey);
  const committedCanonicalAuthorityKeyRef = useRef(canonicalAuthorityKey);
  if (canonicalAuthorityKeyRef.current !== canonicalAuthorityKey) {
    canonicalAuthorityKeyRef.current = canonicalAuthorityKey;
    canonicalAuthorityLeaseRef.current += 1;
  }
  const canonicalAuthorityLeaseCurrent = useCallback(
    (lease: number | undefined) => lease === canonicalAuthorityLeaseRef.current,
    [],
  );

  const abandonSends = useCallback(() => {
    for (const entry of sendsRef.current.values()) entry.run?.abort.abort();
    sendsRef.current = new Map();
    publishSends();
  }, [publishSends]);

  useEffect(() => {
    const authorityChanged =
      committedCanonicalAuthorityKeyRef.current !== canonicalAuthorityKey;
    committedCanonicalAuthorityKeyRef.current = canonicalAuthorityKey;
    if (authorityChanged) {
      setStorageLoaded(false);
      setHydrationAuthorityIssue(null);
      draftStore.set("");
      setAttachments([]);
      setQuotes([]);
      setWorkingActivity(IDLE_WORKING_ACTIVITY);
      updateMessages([]);
    }
    const lease = canonicalAuthorityLeaseRef.current;
    return () => {
      if (canonicalAuthorityLeaseRef.current === lease) {
        canonicalAuthorityLeaseRef.current += 1;
      }
      admissionEnabledRef.current = false;
      abandonSends();
    };
  }, [abandonSends, canonicalAuthorityKey, canonicalConversationId, draftStore, updateMessages]);

  useEffect(() => {
    let active = true;
    const generation = historyPageGenerationRef.current;
    setHydrationAuthorityIssue(null);
    void loadDesktopChatOutbox(threadId, canonicalOutboxAuthority).then(
      (storedOutbox) => {
        if (!active || generation !== historyPageGenerationRef.current) return;
        const unsendable = storedOutbox.filter(
          (record) =>
            !record.text.trim() && record.attachments.length === 0,
        );
        if (unsendable.length > 0) {
          void acknowledgeDesktopChatOutbox(
            threadId,
            new Set(unsendable.map((record) => record.sendId)),
            canonicalOutboxAuthority,
          ).catch(() => {});
        }
        const sendable = storedOutbox.filter(
          (record) => !unsendable.includes(record),
        );
        updateMessages(restoreOutboxMessages([], sendable));
        const lease = canonicalAuthorityLeaseRef.current;
        const cancelling: string[] = [];
        for (const record of sendable) {
          if (sendsRef.current.has(record.userMessageId)) continue;
          sendsRef.current.set(record.userMessageId, {
            item: queuedSendFromRecord(record, lease),
            state: restoredSendState(record),
            waited: true,
          });
          if (record.phase.kind === "cancelling") {
            cancelling.push(record.userMessageId);
          }
        }
        publishSends();
        setStorageLoaded(true);
        for (const id of cancelling) cancelRef.current?.(id);
      },
      () => {
        if (!active || generation !== historyPageGenerationRef.current) return;
        setStorageLoaded(false);
        setHydrationAuthorityIssue({
          message:
            "Stella could not verify pending cloud messages on this device. Try again.",
          retryable: true,
          retry: retryHydration,
        });
      },
    );
    return () => {
      active = false;
      historyPageGenerationRef.current += 1;
    };
  }, [
    canonicalConversationId,
    canonicalOutboxAuthority,
    hydrationRetryGeneration,
    publishSends,
    retryHydration,
    threadId,
    updateMessages,
  ]);

  useEffect(
    () =>
      subscribeChatStorageCleanup(() => {
        historyPageGenerationRef.current += 1;
        abandonSends();
        messagesRef.current = [];
        updateMessages([]);
        draftStore.set("");
        setAttachments([]);
        setQuotes([]);
        setWorkingActivity(IDLE_WORKING_ACTIVITY);
      }),
    [abandonSends, draftStore, updateMessages],
  );

  const acknowledgeSend = useCallback(
    (item: QueuedSend) => {
      void acknowledgeDesktopChatOutbox(
        threadId,
        new Set([item.dispatchId, item.userMessageId]),
        canonicalOutboxAuthority,
      ).catch(() => {});
    },
    [canonicalOutboxAuthority, threadId],
  );

  const persistPhase = useCallback(
    (item: QueuedSend, phase: DesktopChatOutboxPhase) =>
      setDesktopChatOutboxPhase(
        threadId,
        item.dispatchId,
        phase,
        canonicalOutboxAuthority,
      ),
    [canonicalOutboxAuthority, threadId],
  );

  const outboxRecord = useCallback(
    (item: QueuedSend): Omit<DesktopChatOutboxRecord, "sequence"> => {
      const row = messagesRef.current.find(
        (message) => message.id === item.userMessageId,
      );
      return {
        ...(item.structuredAttachments ? { structuredAttachments: true } : {}),
        sendId: item.dispatchId,
        userMessageId: item.userMessageId,
        ...(item.userMessageEventId
          ? { userMessageEventId: item.userMessageEventId }
          : {}),
        text: item.text,
        displayText: item.displayText ?? row?.text ?? item.text,
        createdAt: item.createdAt ?? row?.createdAt ?? Date.now(),
        attachments: item.attachments,
        ...(item.executionTarget
          ? { executionTarget: item.executionTarget }
          : {}),
        ...(item.execution ? { execution: item.execution } : {}),
        authority: canonicalOutboxAuthority,
        phase: { kind: "pending" },
      };
    },
    [canonicalOutboxAuthority],
  );

  const drainQueue = useCallback(() => {
    if (!admissionEnabledRef.current) return;
    const entries = [...sendsRef.current.values()];
    if (entries.some((entry) => occupiesSendSlot(entry.state))) return;
    const next = entries
      .filter(
        (entry) =>
          entry.state.kind === "queued" &&
          canonicalAuthorityLeaseCurrent(entry.item.canonicalAuthorityLease),
      )
      .sort(
        (a, b) =>
          (a.item.queueSequence ?? Number.MAX_SAFE_INTEGER) -
          (b.item.queueSequence ?? Number.MAX_SAFE_INTEGER),
      )[0];
    if (next) dispatchRef.current?.(next.item.userMessageId);
  }, [canonicalAuthorityLeaseCurrent]);

  const persist = useCallback(
    (item: QueuedSend) => {
      void enqueueDesktopChatOutbox(threadId, outboxRecord(item)).then(
        (stored) => {
          item.queueSequence = stored.sequence;
          if (!canonicalAuthorityLeaseCurrent(item.canonicalAuthorityLease)) {
            return;
          }
          const entry = sendsRef.current.get(item.userMessageId);
          if (!entry || entry.state.kind === "settled") {
            acknowledgeSend(item);
            return;
          }
          if (!transition(item.userMessageId, { type: "persisted" })) return;
          drainQueue();
          if (entry.state.kind === "queued") entry.waited = true;
        },
        () => {
          if (!canonicalAuthorityLeaseCurrent(item.canonicalAuthorityLease)) {
            return;
          }
          transition(item.userMessageId, {
            type: "failed",
            reason: "storage",
          });
        },
      );
    },
    [acknowledgeSend, canonicalAuthorityLeaseCurrent, drainQueue, outboxRecord, threadId, transition],
  );

  const releaseSlot = useCallback(() => {
    setWorkingActivity(IDLE_WORKING_ACTIVITY);
    if (appActiveRef.current) drainQueue();
  }, [drainQueue]);

  const renderReply = useCallback(
    (replyId: string, text: string, stopped = false) => {
      updateMessages((current) =>
        current.map((message) =>
          message.id === replyId
            ? { ...message, text, ...(stopped ? { stopped: true } : {}) }
            : message,
        ),
      );
    },
    [updateMessages],
  );

  const removeReply = useCallback(
    (replyId: string, onlyEmpty = false) => {
      updateMessages((current) =>
        current.filter(
          (message) =>
            message.id !== replyId || (onlyEmpty && message.text.length > 0),
        ),
      );
    },
    [updateMessages],
  );

  const submitAdmission = useCallback(
    async (
      item: QueuedSend,
      attachments: { path: string; kind: "image" | "file" }[],
      signal: AbortSignal,
      route: { conversationId: string; ignoreStoredAccess: boolean },
    ): Promise<AutomaticExecutionDispatch> => {
      if (!route.conversationId) {
        route.conversationId = await readMainConversationId();
      }
      const target = item.executionTarget ?? AUTOMATIC_EXECUTION_TARGET;
      let access: StoredPhoneAccess | undefined;
      if (!route.ignoreStoredAccess && target.mode === "device") {
        access =
          transport.access?.desktopDeviceId === target.deviceId
            ? transport.access
            : (await listStoredPairedPhoneAccess()).find(
                (candidate) => candidate.desktopDeviceId === target.deviceId,
              );
      } else if (!route.ignoreStoredAccess && target.mode !== "cloud") {
        access =
          transport.access ?? (await getPreferredPhoneAccess()) ?? undefined;
      }
      if (signal.aborted) throw new AutomaticExecutionWaitAbortedError();
      try {
        return await submitAutomaticExecution({
          ...unifiedChatPlacementAdmission({
            dispatchId: item.dispatchId,
            ...(item.userMessageEventId
              ? { userMessageEventId: item.userMessageEventId }
              : {}),
            conversationId: route.conversationId,
            prompt: desktopChatOutboxPrompt(item),
            attachments,
          }),
          ...(access ? { access } : {}),
          ...(item.execution && target.mode !== "device"
            ? { execution: item.execution }
            : {}),
          target,
          signal,
        });
      } catch (error) {
        if (signal.aborted) throw new AutomaticExecutionWaitAbortedError();
        throw error;
      }
    },
    [transport.access],
  );

  const admitWithRetry = useCallback(
    async (
      item: QueuedSend,
      attachments: { path: string; kind: "image" | "file" }[],
      signal: AbortSignal,
      stillWanted: () => boolean,
      onAttempt: () => void,
    ): Promise<AutomaticExecutionDispatch> => {
      const route = {
        conversationId: canonicalConversationId ?? "",
        ignoreStoredAccess: false,
      };
      const startedAt = Date.now();
      for (;;) {
        if (!stillWanted() || signal.aborted) {
          throw new AutomaticExecutionWaitAbortedError();
        }
        if (Date.now() - startedAt > ADMISSION_GIVE_UP_MS) {
          throw new SendNotDeliveredError();
        }
        if (!admissionEnabledRef.current) {
          await waitForAutomaticRetry(signal);
          continue;
        }
        try {
          onAttempt();
          return await submitAdmission(item, attachments, signal, route);
        } catch (error) {
          if (error instanceof AutomaticExecutionWaitAbortedError || signal.aborted) {
            throw new AutomaticExecutionWaitAbortedError();
          }
          if (
            !route.ignoreStoredAccess &&
            (item.executionTarget?.mode ?? "automatic") !== "device" &&
            isAutomaticExecutionPairCredentialRejection(error)
          ) {
            route.ignoreStoredAccess = true;
            continue;
          }
          if (isPermanentSendError(error)) throw error;
          await waitForAutomaticRetry(signal);
        }
      }
    },
    [canonicalConversationId, submitAdmission],
  );

  const markNotSent = useCallback(
    (entry: SendEntry, reason: NotSentReason) => {
      if (!transition(entry.item.userMessageId, { type: "failed", reason })) {
        return;
      }
      if (entry.run) removeReply(entry.run.replyId);
      entry.run = undefined;
      void persistPhase(entry.item, { kind: "not_sent", reason }).catch(
        () => undefined,
      );
    },
    [persistPhase, removeReply, transition],
  );

  const dispatchAutomatic = useCallback(
    async (entry: SendEntry, run: SendRun) => {
      const { item } = entry;
      const id = item.userMessageId;
      clearComposerNotices(canonicalConversationId);
      const isCurrent = () =>
        canonicalAuthorityLeaseCurrent(item.canonicalAuthorityLease) &&
        sendsRef.current.get(id)?.run === run;
      const assertCurrent = () => {
        if (!isCurrent()) throw new AutomaticExecutionWaitAbortedError();
      };
      let admitted: AutomaticExecutionDispatch | null = null;
      try {
        run.attachments = await resolveAttachmentUploads(
          item.attachments,
          run.abort.signal,
        );
        assertCurrent();
        admitted = await admitWithRetry(
          item,
          run.attachments,
          run.abort.signal,
          () => isCurrent() && entry.state.kind === "admitting",
          () => {
            run.submitAttempted = true;
          },
        );
        assertCurrent();
        transport.onAdmission?.({
          localMessageId: id,
          dispatchId: admitted.dispatchId,
          conversationId: admitted.conversationId || canonicalConversationId,
        });
        run.control = bindAutomaticExecutionAdmission(run.control, admitted);
        transition(id, { type: "admitted", serverDispatchId: admitted.dispatchId });

        const terminal = await waitForAutomaticExecution({
          dispatchId: admitted.dispatchId,
          signal: run.abort.signal,
          ...(transport.statusWake ? { wake: transport.statusWake } : {}),
          beforeRead: async () => {
            if (!isCurrent()) return;
            const pendingCancellation = automaticExecutionCancellationCommand(
              run.control,
            );
            if (!pendingCancellation) return;
            await cancelAutomaticExecution({
              ...pendingCancellation,
              reason: STOP_REASON,
              signal: run.abort.signal,
            });
          },
          onUpdate: (dispatch) => {
            if (!isCurrent()) return;
            const statusText = unifiedChatPlacementStatusText(dispatch);
            if (statusText) patchActivity({ statusText });
          },
        });
        assertCurrent();
        renderReply(
          run.replyId,
          automaticExecutionResultText(terminal),
          terminal.state === "canceled",
        );
        if (terminal.state === "failed" && terminal.errorMessage) {
          showComposerNoticeForError(
            terminal.errorMessage,
            canonicalConversationId,
          );
        }
        acknowledgeSend(item);
        transition(id, { type: "settled" });
        releaseSlot();
      } catch (error) {
        if (
          error instanceof AutomaticExecutionWaitAbortedError ||
          run.abort.signal.aborted ||
          !isCurrent()
        ) {
          return;
        }
        if (!admitted) {
          if (error instanceof AttachmentUploadFailedError) {
            markNotSent(entry, "attachment");
            releaseSlot();
            return;
          }
          if (error instanceof SendNotDeliveredError) {
            markNotSent(entry, "network");
            releaseSlot();
            return;
          }
          if (isPermanentSendError(error) && !composerNoticeHandlesError(error)) {
            markNotSent(entry, "rejected");
            releaseSlot();
            return;
          }
        }
        renderReply(run.replyId, userFacingError(error));
        showComposerNoticeForError(error, canonicalConversationId);
        if (isPermanentSendError(error)) acknowledgeSend(item);
        transition(id, { type: "settled" });
        releaseSlot();
      }
    },
    [
      acknowledgeSend,
      admitWithRetry,
      canonicalAuthorityLeaseCurrent,
      canonicalConversationId,
      markNotSent,
      patchActivity,
      releaseSlot,
      renderReply,
      transition,
      transport,
    ],
  );

  const dispatch = useCallback(
    (userMessageId: string) => {
      const entry = sendsRef.current.get(userMessageId);
      if (!entry || !admissionEnabledRef.current) return;
      if (!transition(userMessageId, { type: "admit" })) return;
      const { item } = entry;
      const run: SendRun = {
        replyId: createId(),
        abort: new AbortController(),
        control: { clientIdempotencyKey: item.dispatchId },
        submitAttempted: false,
      };
      entry.run = run;
      setWorkingActivity(IDLE_WORKING_ACTIVITY);
      const dispatchedAt = Date.now();
      const bumpCreatedAt = entry.waited === true;
      updateMessages((m) => {
        const next = [
          ...m.map((msg) =>
            msg.id === item.userMessageId && bumpCreatedAt
              ? { ...msg, createdAt: dispatchedAt }
              : msg,
          ),
          {
            id: run.replyId,
            role: "assistant" as const,
            requestId: item.userMessageId,
            text: "",
            createdAt: dispatchedAt,
          },
        ];
        if (next.length <= CHAT_TRANSCRIPT_MAX_LOADED) return next;
        return next.slice(-CHAT_TRANSCRIPT_MAX_LOADED);
      });
      void dispatchAutomatic(entry, run);
    },
    [dispatchAutomatic, transition, updateMessages],
  );

  const runCancellation = useCallback(
    (userMessageId: string) => {
      const entry = sendsRef.current.get(userMessageId);
      if (!entry || entry.state.kind !== "cancelling") return;
      const { item } = entry;
      const cancelRequestId = entry.state.cancelRequestId;
      const run: SendRun = {
        replyId: entry.run?.replyId ?? "",
        abort: new AbortController(),
        control: { clientIdempotencyKey: item.dispatchId, cancelRequestId },
        submitAttempted: true,
        ...(entry.run?.attachments ? { attachments: entry.run.attachments } : {}),
      };
      entry.run = run;
      const wanted = () =>
        canonicalAuthorityLeaseCurrent(item.canonicalAuthorityLease) &&
        sendsRef.current.get(userMessageId)?.run === run &&
        entry.state.kind === "cancelling";
      void (async () => {
        for (;;) {
          try {
            run.attachments ??= await resolveAttachmentUploads(
              item.attachments,
              run.abort.signal,
            );
            const admitted = await admitWithRetry(
              item,
              run.attachments,
              run.abort.signal,
              wanted,
              () => undefined,
            );
            if (!wanted()) return;
            await cancelAutomaticExecution({
              dispatchId: admitted.dispatchId,
              cancelRequestId,
              reason: STOP_REASON,
              signal: run.abort.signal,
            });
            break;
          } catch (error) {
            if (!wanted() || run.abort.signal.aborted) return;
            if (
              isPermanentSendError(error) ||
              error instanceof AttachmentUploadFailedError ||
              error instanceof SendNotDeliveredError
            ) {
              break;
            }
            await waitForAutomaticRetry(run.abort.signal).catch(() => undefined);
          }
        }
        if (!wanted()) return;
        entry.run = undefined;
        acknowledgeSend(item);
        transition(userMessageId, { type: "cancel_confirmed" });
      })();
    },
    [acknowledgeSend, admitWithRetry, canonicalAuthorityLeaseCurrent, transition],
  );

  useEffect(() => {
    dispatchRef.current = dispatch;
    cancelRef.current = runCancellation;
  }, [dispatch, runCancellation]);

  useEffect(() => {
    if (!storageLoaded || !drainOperationalOutbox || !appActive) return;
    drainQueue();
  }, [appActive, drainOperationalOutbox, drainQueue, storageLoaded]);

  const retrySend = useCallback(
    (userMessageId: string) => {
      const entry = sendsRef.current.get(userMessageId);
      if (!entry || entry.state.kind !== "not_sent") return;
      if (!canonicalAuthorityLeaseCurrent(entry.item.canonicalAuthorityLease)) {
        return;
      }
      if (entry.state.reason === "attachment") {
        for (const attachment of entry.item.attachments) {
          if (attachment.upload) retryAttachmentUpload(attachment.upload.id);
        }
      }
      if (!transition(userMessageId, { type: "retry" })) return;
      entry.waited = true;
      persist(entry.item);
    },
    [canonicalAuthorityLeaseCurrent, persist, transition],
  );

  const removeSend = useCallback(
    (userMessageId: string) => {
      const entry = sendsRef.current.get(userMessageId);
      if (!entry || entry.state.kind !== "not_sent") return;
      for (const attachment of entry.item.attachments) {
        if (attachment.upload) discardAttachmentUpload(attachment.upload.id);
      }
      acknowledgeSend(entry.item);
      sendsRef.current.delete(userMessageId);
      publishSends();
      updateMessages((current) =>
        current.filter(
          (message) =>
            message.id !== userMessageId && message.requestId !== userMessageId,
        ),
      );
    },
    [acknowledgeSend, publishSends, updateMessages],
  );

  const registeredFailedSendsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const notSent = new Set(
      [...sendStates].flatMap(([id, state]) =>
        state.kind === "not_sent" ? [id] : [],
      ),
    );
    for (const id of registeredFailedSendsRef.current) {
      if (!notSent.has(id)) clearFailedSend(id);
    }
    for (const id of notSent) {
      if (registeredFailedSendsRef.current.has(id)) continue;
      registerFailedSend(id, {
        retry: () => retrySend(id),
        remove: () => removeSend(id),
      });
    }
    registeredFailedSendsRef.current = notSent;
  }, [removeSend, retrySend, sendStates]);
  useEffect(
    () => () => {
      for (const id of registeredFailedSendsRef.current) clearFailedSend(id);
      registeredFailedSendsRef.current = new Set();
    },
    [],
  );

  const submit = useCallback(
    (suppliedPrompt?: string): { userMessageId: string } | null => {
      if (!storageLoaded || !admissionEnabledRef.current) return null;
      const supplied = suppliedPrompt !== undefined;
      const typed = (suppliedPrompt ?? draftStore.get()).trim();
      const pendingQuotes = supplied ? [] : quotes;
      const text = composeQuotedText(pendingQuotes, typed);
      const decoupleQuotes = typed.length > 0 && pendingQuotes.length > 0;
      const rawQuotes = decoupleQuotes ? composeRawQuotes(pendingQuotes) : "";
      const promptText = decoupleQuotes ? typed : text;
      const composerAttachments = supplied ? [] : attachments;
      if (!text && composerAttachments.length === 0) return null;
      const picked = composerAttachments;
      const sendAttachments: DesktopChatOutboxAttachment[] = picked.map(
        (entry) => {
          const state = attachmentUploadState(entry.id);
          const previewUri = attachmentPreviewUri(entry);
          return {
            path: state?.status === "ready" ? state.drivePath : entry.drivePath,
            name: entry.name,
            kind: entry.kind,
            ...(previewUri ? { previewUri } : {}),
            ...(state?.status === "ready"
              ? {}
              : {
                  upload: {
                    id: entry.id,
                    uri: entry.uri,
                    mimeType: entry.mimeType,
                    sizeBytes: entry.sizeBytes,
                  },
                }),
          };
        },
      );
      for (const entry of picked) {
        if (entry.failed) retryAttachmentUpload(entry.id);
      }

      if (!hasAiConsent()) {
        requestAiConsent();
        return null;
      }

      if (!supplied) {
        draftStore.set("");
        setAttachments([]);
        setQuotes([]);
      }

      const behind = [...sendsRef.current.values()].some(
        (entry) =>
          entry.state.kind === "persisting" ||
          entry.state.kind === "queued" ||
          occupiesSendSlot(entry.state),
      );
      const userMessageId = createId();
      const images = picked.filter((entry) => entry.kind === "image");
      const documents = picked.filter((entry) => entry.kind === "file");
      const displayText = promptText;
      const quotedPreview = rawQuotes
        ? rawQuotes.slice(0, QUOTED_TEXT_PREVIEW_MAX_CHARS)
        : undefined;
      const thumbs = images.slice(0, 3).map((entry) => entry.uri);
      const createdAt = Date.now();
      const userMsg: ChatMessage = {
        id: userMessageId,
        role: "user",
        text: displayText,
        createdAt,
        hasImage: images.length > 0,
        ...(sendAttachments.length ? {
          attachmentPaths: sendAttachments.map(entry => entry.path),
          attachmentPreviews: sendAttachments.map(entry => ({
            path: entry.path, name: entry.name,
            ...(entry.previewUri ? { imageUri: entry.previewUri } : {}),
            ...(entry.upload ? { uploadId: entry.upload.id } : {}),
          })),
        } : {}),
        ...(thumbs.length > 0 ? { thumbnailUris: thumbs } : {}),
        ...(documents.length > 0
          ? { documentNames: documents.map((entry) => entry.name) }
          : {}),
        ...(quotedPreview ? { quotedText: quotedPreview } : {}),
        ...(behind ? { sentWhileBusy: true } : {}),
      };

      LayoutAnimation.configureNext({
        duration: 350,
        update: { type: LayoutAnimation.Types.spring, springDamping: 1 },
      });
      updateMessages((m) => {
        const next = [...m, userMsg];
        if (next.length <= CHAT_TRANSCRIPT_MAX_LOADED) return next;
        return next.slice(-CHAT_TRANSCRIPT_MAX_LOADED);
      });

      const execution =
        transport.execution && transport.executionTarget?.mode !== "device"
          ? { execution: { ...transport.execution } }
          : {};
      const item: QueuedSend = {
        structuredAttachments: true,
        dispatchId: userMessageId,
        userMessageId,
        userMessageEventId: userMessageId,
        text,
        displayText,
        createdAt,
        ...(decoupleQuotes ? { promptText, selectedText: rawQuotes } : {}),
        attachments: sendAttachments,
        executionTarget:
          transport.executionTarget ?? AUTOMATIC_EXECUTION_TARGET,
        ...execution,
        canonicalAuthorityLease: canonicalAuthorityLeaseRef.current,
      };
      sendsRef.current.set(userMessageId, {
        item,
        state: { kind: "persisting", behind },
        waited: behind,
      });
      publishSends();
      persist(item);
      return { userMessageId };
    },
    [
      attachments,
      draftStore,
      persist,
      publishSends,
      quotes,
      storageLoaded,
      transport.executionTarget,
      transport.execution,
      updateMessages,
    ],
  );

  const send = useCallback(() => submit(), [submit]);
  const sendPrompt = useCallback((prompt: string) => submit(prompt), [submit]);

  const stop = useCallback(() => {
    let releasedSlot = false;
    for (const entry of [...sendsRef.current.values()]) {
      const { item } = entry;
      const id = item.userMessageId;
      const before = entry.state;
      if (before.kind === "persisting" || before.kind === "queued") {
        transition(id, { type: "stop", cancelRequestId: "", submitAttempted: false });
        if (before.kind === "queued") acknowledgeSend(item);
        continue;
      }
      const run = entry.run;
      if (!run) continue;
      if (before.kind === "admitting") {
        const control = requestAutomaticExecutionCancellation(run.control);
        const next = transition(id, {
          type: "stop",
          cancelRequestId: control.cancelRequestId!,
          submitAttempted: run.submitAttempted,
        });
        if (!next) continue;
        run.abort.abort();
        releasedSlot = true;
        removeReply(run.replyId);
        if (next.state.kind === "cancelling") {
          entry.run = { ...run, replyId: "", abort: new AbortController() };
          void persistPhase(item, {
            kind: "cancelling",
            cancelRequestId: next.state.cancelRequestId,
            requestedAt: Date.now(),
          })
            .catch(() => undefined)
            .finally(() => runCancellation(id));
        } else {
          entry.run = undefined;
          for (const attachment of item.attachments) {
            if (attachment.upload) discardAttachmentUpload(attachment.upload.id);
          }
          acknowledgeSend(item);
        }
        continue;
      }
      if (before.kind === "dispatched") {
        run.control = requestAutomaticExecutionCancellation(run.control);
        const cancelRequestId = run.control.cancelRequestId!;
        if (!transition(id, { type: "stop", cancelRequestId, submitAttempted: true })) {
          continue;
        }
        const cancellation = automaticExecutionCancellationCommand(run.control);
        const authorityLease = canonicalAuthorityLeaseRef.current;
        patchActivity({ statusText: "Stopping" });
        updateMessages((m) =>
          m.map((msg) =>
            msg.id === run.replyId
              ? { ...msg, text: msg.text || "Stopping…", stopped: true }
              : msg,
          ),
        );
        void persistPhase(item, {
          kind: "cancelling",
          cancelRequestId,
          requestedAt: Date.now(),
        })
          .then(() =>
            canonicalAuthorityLeaseCurrent(authorityLease) && cancellation
              ? cancelAutomaticExecution({ ...cancellation, reason: STOP_REASON })
              : undefined,
          )
          .catch(() => undefined)
          .finally(() => transport.statusWake?.nudge());
      }
    }
    if (releasedSlot) releaseSlot();
    else if (![...sendsRef.current.values()].some((entry) => occupiesSendSlot(entry.state))) {
      setWorkingActivity(IDLE_WORKING_ACTIVITY);
    }
  }, [
    acknowledgeSend,
    canonicalAuthorityLeaseCurrent,
    patchActivity,
    persistPhase,
    releaseSlot,
    removeReply,
    runCancellation,
    transition,
    transport.statusWake,
    updateMessages,
  ]);

  const releaseSettledSend = useCallback(
    (userMessageId: string) => {
      const entry = sendsRef.current.get(userMessageId);
      if (entry?.state.kind !== "dispatched" || !entry.run) return;
      const run = entry.run;
      entry.run = undefined;
      run.abort.abort();
      acknowledgeSend(entry.item);
      transition(userMessageId, { type: "settled" });
      removeReply(run.replyId, true);
      releaseSlot();
    },
    [acknowledgeSend, releaseSlot, removeReply, transition],
  );

  const sendingEntry = useMemo(() => {
    let active: string | null = null;
    let sending = false;
    let hasQueuedSend = false;
    for (const [id, state] of sendStates) {
      if (keepsThreadSending(state)) sending = true;
      if (occupiesSendSlot(state)) active = id;
      if (messageSendStatus(state) === "queued") hasQueuedSend = true;
    }
    return { active, sending, hasQueuedSend };
  }, [sendStates]);
  const sending = sendingEntry.sending;
  const pendingSendIds = useMemo(() => [...sendStates.keys()], [sendStates]);

  const workingIndicator = useMemo(
    () => buildWorkingIndicatorState({ sending, activity: workingActivity }),
    [sending, workingActivity],
  );

  const sendDecorated = useMemo(
    () =>
      sendStates.size === 0
        ? messages
        : messages.map((message) => {
            if (message.role !== "user") return message;
            const status = messageSendStatus(sendStates.get(message.id));
            return status ? { ...message, send: status } : message;
          }),
    [messages, sendStates],
  );

  const conversationTasks = useMemo(
    () => collectConversationTasks(messages),
    [messages],
  );

  const displayMessages = useMemo(
    () => applyLiveAgentWorkState(sendDecorated, conversationTasks),
    [conversationTasks, sendDecorated],
  );

  return {
    messages: displayMessages,
    draftStore,
    setDraft,
    attachments,
    addAttachments,
    removeAttachment,
    retryAttachment,
    maxAttachments: CHAT_ATTACHMENT_MAX_COUNT,
    quotes,
    addQuote,
    removeQuote,
    sending,
    activeSendMessageId: sendingEntry.active,
    hasQueuedSend: sendingEntry.hasQueuedSend,
    pendingSendIds,
    workingIndicator,
    storageLoaded,
    authorityIssue: hydrationAuthorityIssue,
    conversationTasks,
    send,
    sendPrompt,
    stop,
    releaseSettledSend,
  };
}
