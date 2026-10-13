/**
 * Where a cloud conversation's Stella runs changed, as its conversation
 * socket says: a `brain` frame, or a reconnect after which a change may have
 * been missed. `useConversationBrain` reads again on it, so nothing polls.
 */
type Listener = (conversationId: string) => void;

const listeners = new Set<Listener>();

export const onConversationBrainChanged = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const conversationBrainChanged = (conversationId: string): void => {
  for (const listener of [...listeners]) listener(conversationId);
};
