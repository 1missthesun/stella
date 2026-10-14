const SIGNAL_DELAY_MS = 300;

const pending = new Map<string, ReturnType<typeof setTimeout>>();

export const conversationJournalAdvanced = (conversationId: string): void => {
  const chat =
    typeof window === "undefined" ? undefined : window.electronAPI?.piChat;
  if (!chat || pending.has(conversationId)) return;
  pending.set(
    conversationId,
    setTimeout(() => {
      pending.delete(conversationId);
      void chat
        .request({ op: "journal", conversationId })
        .catch(() => undefined);
    }, SIGNAL_DELAY_MS),
  );
};
