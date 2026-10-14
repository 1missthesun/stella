import { useChatStorageMode } from "@/features/chat/services/chat-storage-preference";

import type { CloudTurnContext } from "@stella/contracts/turn-plane/turn-start";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import { getAuthToken } from "@/global/auth/services/auth-token";
import { backendSocketUrl, backendUrl } from "@/platform/backend/backend-client";
import { useCloudEngines } from "./cloud-engines-api";
import { markCloudConversationCreated } from "./cloud-conversation-selection";
import {
  CloudTurnStartClientError,
  CloudTurnStartTransportError,
  cloudTurnStartRequest,
  newCloudConversationId,
  startCloudTurn,
} from "./turn-start-client";
import {
  getCloudExecutionSelectionSnapshot,
  reconcileCloudExecutionSelection,
  subscribeCloudExecutionSelection,
} from "./cloud-execution-store";
import { useI18n } from "../../shared/i18n/I18nProvider";
import {
  cloudAttachmentsStore,
  isWebShell,
  type CloudAttachment,
} from "./cloud-composer-store";
import {
  browserExecutionCancelArgs,
  browserExecutionSubmitArgs,
  sha256Hex,
  waitForBrowserExecutionTurn,
} from "./browser-execution-placement";
import {
  cancelDispatch,
  getDispatchStatus,
  PlacementClientError,
  submitDispatch,
} from "./placement-client";
import type { ConversationState } from "./conversation-store";
import {
  activateCloudConversationClientAuthority,
  conversationStore,
} from "./conversation-store";
import {
  cloudConversationOutboxStorageKey,
  pendingPrompts,
  type CloudConversationOutboxAuthority,
  type PendingCloudTurnSubmission,
  type PendingPrompt,
} from "./conversation-outbox";
import type { SocketStatus } from "./conversation-socket";
import { reportCloudReadiness } from "./cloud-readiness-timing";
import { showToast } from "@/ui/toast";
import { presentCloudUsageLimit } from "./usage-limit-notice";
import { getExecutionTargetSnapshot } from "../execution-placement/execution-target-store";
import { waitForCloudAttachmentUploads } from "./browser-chat-attachments";

export type CloudRealtimeConfig = {
  socketBaseUrl: string | null;
  httpOrigin: string | null;
  resolved: boolean;
};

const OFFLINE_CONFIG: CloudRealtimeConfig = {
  socketBaseUrl: null,
  httpOrigin: null,
  resolved: false,
};

const UNSUPPORTED_CONFIG: CloudRealtimeConfig = {
  socketBaseUrl: null,
  httpOrigin: null,
  resolved: true,
};

export const useCloudRealtimeConfig = (): CloudRealtimeConfig => {
  const { isCloudConversationReady } = useCloudConversationSession();
  const config = useMemo(() => {
    if (!isCloudConversationReady) return OFFLINE_CONFIG;
    if (!backendSocketUrl) return UNSUPPORTED_CONFIG;
    return { socketBaseUrl: backendSocketUrl, httpOrigin: backendUrl, resolved: true };
  }, [isCloudConversationReady]);
  useEffect(() => {
    if (!isCloudConversationReady || !config.resolved) return;
    reportCloudReadiness("cloud.realtime-config", {
      outcome: config.socketBaseUrl ? "success" : "unavailable",
    });
  }, [isCloudConversationReady, config.resolved, config.socketBaseUrl]);
  return config;
};

const IDLE_STATE: ConversationState = {
  conversationId: "",
  status: "idle",
  statusMessage: null,
  statusRetryable: true,
  epoch: null,
  headSeq: -1,
  records: [],
  live: null,
  title: "",
  floorSeq: 0,
  hasOlder: false,
  loadingOlder: false,
  olderNotice: null,
};

const noopSubscribe = (): (() => void) => () => {};
const idleSnapshot = (): ConversationState => IDLE_STATE;
const noLocalExecution = (): null => null;

export type CloudConversationView = {
  state: ConversationState;
  status: SocketStatus;
  pending: readonly PendingPrompt[];
  send: (prompt: string, context?: CloudTurnContext) => Promise<void>;
  retrySend: (clientMsgId: string) => Promise<void>;
  dismissSend: (clientMsgId: string) => void;
  cancelTurn: (turnId: string) => Promise<boolean>;
  cancelPending: (clientMsgId: string) => Promise<boolean>;
  loadOlder: () => void;
  retryConnection: () => void;
};

