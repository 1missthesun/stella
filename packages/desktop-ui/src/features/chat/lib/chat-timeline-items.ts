import type { EventRowViewModel } from "@/features/chat/conversation-row-types";
import type { QueuedUserMessage } from "@/features/chat/hooks/queued-user-messages";
import { eventRowRendersContent } from "@/features/chat/lib/assistant-row-content";
import type { UserAskRecord } from "@stella/contracts/user-ask-deck";

export type ChatTimelineItem =
  | {
      id: string;
      type: "message";
      row: EventRowViewModel;
    }
  | {
      id: "chat-timeline:working-indicator";
      type: "working-indicator";
    }
  | {
      id: string;
      type: "ask-record";
      record: UserAskRecord;
    }
  | {
      id: string;
      type: "queued-users";
      messages: QueuedUserMessage[];
    };

const askRecordSignature = (record: UserAskRecord): string =>
  record.answers.map((answer) => answer.question).join("\u0000");

export const buildChatTimelineItems = (args: {
  rows: EventRowViewModel[];
  queuedUserMessages: readonly QueuedUserMessage[];
  includeWorkingIndicator: boolean;
  askRecords?: readonly UserAskRecord[];
}): ChatTimelineItem[] => {
  const items: ChatTimelineItem[] = [];
  const messageIds = new Set<string>();
  const shownRecords = new Set<string>();

  for (const row of args.rows) {
    if (!eventRowRendersContent(row)) continue;
    messageIds.add(row.id);
    items.push({ id: row.id, type: "message", row });
    if (row.kind === "assistant") {
      for (const record of row.askRecords ?? []) {
        shownRecords.add(record.toolCallId ?? record.id);
        shownRecords.add(askRecordSignature(record));
      }
    }
  }

  for (const record of args.askRecords ?? []) {
    if (
      shownRecords.has(record.toolCallId ?? record.id) ||
      shownRecords.has(askRecordSignature(record))
    ) {
      continue;
    }
    const before = items.findIndex(
      (item) =>
        item.type === "message" &&
        (item.row.timestampMs ?? Number.POSITIVE_INFINITY) > record.createdAt,
    );
    const recordItem: ChatTimelineItem = {
      id: `chat-timeline:ask-record:${record.id}`,
      type: "ask-record",
      record,
    };
    if (before < 0) items.push(recordItem);
    else items.splice(before, 0, recordItem);
  }


  if (args.includeWorkingIndicator) {
    items.push({
      id: "chat-timeline:working-indicator",
      type: "working-indicator",
    });
  }

  const queued = args.queuedUserMessages
    .map((message, insertionIndex) => ({ message, insertionIndex }))
    .sort(
      (left, right) =>
        left.message.queueOrder - right.message.queueOrder ||
        left.insertionIndex - right.insertionIndex,
    );
  const visibleQueued: QueuedUserMessage[] = [];
  for (const { message } of queued) {
    if (!messageIds.has(message.id)) visibleQueued.push(message);
  }
  if (visibleQueued.length > 0) {
    items.push({
      id: visibleQueued[0]!.id,
      type: "queued-users",
      messages: visibleQueued,
    });
  }

  return items;
};
