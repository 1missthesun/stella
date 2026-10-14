import { isUiHiddenChatMessagePayload } from "./chat-event-visibility.js";

type GroupableEvent = {
  type: string;
  payload?: Record<string, unknown>;
};

export const groupChatTurns = <
  E extends GroupableEvent,
  M extends { toolEvents: E[] },
>(
  events: readonly E[],
  toMessage: (event: E) => M,
  isTurnDecoration: (event: E) => boolean = () => true,
): { messages: M[]; visibleMessageCount: number } => {
  const messages: M[] = [];
  let turnUserMessage: M | null = null;
  let currentAssistant: M | null = null;
  let pendingPreAssistantTools: E[] = [];
  let visibleMessageCount = 0;

  const finalizePreAssistantTools = () => {
    if (pendingPreAssistantTools.length > 0 && turnUserMessage) {
      turnUserMessage.toolEvents = [
        ...turnUserMessage.toolEvents,
        ...pendingPreAssistantTools,
      ];
    }
    pendingPreAssistantTools = [];
  };

  for (const event of events) {
    if (event.type === "user_message") {
      finalizePreAssistantTools();
      const message = toMessage(event);
      messages.push(message);
      turnUserMessage = message;
      currentAssistant = null;
      if (!isUiHiddenChatMessagePayload(event.payload ?? null)) {
        visibleMessageCount += 1;
      }
      continue;
    }
    if (event.type === "assistant_message") {
      const message = toMessage(event);
      messages.push(message);
      const hidden = isUiHiddenChatMessagePayload(event.payload ?? null);
      if (!hidden && pendingPreAssistantTools.length > 0) {
        message.toolEvents = [...message.toolEvents, ...pendingPreAssistantTools];
        pendingPreAssistantTools = [];
      }
      if (!hidden) {
        currentAssistant = message;
        visibleMessageCount += 1;
      }
      continue;
    }
    if (!isTurnDecoration(event)) continue;
    if (currentAssistant) {
      currentAssistant.toolEvents = [...currentAssistant.toolEvents, event];
    } else {
      pendingPreAssistantTools.push(event);
    }
  }

  finalizePreAssistantTools();
  return { messages, visibleMessageCount };
};
