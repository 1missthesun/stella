import { useCallback, useEffect, useRef, useState } from "react";
import { getPlatform } from "@/platform/electron/platform";
import { useChatStore } from "@/context/chat-store-context";
import { getOrCreateDeviceId } from "@/platform/electron/device-id";
import type { SendMessageArgs } from "../streaming/chat-types";
import type { MessageMetadata } from "@/features/chat/lib/event-transforms";
import type { EventRecord } from "@/features/chat/lib/event-transforms";
import type { MessageRecord } from "@stella/contracts/local-chat";
import { resolveComposerContextState } from "../composer-context";
import {
  buildAllLocalAttachments,
  toDisplayAttachments,
} from "../streaming/message-context";
import { toPastedTextDescriptor } from "../lib/paste-context";
import { rememberSentAttachmentPreviews } from "@/features/cloud/drive-attachment-previews";
import { getComposerAppSelections } from "../composer-context";
import { useLocalAgentStream } from "../streaming/use-local-agent-stream";
import { acceptedUserMessageIds } from "../lib/accepted-user-message-ids";
import { onPiChatEvents } from "@/features/chat/pi/pi-chat-store";
import { showToast } from "@/ui/toast";
import { expandShowCaptures } from "@/features/show-stella/use-show-stella";
import {
  clearHeldSend,
  dismissHeldSendNotice,
  holdSend,
  retryHeldSend,
} from "@/features/chat/held-send";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";

type UseStreamingChatOptions = {
  conversationId: string | null;
  locale: string;
  notifyTierRestrictedModel?: () => void | Promise<void>;
  persistedMessages: MessageRecord[];
};

const createLocalMessageId = () => `local-${crypto.randomUUID()}`;

const QUOTED_TEXT_PREVIEW_MAX_CHARS = 4_000;

export const buildContextMessageMetadata = (
  chatContext: SendMessageArgs["chatContext"],
  selectedText: SendMessageArgs["selectedText"],
  base?: MessageMetadata,
): MessageMetadata | undefined => {
  const appSelectionLabels = getComposerAppSelections(chatContext)
    .map((selection) => selection.label?.trim() ?? "")
    .filter((label) => label.length > 0);
  // Joined singular kept for legacy single-slot consumers.
  const appSelectionLabel =
    appSelectionLabels.length > 0 ? appSelectionLabels.join(", ") : undefined;
  const activityLabel = chatContext?.activity?.label?.trim();
  const pastedTexts = (chatContext?.pastedTexts ?? [])
    .map((text) => text?.trim() ?? "")
    .filter((text) => text.length > 0)
    .map(toPastedTextDescriptor);
  const quotedSource =
    selectedText?.trim() || chatContext?.selectedText?.trim() || "";
  const quotedText = quotedSource
    ? quotedSource.slice(0, QUOTED_TEXT_PREVIEW_MAX_CHARS)
    : undefined;
  if (
    !appSelectionLabel &&
    !activityLabel &&
    pastedTexts.length === 0 &&
    !quotedText
  ) {
    return base;
  }

  return {
    ...(base ?? {}),
    context: {
      ...(base?.context ?? {}),
      ...(appSelectionLabel ? { appSelectionLabel } : {}),
      ...(appSelectionLabels.length > 0 ? { appSelectionLabels } : {}),
      ...(activityLabel ? { activityLabel } : {}),
      ...(pastedTexts.length > 0 ? { pastedTexts } : {}),
      ...(quotedText ? { quotedText } : {}),
    },
  };
};

// Mirrors the runtime's persisted user_message text (the trimmed prompt only;
// quoted text travels in metadata), so the pending bubble matches the
// confirmed one, including image-only sends with no text.
const visibleUserMessageText = (userPrompt: string): string => userPrompt.trim();

const buildOptimisticUserEvent = (args: {
  id: string;
  text: string;
  timestamp: number;
  platform?: string;
  timezone?: string;
  locale?: string;
  metadata?: SendMessageArgs["metadata"];
  attachments: ReturnType<typeof buildAllLocalAttachments>;
  mode?: string;
}): EventRecord => ({
  _id: args.id,
  type: "user_message",
  timestamp: args.timestamp,
  payload: {
    text: args.text,
    ...(args.attachments.length ? { attachments: args.attachments } : {}),
    ...(args.platform ? { platform: args.platform } : {}),
    ...(args.timezone ? { timezone: args.timezone } : {}),
    ...(args.locale ? { locale: args.locale } : {}),
    ...(args.metadata ? { metadata: args.metadata } : {}),
    ...(args.mode ? { mode: args.mode } : {}),
  },
});

