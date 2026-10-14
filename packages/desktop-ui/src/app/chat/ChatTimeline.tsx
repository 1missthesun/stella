import type { ChatListBinding } from "@/shell/use-chat-scroll-management";
import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import {
  LegendList,
  type LegendListRenderItemProps,
  type MaintainVisibleContentPositionConfig,
} from "@legendapp/list/react";
import { AssistantMessageRow, UserMessageRow } from "@/app/chat/MessageRow";
import { ChatTimeDivider } from "@/app/chat/ChatTimeDivider";
import { ComposerQueuedMessages } from "./ComposerQueuedMessages";
import {
  InlineWorkingIndicator,
  type InlineWorkingIndicatorMountProps,
} from "./InlineWorkingIndicator";
import {
  createReplyHandoffController,
  ReplyHandoffContext,
} from "./reply-handoff";
import type { QueuedUserMessage } from "@/features/chat/hooks/queued-user-messages";
import {
  buildChatTimelineItems,
  type ChatTimelineItem,
} from "@/features/chat/lib/chat-timeline-items";
import { timestampHeaders } from "@/features/chat/lib/message-time-labels";
import type { EventRowViewModel } from "@/features/chat/conversation-row-types";
import { shownAgentLabelIds } from "@/features/chat/lib/assistant-row-content";
import { LoaderCircle } from "@/ui/icons";
import { UserAskRecordCard } from "@/features/user-ask/UserAskRecordCard";
import { useConversationUserAskRecords } from "@/features/user-ask/user-ask-store";
import { useT } from "@/shared/i18n";
import { showToast } from "@/ui/toast";
import {
  finishMessageJump,
  readMessageJump,
  subscribeMessageJump,
} from "@/features/catch-up/message-jump";

type LegendSummedPadding =
  | "padding"
  | "paddingTop"
  | "paddingRight"
  | "paddingBottom"
  | "paddingLeft";

export type LegendContentStyle = Omit<
  CSSProperties,
  | LegendSummedPadding
  | "paddingBlock"
  | "paddingBlockStart"
  | "paddingBlockEnd"
  | "paddingInline"
  | "paddingInlineStart"
  | "paddingInlineEnd"
> &
  Partial<Record<LegendSummedPadding, number>>;

type ChatTimelineProps = {
  rows: EventRowViewModel[];
  conversationId?: string | null;
  hasOlderEvents?: boolean;
  isLoadingOlder?: boolean;
  isLoadingHistory?: boolean;
  emptyState?: React.ReactNode;
  extraTail?: React.ReactNode;
  queuedUserMessages?: QueuedUserMessage[];
  onCancelQueued?: (message: QueuedUserMessage) => void;
  indicator?: InlineWorkingIndicatorMountProps;
  list?: ChatListBinding;
  recycleItems?: boolean;
  alignItemsAtEnd?: boolean;
  estimatedItemSize?: number;
  className?: string;
  contentContainerStyle?: LegendContentStyle;
  takesMessageJumps?: boolean;
  onLoadOlder?: () => boolean | void | Promise<boolean>;
};

const MESSAGE_JUMP_MAX_PAGES = 8;
const MESSAGE_JUMP_FLASH_MS = 1_800;

const ROW_GAP = 20;
const ASSISTANT_RUN_GAP = 6;
const USER_RUN_GAP = 8;
const CARD_RUN_GAP = 8;

const isCardRow = (row: EventRowViewModel): boolean =>
  row.kind === "assistant" &&
  row.text.trim().length === 0 &&
  Boolean(
    row.resourcePayload ||
      row.sourceDiffPayloads?.length ||
      row.inlineImagePayloads?.length ||
      row.officePreviewRef ||
      row.backgroundWork,
  );

const hasReplyPreview = (row: EventRowViewModel): boolean =>
  row.kind === "assistant" &&
  Boolean(
    row.replyRefs?.some((ref) => ref.kind === "message") ||
      shownAgentLabelIds(row).length,
  );

