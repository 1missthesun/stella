import { placeUnrecordedRows, type ChatRowPlace } from "@stella/contracts/chat-placement";
import type { MessageRecord } from "@stella/contracts/local-chat";

export const assistantOwnerId = (message: MessageRecord): string | undefined => {
  if (message.type !== "assistant_message") return undefined;
  const owner = message.payload?.userMessageId;
  return typeof owner === "string" && owner.length > 0 ? owner : undefined;
};

const keepsItsPlace = (message: MessageRecord): boolean =>
  message.type === "assistant_message" || message.payload?.sendFailed !== undefined;

const placeOf =
  (beforeIds: ReadonlyMap<string, string> | undefined) =>
  (message: MessageRecord): ChatRowPlace => {
    const ownerId = assistantOwnerId(message);
    const sentAfter = message.payload?.sentAfterSequence;
    const beforeId = beforeIds?.get(message._id);
    return {
      id: message._id,
      ...(ownerId ? { ownerId } : {}),
      ...(message.sequence !== undefined ? { sequence: message.sequence } : {}),
      ...(typeof sentAfter === "number" && keepsItsPlace(message)
        ? { afterSequence: sentAfter }
        : {}),
      ...(beforeId ? { beforeId } : {}),
    };
  };

export const placeInConversation = (
  recorded: readonly MessageRecord[],
  unrecorded: readonly MessageRecord[],
  beforeIds?: ReadonlyMap<string, string>,
): MessageRecord[] => placeUnrecordedRows(recorded, unrecorded, placeOf(beforeIds));

export const newestSequence = (messages: readonly MessageRecord[]): number | undefined => {
  let newest: number | undefined;
  for (const { sequence } of messages) {
    if (sequence !== undefined && (newest === undefined || sequence > newest)) newest = sequence;
  }
  return newest;
};
