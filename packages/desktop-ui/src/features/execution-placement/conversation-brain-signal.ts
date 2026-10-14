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
