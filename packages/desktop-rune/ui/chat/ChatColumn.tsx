import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { ConnectorConnectCard } from "@/app/chat/ConnectorConnectCard";
import { UsageLimitChatCard } from "@/features/chat/UsageLimitChatCard";
import { SafeguardChatCard } from "@/features/chat/SafeguardChatCard";
import { ComposerNotice } from "@/app/chat/ComposerNotice";
import { ComputerLinkNotice } from "./ComputerLinkNotice";
import { CloudBrowserInterventionCard } from "@/features/cloud/CloudBrowserInterventionCard";
import { CloudConnectorConnectCard } from "@/features/cloud/CloudConnectorConnectCard";
import { UserAskList } from "@/features/user-ask/UserAskList";
import { ConversationEvents } from "@/app/chat/ConversationEvents";
import { MessageReplyContext } from "@/app/chat/message-reply-context";
import { ConversationFocusOverlay } from "@/app/chat/ConversationFocusOverlay";
import { useConversationFocus } from "@/features/chat/services/conversation-focus-store";
import { useChatMessages } from "@/context/use-chat-messages";
import { Composer } from "@/app/chat/Composer";
import { buildInlineWorkingIndicatorProps } from "@/features/chat/working-indicator-state";
import { useReadAloud } from "@/features/voice/services/read-aloud/use-read-aloud";
import type { ChatColumnProps } from "@/features/chat/chat-column-types";
import { useOverdueStop } from "@/features/chat/hooks/use-overdue-stop";
import { useAssistantReplyPeek } from "@/features/chat/hooks/use-assistant-reply-peek";
import { useDeferredChatMessages } from "@/features/chat/hooks/use-deferred-chat-messages";
import { useComposerMessage, type ComposerMessageStore } from "@/features/chat/hooks/use-composer-message-state";
import { CATCH_UP_ENABLED } from "@stella/contracts/catch-up";
import { useT } from "@/shared/i18n";
import { SessionPausedBanner } from "@/global/local-mode/SessionPausedBanner";
import { WaitingMessages } from "@/global/local-mode/WaitingMessages";
import { Icon, Icons, withStroke } from "../kit";
import { derive, mix, useTokens } from "../theme";
import { UnderGlassContext, type LegendContentStyle } from "./ChatTimeline";
import { CHAT_TOP_PAD, SHELL_TOPBAR_HEIGHT } from "../shell/metrics";
import { AdaptiveGlass, chromeGlass, composerGroupGlass, GlassSheen, useGlassBackdrop } from "../shell/glass";
import { useFileDrop } from "./use-file-drop";
import { COMPOSER_GAP, COMPOSER_NARROW_W, COMPOSER_PAD_TOP, composerShellMaxW } from "./Composer";
import { reportComposerArea } from "../replace/shell/workspace-stage/viewer-geometry";
import { reportChatColumnEdges } from "../shell/chat-column-edges";
import type { Layout } from "../../host/rune-jsx/props";
import type { ChatScrollThumb, ChatScrollThumbHandle } from "./use-chat-scroll-management";
import { useStaticHomeLook } from "./static-home";

export type { ChatColumnProps };

const CONTENT_PAD_BOTTOM = 28;

const CHAT_COLUMN_MAX_W = 16 * 50;

const FULL_CHAT_CONTENT_STYLE: LegendContentStyle = {
  maxWidth: "min(50rem, 100%)",
  marginLeft: "auto",
  marginRight: "auto",
  paddingLeft: 24,
  paddingRight: 24,
  paddingTop: CHAT_TOP_PAD,
  paddingBottom: CONTENT_PAD_BOTTOM,
};

const reportColumn = (r: Layout) => {
  const w = Math.min(CHAT_COLUMN_MAX_W, r.w);
  const left = r.x + (r.w - w) / 2;
  reportChatColumnEdges({ left, right: left + w });
};
const COMPOSER_OVERLAP = 12;
const SCROLL_BUTTON_SIZE = 32;
const SCROLL_BUTTON_BOTTOM = 28;
const SCROLLBAR_W = 10;

type StoreBackedComposerProps = Omit<ComponentProps<typeof Composer>, "message"> & { messageStore: ComposerMessageStore };

const StoreBackedComposer = memo(function StoreBackedComposer({ messageStore, ...props }: StoreBackedComposerProps) {
  const message = useComposerMessage(messageStore);
  return (
    <AdaptiveGlass>
      <Composer {...props} message={message} />
    </AdaptiveGlass>
  );
});

