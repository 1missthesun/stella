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
  markDesktopChatOutboxCancellation,
  type DesktopChatOutboxAuthority,
} from "./desktop-chat-outbox";
import {
  restoreOutboxMessages,
  desktopChatOutboxPrompt,
  type DesktopChatOutboxAttachment,
  type DesktopChatOutboxRecord,
} from "./desktop-chat-outbox-state";
import {
  appendAttachments,
  attachmentsSettled,
  isAttachmentReady,
  uploadChatAttachment,
  withAttachmentStatus,
  CHAT_ATTACHMENT_MAX_COUNT,
  type ComposerAttachment,
  type PickedAttachment,
} from "./chat-attachments";
import { getBackendClient } from "./backend";
import { File } from "expo-file-system";
import { fetch as expoFetch } from "expo/fetch";
import { useT } from "../i18n/I18nProvider";
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
import { admitSend } from "./send-admission";
import { userFacingError } from "./user-facing-error";
import { createChatDraftStore, type ChatDraftStore } from "./chat-draft-store";
import {
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

const isPermanentAutomaticAdmissionError = (error: unknown) => {
  const code =
    error && typeof error === "object" ? Reflect.get(error, "code") : null;
  if (
    code === "sign_in_required" ||
    code === "subscription_required" ||
    code === "usage_limit" ||
    code === "owner_suspended"
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /authentication required|sign in|signed-in account|ownership_migrated|linked to (?:an|another) account|being linked|owner generation|account data is currently|invalid|unsupported|not found|not paired|conflict|payload|conversation|malformed|different (?:dispatch|message) identity/i.test(
    message,
  );
};

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

type QueuedSend = {
  structuredAttachments?: true;
  userMessageEventId?: string;
  dispatchId: string;
  clientRequestId: string;
  userMessageId: string;
  text: string;
  promptText?: string;
  selectedText?: string;
  attachments: DesktopChatOutboxAttachment[];
  queueSequence?: number;
  canonicalAuthorityLease?: number;
  cancelRequestId?: string;
  executionTarget?: AutomaticExecutionTarget;
  execution?: CloudExecutionSelection;
};

export type ChatTransport = {
  accountScope: string;
  ownerGeneration: string;
  conversationId: string;
  authorityReady: boolean;
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
};

export type ChatThread = ChatComposerThread & {
  conversationId?: string | null;
  authorityReady?: boolean;
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
  const canonicalAuthorityReady = transport.authorityReady;
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
  const drainOperationalOutbox = canonicalAuthorityReady;
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
  const [hydrationAuthorityIssue, setHydrationAuthorityIssue] =
    useState<ChatComposerThread["authorityIssue"]>(null);
  const retryHydration = useCallback(() => {
    setHydrationRetryGeneration((generation) => generation + 1);
  }, []);
  const historyPageGenerationRef = useRef(0);
  const [draftStore] = useState(createChatDraftStore);
  const setDraft = draftStore.set;
  const t = useT();
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const startAttachmentUpload = useCallback(
    (picked: PickedAttachment) => {
      const taken = new Set(
        attachmentsRef.current
          .map((entry) => (entry.status === "ready" ? entry.drivePath : ""))
          .filter(Boolean),
      );
      void uploadChatAttachment(picked, taken, {
        client: getBackendClient(),
        readFile: async (uri) => await new File(uri).bytes(),
        fetch: expoFetch,
      })
        .then((drivePath) => {
          setAttachments((current) =>
            withAttachmentStatus(current, picked.id, {
              status: "ready",
              drivePath,
            }),
          );
        })
        .catch((error: unknown) => {
          setAttachments((current) =>
            withAttachmentStatus(current, picked.id, {
              status: "failed",
              message:
                error instanceof Error && error.message
                  ? error.message
                  : t("chat.attachments.uploadFailed"),
            }),
          );
        });
    },
    [t],
  );
  const addAttachments = useCallback(
    (picked: readonly PickedAttachment[]): { rejected: number } => {
      const pending: ComposerAttachment[] = picked.map((entry) => ({
        ...entry,
        status: "uploading",
      }));
      const merged = appendAttachments(attachmentsRef.current, pending);
      const accepted = merged.attachments.filter((entry) =>
        pending.some((candidate) => candidate.id === entry.id),
      );
      setAttachments(merged.attachments);
      for (const entry of accepted) startAttachmentUpload(entry);
      return { rejected: merged.rejected };
    },
    [startAttachmentUpload],
  );
  const retryAttachment = useCallback(
    (id: string) => {
      const target = attachmentsRef.current.find((entry) => entry.id === id);
      if (!target || target.status !== "failed") return;
      setAttachments((current) =>
        withAttachmentStatus(current, id, { status: "uploading" }),
      );
      startAttachmentUpload(target);
    },
    [startAttachmentUpload],
  );
  const removeAttachment = useCallback((id: string) => {
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
  const [sending, setSending] = useState(false);
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

  const queueRef = useRef<QueuedSend[]>([]);
  const acceptedDesktopSendIdsRef = useRef<Set<string>>(new Set());
  const stoppedDispatchIdsRef = useRef<Set<string>>(new Set());
  const activeDispatchRef = useRef<{
    dispatchId: string;
    automaticControl?: AutomaticExecutionTurnControl;
    userMessageId: string;
    replyId: string;
    abort: AbortController;
    generation: number;
    latestResponseUserMessageId: string;
  } | null>(null);
  const dispatchGenerationRef = useRef(0);
  const pendingEnqueueRef = useRef<Set<string>>(new Set());
  const drainQueueRef = useRef<(() => void) | null>(null);
  // The dispatch fn closes over `transport`; keep the latest in a ref so the
  // stable queue/drain machinery never dispatches against a stale destination.
  const dispatchRef = useRef<((item: QueuedSend) => Promise<void>) | null>(
    null,
  );
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

  useEffect(() => {
    const authorityChanged =
      committedCanonicalAuthorityKeyRef.current !== canonicalAuthorityKey;
    committedCanonicalAuthorityKeyRef.current = canonicalAuthorityKey;
    if (authorityChanged) {
      acceptedDesktopSendIdsRef.current.clear();
      stoppedDispatchIdsRef.current.clear();
      setStorageLoaded(false);
      setHydrationAuthorityIssue(null);
      draftStore.set("");
      setAttachments([]);
      setQuotes([]);
      setSending(false);
      setWorkingActivity(IDLE_WORKING_ACTIVITY);
      updateMessages([]);
    }
    const lease = canonicalAuthorityLeaseRef.current;
    const pendingEnqueues = pendingEnqueueRef.current;
    return () => {
      if (canonicalAuthorityLeaseRef.current === lease) {
        canonicalAuthorityLeaseRef.current += 1;
      }
      admissionEnabledRef.current = false;
      queueRef.current = [];
      pendingEnqueues.clear();
      const active = activeDispatchRef.current;
      activeDispatchRef.current = null;
      active?.abort.abort();
    };
  }, [canonicalAuthorityKey, canonicalConversationId, draftStore, updateMessages]);

  useEffect(() => {
    let active = true;
    const generation = historyPageGenerationRef.current;
    setHydrationAuthorityIssue(null);
    void loadDesktopChatOutbox(threadId, canonicalOutboxAuthority).then(
      (storedOutbox) => {
        if (!active || generation !== historyPageGenerationRef.current) return;
        const restored = restoreOutboxMessages([], storedOutbox);
        updateMessages(restored);
        setStorageLoaded(true);
        const outboxByUserMessageId = new Map(
          storedOutbox.map((record) => [record.userMessageId, record]),
        );
        const pendingSends = restored.filter(
          (m) =>
            m.role === "user" &&
            (outboxByUserMessageId.has(m.id) || m.queued === true) &&
            m.text.trim().length > 0,
        );
        for (const row of pendingSends) {
          const stored = outboxByUserMessageId.get(row.id);
          queueRef.current.push({
            dispatchId: stored?.sendId ?? row.id,
            clientRequestId: stored?.sendId ?? row.id,
            userMessageId: row.id,
            ...(stored?.userMessageEventId ? { userMessageEventId: stored.userMessageEventId } : {}),
            ...(stored?.structuredAttachments === true ? { structuredAttachments: true } : {}),
            text: stored?.text ?? row.text,
            attachments: stored?.attachments ?? [],
            executionTarget:
              stored?.executionTarget ?? AUTOMATIC_EXECUTION_TARGET,
            ...(stored?.execution ? { execution: stored.execution } : {}),
            ...(stored ? { queueSequence: stored.sequence } : {}),
            canonicalAuthorityLease: canonicalAuthorityLeaseRef.current,
            ...(stored?.cancelRequestId
              ? { cancelRequestId: stored.cancelRequestId }
              : {}),
          });
        }
        queueRef.current.sort(
          (a, b) =>
            (a.queueSequence ?? Number.MAX_SAFE_INTEGER) -
            (b.queueSequence ?? Number.MAX_SAFE_INTEGER),
        );
        if (pendingSends.length > 0 && admissionEnabledRef.current) {
          drainQueueRef.current?.();
        }
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
    retryHydration,
    threadId,
    updateMessages,
  ]);

  // Mirror of `sending` for reads outside render. The ref is written
  // SYNCHRONOUSLY by `markSending` at every transition (the effect below is
  // only a belt-and-braces reconciler), so imperative callers racing the
  // `setSending(true)` commit still observe the in-flight turn.
  const sendingRef = useRef(false);
  const markSending = useCallback((next: boolean) => {
    sendingRef.current = next;
    setSending(next);
  }, []);
  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);
  useEffect(
    () =>
      subscribeChatStorageCleanup(() => {
        historyPageGenerationRef.current += 1;
        dispatchGenerationRef.current += 1;
        queueRef.current = [];
        for (const id of pendingEnqueueRef.current) {
          stoppedDispatchIdsRef.current.add(id);
        }
        pendingEnqueueRef.current.clear();
        const activeDispatch = activeDispatchRef.current;
        if (activeDispatch) {
          stoppedDispatchIdsRef.current.add(activeDispatch.dispatchId);
          activeDispatch.abort.abort();
        }
        activeDispatchRef.current = null;
        acceptedDesktopSendIdsRef.current.clear();
        messagesRef.current = [];
        markSending(false);
        updateMessages([]);
        draftStore.set("");
        setAttachments([]);
        setQuotes([]);
        setWorkingActivity(IDLE_WORKING_ACTIVITY);
      }),
    [draftStore, markSending, updateMessages],
  );

  const acknowledgeDesktopSendIds = useCallback(
    (acceptedIds: Iterable<string>) => {
      const ids = new Set(
        [...acceptedIds].map((id) => id.trim()).filter((id) => id.length > 0),
      );
      if (ids.size === 0) return;
      for (const id of ids) acceptedDesktopSendIdsRef.current.add(id);
      queueRef.current = queueRef.current.filter(
        (item) =>
          !ids.has(item.clientRequestId) && !ids.has(item.userMessageId),
      );
      void acknowledgeDesktopChatOutbox(
        threadId,
        ids,
        canonicalOutboxAuthority,
      ).catch(() => {});
    },
    [canonicalOutboxAuthority, threadId],
  );

  const finishDispatch = useCallback(() => {
    activeDispatchRef.current = null;
    markSending(false);
    setWorkingActivity(IDLE_WORKING_ACTIVITY);
    if (queueRef.current.length > 0 && appActive) {
      drainQueueRef.current?.();
    }
  }, [appActive, markSending]);

  const dispatchAutomatic = useCallback(
    async (item: QueuedSend, replyId: string, abort: AbortController) => {
      clearComposerNotices(canonicalConversationId);
      const assertAuthorityLease = () => {
        if (!canonicalAuthorityLeaseCurrent(item.canonicalAuthorityLease)) {
          throw new AutomaticExecutionWaitAbortedError();
        }
      };
      const isCurrent = () =>
        canonicalAuthorityLeaseCurrent(item.canonicalAuthorityLease) &&
        (activeDispatchRef.current?.replyId === replyId ||
          stoppedDispatchIdsRef.current.has(item.dispatchId));
      const renderReply = (text: string, stopped = false) => {
        if (!isCurrent()) return;
        updateMessages((current) =>
          current.map((message) =>
            message.id === replyId
              ? { ...message, text, ...(stopped ? { stopped: true } : {}) }
              : message,
          ),
        );
      };

      const placementAttachments = item.attachments.map((entry) => ({
        path: entry.path,
        kind: entry.kind,
      }));

      try {
        assertAuthorityLease();
        let admitted: AutomaticExecutionDispatch | null = null;
        let placementConversationId = canonicalConversationId ?? "";
        let ignoreStoredAccess = false;
        while (!admitted) {
          assertAuthorityLease();
          try {
            if (!placementConversationId) {
              placementConversationId = await readMainConversationId();
              assertAuthorityLease();
            }
            const target = item.executionTarget ?? AUTOMATIC_EXECUTION_TARGET;
            let access: StoredPhoneAccess | undefined;
            if (!ignoreStoredAccess && target.mode === "device") {
              access =
                transport.access?.desktopDeviceId === target.deviceId
                  ? transport.access
                  : (await listStoredPairedPhoneAccess()).find(
                      (candidate) =>
                        candidate.desktopDeviceId === target.deviceId,
                    );
            } else if (!ignoreStoredAccess && target.mode !== "cloud") {
              access =
                transport.access ??
                (await getPreferredPhoneAccess()) ??
                undefined;
            }
            assertAuthorityLease();
            if (!admissionEnabledRef.current) {
              await waitForAutomaticRetry(abort.signal);
              assertAuthorityLease();
              continue;
            }
            admitted = await submitAutomaticExecution({
              ...unifiedChatPlacementAdmission({
                dispatchId: item.dispatchId,
                ...(item.userMessageEventId ? { userMessageEventId: item.userMessageEventId } : {}),
                conversationId: placementConversationId,
                prompt: desktopChatOutboxPrompt(item),
                attachments: placementAttachments,
              }),
              ...(access ? { access } : {}),
              ...(item.execution && target.mode !== "device" ? { execution: item.execution } : {}),
              target,
            });
            assertAuthorityLease();
          } catch (error) {
            if (
              error instanceof AutomaticExecutionWaitAbortedError ||
              abort.signal.aborted
            ) {
              throw error;
            }
            if (
              !ignoreStoredAccess &&
              (item.executionTarget?.mode ?? "automatic") !== "device" &&
              isAutomaticExecutionPairCredentialRejection(error)
            ) {
              ignoreStoredAccess = true;
              continue;
            }
            if (isPermanentAutomaticAdmissionError(error)) throw error;
            await waitForAutomaticRetry(abort.signal);
            assertAuthorityLease();
          }
        }

        assertAuthorityLease();
        const active = activeDispatchRef.current;
        transport.onAdmission?.({
          localMessageId: item.userMessageId,
          dispatchId: admitted.dispatchId,
          conversationId: placementConversationId,
        });
        if (active?.replyId === replyId) {
          active.automaticControl = bindAutomaticExecutionAdmission(
            active.automaticControl ?? {
              clientIdempotencyKey: item.dispatchId,
            },
            admitted,
          );
        }
        let control =
          active?.automaticControl ??
          bindAutomaticExecutionAdmission(
            { clientIdempotencyKey: item.dispatchId },
            admitted,
          );
        if (
          item.cancelRequestId ||
          stoppedDispatchIdsRef.current.has(item.dispatchId)
        ) {
          control = requestAutomaticExecutionCancellation({
            ...control,
            ...(item.cancelRequestId
              ? { cancelRequestId: item.cancelRequestId }
              : {}),
          });
          if (active?.replyId === replyId) active.automaticControl = control;
        }
        const cancellation = automaticExecutionCancellationCommand(control);
        if (cancellation) {
          for (;;) {
            try {
              admitted = await cancelAutomaticExecution({
                ...cancellation,
                reason: "Stopped from the mobile conversation.",
                signal: abort.signal,
              });
              assertAuthorityLease();
              break;
            } catch (error) {
              if (
                error instanceof AutomaticExecutionWaitAbortedError ||
                abort.signal.aborted
              ) {
                throw error;
              }
              if (isPermanentAutomaticAdmissionError(error)) throw error;
              patchActivity({ statusText: "Stopping" });
              await waitForAutomaticRetry(abort.signal);
            }
          }
        }

        const terminal = await waitForAutomaticExecution({
          dispatchId: admitted.dispatchId,
          signal: abort.signal,
          ...(transport.statusWake ? { wake: transport.statusWake } : {}),
          beforeRead: async () => {
            const current = activeDispatchRef.current;
            if (current?.replyId !== replyId) return;
            const pendingCancellation = automaticExecutionCancellationCommand(
              current.automaticControl ?? {
                clientIdempotencyKey: item.dispatchId,
              },
            );
            if (!pendingCancellation) return;
            await cancelAutomaticExecution({
              ...pendingCancellation,
              reason: "Stopped from the mobile conversation.",
              signal: abort.signal,
            });
            assertAuthorityLease();
          },
          onUpdate: (dispatch) => {
            if (!canonicalAuthorityLeaseCurrent(item.canonicalAuthorityLease)) {
              return;
            }
            const statusText = unifiedChatPlacementStatusText(dispatch);
            if (statusText) patchActivity({ statusText });
          },
        });
        assertAuthorityLease();
        renderReply(
          automaticExecutionResultText(terminal),
          terminal.state === "canceled",
        );
        if (terminal.state === "failed" && terminal.errorMessage) {
          showComposerNoticeForError(
            terminal.errorMessage,
            canonicalConversationId,
          );
        }
        acknowledgeDesktopSendIds([item.dispatchId, item.userMessageId]);
        finishDispatch();
      } catch (error) {
        if (
          error instanceof AutomaticExecutionWaitAbortedError ||
          abort.signal.aborted
        ) {
          return;
        }
        renderReply(userFacingError(error));
        showComposerNoticeForError(error, canonicalConversationId);
        if (isPermanentAutomaticAdmissionError(error)) {
          acknowledgeDesktopSendIds([item.dispatchId, item.userMessageId]);
        }
        finishDispatch();
      }
    },
    [
      acknowledgeDesktopSendIds,
      canonicalAuthorityLeaseCurrent,
      canonicalConversationId,
      finishDispatch,
      patchActivity,
      transport,
      updateMessages,
    ],
  );

  const parkQueuedSend = useCallback(
    (item: QueuedSend) => {
      if (
        !queueRef.current.some(
          (queued) => queued.dispatchId === item.dispatchId,
        )
      ) {
        queueRef.current.push(item);
        queueRef.current.sort(
          (a, b) =>
            (a.queueSequence ?? Number.MAX_SAFE_INTEGER) -
            (b.queueSequence ?? Number.MAX_SAFE_INTEGER),
        );
      }
      updateMessages((current) =>
        current.map((message) =>
          message.id === item.userMessageId
            ? { ...message, queued: true }
            : message,
        ),
      );
    },
    [updateMessages],
  );

  const dispatch = useCallback(
    async (item: QueuedSend) => {
      if (!canonicalAuthorityLeaseCurrent(item.canonicalAuthorityLease)) {
        return;
      }
      if (!admissionEnabledRef.current) {
        parkQueuedSend(item);
        markSending(false);
        setWorkingActivity(IDLE_WORKING_ACTIVITY);
        return;
      }
      const replyId = createId();
      const abort = new AbortController();
      dispatchGenerationRef.current += 1;
      activeDispatchRef.current = {
        dispatchId: item.dispatchId,
        automaticControl: {
          clientIdempotencyKey: item.dispatchId,
          ...(item.cancelRequestId
            ? { cancelRequestId: item.cancelRequestId }
            : {}),
        },
        userMessageId: item.userMessageId,
        replyId,
        abort,
        generation: dispatchGenerationRef.current,
        latestResponseUserMessageId: item.userMessageId,
      };
      setWorkingActivity(IDLE_WORKING_ACTIVITY);
      const dispatchedAt = Date.now();
      updateMessages((m) => {
        const next = [
          ...m.map((msg) => {
            if (msg.id !== item.userMessageId) return msg;
            return msg.queued
              ? { ...msg, queued: false, createdAt: dispatchedAt }
              : { ...msg, queued: false };
          }),
          {
            id: replyId,
            role: "assistant" as const,
            requestId: item.userMessageId,
            text: "",
            createdAt: dispatchedAt,
          },
        ];
        if (next.length <= CHAT_TRANSCRIPT_MAX_LOADED) return next;
        return next.slice(-CHAT_TRANSCRIPT_MAX_LOADED);
      });

      await dispatchAutomatic(item, replyId, abort);
    },
    [
      canonicalAuthorityLeaseCurrent,
      dispatchAutomatic,
      markSending,
      parkQueuedSend,
      updateMessages,
    ],
  );

  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);

  const drainQueue = useCallback(() => {
    const next = queueRef.current[0];
    if (!next) return;
    if (!canonicalAuthorityLeaseCurrent(next.canonicalAuthorityLease)) {
      queueRef.current.shift();
      return;
    }
    if (!admissionEnabledRef.current) return;
    queueRef.current.shift();
    markSending(true);
    void dispatchRef.current?.(next);
  }, [canonicalAuthorityLeaseCurrent, markSending]);

  useEffect(() => {
    drainQueueRef.current = drainQueue;
  }, [drainQueue]);

  useEffect(() => {
    if (!storageLoaded || !drainOperationalOutbox || sendingRef.current) return;
    drainQueueRef.current?.();
  }, [drainOperationalOutbox, storageLoaded]);

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
      if (!attachmentsSettled(composerAttachments)) return null;
      const picked = composerAttachments.filter(isAttachmentReady);
      const sendAttachments: DesktopChatOutboxAttachment[] = picked.map(
        (entry) => ({
          path: entry.drivePath,
          name: entry.name,
          kind: entry.kind,
          ...(entry.kind === "image" ? { previewUri: entry.uri } : {}),
        }),
      );

      if (!hasAiConsent()) {
        requestAiConsent();
        return null;
      }

      if (!supplied) {
        draftStore.set("");
        setAttachments([]);
        setQuotes([]);
      }

      // Queue-vs-primary-dispatch is decided on the synchronously-written ref,
      // NOT the
      // render-state `sending`: a second imperative send in the same
      // render/effect gap would otherwise dispatch a second full response
      // observer. `admitSend` claims that singleton observer atomically; a
      // queued desktop item is still transmitted promptly by the durable-ACK
      // steer pump above, while cloud keeps its serial next-turn behavior.
      const admission = admitSend(sendingRef);

      const userMessageId = createId();
      const images = picked.filter((entry) => entry.kind === "image");
      const documents = picked.filter((entry) => entry.kind === "file");
      // Same text the confirmed row shows (the prompt only); attachments
      // render as thumbnails/chips, so image-only sends carry no label.
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
          })),
        } : {}),
        ...(thumbs.length > 0 ? { thumbnailUris: thumbs } : {}),
        ...(documents.length > 0
          ? { documentNames: documents.map((entry) => entry.name) }
          : {}),
        ...(quotedPreview ? { quotedText: quotedPreview } : {}),
        ...(admission === "queue" ? { queued: true, sentWhileBusy: true } : {}),
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

      const item: QueuedSend = {
        structuredAttachments: true,
        dispatchId: userMessageId,
        clientRequestId: userMessageId,
        userMessageId,
        userMessageEventId: userMessageId,
        text,
        ...(decoupleQuotes ? { promptText, selectedText: rawQuotes } : {}),
        attachments: sendAttachments,
        executionTarget:
          transport.executionTarget ?? AUTOMATIC_EXECUTION_TARGET,
        ...(transport.execution && transport.executionTarget?.mode !== "device"
          ? { execution: { ...transport.execution } }
          : {}),
        canonicalAuthorityLease: canonicalAuthorityLeaseRef.current,
      };
      pendingEnqueueRef.current.add(userMessageId);
      if (admission === "dispatch") markSending(true);
      const durableRecord: Omit<DesktopChatOutboxRecord, "sequence"> = {
        structuredAttachments: true,
        sendId: userMessageId,
        userMessageId,
        userMessageEventId: userMessageId,
        text,
        displayText,
        createdAt,
        attachments: sendAttachments,
        executionTarget:
          transport.executionTarget ?? AUTOMATIC_EXECUTION_TARGET,
        ...(transport.execution && transport.executionTarget?.mode !== "device"
          ? { execution: { ...transport.execution } }
          : {}),
        authority: canonicalOutboxAuthority,
      };
      void enqueueDesktopChatOutbox(threadId, durableRecord)
        .then((stored) => {
          pendingEnqueueRef.current.delete(userMessageId);
          if (!canonicalAuthorityLeaseCurrent(item.canonicalAuthorityLease)) {
            return;
          }
          item.queueSequence = stored.sequence;
          if (
            acceptedDesktopSendIdsRef.current.has(item.userMessageId) ||
            stoppedDispatchIdsRef.current.has(item.dispatchId)
          ) {
            acknowledgeDesktopSendIds([
              item.clientRequestId,
              item.userMessageId,
            ]);
            return;
          }
          if (admission === "queue" || !admissionEnabledRef.current) {
            parkQueuedSend(item);
            if (admission === "dispatch") markSending(false);
            if (!sendingRef.current && admissionEnabledRef.current) {
              drainQueueRef.current?.();
            }
            return;
          }
          void dispatch(item);
        })
        .catch(() => {
          pendingEnqueueRef.current.delete(userMessageId);
          if (!canonicalAuthorityLeaseCurrent(item.canonicalAuthorityLease)) {
            return;
          }
          if (stoppedDispatchIdsRef.current.has(item.dispatchId)) return;
          if (admission === "dispatch") markSending(false);
          updateMessages((current) =>
            current.map((message) =>
              message.id === userMessageId
                ? { ...message, queued: true }
                : message,
            ),
          );
        });
      return { userMessageId };
    },
    [
      acknowledgeDesktopSendIds,
      attachments,
      canonicalAuthorityLeaseCurrent,
      canonicalOutboxAuthority,
      dispatch,
      draftStore,
      quotes,
      markSending,
      parkQueuedSend,
      storageLoaded,
      threadId,
      transport.executionTarget,
      transport.execution,
      updateMessages,
    ],
  );

  const send = useCallback(() => submit(), [submit]);
  const sendPrompt = useCallback((prompt: string) => submit(prompt), [submit]);

  const stop = useCallback(() => {
    const cancelledIds = [
      ...new Set([
        ...queueRef.current.map((q) => q.userMessageId),
        ...pendingEnqueueRef.current,
      ]),
    ];
    for (const id of cancelledIds) stoppedDispatchIdsRef.current.add(id);
    pendingEnqueueRef.current.clear();
    queueRef.current = [];
    if (cancelledIds.length > 0) {
      acknowledgeDesktopSendIds(cancelledIds);
    }
    if (cancelledIds.length > 0) {
      updateMessages((m) =>
        m.map((msg) =>
          cancelledIds.includes(msg.id)
            ? { ...msg, queued: false, stopped: true }
            : msg,
        ),
      );
    }
    const active = activeDispatchRef.current;
    if (active) {
      stoppedDispatchIdsRef.current.add(active.dispatchId);
      const control = requestAutomaticExecutionCancellation(
        active.automaticControl ?? {
          clientIdempotencyKey: active.dispatchId,
        },
      );
      active.automaticControl = control;
      const cancelRequestId = control.cancelRequestId!;
      const cancellation = automaticExecutionCancellationCommand(control);
      const authorityLease = canonicalAuthorityLeaseRef.current;
      patchActivity({ statusText: "Stopping" });
      updateMessages((m) =>
        m.map((msg) =>
          msg.id === active.replyId
            ? { ...msg, text: msg.text || "Stopping…", stopped: true }
            : msg,
        ),
      );
      void markDesktopChatOutboxCancellation(
        threadId,
        active.dispatchId,
        cancelRequestId,
        Date.now(),
        canonicalOutboxAuthority,
      )
        .then(() =>
          canonicalAuthorityLeaseCurrent(authorityLease) && cancellation
            ? cancelAutomaticExecution({
                ...cancellation,
                reason: "Stopped from the mobile conversation.",
              })
            : undefined,
        )
        .catch(() => {
          // The active placement observer retries from the durable intent;
          // a relaunch does the same if this process is interrupted.
        })
        .finally(() => transport.statusWake?.nudge());
      return;
    }
    markSending(false);
    setWorkingActivity(IDLE_WORKING_ACTIVITY);
  }, [
    acknowledgeDesktopSendIds,
    canonicalAuthorityLeaseCurrent,
    canonicalOutboxAuthority,
    markSending,
    patchActivity,
    threadId,
    transport.statusWake,
    updateMessages,
  ]);

  const workingIndicator = useMemo(
    () => buildWorkingIndicatorState({ sending, activity: workingActivity }),
    [sending, workingActivity],
  );

  const conversationTasks = useMemo(
    () => collectConversationTasks(messages),
    [messages],
  );

  // The transcript's agent-work cards must agree with the pill above: their
  // synced `state` was settled desktop-side (where elapsed time counts as
  // completion), so re-derive it from the same live task fold. A `send_message`
  // follow-up steering a still-running thread renders as in-progress instead
  // of a false "Finished". Render-only — the raw fold stays what persists.
  const displayMessages = useMemo(
    () => applyLiveAgentWorkState(messages, conversationTasks),
    [conversationTasks, messages],
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
    activeSendMessageId: sending ? activeDispatchRef.current?.userMessageId ?? null : null,
    workingIndicator,
    storageLoaded,
    authorityIssue: hydrationAuthorityIssue,
    conversationTasks,
    send,
    sendPrompt,
    stop,
  };
}
