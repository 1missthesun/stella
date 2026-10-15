import {
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import type { MessageRecord } from "@stella/contracts/local-chat";
import type {
  CompanionMessagePreview,
  CompanionState,
} from "@stella/contracts/desktop/companion";
import { useChatMessages } from "@/context/use-chat-messages";
import { useChatRuntime } from "@/context/use-chat-runtime";
import { countActiveTopLevelActivityWorkUnits } from "@/features/chat/lib/event-transforms";
import { getWorkingIndicatorCharacterState } from "@/features/chat/working-indicator-state";
import { stripMarkdownForTts } from "@/features/voice/services/read-aloud/markdown-strip";
import { readAloudPrefStore } from "@/features/voice/services/read-aloud/read-aloud-pref";
import {
  isReadAloudPlaying,
  subscribeReadAloudPlaying,
} from "@/features/voice/services/read-aloud/read-aloud-player";
import { useCompanionVisible } from "./use-companion-window";

const PUBLISH_THROTTLE_MS = 80;
const USER_PREVIEW_MAX_CHARS = 400;
const ASSISTANT_PREVIEW_MAX_CHARS = 700;

type MessagePayload = {
  text?: unknown;
  originUserMessageId?: unknown;
  userMessageId?: unknown;
  metadata?: {
    ui?: { visibility?: unknown };
    runtime?: { isStreaming?: unknown };
  };
};

const lastPlainPreview = new Map<number, { raw: string; preview: string }>();

const toPlainPreview = (raw: string, maxChars: number): string => {
  const cached = lastPlainPreview.get(maxChars);
  if (cached?.raw === raw) return cached.preview;
  const plain = stripMarkdownForTts(raw).replace(/\s+/g, " ").trim();
  const preview =
    plain.length > maxChars ? `${plain.slice(0, maxChars).trimEnd()}…` : plain;
  lastPlainPreview.set(maxChars, { raw, preview });
  return preview;
};

const latestUserPreview = (
  messages: readonly MessageRecord[],
): CompanionMessagePreview | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.type !== "user_message") continue;
    const payload = (message.payload ?? {}) as MessagePayload;
    if (payload.metadata?.ui?.visibility === "hidden") continue;
    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    if (!text) continue;
    const plain = toPlainPreview(text, USER_PREVIEW_MAX_CHARS);
    if (!plain) continue;
    const originId =
      typeof payload.originUserMessageId === "string"
        ? payload.originUserMessageId
        : undefined;
    return {
      id: message._id,
      text: plain,
      at: message.timestamp,
      ...(originId ? { originId } : {}),
    };
  }
  return null;
};

const latestAssistantPreview = (
  messages: readonly MessageRecord[],
): (CompanionMessagePreview & { streaming: boolean }) | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.type !== "assistant_message") continue;
    const payload = (message.payload ?? {}) as MessagePayload;
    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    const streaming = payload.metadata?.runtime?.isStreaming === true;
    if (!text && !streaming) continue;
    const replyTo =
      typeof payload.userMessageId === "string"
        ? payload.userMessageId
        : undefined;
    return {
      id: message._id,
      text: text ? toPlainPreview(text, ASSISTANT_PREVIEW_MAX_CHARS) : "",
      at: message.timestamp,
      streaming,
      ...(replyTo ? { replyTo } : {}),
    };
  }
  return null;
};

export function useCompanionBridge(conversationId: string | null): void {
  const api = window.electronAPI?.companion;
  const messages = useChatMessages();
  const { conversation } = useChatRuntime();
  const {
    tasks,
    isStreaming,
    sendContextlessMessage,
    sendMessageWithContext,
    cancelCurrentStream,
  } = conversation;
  const activeToolName = conversation.streaming.activeToolName ?? null;

  const readAloudEnabled = useSyncExternalStore(
    readAloudPrefStore.subscribe,
    readAloudPrefStore.getSnapshot,
    readAloudPrefStore.getServerSnapshot,
  );

  const companionVisible = useCompanionVisible(false);

  const readAloudPlaying =
    useSyncExternalStore(subscribeReadAloudPlaying, isReadAloudPlaying) &&
    companionVisible &&
    readAloudEnabled;

  const runningAgentCount = useMemo(
    () => countActiveTopLevelActivityWorkUnits(tasks),
    [tasks],
  );
  const latestUser = useMemo(() => latestUserPreview(messages), [messages]);
  const latestAssistant = useMemo(
    () => latestAssistantPreview(messages),
    [messages],
  );

  const snapshot = useMemo<CompanionState>(
    () => ({
      conversationId,
      latestUser,
      latestAssistant,
      isStreaming,
      workState: isStreaming
        ? getWorkingIndicatorCharacterState({
            toolName: activeToolName ?? undefined,
          })
        : null,
      runningAgentCount,
      readAloudPlaying,
    }),
    [
      conversationId,
      latestUser,
      latestAssistant,
      isStreaming,
      activeToolName,
      runningAgentCount,
      readAloudPlaying,
    ],
  );

  const latestRef = useRef(snapshot);
  latestRef.current = snapshot;
  const lastSentRef = useRef<string>("");
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!api) return;
    const serialized = JSON.stringify(snapshot);
    if (serialized === lastSentRef.current) return;
    const publish = () => {
      const current = latestRef.current;
      lastSentRef.current = JSON.stringify(current);
      api.publishState(current);
    };
    if (!lastSentRef.current) {
      publish();
      return;
    }
    if (!companionVisible) return;
    if (timerRef.current !== null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      publish();
    }, PUBLISH_THROTTLE_MS);
  }, [api, companionVisible, snapshot]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!api) return;
    return api.onSendRequested(({ text, attachments }) => {
      const trimmed = typeof text === "string" ? text.trim() : "";
      const metadata = { trigger: { source: "companion" } } as const;
      if (attachments) {
        void sendMessageWithContext(
          trimmed,
          { window: null, ...attachments },
          null,
          undefined,
          metadata,
        );
        return;
      }
      if (!trimmed) return;
      sendContextlessMessage(trimmed, metadata);
    });
  }, [api, sendContextlessMessage, sendMessageWithContext]);

  useEffect(() => {
    if (!api) return;
    return api.onStopRequested(() => {
      cancelCurrentStream();
    });
  }, [api, cancelCurrentStream]);
}

export function CompanionBridge({
  conversationId,
}: {
  conversationId: string | null;
}): null {
  useCompanionBridge(conversationId);
  return null;
}