export function useStreamingChatCore({
  conversationId,
  locale,
  notifyTierRestrictedModel,
  persistedMessages,
}: UseStreamingChatOptions) {
  const activeConversationId = conversationId;
  const [optimisticEvents, setOptimisticEvents] = useState<EventRecord[]>([]);
  const pendingSendRef = useRef<symbol | null>(null);
  const [isSending, setIsSending] = useState(false);
  const activeConversationIdRef = useRef(activeConversationId);
  activeConversationIdRef.current = activeConversationId;
  const { isLocalStorage, storageMode } = useChatStore();

  const reconcileAcceptedUserMessage = useCallback(
    (optimisticId: string, acceptedId: string) => {
      if (optimisticId === acceptedId) return;
      setOptimisticEvents((current) =>
        current.map((event) =>
          event._id === optimisticId ? { ...event, _id: acceptedId } : event,
        ),
      );
    },
    [],
  );

  const {
    pendingUserMessageId,
    setPendingUserMessageId,
    startStream,
    cancelCurrentStream,
  } = useLocalAgentStream({
    activeConversationId,
    storageMode,
  });

  useEffect(() => {
    pendingSendRef.current = null;
    setIsSending(false);
    setOptimisticEvents([]);
    setPendingUserMessageId(null);
  }, [activeConversationId, setPendingUserMessageId]);

  const clearOptimisticMessage = useCallback(
    (messageId: string) => {
      setOptimisticEvents((current) =>
        current.filter((event) => event._id !== messageId),
      );
      setPendingUserMessageId((current) =>
        current === messageId ? null : current,
      );
    },
    [setPendingUserMessageId],
  );

  useEffect(() => {
    if (!activeConversationId) return;
    return onPiChatEvents(({ conversationId, events }) => {
      if (conversationId !== activeConversationId) return;
      for (const event of events) {
        if (event.type === "send_moved") {
          reconcileAcceptedUserMessage(event.requestId, event.userMessageId);
          setPendingUserMessageId((current) =>
            current === event.requestId ? event.userMessageId : current,
          );
          continue;
        }
        if (event.type !== "send_failed") continue;
        clearOptimisticMessage(event.requestId);
        showToast({
          title: "Message not delivered",
          description: event.message,
          variant: "error",
        });
      }
    });
  }, [
    activeConversationId,
    clearOptimisticMessage,
    reconcileAcceptedUserMessage,
    setPendingUserMessageId,
  ]);

  useEffect(() => {
    if (!pendingUserMessageId) return;

    const hasAssistantReply = persistedMessages.some((message) => {
      if (message.type !== "assistant_message") return false;
      if (!message.payload || typeof message.payload !== "object") return false;
      const payload = message.payload as { userMessageId?: string };
      return payload.userMessageId === pendingUserMessageId;
    });
    if (hasAssistantReply) {
      setPendingUserMessageId(null);
    }
  }, [pendingUserMessageId, persistedMessages, setPendingUserMessageId]);

  const acknowledgeMessages = useCallback((messages: readonly MessageRecord[]) => {
    const persistedIds = acceptedUserMessageIds(messages);
    setOptimisticEvents((current) => {
      const next = current.filter((event) => !persistedIds.has(event._id));
      return next.length === current.length ? current : next;
    });
  }, []);

  useEffect(() => {
    if (optimisticEvents.length > 0) acknowledgeMessages(persistedMessages);
  }, [acknowledgeMessages, optimisticEvents, persistedMessages]);

  const sendMessageRef = useRef<(sent: SendMessageArgs) => Promise<boolean>>(
    async () => false,
  );

  // A first message that waited for a sign-in or an engine goes out as soon
  // as one arrives.
  const { hasConnectedAccount } = useAuthSessionState();
  const signedInRef = useRef(hasConnectedAccount);
  useEffect(() => {
    const was = signedInRef.current;
    signedInRef.current = hasConnectedAccount;
    if (hasConnectedAccount && !was) {
      void retryHeldSend({ attempts: 8, spacingMs: 1500 });
    }
  }, [hasConnectedAccount]);
  useEffect(() => {
    const onEngineChange = () => void retryHeldSend({ attempts: 2 });
    window.addEventListener("stella:local-model-preferences-changed", onEngineChange);
    return () =>
      window.removeEventListener("stella:local-model-preferences-changed", onEngineChange);
  }, []);

  const sendMessage = useCallback(
    async (sent: SendMessageArgs) => {
      const options: SendMessageArgs = {
        ...sent,
        chatContext: expandShowCaptures(sent.chatContext),
      };
      const resolvedConversationId = activeConversationId;
      const cleanedText = options.text.trim();
      const contextState = resolveComposerContextState(
        options.chatContext,
        options.selectedText,
      );
      const hasAttachments = Boolean(
        options.chatContext?.regionScreenshots?.length ||
        options.chatContext?.files?.length,
      );

      if (
        !resolvedConversationId ||
        activeConversationIdRef.current !== resolvedConversationId ||
        (!cleanedText && !contextState.hasSubmittableContext)
      ) {
        return false;
      }
      if (pendingSendRef.current) {
        return false;
      }

      const sendAttempt = Symbol("composer-send");
      pendingSendRef.current = sendAttempt;
      setIsSending(true);

      const attachments =
        isLocalStorage && hasAttachments
          ? buildAllLocalAttachments(options.chatContext)
          : [];
      const messageMetadata = buildContextMessageMetadata(
        options.chatContext,
        options.selectedText,
        options.metadata,
      );
      const platform = getPlatform();
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const requestLocale = locale;
      const optimisticUserMessageId = createLocalMessageId();
      const optimisticText = visibleUserMessageText(cleanedText);

      const messageTimestamp = Date.now();
      const optimisticEvent = buildOptimisticUserEvent({
        id: optimisticUserMessageId,
        text: optimisticText,
        timestamp: messageTimestamp,
        platform,
        timezone,
        locale: requestLocale,
        ...(messageMetadata ? { metadata: messageMetadata } : {}),
        attachments: toDisplayAttachments(attachments),
      });

      rememberSentAttachmentPreviews(
        optimisticUserMessageId,
        toDisplayAttachments(attachments),
      );
      setOptimisticEvents((current) => [...current, optimisticEvent]);
      setPendingUserMessageId(optimisticUserMessageId);
      options.onClear();
      options.onOptimisticStart?.();

      let needsEngine = false;
      try {
        const deviceId = await getOrCreateDeviceId();
        const accepted = await startStream({
          userPrompt: cleanedText,
          selectedText: options.selectedText,
          chatContext: options.chatContext,
          deviceId,
          platform,
          timezone,
          locale: requestLocale,
          ...(messageMetadata ? { messageMetadata } : {}),
          attachments,
          userMessageEventId: optimisticUserMessageId,
          onUserMessageAccepted: (acceptedId: string) =>
            reconcileAcceptedUserMessage(optimisticUserMessageId, acceptedId),
          userMessageTimestamp: messageTimestamp,
          onNeedsEngine: () => {
            needsEngine = true;
          },
        });
        if (!accepted && needsEngine) {
          holdSend({
            conversationId: resolvedConversationId,
            retry: () => sendMessageRef.current(sent),
          });
          // Signed in here, but the runtime hasn't taken the sign-in yet
          // (Stella just started): nothing else will send it again.
          if (signedInRef.current) void retryHeldSend({ attempts: 8, spacingMs: 1500 });
        } else {
          clearHeldSend();
          if (accepted) dismissHeldSendNotice();
        }
        if (!accepted) {
          clearOptimisticMessage(optimisticUserMessageId);
          options.onRestore?.();
          return false;
        }

        void notifyTierRestrictedModel?.();

        console.log(
          `[stella:trace] sendMessage (steer) | textLength=${cleanedText.length}`,
        );
        return true;
      } catch (error) {
        clearOptimisticMessage(optimisticUserMessageId);
        options.onRestore?.();
        console.error(
          "Failed to prepare local agent chat:",
          error instanceof Error ? error.message : String(error),
        );
        return false;
      } finally {
        if (pendingSendRef.current === sendAttempt) {
          pendingSendRef.current = null;
          setIsSending(false);
        }
      }
    },
    [
      activeConversationId,
      isLocalStorage,
      clearOptimisticMessage,
      notifyTierRestrictedModel,
      startStream,
      reconcileAcceptedUserMessage,
      locale,
      setPendingUserMessageId,
    ],
  );

  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  return {
    optimisticEvents,
    acknowledgeMessages,
    isSending,
    pendingUserMessageId,
    sendMessage,
    cancelCurrentStream,
  };
}
