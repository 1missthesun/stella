import {
  isUiDisplayableChatEvent,
} from "@stella/contracts/chat-event-visibility";

type ChatEventLike = Parameters<typeof isUiDisplayableChatEvent>[0];

export function filterMessagesForUiDisplay<T extends ChatEventLike>(
  messages: readonly T[],
): T[] {
  return messages.filter((message) => isUiDisplayableChatEvent(message));
}
