/**
 * This computer's runtime keeps its own copy of a cloud conversation's
 * journal. The app's conversation socket already receives every record, so
 * it tells the runtime when the journal grew (`op: "journal"`) instead of the
 * runtime polling the conversation's history. Records arriving together are
 * sent as one signal: the runtime imports everything new on each.
 */
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
