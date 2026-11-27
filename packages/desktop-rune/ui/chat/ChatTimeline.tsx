import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { ChatVariantContext, type ChatVariant } from "./chat-text";
import type { ChatListBinding } from "./use-chat-scroll-management";
import { buildChatTimelineItems, type ChatTimelineItem } from "@/features/chat/lib/chat-timeline-items";
import { timestampHeaders } from "@/features/chat/lib/message-time-labels";
import type { EventRowViewModel } from "@/features/chat/conversation-row-types";
import { shownAgentLabelIds } from "@/features/chat/lib/assistant-row-content";
import { extractFileLinkTargets } from "@stella/contracts/local-file-links";
import { replyAttachmentPlacement } from "@stella/contracts/reply-attachments";
import { useConversationUserAskRecords } from "@/features/user-ask/user-ask-store";
import { finishMessageJump, readMessageJump, subscribeMessageJump } from "@/features/catch-up/message-jump";
import { createReplyHandoffController, ReplyHandoffContext } from "@/app/chat/reply-handoff";
import { showToast } from "@/ui/toast";
import { useT } from "@/shared/i18n";
import { Icon, Icons, withStroke } from "../kit";
import { derive, fontSize, mixOklch, radius, useTokens } from "../theme";
import { ChatTimeDivider } from "./ChatTimeDivider";
import { InlineWorkingIndicator, type InlineIndicatorPhase, type InlineWorkingIndicatorMountProps } from "./InlineWorkingIndicator";
import { AssistantMessageRow, UserMessageRow } from "./MessageRow";
import { UserAskRecordCard } from "./UserAskRecordCard";
import { panelSurface } from "./surfaces";
import { isViewFile } from "../views/ViewTabContent";

type LegendSummedPadding = "padding" | "paddingTop" | "paddingRight" | "paddingBottom" | "paddingLeft";

export type LegendContentStyle = Omit<
  CSSProperties,
  LegendSummedPadding | "paddingBlock" | "paddingBlockStart" | "paddingBlockEnd" | "paddingInline" | "paddingInlineStart" | "paddingInlineEnd"
> &
  Partial<Record<LegendSummedPadding, number>>;

type ChatTimelineProps = {
  rows: EventRowViewModel[];
  conversationId?: string | null;
  hasOlderEvents?: boolean;
  isLoadingOlder?: boolean;
  isLoadingHistory?: boolean;
  emptyState?: ReactNode;
  extraTail?: ReactNode;
  indicator?: InlineWorkingIndicatorMountProps;
  list?: ChatListBinding;
  recycleItems?: boolean;
  alignItemsAtEnd?: boolean;
  estimatedItemSize?: number;
  className?: string;
  contentContainerStyle?: LegendContentStyle;
  takesMessageJumps?: boolean;
  onLoadOlder?: () => boolean | void | Promise<boolean>;
  /** The sidebar look (`.chat-conversation-surface--sidebar`); unset inherits ChatVariantContext. */
  variant?: ChatVariant;
};

export const CHAT_DRAW_DISTANCE_COLD_PX = 300;
export const CHAT_DRAW_DISTANCE_WARM_PX = 1_200;

const MESSAGE_JUMP_MAX_PAGES = 8;
const MESSAGE_JUMP_FLASH_MS = 1_800;
const MESSAGE_JUMP_VIEW_POSITION = 0.2;
const ROW_GAP = 20;
const ASSISTANT_RUN_GAP = 6;
const USER_RUN_GAP = 8;
const CARD_RUN_GAP = 8;
const EXTRA_TAIL_GAP = 14;
const CONTENT_MAX_W = 800;
const SESSION_TOP_FADE = 24;
const SESSION_END_FADE_STOPS: [number, number][] = [
  [0.4, 0.86],
  [0.72, 0.62],
  [1, 0.4],
];

const isCardRow = (row: EventRowViewModel): boolean =>
  row.kind === "assistant" &&
  row.text.trim().length === 0 &&
  Boolean(row.resourcePayload || row.sourceDiffPayloads?.length || row.inlineImagePayloads?.length || row.officePreviewRef || row.backgroundWork);