const AboveComposerCards = memo(function AboveComposerCards({ conversationId, onLayout }: { conversationId: string | null; onLayout: (r: Layout) => void }) {
  return (
    <col w="full" onLayout={onLayout}>
      <ComputerLinkNotice conversationId={conversationId} />
      <ConnectorConnectCard conversationId={conversationId} />
      <CloudConnectorConnectCard conversationId={conversationId} />
      <CloudBrowserInterventionCard conversationId={conversationId} />
      <UserAskList conversationId={conversationId} />
      <ComposerNotice conversationId={conversationId} />
    </col>
  );
});

type ComposerAreaParts = { above: Layout | null; composer: Layout | null };

function useComposerAreaReport() {
  const parts = useRef<ComposerAreaParts>({ above: null, composer: null });
  const report = useCallback(() => {
    const area = parts.current;
    const composer = area.composer;
    if (!composer || composer.w <= 0) return reportComposerArea(null);
    const narrow = composer.w < COMPOSER_NARROW_W;
    const width = narrow ? composer.w - 16 : composerShellMaxW(composer.w);
    const shellTop = composer.y + COMPOSER_PAD_TOP + COMPOSER_GAP;
    const top = area.above && area.above.h > 0 ? Math.min(area.above.y, shellTop) : shellTop;
    reportComposerArea({ top, left: composer.x + (composer.w - width) / 2, width });
  }, []);
  useEffect(() => () => reportComposerArea(null), []);
  return useMemo(() => {
    const on = (part: keyof ComposerAreaParts) => (r: Layout) => {
      parts.current[part] = r;
      report();
    };
    return { chatAbove: on("above"), chatComposer: on("composer") };
  }, [report]);
}

/**
 * The glass button that scrolls to the latest message. It rises out of the composer's glass, pinching
 * off it, and sinks back into it (one glass group, `composerGroupGlass`); under Reduce Transparency
 * it's a solid button that fades. Its holder stays mounted so the button can morph back as it goes.
 */
function ScrollToBottomButton({ shown, onPress, bottom }: { shown: boolean; onPress: () => void; bottom: number }) {
  const t = useT();
  const tokens = useTokens();
  const backdrop = useGlassBackdrop();
  const glass = composerGroupGlass(tokens, true);
  const solid = chromeGlass(tokens).controls;
  return (
    <box absolute={{ bottom: bottom + SCROLL_BUTTON_BOTTOM - COMPOSER_OVERLAP, left: 0, right: 0 }} h={SCROLL_BUTTON_SIZE} center inert={!shown}>
      {shown ? (
        <box
          role="button"
          focusable
          label={t("app.chat.column.scrollToBottom")}
          w={SCROLL_BUTTON_SIZE}
          h={SCROLL_BUTTON_SIZE}
          center
          radius={SCROLL_BUTTON_SIZE / 2}
          fx={glass}
          fill={glass ? undefined : solid.fill}
          border={glass ? undefined : solid.border}
          onBackdrop={backdrop}
          pressScale={0.95}
          hoverGroup
          focusRing={{ color: tokens.c.ring, width: 2, offset: 0 }}
          onPress={onPress}
          enter={glass ? undefined : "fade"}
          exit={glass ? undefined : "fade"}
        >
          <GlassSheen radius={SCROLL_BUTTON_SIZE / 2} />
          <box hoverColor={tokens.c.textStrong}>
            <Icon icon={withStroke(Icons.stella.ChevronDown, 2.5)} size={16} color={tokens.c.textWeak} />
          </box>
        </box>
      ) : null}
    </box>
  );
}

