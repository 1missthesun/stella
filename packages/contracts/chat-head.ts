const heads = new Map<string, number>();

export const noteChatHead = (conversationId: string, sequence: number): void => {
  if (!Number.isSafeInteger(sequence) || sequence < 0) return;
  heads.set(conversationId, sequence);
};

export const chatHead = (conversationId: string | null | undefined): number | undefined =>
  conversationId ? heads.get(conversationId) : undefined;