const hasReplyPreview = (row: EventRowViewModel): boolean => row.kind === "assistant" && Boolean(row.replyRefs?.some((ref) => ref.kind === "message") || shownAgentLabelIds(row).length);

const gapAfterRow = (current: EventRowViewModel, next: EventRowViewModel | undefined): number => {
  if (!next) return ROW_GAP;
  if (hasReplyPreview(next)) return ROW_GAP;
  if (isCardRow(current) && isCardRow(next)) return CARD_RUN_GAP;
  if (current.kind === "assistant" && next.kind === "assistant") return ASSISTANT_RUN_GAP;
  if (current.kind === "user" && next.kind === "user") return USER_RUN_GAP;
  return ROW_GAP;
};

type TimelineListItem = ChatTimelineItem & { gapAfter: number; timeHeaderMs?: number };

const hasMediaLinks = (text: string): boolean => text.trim().length > 0 && extractFileLinkTargets(text).some((target) => replyAttachmentPlacement(target) === "media");

const px = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined);

/** `contentContainerStyle`'s numeric paddings, as LegendList sums them. */
const contentPadding = (style: LegendContentStyle | undefined) => {
  const all = px(style?.padding) ?? 0;
  return {
    pt: (px(style?.paddingTop) ?? 0) + all,
    pr: (px(style?.paddingRight) ?? 0) + all,
    pb: (px(style?.paddingBottom) ?? 0) + all,
    pl: (px(style?.paddingLeft) ?? 0) + all,
  };
};

/** `min(50rem, 100%)` and friends: the chat column's cap, or none. */
const contentMaxWidth = (style: LegendContentStyle | undefined): number | undefined => {
  const value = style?.maxWidth;
  if (typeof value === "number") return value;
  if (typeof value === "string" && /50rem/.test(value)) return CONTENT_MAX_W;
  return undefined;
};

function JumpFlash() {
  const tokens = useTokens();
  const fill = derive(tokens, "chat-jump-flash", (k) => mixOklch(k.c.primary, 12, "transparent"));
  return (
    <box
      absolute={{ left: -10, top: -4, right: -10, bottom: -4 }}
      radius={radius.xl}
      fill={fill}
      inert
      loop={{ kind: "sequence", period: MESSAGE_JUMP_FLASH_MS / 1000, times: 1, frames: [{ at: 0, opacity: 1 }, { at: 0.35, opacity: 1 }, { at: 1, opacity: 0 }] }}
    />
  );
}

function HistoryStatus() {
  const tokens = useTokens();
  const surface = panelSurface(tokens);
  return (
    <row w="full" justify="center" pb={ROW_GAP}>
      <box role="status" py={8 + 1} px={12 + 1} radius={radius.full} gradient={surface.gradient} border={surface.border} shadows={surface.shadows}>
        <text size={fontSize.sm} lineHeight={fontSize.sm} color={tokens.c.textWeak}>
          Loading earlier messages...
        </text>
      </box>
    </row>
  );
}

function WorkingIndicatorRow({ indicator, onVacated }: { indicator: InlineWorkingIndicatorMountProps; onVacated: (vacated: boolean) => void }) {
  const [phase, setPhase] = useState<InlineIndicatorPhase>("shown");
  useEffect(() => onVacated(phase === "vacated"), [onVacated, phase]);
  const vacated = phase === "vacated";
  return (
    <box w="full" pt={vacated ? 0 : phase === "leaving" ? 0 : 4} h={vacated ? 0 : undefined} clip={vacated ? 0 : undefined} motion={phase === "leaving" ? { dur: 0.22, bounce: 0 } : undefined}>
      <InlineWorkingIndicator {...indicator} onPhase={setPhase} />
    </box>
  );
}