const gapAfterRow = (
  current: EventRowViewModel,
  next: EventRowViewModel | undefined,
): number => {
  if (!next) return ROW_GAP;
  if (hasReplyPreview(next)) return ROW_GAP;
  if (isCardRow(current) && isCardRow(next)) return CARD_RUN_GAP;
  if (current.kind === "assistant" && next.kind === "assistant") {
    return ASSISTANT_RUN_GAP;
  }
  if (current.kind === "user" && next.kind === "user") {
    return USER_RUN_GAP;
  }
  return ROW_GAP;
};

type TimelineListItem = ChatTimelineItem & {
  gapAfter: number;
  timeHeaderMs?: number;
};

export const CHAT_DRAW_DISTANCE_COLD_PX = 300;
export const CHAT_DRAW_DISTANCE_WARM_PX = 1_200;
const CHAT_DRAW_DISTANCE_FALLBACK_DELAY_MS = 240;

const useChatDrawDistance = (dataKey: string | null): number => {
  const [warmedDataKey, setWarmedDataKey] = useState<string | null>(null);

  useEffect(() => {
    if (!dataKey || warmedDataKey === dataKey) return;
    const scheduleIdle =
      window.requestIdleCallback ??
      ((callback: IdleRequestCallback) =>
        window.setTimeout(
          () =>
            callback({
              didTimeout: false,
              timeRemaining: () => 0,
            }),
          CHAT_DRAW_DISTANCE_FALLBACK_DELAY_MS,
        ));
    const cancelIdle =
      window.cancelIdleCallback ??
      ((handle: number) => window.clearTimeout(handle));
    const handle = scheduleIdle(() => {
      startTransition(() => setWarmedDataKey(dataKey));
    });
    return () => cancelIdle(handle as number);
  }, [dataKey, warmedDataKey]);

  return warmedDataKey === dataKey
    ? CHAT_DRAW_DISTANCE_WARM_PX
    : CHAT_DRAW_DISTANCE_COLD_PX;
};

// Rows that only ever sit at the tail never anchor the list: a message
// inserted above them would otherwise shift the scroll by its own height in
// one frame, ahead of the send's scroll motion.
const KEEP_VISIBLE_POSITION: MaintainVisibleContentPositionConfig<TimelineListItem> =
  {
    data: true,
    size: true,
    shouldRestorePosition: (item) =>
      item.type !== "working-indicator" && item.type !== "queued-users",
  };

const ItemSeparator = ({ leadingItem }: { leadingItem: TimelineListItem }) => (
  <div style={{ height: leadingItem.gapAfter }} aria-hidden="true" />
);

const renderRow = (
  row: EventRowViewModel,
  conversationId?: string | null,
) => {
  if (row.kind === "user") {
    return <UserMessageRow key={row.id} row={row} />;
  }
  return (
    <AssistantMessageRow
      key={row.id}
      row={row}
      conversationId={conversationId}
    />
  );
};

const TimelineUserItem = ({
  item,
  onCancelQueued,
}: {
  item: Extract<ChatTimelineItem, { type: "message" | "queued-users" }>;
  onCancelQueued?: (message: QueuedUserMessage) => void;
}) => {
  if (item.type === "queued-users") {
    return (
      <ComposerQueuedMessages
        messages={item.messages}
        onCancel={onCancelQueued}
      />
    );
  }
  return item.row.kind === "user" ? (
    <UserMessageRow row={item.row} />
  ) : null;
};

