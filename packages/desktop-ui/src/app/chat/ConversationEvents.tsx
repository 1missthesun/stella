import type { ChatListBinding } from "@/shell/use-chat-scroll-management";
import { memo, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import type { MessageRecord } from "@stella/contracts/local-chat";
import { useEventRows } from "@/features/chat/hooks/use-event-rows";
import { useThreadActivity } from "@/features/chat/hooks/use-thread-activity";
import { useAgentParents } from "@/features/chat/hooks/use-agent-parents";
import { useDriveAttachmentPreviews } from "@/features/cloud/drive-attachment-previews";
import { ChatTimeline, type LegendContentStyle } from "./ChatTimeline";
import type { InlineWorkingIndicatorMountProps } from "./InlineWorkingIndicator";
import type { QueuedUserMessage } from "@/features/chat/hooks/use-streaming-chat";
import {
  messageArrivedAt,
  recordMessageArrival,
  recordPresentMessage,
} from "@/features/chat/lib/message-entry-animation-state";
import type { EventRowViewModel } from "@/features/chat/conversation-row-types";

type Props = {
  messages: MessageRecord[];
  conversationId?: string | null;
  maxItems?: number;
  pendingUserMessageId?: string | null;
  queuedUserMessages?: QueuedUserMessage[];
  onCancelQueued?: (message: QueuedUserMessage) => void;
  indicator?: InlineWorkingIndicatorMountProps;
  hasOlderMessages?: boolean;
  isLoadingOlder?: boolean;
  isLoadingHistory?: boolean;
  list?: ChatListBinding;
  className?: string;
  contentContainerStyle?: LegendContentStyle;
  estimatedItemSize?: number;
  extraTail?: React.ReactNode;
  alignItemsAtEnd?: boolean;
  takesMessageJumps?: boolean;
  onLoadOlder?: () => boolean | void | Promise<boolean>;
};

function useMessageArrivals(
  rows: readonly EventRowViewModel[],
  conversationId: string | null | undefined,
  pendingUserMessageId: string | null | undefined,
): number {
  const [version, bump] = useReducer((current: number) => current + 1, 0);
  const seededConversationRef = useRef<string | null | undefined>(undefined);
  const tailAssistantId = useMemo(() => {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (row?.kind === "assistant") return row.id;
    }
    return null;
  }, [rows]);

  useLayoutEffect(() => {
    let changed = false;
    if (seededConversationRef.current !== conversationId) {
      seededConversationRef.current = conversationId;
      if (tailAssistantId) recordPresentMessage(tailAssistantId);
    } else if (tailAssistantId) {
      changed = recordMessageArrival(tailAssistantId);
    }
    if (pendingUserMessageId) {
      changed = recordMessageArrival(pendingUserMessageId) || changed;
    }
    if (changed) bump();
  }, [conversationId, pendingUserMessageId, tailAssistantId]);
  return version;
}

const withArrival = (row: EventRowViewModel): EventRowViewModel => {
  if (row.kind !== "user" && row.kind !== "assistant") return row;
  const arrivedAt = messageArrivedAt(row.id);
  return arrivedAt === undefined ? row : { ...row, arrivedAt };
};

export const ConversationEvents = memo(function ConversationEvents({
  messages,
  conversationId,
  maxItems,
  pendingUserMessageId,
  queuedUserMessages,
  onCancelQueued,
  indicator,
  hasOlderMessages,
  isLoadingOlder,
  isLoadingHistory,
  list,
  className,
  contentContainerStyle,
  estimatedItemSize,
  extraTail,
  alignItemsAtEnd,
  takesMessageJumps,
  onLoadOlder,
}: Props) {
  const activity = useThreadActivity(conversationId);
  const agentTitlesKey = activity.records
    .map((record) => `${record.threadId}\u001f${record.description ?? ""}`)
    .join("\u001e");
  const agentTitles = useMemo(() => {
    const titles = new Map<string, string>();
    if (!agentTitlesKey) return titles;
    for (const entry of agentTitlesKey.split("\u001e")) {
      const [threadId, title] = entry.split("\u001f");
      if (threadId && title) titles.set(threadId, title);
    }
    return titles;
  }, [agentTitlesKey]);
  const agentParents = useAgentParents(conversationId, activity.records);
  const presentedMessages = useDriveAttachmentPreviews(messages);
  const { rows: projectedRows } = useEventRows({
    messages: presentedMessages,
    maxItems,
    agentTitles,
    agentParents,
  });

  const arrivalVersion = useMessageArrivals(
    projectedRows,
    conversationId,
    pendingUserMessageId,
  );
  const rows = useMemo(() => {
    void arrivalVersion;
    let changed = false;
    const next = projectedRows.map((row) => {
      const annotated = withArrival(row);
      if (annotated !== row) changed = true;
      return annotated;
    });
    return changed ? next : projectedRows;
  }, [arrivalVersion, projectedRows]);

  return (
    <ChatTimeline
      rows={rows}
      conversationId={conversationId}
      hasOlderEvents={hasOlderMessages}
      isLoadingOlder={isLoadingOlder}
      isLoadingHistory={isLoadingHistory}
      queuedUserMessages={queuedUserMessages}
      onCancelQueued={onCancelQueued}
      indicator={indicator}
      list={list}
      className={className}
      contentContainerStyle={contentContainerStyle}
      estimatedItemSize={estimatedItemSize}
      extraTail={extraTail}
      alignItemsAtEnd={alignItemsAtEnd}
      takesMessageJumps={takesMessageJumps}
      onLoadOlder={onLoadOlder}
    />
  );
});
