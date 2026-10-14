export type MessageJump = {
  conversationId: string;
  messageIds: readonly string[];
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