export const ChatTimeline = memo(function ChatTimeline({
  rows,
  conversationId,
  hasOlderEvents,
  isLoadingOlder,
  isLoadingHistory,
  emptyState,
  extraTail,
  queuedUserMessages,
  onCancelQueued,
  indicator,
  list,
  recycleItems = true,
  alignItemsAtEnd = false,
  estimatedItemSize = 120,
  className,
  contentContainerStyle,
  takesMessageJumps = false,
  onLoadOlder,
}: ChatTimelineProps) {
  const t = useT();
  const [replyHandoffController] = useState(createReplyHandoffController);
  const askRecords = useConversationUserAskRecords(conversationId);
  const listItems = useMemo<TimelineListItem[]>(() => {
    const items = buildChatTimelineItems({
      rows,
      queuedUserMessages: queuedUserMessages ?? [],
      includeWorkingIndicator: Boolean(indicator),
      askRecords,
    });
    const timeHeaders = timestampHeaders(
      items.flatMap((item) =>
        item.type === "message"
          ? [{ id: item.id, timestampMs: item.row.timestampMs }]
          : [],
      ),
    );
    return items.map((item, index) => {
      const next = items[index + 1];

      const timeHeaderMs =
        item.type === "message" ? timeHeaders.get(item.id) : undefined;
      if (!next) {
        return {
          ...item,
          gapAfter: 0,
          timeHeaderMs,
        };
      }
      if (item.type === "message") {
        const nextRow = next?.type === "message" ? next.row : undefined;
        return {
          ...item,
          gapAfter: gapAfterRow(item.row, nextRow),
          timeHeaderMs,
        };
      }
      if (item.type === "working-indicator") {
        return { ...item, gapAfter: next?.type === "queued-users" ? 20 : 0 };
      }
      return {
        ...item,
        gapAfter: next?.type === "queued-users" ? 6 : ROW_GAP,
      };
    });
  }, [askRecords, indicator, queuedUserMessages, rows]);
  const tailUserRowId = useMemo(() => {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (row?.kind === "assistant") return null;
      if (row?.kind === "user") return row.id;
    }
    return null;
  }, [rows]);
  useEffect(() => {
    if (tailUserRowId) replyHandoffController.userMessageSent();
  }, [replyHandoffController, tailUserRowId]);
  const messageJump = useSyncExternalStore(subscribeMessageJump, readMessageJump);
  const [flashItemId, setFlashItemId] = useState<string | null>(null);
  const jumpPagesRef = useRef<{ requestId: number; pages: number } | null>(null);
  useEffect(() => {
    if (!takesMessageJumps || !messageJump || !conversationId) return;
    if (messageJump.conversationId !== conversationId) return;
    const ids = new Set(messageJump.messageIds);
    const index = listItems.findIndex(
      (item) =>
        item.type === "message" &&
        (ids.has(item.id) ||
          (item.row.kind === "assistant" &&
            item.row.sourceMessageId !== undefined &&
            ids.has(item.row.sourceMessageId))),
    );
    if (index >= 0) {
      finishMessageJump(messageJump.requestId);
      jumpPagesRef.current = null;
      void list?.ref.current?.scrollToIndex({
        index,
        animated: true,
        viewPosition: 0.2,
      });
      setFlashItemId(listItems[index]!.id);
      return;
    }
    if (isLoadingOlder) return;
    const progress =
      jumpPagesRef.current?.requestId === messageJump.requestId
        ? jumpPagesRef.current
        : { requestId: messageJump.requestId, pages: 0 };
    jumpPagesRef.current = progress;
    if (!hasOlderEvents || !onLoadOlder || progress.pages >= MESSAGE_JUMP_MAX_PAGES) {
      finishMessageJump(messageJump.requestId);
      jumpPagesRef.current = null;
      showToast({ title: t("app.chat.catchUp.notLoaded") });
      return;
    }
    progress.pages += 1;
    void onLoadOlder();
  }, [
    conversationId,
    hasOlderEvents,
    isLoadingOlder,
    list,
    listItems,
    messageJump,
    onLoadOlder,
    t,
    takesMessageJumps,
  ]);
  useEffect(() => {
    if (!flashItemId) return;
    const timer = window.setTimeout(() => setFlashItemId(null), MESSAGE_JUMP_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flashItemId]);

  const renderedMessageRowCount = listItems.reduce(
    (count, item) => count + (item.type === "message" ? 1 : 0),
    0,
  );

  const renderItem = useCallback(
    ({ item }: LegendListRenderItemProps<TimelineListItem>) => {
      if (item.type === "ask-record") {
        return (
          <div className="event-row event-row--assistant">
            <div className="event-item assistant">
              <UserAskRecordCard record={item.record} />
            </div>
          </div>
        );
      }
      if (item.type === "working-indicator") {
        return indicator ? (
          <div className="event-list-working-indicator">
            <InlineWorkingIndicator {...indicator} />
          </div>
        ) : null;
      }
      const row =
        item.type === "queued-users" || item.row.kind === "user" ? (
          <TimelineUserItem item={item} onCancelQueued={onCancelQueued} />
        ) : (
          renderRow(
            item.row,
            conversationId,
          )
        );
      return (
        <>
          {item.timeHeaderMs === undefined ? null : (
            <ChatTimeDivider timestampMs={item.timeHeaderMs} />
          )}
          {row}
          {flashItemId === item.id ? (
            <div className="chat-jump-flash" aria-hidden="true" />
          ) : null}
        </>
      );
    },
    [conversationId, flashItemId, indicator, onCancelQueued],
  );

  const keyExtractor = useCallback((item: TimelineListItem) => item.id, []);
  const drawDistance = useChatDrawDistance(
    rows.length > 0 ? (conversationId ?? listItems[0]?.id ?? null) : null,
  );

  const ListHeader = useMemo(() => {
    if (!isLoadingOlder || !hasOlderEvents) return null;
    return (
      <div className="event-history-status" role="status" aria-live="polite">
        Loading earlier messages...
      </div>
    );
  }, [hasOlderEvents, isLoadingOlder]);

  const ListFooter = useMemo(
    () =>
      extraTail ? (
        <div className="event-list-extra-tail">{extraTail}</div>
      ) : null,
    [extraTail],
  );

  const endFade = contentContainerStyle?.paddingBottom ?? 0;
  const listStyle = useMemo(
    () =>
      ({
        height: "100%",
        width: "100%",
        "--session-end-fade": `${endFade}px`,
      }) as CSSProperties,
    [endFade],
  );

  if (isLoadingHistory && rows.length === 0) {
    return (
      <div
        className="event-list-fallback"
        data-loading-history="true"
        role="status"
        aria-live="polite"
        aria-label={t("app.chat.timeline.loadingConversation")}
      >
        <LoaderCircle
          className="stella-loader-circle"
          size={18}
          strokeWidth={2}
          aria-hidden="true"
        />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="event-list-fallback" data-empty="true">
        {askRecords.length > 0 ? (
          askRecords.map((record) => (
            <div className="event-row event-row--assistant" key={record.id}>
              <div className="event-item assistant">
                <UserAskRecordCard record={record} />
              </div>
            </div>
          ))
        ) : (
          emptyState ?? (
            <div className="event-empty">{t("app.chat.timeline.empty")}</div>
          )
        )}
        {extraTail ? (
          <div className="event-list-extra-tail">{extraTail}</div>
        ) : null}
      </div>
    );
  }

  return (
    <ReplyHandoffContext.Provider value={replyHandoffController}>
      <LegendList<TimelineListItem>
        ref={list?.ref}
        dataKey={list?.dataKey}
        onScroll={list?.onScroll}
        onReady={list?.onReady}
        data={listItems}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        extraData={flashItemId}
        estimatedItemSize={estimatedItemSize}
        drawDistance={drawDistance}
        recycleItems={recycleItems}
        data-rendered-row-count={renderedMessageRowCount}
        alignItemsAtEnd={alignItemsAtEnd}
        maintainVisibleContentPosition={KEEP_VISIBLE_POSITION}
        initialScrollAtEnd
        ListHeaderComponent={ListHeader ?? undefined}
        ListFooterComponent={ListFooter}
        ItemSeparatorComponent={ItemSeparator}
        className={className}
        contentContainerStyle={contentContainerStyle}
        style={listStyle}
      />
    </ReplyHandoffContext.Provider>
  );
});
