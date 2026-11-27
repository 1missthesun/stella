import type { ChatListBinding } from "@/shell/use-chat-scroll-management";
import { memo, useEffect, useMemo, useRef } from "react";
import type { MessageRecord } from "@stella/contracts/local-chat";
import { useEventRows } from "@/features/chat/hooks/use-event-rows";
import { useThreadActivity } from "@/features/chat/hooks/use-thread-activity";
import { useAgentParents } from "@/features/chat/hooks/use-agent-parents";
import { useDriveAttachmentPreviews } from "@/features/cloud/drive-attachment-previews";
import { ChatTimeline, type LegendContentStyle } from "./ChatTimeline";
import { publishRelayedAgents } from "@/features/app-source/app-source-store";
import type { InlineWorkingIndicatorMountProps } from "./InlineWorkingIndicator";
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
): void {
  const seededConversationRef = useRef<string | null | undefined>(undefined);
  const tailAssistantId = useMemo(() => {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (row?.kind === "assistant") return row.id;
    }
    return null;
  }, [rows]);

  // Recorded while rendering, so a message's first frame already carries its entrance rather
  // than gaining it a commit later. The writes are idempotent. A conversation is seeded once its
  // rows exist, so what it opens with (a welcome included) is present, not arriving.
  if (seededConversationRef.current !== conversationId) {
    if (rows.length > 0) {
      seededConversationRef.current = conversationId;
      if (tailAssistantId) recordPresentMessage(tailAssistantId);
    }
  } else if (tailAssistantId) {
    recordMessageArrival(tailAssistantId);
  }
  if (pendingUserMessageId) recordMessageArrival(pendingUserMessageId);
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

  const relayedKey = useMemo(
    () =>
      projectedRows
        .flatMap((row) =>
          row.kind === "assistant"
            ? (row.agentCompletion?.sections.map((section) => section.agentId) ?? [])
            : [],
        )
        .join("\n"),
    [projectedRows],
  );
  useEffect(() => {
    if (conversationId) {
      publishRelayedAgents(conversationId, relayedKey ? relayedKey.split("\n") : []);
    }
  }, [conversationId, relayedKey]);

  useMessageArrivals(projectedRows, conversationId, pendingUserMessageId);
  const rows = useMemo(() => {
    void pendingUserMessageId;
    let changed = false;
    const next = projectedRows.map((row) => {
      const annotated = withArrival(row);
      if (annotated !== row) changed = true;
      return annotated;
    });
    return changed ? next : projectedRows;
  }, [pendingUserMessageId, projectedRows]);

  return (
    <ChatTimeline
      rows={rows}
      conversationId={conversationId}
      hasOlderEvents={hasOlderMessages}
      isLoadingOlder={isLoadingOlder}
      isLoadingHistory={isLoadingHistory}
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
