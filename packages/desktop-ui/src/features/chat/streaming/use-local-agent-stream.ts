import { useCallback, useEffect, useRef, useState } from "react";
import { showToast } from "@/ui/toast";
import { resolveAgentNotReadyToast } from "./agent-stream-errors";
import {
  isStellaLimitOrAuthReason,
  resolveStellaProviderErrorToast,
} from "./stella-provider-error-toast";
import { abortPiChat, submitPiChat } from "@/features/chat/pi/pi-chat-store";
import type { ChatContext } from "@/shared/types/electron";
import type { AttachmentRef } from "./chat-types";

type StartChatAttachment = {
  url: string;
  mimeType?: string;
  name?: string;
  previewUrl?: string;
  kind?: AttachmentRef["kind"];
  size?: number;
  path?: string;
};

const attachmentsForStartChat = (
  attachments: AttachmentRef[] | undefined,
): StartChatAttachment[] | undefined => {
  if (!attachments?.length) return undefined;
  const mapped = attachments
    .filter(
      (a): a is AttachmentRef & { url: string } =>
        typeof a.url === "string" && a.url.length > 0,
    )
    .map((a) => {
      const item: StartChatAttachment = { url: a.url };
      if (a.mimeType) item.mimeType = a.mimeType;
      if (a.name) item.name = a.name;
      if (a.previewUrl) item.previewUrl = a.previewUrl;
      if (a.kind) item.kind = a.kind;
      if (typeof a.size === "number") item.size = a.size;
      if (a.path) item.path = a.path;
      return item;
    });
  return mapped.length ? mapped : undefined;
};

export type LocalAgentStartArgs = {
  userPrompt: string;
  selectedText?: string | null;
  chatContext?: ChatContext | null;
  deviceId?: string;
  platform?: string;
  timezone?: string;
  locale?: string;
  mode?: string;
  messageMetadata?: Record<string, unknown>;
  attachments?: AttachmentRef[];
  userMessageEventId?: string;
  userMessageTimestamp?: number;
  onUserMessageAccepted?: (userMessageId: string) => void;
  onStartFailed?: () => void;
};

type LocalAgentStreamOptions = {
  activeConversationId: string | null;
  storageMode?: "cloud" | "local";
};

/**
 * Sends the composer's message to the conversation's harness. Its timeline
 * and run state come from the pi chat store, keyed by the request id; the
 * runtime prepares the rest of the send (attachments, chat context).
 */
export function useLocalAgentStream({
  activeConversationId,
  storageMode,
}: LocalAgentStreamOptions) {
  const [pendingUserMessageId, setPendingUserMessageId] = useState<
    string | null
  >(null);
  const startAttemptRef = useRef(0);
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setPendingUserMessageId(null);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [activeConversationId]);
  const startStream = useCallback(
    async (args: LocalAgentStartArgs): Promise<boolean> => {
      if (!activeConversationId || !window.electronAPI) {
        args.onStartFailed?.();
        return false;
      }
      if (args.userMessageEventId && args.mode !== "follow_up") {
        setPendingUserMessageId(args.userMessageEventId);
      }
      const attemptId = ++startAttemptRef.current;
      const startChatAttachments = attachmentsForStartChat(args.attachments);
      // The composer's attached images/files already travel as
      // `attachments` — shipping them again inside chatContext doubles a
      // potentially huge base64 payload across the IPC bridge for fields
      // the runtime never reads (it only consumes windowScreenshot,
      // window/AX, selection, and pasted text from chatContext).
      const startChatContext = args.chatContext
        ? {
            ...args.chatContext,
            regionScreenshots: undefined,
            files: undefined,
          }
        : args.chatContext;
      try {
        await Promise.resolve();
        if (attemptId !== startAttemptRef.current) {
          return false;
        }
        const placed = await submitPiChat(
          activeConversationId,
          args.userMessageEventId || crypto.randomUUID(),
          args.userPrompt ?? "",
          {
            ...(typeof args.selectedText !== "undefined"
              ? { selectedText: args.selectedText }
              : {}),
            ...(startChatContext ? { chatContext: startChatContext } : {}),
            ...(startChatAttachments?.length
              ? { attachments: startChatAttachments }
              : {}),
            deviceId: args.deviceId,
            platform: args.platform,
            timezone: args.timezone,
            ...(args.locale ? { locale: args.locale } : {}),
            mode: args.mode,
            ...(args.messageMetadata
              ? { messageMetadata: args.messageMetadata }
              : {}),
            // Where the conversation's Stella runs takes the send; its turn
            // comes back through the conversation's journal.
            ...(storageMode ? { storageMode } : {}),
          },
        );
        // The cloud journals a placed message under its dispatch id.
        if (
          placed &&
          args.userMessageEventId &&
          placed.userMessageId !== args.userMessageEventId
        ) {
          args.onUserMessageAccepted?.(placed.userMessageId);
          setPendingUserMessageId((current) =>
            current === args.userMessageEventId
              ? placed.userMessageId
              : current,
          );
        }
        return true;
      } catch (error) {
        const message = (error as Error).message;
        console.error("Failed to start local agent chat:", message);
        if (args.userMessageEventId) {
          setPendingUserMessageId((current) =>
            current === args.userMessageEventId ? null : current,
          );
        }
        const reason = message || null;
        // A queued / follow-up message whose start fails because the user hit
        // an anonymous cap or usage/auth limit must show the same actionable
        // sign-in or connect-a-provider notice as the live send path — not the
        // generic "Stella is still starting up". `resolveAgentNotReadyToast`
        // only understands local startup hiccups, so route real backend
        // limit/auth reasons through the provider-error resolver (which
        // carries the Sign in / Upgrade / BYOK CTAs).
        if (isStellaLimitOrAuthReason(reason)) {
          showToast(resolveStellaProviderErrorToast(reason));
        } else {
          const toast = resolveAgentNotReadyToast(reason);
          showToast({
            title: toast.title,
            description: toast.description || reason || "Please try again.",
            variant: "error",
          });
        }
        args.onStartFailed?.();
        return false;
      }
    },
    [activeConversationId, storageMode],
  );
  const cancelCurrentStream = useCallback(() => {
    // The runtime stops the conversation's run, and what it placed
    // elsewhere for it, by its exact dispatch.
    if (activeConversationId) abortPiChat(activeConversationId);
  }, [activeConversationId]);
  return {
    pendingUserMessageId,
    setPendingUserMessageId,
    startStream,
    cancelCurrentStream,
  };
}
