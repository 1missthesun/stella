import type { JournalMessageRecord } from "@stella/contracts/conversation-protocol";

// A message sent from this client shows first as a pending row keyed by its clientMsgId. The
// journal echoes it under the id the server gave it (the placement dispatch id, `dsp:…`), so
// without this the chat would drop the pending row and insert a new one: the bubble remounts and
// plays its entrance again. When the echo acknowledges the pending send, the journal's id is
// remembered here and the message keeps the client's id for the rest of the session.
const clientIdByJournalId = new Map<string, string>();

const journalUserMessageId = (record: JournalMessageRecord): string =>
  record.clientMsgId ?? `cloud:${record.turnId}:message:${record.seq}`;

export const rememberSentMessageId = (
  record: JournalMessageRecord,
  clientMsgId: string,
): void => {
  const journalId = journalUserMessageId(record);
  if (journalId !== clientMsgId) clientIdByJournalId.set(journalId, clientMsgId);
};

/** The event id of a journal user message: the sending client's id when it was sent here. */
export const userMessageEventId = (record: JournalMessageRecord): string => {
  const journalId = journalUserMessageId(record);
  return clientIdByJournalId.get(journalId) ?? journalId;
};