/** `.chat-scrollbar`: the overlay thumb the scroll hook drives, draggable, at the layer's right edge. */
function ChatScrollbar({ bind, onDrag }: { bind: (handle: ChatScrollThumbHandle | null) => void; onDrag: (dy: number, phase: "start" | "move" | "end") => void }) {
  const tokens = useTokens();
  const [thumb, setThumb] = useState<ChatScrollThumb>({ top: 0, height: 0, visible: false });
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    bind((next) => setThumb((prev) => (prev.top === next.top && prev.height === next.height && prev.visible === next.visible ? prev : next)));
    return () => bind(null);
  }, [bind]);
  const look = derive(tokens, "chat-scrollbar", (k) => ({ rest: mix(k.c.foreground, 28, "transparent"), active: mix(k.c.foreground, 35, "transparent") }));
  const wide = hovered || dragging;
  return (
    <box absolute={{ top: 0, right: 0, bottom: 0 }} w={SCROLLBAR_W} raise={15} onHover={setHovered}>
      {thumb.height > 0 ? (
        <box
          absolute={{ top: thumb.top, right: wide ? 1 : 2 }}
          w={wide ? 8 : 6}
          h={thumb.height}
          radius={999}
          fill={dragging ? look.active : look.rest}
          opacity={thumb.visible || wide ? 1 : 0}
          motion={{ dur: 0.2, bounce: 0 }}
          cursor={dragging ? "grabbing" : "grab"}
          onDrag={(d) => {
            if (d.phase === "start") setDragging(true);
            if (d.phase === "end") setDragging(false);
            onDrag(d.dy, d.phase);
          }}
        />
      ) : null}
    </box>
  );
}

