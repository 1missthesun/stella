import { ChatRowAnchors } from "@stella/contracts/chat-placement";
import type { EventRowViewModel } from "@/features/chat/conversation-row-types";
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
;

const askRecordAnchors = new ChatRowAnchors();

const askRecordSignature = (record: UserAskRecord): string =>
  record.answers.map((answer) => answer.question).join("\u0000");

export const buildChatTimelineItems = (args: {
  rows: EventRowViewModel[];
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

  const recordItems: ChatTimelineItem[] = [];
  for (const record of args.askRecords ?? []) {
    if (
      shownRecords.has(record.toolCallId ?? record.id) ||
      shownRecords.has(askRecordSignature(record))
    ) {
      continue;
    }
    recordItems.push({
      id: `chat-timeline:ask-record:${record.id}`,
      type: "ask-record",
      record,
    });
  }
  const placed = askRecordAnchors.insert(items, recordItems, (item) => item.id);

  if (args.includeWorkingIndicator) {
    placed.push({
      id: "chat-timeline:working-indicator",
      type: "working-indicator",
    });
  }

  return placed;
};