const newClientMsgId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

type RenderedAcceptanceBrowserDispatchMetadata = {
  authoritySha256: string;
  clientMsgIdSha256: string;
  conversationIdSha256: string;
  outboxKeySha256: string;
};

type RenderedAcceptanceBrowserDispatchOutcome = {
  clientMsgIdSha256: string;
  outcome: "accepted" | "owner_generation_rejected" | "other_rejected";
  errorCodeSha256: string;
};

type RenderedAcceptanceAuthorityMetadata = {
  authoritySha256: string;
  ownerGenerationSha256: string;
};

declare global {
  interface Window {
    __STELLA_RENDERED_ACCEPTANCE_BEFORE_BROWSER_DISPATCH__?: (
      metadata: RenderedAcceptanceBrowserDispatchMetadata,
    ) => Promise<void>;
    __STELLA_RENDERED_ACCEPTANCE_AFTER_BROWSER_DISPATCH__?: (
      metadata: RenderedAcceptanceBrowserDispatchOutcome,
    ) => void;
    __STELLA_RENDERED_ACCEPTANCE_AUTHORITY__?: (
      metadata: RenderedAcceptanceAuthorityMetadata,
    ) => void;
  }
}

const hashCloudOutboxAuthority = async (
  authority: CloudConversationOutboxAuthority,
): Promise<string> =>
  await sha256Hex(
    JSON.stringify([authority.accountScope, authority.ownerGeneration]),
  );

const waitForRenderedAcceptanceBrowserDispatch = async (
  entry: PendingPrompt,
  barrier: (
    metadata: RenderedAcceptanceBrowserDispatchMetadata,
  ) => Promise<void>,
): Promise<void> => {
  const requestedConversationId = entry.submission.requestedConversationId;
  const [
    authoritySha256,
    clientMsgIdSha256,
    conversationIdSha256,
    outboxKeySha256,
  ] = await Promise.all([
    hashCloudOutboxAuthority(entry),
    sha256Hex(entry.clientMsgId),
    sha256Hex(requestedConversationId ?? "<new-conversation>"),
    sha256Hex(cloudConversationOutboxStorageKey(entry)),
  ]);
  await barrier(
    Object.freeze({
      authoritySha256,
      clientMsgIdSha256,
      conversationIdSha256,
      outboxKeySha256,
    }),
  );
};