export const ChatColumn = memo(function ChatColumn({ conversation, composer, scroll, composerEntering, conversationId }: ChatColumnProps) {
  useStaticHomeLook(useTokens());
  const focus = useConversationFocus(conversationId);
  const { noteManualScroll, showScrollButton, scrollToBottom, list, isFollowingLatest, isNearBottom, isUserScrolling } = scroll;
  const bindThumb = scroll.thumbRef as unknown as (handle: ChatScrollThumbHandle | null) => void;

  const dragStartRef = useRef<number | null>(null);
  const handleThumbDrag = useCallback(
    (dy: number, phase: "start" | "move" | "end") => {
      const ref = list.ref.current;
      if (!ref) return;
      const state = ref.getState();
      if (phase === "start") dragStartRef.current = state.scroll;
      if (phase === "end") {
        dragStartRef.current = null;
        return;
      }
      if (dragStartRef.current === null) return;
      noteManualScroll();
      const range = Math.max(1, state.contentLength - state.scrollLength);
      const next = Math.max(0, Math.min(range, dragStartRef.current + (dy / Math.max(1, state.scrollLength)) * range));
      void ref.scrollToOffset({ offset: next, animated: false });
    },
    [list.ref, noteManualScroll],
  );

  const liveMessages = useChatMessages();
  // The conversation names its views (their storage syncs as `<conversationId>/<slug>`), and where a
  // view's file isn't on this device (the web, a view made in the cloud or elsewhere) it carries its source.
  useEffect(() => {
    globalThis.stella.views?.offerMessages?.(liveMessages, conversationId);
  }, [liveMessages, conversationId]);
  const messages = useDeferredChatMessages(liveMessages, isUserScrolling, conversationId);
  const assistantReplyPeek = useAssistantReplyPeek({ messages, isFollowingLatest, isNearBottom });

  useReadAloud(messages);

  const overdueStop = useOverdueStop({ working: Boolean(conversation.streaming.isStreaming), messageId: conversation.streaming.pendingUserMessageId, stop: composer.onStop });
  const indicatorProps = useMemo(
    () =>
      buildInlineWorkingIndicatorProps({
        isStreaming: Boolean(conversation.streaming.isStreaming),
        isToolActive: Boolean(conversation.streaming.isToolActive),
        answerLanded: Boolean(conversation.streaming.answerLanded),
        activeToolName: conversation.streaming.activeToolName,
        activeToolCallId: conversation.streaming.activeToolCallId,
        runtimeStatusText: conversation.streaming.runtimeStatusText,
        isCompacting: Boolean(conversation.streaming.isCompacting),
        onStop: overdueStop,
      }),
    [
      conversation.streaming.isStreaming,
      conversation.streaming.isToolActive,
      conversation.streaming.answerLanded,
      conversation.streaming.activeToolName,
      conversation.streaming.activeToolCallId,
      conversation.streaming.runtimeStatusText,
      conversation.streaming.isCompacting,
      overdueStop,
    ],
  );
  const composerArea = useComposerAreaReport();
  const [composerStackH, setComposerStackH] = useState(0);
  const contentStyle = useMemo<LegendContentStyle>(() => ({ ...FULL_CHAT_CONTENT_STYLE, paddingBottom: CONTENT_PAD_BOTTOM + composerStackH - COMPOSER_OVERLAP }), [composerStackH]);
  const { isDragOver, dropHandlers } = useFileDrop({ setChatContext: composer.setChatContext });

  const replyComposerRef = useRef(composer);
  replyComposerRef.current = composer;
  const handleReplyToMessage = useCallback((text: string) => {
    const quoted = text.trim();
    if (!quoted) return;
    const current = replyComposerRef.current;
    current.setSelectedText(quoted);
    current.requestFocus?.();
  }, []);

  const renderComposer = (replyPeek: ComponentProps<typeof Composer>["replyPeek"]) => {
    return (
      <StoreBackedComposer
        messageStore={composer.messageStore}
        setMessage={composer.setMessage}
        chatContext={composer.chatContext}
        setChatContext={composer.setChatContext}
        selectedText={composer.selectedText}
        setSelectedText={composer.setSelectedText}
        isStreaming={conversation.streaming.isStreaming}
        canSubmit={composer.canSubmit}
        focusRequestId={composer.focusRequestId}
        conversationId={conversationId}
        onSend={composer.onSend}
        onStop={composer.onStop}
        isDragOver={isDragOver}
        replyPeek={replyPeek}
        catchUp={CATCH_UP_ENABLED}
      />
    );
  };

  const { visible: replyPeekVisible, previewText: replyPeekText, dismiss: dismissReplyPeek } = assistantReplyPeek;
  const chatReplyPeek = useMemo(
    () => (replyPeekVisible ? { text: replyPeekText, onJumpToBottom: () => scrollToBottom("smooth"), onDismiss: dismissReplyPeek } : null),
    [dismissReplyPeek, replyPeekText, replyPeekVisible, scrollToBottom],
  );

  const extraTail = conversation.extraTail;
  const replying = Boolean(conversation.streaming.isStreaming);
  const chatTail = useMemo(
    () => (
      <>
        {extraTail}
        <UsageLimitChatCard conversationId={conversationId} />
        <SafeguardChatCard conversationId={conversationId} replying={replying} />
        <WaitingMessages />
      </>
    ),
    [conversationId, extraTail, replying],
  );

  return (
    <row w="full" h="full" grow={1} minW={0} minH={0} align="stretch">
      <row grow={1} minW={0} minH={0} align="stretch">
        <col grow={1} minW={0} minH={0} {...dropHandlers}>
          <col absolute={{ left: 0, top: SHELL_TOPBAR_HEIGHT, right: 0 }} raise={2}>
            <SessionPausedBanner />
          </col>
          <box grow={1} minH={0} w="full" clip={0} onLayout={reportColumn}>
            <box w="full" h="full" hidden={scroll.isOpeningScroll} inert={Boolean(focus)}>
              <MessageReplyContext.Provider value={handleReplyToMessage}>
                <UnderGlassContext.Provider value>
                  <ConversationEvents
                    messages={messages}
                    conversationId={conversationId}
                    pendingUserMessageId={conversation.streaming.pendingUserMessageId}
                    indicator={indicatorProps}
                    hasOlderMessages={conversation.history.hasOlderMessages}
                    isLoadingOlder={conversation.history.isLoadingOlder}
                    isLoadingHistory={conversation.history.isInitialLoading}
                    list={list}
                    className="session-content"
                    contentContainerStyle={contentStyle}
                    estimatedItemSize={140}
                    extraTail={chatTail}
                    takesMessageJumps
                    onLoadOlder={conversation.history.loadOlder}
                  />
                </UnderGlassContext.Provider>
              </MessageReplyContext.Provider>
              <AdaptiveGlass><ScrollToBottomButton shown={showScrollButton && !assistantReplyPeek.visible} bottom={composerStackH} onPress={() => scrollToBottom("smooth")} /></AdaptiveGlass>
            </box>
            <ConversationFocusOverlay conversationId={conversationId} />
          </box>
          <col absolute={{ left: 0, right: 0, bottom: 0 }} raise={2} onLayout={(r) => setComposerStackH((h) => (Math.abs(h - r.h) < 0.5 ? h : r.h))}>
            <AboveComposerCards conversationId={conversationId} onLayout={composerArea.chatAbove} />
            <col w="full" onLayout={composerArea.chatComposer} enter={composerEntering ? { opacity: 0, y: 12, dur: 0.6, bounce: 0 } : undefined}>
              {renderComposer(chatReplyPeek)}
            </col>
          </col>
        </col>
        <ChatScrollbar bind={bindThumb} onDrag={handleThumbDrag} />
      </row>
    </row>
  );
});
