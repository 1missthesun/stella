import { useRef } from "react";
import type { MessageRecord } from "@stella/contracts/local-chat";

export function useDeferredChatMessages(
  messages: MessageRecord[],
  deferUpdates: boolean,
  scopeKey?: string | null,
): MessageRecord[] {
  const paintedMessagesRef = useRef(messages);
  const scopeKeyRef = useRef(scopeKey);
  if (scopeKeyRef.current !== scopeKey) {
    scopeKeyRef.current = scopeKey;
    paintedMessagesRef.current = messages;
  } else if (!deferUpdates) {
    paintedMessagesRef.current = messages;
  }
  return deferUpdates ? paintedMessagesRef.current : messages;
}