const serializedErrorPayload = (
  error: unknown,
): Record<string, unknown> | null => {
  if (error instanceof PlacementClientError) return { code: error.code };
  const data = (error as { data?: unknown })?.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  if (!(error instanceof Error)) return null;
  const first = error.message.indexOf("{");
  const last = error.message.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try {
    const parsed: unknown = JSON.parse(error.message.slice(first, last + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

export const classifyBrowserDispatchRejection = async (
  error: unknown,
): Promise<
  Pick<RenderedAcceptanceBrowserDispatchOutcome, "outcome" | "errorCodeSha256">
> => {
  const payload = serializedErrorPayload(error);
  const code = typeof payload?.code === "string" ? payload.code : "";
  return {
    outcome:
      code === "generation_stale" || code === "OWNER_DATA_GENERATION_STALE"
        ? "owner_generation_rejected"
        : "other_rejected",
    errorCodeSha256: await sha256Hex(code || "<no-error-code>"),
  };
};

const browserDispatchRejectionReceipt = async (
  entry: PendingPrompt,
  error: unknown,
): Promise<RenderedAcceptanceBrowserDispatchOutcome> => {
  const classification = await classifyBrowserDispatchRejection(error);
  return {
    clientMsgIdSha256: await sha256Hex(entry.clientMsgId),
    ...classification,
  };
};

const reportRenderedAcceptanceAuthority = (
  authority: CloudConversationOutboxAuthority,
  hook: (metadata: RenderedAcceptanceAuthorityMetadata) => void,
): void => {
  void Promise.all([
    hashCloudOutboxAuthority(authority),
    sha256Hex(authority.ownerGeneration),
  ])
    .then(([authorityHash, ownerGenerationSha256]) => {
      hook({ authoritySha256: authorityHash, ownerGenerationSha256 });
    })
    .catch(() => {
      // Acceptance instrumentation must never change product behavior.
    });
};

export const useConversation = (
  conversationId: string | null,
  decoratePrompt: (
    prompt: string,
    attachments: readonly CloudAttachment[],
  ) => string = (prompt) => prompt,
  onSent: (submittedAttachments: readonly CloudAttachment[]) => void = () => {},
): CloudConversationView => {
  const config = useCloudRealtimeConfig();
  const { locale } = useI18n();
  const {
    isCloudConversationReady: authCloudReady,
    accountScope,
    ownerGeneration,
  } = useCloudConversationSession();
  const storageMode = useChatStorageMode();
  const isCloudConversationReady = authCloudReady && storageMode === "cloud";
  const webShell = isWebShell();
  const authority = useMemo<CloudConversationOutboxAuthority | null>(() => {
    if (!isCloudConversationReady || !ownerGeneration) return null;
    return { accountScope, ownerGeneration };
  }, [accountScope, isCloudConversationReady, ownerGeneration]);
  const activeAuthorityKey = authority
    ? `${authority.accountScope}\u0000${authority.ownerGeneration}`
    : null;
  const activeAuthorityKeyRef = useRef(activeAuthorityKey);
  activeAuthorityKeyRef.current = activeAuthorityKey;
  const activatedAuthorityKeyRef = useRef<string | null>(null);
  const dispatchByTurnRef = useRef(new Map<string, string>());
  const preparingAttachmentSendRef = useRef(false);
  const cloudEngine = useCloudEngines(isCloudConversationReady);
  const cloudSelection = cloudEngine?.selection ?? cloudEngine?.execution;
  const localExecution = useSyncExternalStore(
    subscribeCloudExecutionSelection,
    getCloudExecutionSelectionSnapshot,
    noLocalExecution,
  );
  const store =
    isCloudConversationReady && conversationId && authority
      ? conversationStore(
          conversationId,
          authority.accountScope,
          authority.ownerGeneration,
        )
      : null;

  useEffect(() => {
    reconcileCloudExecutionSelection(cloudSelection);
  }, [cloudSelection, localExecution]);

  useEffect(() => {
    if (!authority) return;
    const changed = activatedAuthorityKeyRef.current !== activeAuthorityKey;
    const ready = activateCloudConversationClientAuthority(authority);
    if (changed) dispatchByTurnRef.current.clear();
    activatedAuthorityKeyRef.current = activeAuthorityKey;
    const renderedAcceptanceAuthority =
      import.meta.env.DEV && typeof window !== "undefined"
        ? window.__STELLA_RENDERED_ACCEPTANCE_AUTHORITY__
        : undefined;
    if (ready && renderedAcceptanceAuthority) {
      reportRenderedAcceptanceAuthority(authority, renderedAcceptanceAuthority);
    }
  }, [activeAuthorityKey, authority]);

  useEffect(() => {
    store?.setConfig(config.socketBaseUrl, config.resolved);
  }, [store, config.socketBaseUrl, config.resolved]);

  const state = useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    store?.getSnapshot ?? idleSnapshot,
    idleSnapshot,
  );
  const allPending = useSyncExternalStore(
    pendingPrompts.subscribe,
    pendingPrompts.getSnapshot,
    pendingPrompts.getServerSnapshot,
  );

  useEffect(() => {
    if (!store) return;
    const wake = () => store.wake();
    const onVisible = () => {
      if (document.visibilityState === "visible") store.wake();
    };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [store]);

  const pending = useMemo(
    () =>
      allPending.filter(
        (entry) =>
          authority !== null &&
          entry.accountScope === authority.accountScope &&
          entry.ownerGeneration === authority.ownerGeneration &&
          (entry.conversationId === null ||
            entry.conversationId === conversationId),
      ),
    [allPending, authority, conversationId],
  );

  const dispatch = useCallback(
    async (entry: PendingPrompt): Promise<void> => {
      const sendAuthority: CloudConversationOutboxAuthority = {
        accountScope: entry.accountScope,
        ownerGeneration: entry.ownerGeneration,
      };
      const sendAuthorityKey = `${entry.accountScope}\u0000${entry.ownerGeneration}`;
      const clientMsgId = entry.clientMsgId;
      const submission = entry.submission;
      if (!pendingPrompts.claimDispatch(sendAuthority, clientMsgId)) return;
      const isCurrentAuthority = () =>
        activeAuthorityKeyRef.current === sendAuthorityKey;
      try {
        if (!isCurrentAuthority()) return;
        if (!webShell) {
          const targetConversationId = submission.requestedConversationId;
          if (!targetConversationId) {
            throw new Error("Open a cloud conversation before sending.");
          }
          const httpOrigin = config.httpOrigin;
          if (!httpOrigin) {
            throw new Error(
              "Stella's cloud isn't reachable yet. Try again in a moment.",
            );
          }
          const result = await startCloudTurn({
            httpOrigin,
            conversationId: targetConversationId,
            request: cloudTurnStartRequest(clientMsgId, submission, entry.text),
            getToken: (options) => getAuthToken(options ?? {}),
          });
          if (!isCurrentAuthority()) return;
          if (result.createdConversation) {
            markCloudConversationCreated(
              result.conversationId,
              entry.accountScope,
            );
          }
          pendingPrompts.bind(
            sendAuthority,
            clientMsgId,
            result.conversationId,
            result.turnId,
          );
          pendingPrompts.acknowledgeAdmission(
            sendAuthority,
            clientMsgId,
            result.conversationId,
            result.turnId,
          );
          onSent(submission.attachments);
          return;
        }
        const requestedConversationId = submission.requestedConversationId;
        if (!requestedConversationId) {
          throw new Error("Open a cloud conversation before sending.");
        }
        const placementOrigin = config.httpOrigin;
        if (!placementOrigin) {
          throw new Error(
            "Stella's cloud isn't reachable yet. Try again in a moment.",
          );
        }
        const submitArgs = await browserExecutionSubmitArgs({
          clientMsgId,
          conversationId: requestedConversationId,
          submission,
        });
        if (!isCurrentAuthority()) return;
        const renderedAcceptanceBarrier =
          import.meta.env.DEV && typeof window !== "undefined"
            ? window.__STELLA_RENDERED_ACCEPTANCE_BEFORE_BROWSER_DISPATCH__
            : undefined;
        if (renderedAcceptanceBarrier) {
          await waitForRenderedAcceptanceBrowserDispatch(
            entry,
            renderedAcceptanceBarrier,
          );
        }
        const mutationOutcome = await (async () => {
          try {
            return {
              accepted: true as const,
              result: await submitDispatch({
                httpOrigin: placementOrigin,
                request: submitArgs,
                getToken: (options) => getAuthToken(options ?? {}),
              }),
            };
          } catch (error) {
            return { accepted: false as const, error };
          }
        })();
        const renderedAcceptanceOutcome =
          import.meta.env.DEV && typeof window !== "undefined"
            ? window.__STELLA_RENDERED_ACCEPTANCE_AFTER_BROWSER_DISPATCH__
            : undefined;
        if (renderedAcceptanceOutcome) {
          const receipt = mutationOutcome.accepted
            ? {
                clientMsgIdSha256: await sha256Hex(entry.clientMsgId),
                outcome: "accepted" as const,
                errorCodeSha256: await sha256Hex("<accepted>"),
              }
            : await browserDispatchRejectionReceipt(
                entry,
                mutationOutcome.error,
              );
          try {
            renderedAcceptanceOutcome(Object.freeze(receipt));
          } catch {
            // Acceptance instrumentation must never change product behavior.
          }
        }
        if (!mutationOutcome.accepted) throw mutationOutcome.error;
        const result = mutationOutcome.result;
        if (!isCurrentAuthority()) return;
        pendingPrompts.bindDispatch(
          sendAuthority,
          clientMsgId,
          result.dispatchId,
        );
        onSent(submission.attachments);

        const current = pendingPrompts.find(sendAuthority, clientMsgId);
        if (current?.cancelRequested) {
          const canceled = await cancelDispatch({
            httpOrigin: placementOrigin,
            getToken: (options) => getAuthToken(options ?? {}),
            ...browserExecutionCancelArgs(result.dispatchId),
          });
          if (!isCurrentAuthority()) return;
          if (canceled.state === "canceled") {
            pendingPrompts.acknowledgeTerminal(
              sendAuthority,
              clientMsgId,
              result.dispatchId,
            );
            pendingPrompts.drop(sendAuthority, clientMsgId);
            return;
          }
        }

        const settled = await waitForBrowserExecutionTurn({
          dispatchId: result.dispatchId,
          queryStatus: (dispatchId) =>
            getDispatchStatus({
              httpOrigin: placementOrigin,
              dispatchId,
              getToken: (options) => getAuthToken(options ?? {}),
            }),
          isCurrentAccount: isCurrentAuthority,
        });
        if (settled.status === "stale") return;
        if (settled.dispatch.cloudTurnId) {
          dispatchByTurnRef.current.set(
            settled.dispatch.cloudTurnId,
            result.dispatchId,
          );
          pendingPrompts.bind(
            sendAuthority,
            clientMsgId,
            settled.dispatch.conversationId,
            settled.dispatch.cloudTurnId,
          );
          pendingPrompts.acknowledgeAdmission(
            sendAuthority,
            clientMsgId,
            settled.dispatch.conversationId,
            settled.dispatch.cloudTurnId,
          );
        }
        if (settled.status === "terminal") {
          pendingPrompts.acknowledgeTerminal(
            sendAuthority,
            clientMsgId,
            result.dispatchId,
          );
          if (settled.dispatch.state === "canceled") {
            pendingPrompts.drop(sendAuthority, clientMsgId);
          } else if (settled.dispatch.state === "failed") {
            pendingPrompts.fail(
              sendAuthority,
              clientMsgId,
              settled.dispatch.errorMessage || "That cloud turn failed.",
            );
            presentCloudUsageLimit(
              settled.dispatch.errorMessage,
              settled.dispatch.conversationId || null,
            );
          }
        }
      } catch (error) {
        if (!isCurrentAuthority()) return;
        pendingPrompts.fail(
          sendAuthority,
          clientMsgId,
          friendlySendError(error),
          isAmbiguousTransportFailure(error),
        );
        presentCloudUsageLimit(
          friendlySendError(error),
          entry.conversationId ?? submission.requestedConversationId ?? null,
        );
      } finally {
        pendingPrompts.releaseDispatch(sendAuthority, clientMsgId);
      }
    },
    [config.httpOrigin, onSent, webShell],
  );

  useEffect(() => {
    if (!authority || !pendingPrompts.isAuthorityReady(authority)) return;
    if (!config.resolved) return;
    for (const entry of allPending) {
      if (
        entry.accountScope !== authority.accountScope ||
        entry.ownerGeneration !== authority.ownerGeneration ||
        entry.error !== null ||
        (entry.conversationId !== null &&
          entry.conversationId !== conversationId)
      ) {
        continue;
      }
      void dispatch(entry);
    }
  }, [
    allPending,
    authority,
    config.resolved,
    conversationId,
    dispatch,
    webShell,
  ]);

  const send = useCallback(
    async (prompt: string, context?: CloudTurnContext): Promise<void> => {
      if (webShell) {
        if (preparingAttachmentSendRef.current) return;
        preparingAttachmentSendRef.current = true;
        try {
          await waitForCloudAttachmentUploads();
        } catch (error) {
          showToast({
            title: "An attachment couldn’t be sent",
            description:
              error instanceof Error ? error.message : "Try the upload again.",
            variant: "error",
          });
          return;
        } finally {
          preparingAttachmentSendRef.current = false;
        }
      }
      const text = prompt.trim();
      if (!text) return;
      const clientMsgId = newClientMsgId();
      const attachments = cloudAttachmentsStore.getSnapshot();
      const selectedExecution =
        getCloudExecutionSelectionSnapshot() ?? cloudSelection ?? null;
      if (!authority) return;
      const requestedConversationId =
        conversationId ?? (webShell ? null : newCloudConversationId());
      const submission: PendingCloudTurnSubmission = {
        requestedConversationId,
        prompt: decoratePrompt(text, attachments),
        imagePaths: attachments
          .filter(
            (entry) =>
              entry.contentType?.toLowerCase().startsWith("image/") ||
              /\.(png|jpe?g|gif|webp)$/i.test(entry.path),
          )
          .slice(0, 4)
          .map((entry) => entry.path),
        attachments,
        ...(context ? { context } : {}),
        locale: locale !== "en" ? locale : null,
        execution: selectedExecution ? { ...selectedExecution } : null,
        executionTarget: getExecutionTargetSnapshot(),
      };
      const entry = pendingPrompts.add(
        authority,
        clientMsgId,
        text,
        conversationId,
        submission,
      );
      if (entry.durable && entry.error === null) await dispatch(entry);
    },
    [
      authority,
      cloudSelection,
      conversationId,
      decoratePrompt,
      dispatch,
      locale,
      webShell,
    ],
  );

  const retrySend = useCallback(
    async (clientMsgId: string): Promise<void> => {
      const entry = pending.find(
        (candidate) => candidate.clientMsgId === clientMsgId,
      );
      if (!entry || !authority) return;
      const retry = pendingPrompts.prepareRetry(authority, clientMsgId);
      if (!retry) return;
      await dispatch(retry);
    },
    [authority, dispatch, pending],
  );
  const dismissSend = useCallback(
    (clientMsgId: string) => {
      if (authority) pendingPrompts.drop(authority, clientMsgId);
    },
    [authority],
  );
  const cancelPending = useCallback(
    async (clientMsgId: string): Promise<boolean> => {
      if (!authority) return false;
      const entry = pendingPrompts.find(authority, clientMsgId);
      if (!entry) return false;
      if (!entry.dispatchId) {
        pendingPrompts.requestCancel(authority, clientMsgId);
        return true;
      }
      const placementOrigin = config.httpOrigin;
      if (!placementOrigin) return false;
      try {
        const canceled = await cancelDispatch({
          httpOrigin: placementOrigin,
          getToken: (options) => getAuthToken(options ?? {}),
          ...browserExecutionCancelArgs(entry.dispatchId),
        });
        if (canceled.state === "canceled") {
          pendingPrompts.acknowledgeTerminal(
            authority,
            clientMsgId,
            entry.dispatchId,
          );
          pendingPrompts.drop(authority, clientMsgId);
        }
        return true;
      } catch {
        return false;
      }
    },
    [authority, config.httpOrigin],
  );
  const cancelTurn = useCallback(
    async (turnId: string): Promise<boolean> => {
      const journalDispatchId = state.records.find(
        (record) =>
          record.kind === "message" &&
          record.role === "user" &&
          record.turnId === turnId &&
          record.clientMsgId?.startsWith("exec:"),
      );
      const dispatchId =
        dispatchByTurnRef.current.get(turnId) ??
        (journalDispatchId?.kind === "message"
          ? journalDispatchId.clientMsgId
          : undefined);
      const placementOrigin = config.httpOrigin;
      if (dispatchId && placementOrigin) {
        try {
          await cancelDispatch({
            httpOrigin: placementOrigin,
            getToken: (options) => getAuthToken(options ?? {}),
            ...browserExecutionCancelArgs(dispatchId),
          });
          return true;
        } catch {
          return false;
        }
      }
      // Compatibility for a turn created before browser placement shipped.
      return store?.cancelTurn(turnId) ?? false;
    },
    [config.httpOrigin, state.records, store],
  );
  const loadOlder = useCallback(() => store?.loadOlder(), [store]);
  const retryConnection = useCallback(() => store?.retry(), [store]);

  return {
    state,
    status: state.status,
    pending,
    send,
    retrySend,
    dismissSend,
    cancelTurn,
    cancelPending,
    loadOlder,
    retryConnection,
  };
};

const friendlySendError = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  return "That didn't send. Try again.";
};

const isAmbiguousTransportFailure = (error: unknown): boolean => {
  if (error instanceof CloudTurnStartClientError) return false;
  if (error instanceof CloudTurnStartTransportError) return true;
  if (error instanceof TypeError) return true;
  if ((error as { data?: unknown })?.data !== undefined) return false;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /network|fetch|connection|socket|timed out|timeout|still starting|failed to reach|load failed/i.test(
    message,
  );
};
