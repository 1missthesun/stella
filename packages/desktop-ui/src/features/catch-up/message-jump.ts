/**
 * A request to bring one message into view in the chat timeline. Catch-up
 * links set it; the timeline showing that conversation takes it, scrolls
 * there (paging older history in when the message is not loaded yet) and
 * clears it.
 */

export type MessageJump = {
  conversationId: string;
  /** Ids the message may go by in the timeline, most specific first. */
  messageIds: readonly string[];
  /** Distinguishes two jumps to the same message. */
  requestId: number;
};

let current: MessageJump | null = null;
let nextRequestId = 1;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

export const requestMessageJump = (
  conversationId: string,
  messageIds: readonly string[],
): void => {
  current = { conversationId, messageIds, requestId: nextRequestId++ };
  emit();
};

export const finishMessageJump = (requestId: number): void => {
  if (current?.requestId !== requestId) return;
  current = null;
  emit();
};

export const subscribeMessageJump = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const readMessageJump = (): MessageJump | null => current;