export const ChatTimeline = memo(function ChatTimeline({
  rows,
  conversationId,
  hasOlderEvents,
  isLoadingOlder,
  isLoadingHistory,
  emptyState,
  extraTail,
  indicator,
  list,
  alignItemsAtEnd = false,
  estimatedItemSize = 120,
  contentContainerStyle,
  takesMessageJumps = false,
  onLoadOlder,
  variant,
}: ChatTimelineProps) {
  const t = useT();
  const tokens = useTokens();
  const [replyHandoffController] = useState(createReplyHandoffController);
  const askRecords = useConversationUserAskRecords(conversationId);
  const [indicatorVacated, setIndicatorVacated] = useState(false);
  const [tailFilled, setTailFilled] = useState(false);
  const tailPulledUp = Boolean(indicator && indicatorVacated && extraTail);
  const listItems = useMemo<TimelineListItem[]>(() => {
    const items = buildChatTimelineItems({ rows, includeWorkingIndicator: Boolean(indicator), askRecords });
    const timeHeaders = timestampHeaders(items.flatMap((item) => (item.type === "message" ? [{ id: item.id, timestampMs: item.row.timestampMs }] : [])));
    return items.map((item, index) => {
      const next = items[index + 1];
      const timeHeaderMs = item.type === "message" ? timeHeaders.get(item.id) : undefined;
      if (!next) return { ...item, gapAfter: 0, timeHeaderMs };
      if (item.type === "working-indicator") return { ...item, gapAfter: 0 };
      const gap = item.type === "message" ? gapAfterRow(item.row, next.type === "message" ? next.row : undefined) : ROW_GAP;
      const gapAfter = tailPulledUp && next.type === "working-indicator" ? gap - EXTRA_TAIL_GAP : gap;
      return item.type === "message" ? { ...item, gapAfter, timeHeaderMs } : { ...item, gapAfter };
    });
  }, [askRecords, indicator, rows, tailPulledUp]);
  const latestMediaRowId = useMemo(() => {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (row?.kind === "assistant" && hasMediaLinks(row.text)) return row.id;
    }
    return null;
  }, [rows]);
  // A view lives in one card, in the newest reply that made or changed it; older replies keep a chip.
  const liveViewRowIds = useMemo(() => {
    const ids = new Set<string>();
    const seen = new Set<string>();
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      const payload = row?.kind === "assistant" ? row.resourcePayload : undefined;
      if (!row || payload?.kind !== "canvas-html" || payload.driveBacked || !isViewFile(payload.filePath) || seen.has(payload.filePath)) continue;
      seen.add(payload.filePath);
      ids.add(row.id);
    }
    return ids;
  }, [rows]);
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
      (item) => item.type === "message" && (ids.has(item.id) || (item.row.kind === "assistant" && item.row.sourceMessageId !== undefined && ids.has(item.row.sourceMessageId))),
    );
    if (index >= 0) {
      finishMessageJump(messageJump.requestId);
      jumpPagesRef.current = null;
      list?.ref.current?.scrollToKey(`chat-row:${listItems[index]!.id}`, MESSAGE_JUMP_VIEW_POSITION);
      setFlashItemId(listItems[index]!.id);
      return;
    }
    if (isLoadingOlder) return;
    const progress = jumpPagesRef.current?.requestId === messageJump.requestId ? jumpPagesRef.current : { requestId: messageJump.requestId, pages: 0 };
    jumpPagesRef.current = progress;
    if (!hasOlderEvents || !onLoadOlder || progress.pages >= MESSAGE_JUMP_MAX_PAGES) {
      finishMessageJump(messageJump.requestId);
      jumpPagesRef.current = null;
      showToast({ title: t("app.chat.catchUp.notLoaded") });
      return;
    }
    progress.pages += 1;
    void onLoadOlder();
  }, [conversationId, hasOlderEvents, isLoadingOlder, list, listItems, messageJump, onLoadOlder, t, takesMessageJumps]);
  useEffect(() => {
    if (!flashItemId) return;
    const timer = setTimeout(() => setFlashItemId(null), MESSAGE_JUMP_FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashItemId]);

  const laidOutRef = useRef(false);
  const reportedRef = useRef<{ dataKey: string | undefined; onReady: (() => void) | undefined } | null>(null);
  const onReady = list?.onReady;
  const dataKey = list?.dataKey;
  const markReady = useCallback(() => {
    const reported = reportedRef.current;
    if (!laidOutRef.current || (reported && reported.dataKey === dataKey && reported.onReady === onReady)) return;
    reportedRef.current = { dataKey, onReady };
    onReady?.();
  }, [dataKey, onReady]);
  useEffect(markReady, [markReady]);
  const padding = contentPadding(contentContainerStyle);
  const contextVariant = useContext(ChatVariantContext);
  const surfaceVariant = variant ?? contextVariant;
  const maxW = contentMaxWidth(contentContainerStyle);
  const scrollId = list?.scrollId;

  const renderItem = (item: TimelineListItem) => {
    if (item.type === "ask-record") return <UserAskRecordCard record={item.record} />;
    if (item.type === "working-indicator") return indicator ? <WorkingIndicatorRow indicator={indicator} onVacated={setIndicatorVacated} /> : null;
    return (
      <>
        {item.timeHeaderMs === undefined ? null : <ChatTimeDivider timestampMs={item.timeHeaderMs} />}
        <box w="full">
          {item.row.kind === "user" ? (
            <UserMessageRow row={item.row} />
          ) : (
            <AssistantMessageRow row={item.row} conversationId={conversationId} latestMedia={item.row.id === latestMediaRowId} liveView={liveViewRowIds.has(item.row.id)} />
          )}
          {flashItemId === item.id ? <JumpFlash /> : null}
        </box>
      </>
    );
  };

  const tail = extraTail ? (
    <col w="full" gap={6} mt={!tailPulledUp && tailFilled ? EXTRA_TAIL_GAP : 0} onLayout={(r) => setTailFilled(r.h > 0)}>
      {extraTail}
    </col>
  ) : null;

  const fallback = (children: ReactNode, status?: { role: "status"; label: string }) => (
    <col
      id={scrollId}
      w="full"
      h="full"
      gap={surfaceVariant === "sidebar" ? 8 : 20}
      pt={32}
      justify="center"
      align="center"
      {...status}
      onLayout={() => {
        laidOutRef.current = true;
        markReady();
      }}
    >
      {children}
    </col>
  );

  const viewport = (children: ReactNode) => (
    <col
      id={scrollId}
      w="full"
      h="full"
      scrollY
      stickBottom={list?.follow ?? true}
      selectionGroup
      scrollFade={{ top: { size: SESSION_TOP_FADE, linear: true }, ...(padding.pb > 0 ? { bottom: { size: padding.pb, stops: SESSION_END_FADE_STOPS } } : {}) }}
      onScroll={list?.onScroll}
      onLayout={() => {
        laidOutRef.current = true;
        markReady();
      }}
    >
      <col w="full" maxW={maxW} selfAlign="center" {...(alignItemsAtEnd ? { minH: "full", justify: "end" } : {})} {...padding}>
        {children}
      </col>
    </col>
  );

  if (isLoadingHistory && rows.length === 0) {
    return fallback(
      <Icon icon={withStroke(Icons.stella.LoaderCircle, 2)} size={18} color={tokens.c.textWeak} spin={0.8} />,
      { role: "status", label: t("app.chat.timeline.loadingConversation") },
    );
  }

  if (rows.length === 0) {
    return fallback(
      <>
        {askRecords.length > 0
          ? askRecords.map((record) => <UserAskRecordCard key={record.id} record={record} />)
          : (emptyState ?? (
              <text py={40} px={20} size={fontSize.md} color={tokens.c.textWeaker} textAlign="center">
                {t("app.chat.timeline.empty")}
              </text>
            ))}
        {tail}
      </>,
    );
  }

  const timeline = (
    <ReplyHandoffContext.Provider value={replyHandoffController}>
      {viewport(
        <>
          {isLoadingOlder && hasOlderEvents ? <HistoryStatus /> : null}
          <list w="full" estimate={estimatedItemSize}>
            {listItems.map((item) => (
              <col key={item.id} id={`chat-row:${item.id}`} w="full" arrivesWhole={item.type === "message"}>
                {renderItem(item)}
                {item.gapAfter > 0 ? <box h={item.gapAfter} /> : null}
              </col>
            ))}
          </list>
          {tail}
        </>,
      )}
    </ReplyHandoffContext.Provider>
  );
  return variant ? <ChatVariantContext.Provider value={variant}>{timeline}</ChatVariantContext.Provider> : timeline;
});
