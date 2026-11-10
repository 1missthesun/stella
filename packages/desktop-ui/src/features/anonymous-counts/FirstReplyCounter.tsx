import { useEffect } from "react";
import type { MessageRecord } from "@stella/contracts/local-chat";
import { isUiHiddenChatMessagePayload } from "@stella/contracts/chat-event-visibility";
import { useChatMessages } from "@/context/use-chat-messages";
import { uiState } from "@/platform/ui-state";
import { recordAnonymousCount } from "./record-anonymous-count";

const COUNTED_KEY = "stella:anonymous-counts:first-reply";

const visibleText = (message: MessageRecord): boolean => {
  if (isUiHiddenChatMessagePayload(message.payload ?? null)) return false;
  const text = (message.payload as { text?: unknown } | undefined)?.text;
  return typeof text === "string" && text.trim().length > 0;
};

/** A visible reply that came after something the user sent. */
const hasAnsweredMessage = (messages: readonly MessageRecord[]): boolean => {
  let firstOwnAt: number | null = null;
  for (const message of messages) {
    if (!visibleText(message)) continue;
    if (message.type === "user_message") {
      firstOwnAt = firstOwnAt === null ? message.timestamp : Math.min(firstOwnAt, message.timestamp);
    }
  }
  if (firstOwnAt === null) return false;
  return messages.some(
    (message) =>
      message.type === "assistant_message" &&
      message.timestamp >= firstOwnAt &&
      visibleText(message),
  );
};

/** Sends the anonymous "first successful reply" count once per install. */
export function FirstReplyCounter() {
  const messages = useChatMessages();
  useEffect(() => {
    if (uiState.getItem(COUNTED_KEY) === "1") return;
    if (!hasAnsweredMessage(messages)) return;
    uiState.setItem(COUNTED_KEY, "1");
    recordAnonymousCount({ type: "first_reply" });
  }, [messages]);
  return null;
}
