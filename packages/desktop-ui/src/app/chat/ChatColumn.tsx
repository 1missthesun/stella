import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { ChevronDown } from "@/ui/icons";
import { ConnectorConnectCard } from "./ConnectorConnectCard";
import { AppSourceOffers } from "@/features/app-source/AppSourceCards";
import { UsageLimitChatCard } from "@/features/chat/UsageLimitChatCard";
import { ComposerNotice } from "./ComposerNotice";
import { CloudBrowserInterventionCard } from "@/features/cloud/CloudBrowserInterventionCard";
import { CloudConnectorConnectCard } from "@/features/cloud/CloudConnectorConnectCard";
import { UserAskList } from "@/features/user-ask/UserAskList";
import { ConversationEvents } from "./ConversationEvents";
import type { LegendContentStyle } from "./ChatTimeline";
import { MessageReplyContext } from "./message-reply-context";
import { ConversationFocusOverlay } from "./ConversationFocusOverlay";
import { useConversationFocus } from "@/features/chat/services/conversation-focus-store";
import { useChatMessages } from "@/context/use-chat-messages";
import { Composer } from "./Composer";
import { HomeContent } from "@/app/home/HomeContent";
import { buildInlineWorkingIndicatorProps } from "@/features/chat/working-indicator-state";
import { useFileDrop } from "@/features/chat/hooks/use-file-drop";
import { useReadAloud } from "@/features/voice/services/read-aloud/use-read-aloud";
import type { ChatColumnProps } from "@/features/chat/chat-column-types";
import { useAssistantReplyPeek } from "@/features/chat/hooks/use-assistant-reply-peek";
import { useDeferredChatMessages } from "@/features/chat/hooks/use-deferred-chat-messages";
import {
  restoreQueuedTextToComposer,
  type QueuedUserMessage,
} from "@/features/chat/hooks/queued-user-messages";
import {
  useComposerMessage,
  type ComposerMessageStore,
} from "@/features/chat/hooks/use-composer-message-state";
import { CATCH_UP_ENABLED } from "@stella/contracts/catch-up";
import { useT } from "@/shared/i18n";
import "./full-shell.chat.css";

const FULL_CHAT_CONTENT_STYLE: LegendContentStyle = {
  maxWidth: "min(50rem, 100%)",
  marginLeft: "auto",
  marginRight: "auto",
  paddingLeft: 24,
  paddingRight: 24,
  paddingTop: 112,
  paddingBottom: 28,
};

const HOME_LEAVE_MS = 280;

type StoreBackedComposerProps = Omit<
  ComponentProps<typeof Composer>,
  "message"
> & { messageStore: ComposerMessageStore };

const StoreBackedComposer = memo(function StoreBackedComposer({
  messageStore,
  ...props
}: StoreBackedComposerProps) {
  const message = useComposerMessage(messageStore);
  return <Composer {...props} message={message} />;
});

const AboveComposerCards = memo(function AboveComposerCards({
  conversationId,
}: {
  conversationId: string | null;
}) {
  return (
    <>
      {/* Inline connect offer (agent-initiated) pinned above the
          composer while the agent's turn waits on the answer. */}
      <ConnectorConnectCard conversationId={conversationId} />
      <CloudConnectorConnectCard conversationId={conversationId} />
      <CloudBrowserInterventionCard conversationId={conversationId} />
      <UserAskList conversationId={conversationId} />
      {/* Sign-in / plan-limit / provider notices pin here too, so the
          thing blocking the composer sits right above it. */}
      <ComposerNotice conversationId={conversationId} />
    </>
  );
});

export const ChatColumn = memo(function ChatColumn({
  conversation,
  composer,
  scroll,
  composerEntering,
  conversationId,
  showHomeContent,
}: ChatColumnProps) {
  const t = useT();
  const focus = useConversationFocus(conversationId);
  const homeObscuresChat = showHomeContent && !focus;
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ y: number; scrollTop: number } | null>(null);
  const { noteManualScroll } = scroll;

  const getScrollNode = useCallback((): HTMLElement | null => {
    const list = scroll.list.ref.current;
    if (!list) return null;
    return list.getScrollableNode();
  }, [scroll.list.ref]);

  const handleThumbDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const el = getScrollNode();
      if (!el) return;
      noteManualScroll();
      isDraggingRef.current = true;
      dragStartRef.current = { y: e.clientY, scrollTop: el.scrollTop };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [getScrollNode, noteManualScroll],
  );

  const handleThumbMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDraggingRef.current || !dragStartRef.current) return;
      const el = getScrollNode();
      if (!el) return;
      noteManualScroll();
      const trackHeight = el.clientHeight;
      const scrollRange = Math.max(1, el.scrollHeight - el.clientHeight);
      const dy = e.clientY - dragStartRef.current.y;
      const scrollDelta = (dy / trackHeight) * scrollRange;
      const next = Math.max(
        0,
        Math.min(scrollRange, dragStartRef.current.scrollTop + scrollDelta),
      );
      const list = scroll.list.ref.current;
      if (list) {
        void list.scrollToOffset({ offset: next, animated: false });
      } else {
        el.scrollTop = next;
      }
    },
    [getScrollNode, noteManualScroll, scroll.list.ref],
  );

  const handleThumbUp = useCallback(() => {
    isDraggingRef.current = false;
    dragStartRef.current = null;
  }, []);

  const {
    showScrollButton,
    scrollToBottom,
    thumbRef,
    list,
    isFollowingLatest,
    isNearBottom,
    isUserScrolling,
  } = scroll;

  const liveMessages = useChatMessages();
  const messages = useDeferredChatMessages(
    liveMessages,
    isUserScrolling,
    conversationId,
  );

  const assistantReplyPeek = useAssistantReplyPeek({
    messages,
    isFollowingLatest,
    isNearBottom,
  });

  const [homeVisible, setHomeVisible] = useState(Boolean(showHomeContent));
  if (showHomeContent && !homeVisible) setHomeVisible(true);
  const homeLeaving = homeVisible && !showHomeContent;

  useEffect(() => {
    if (!homeLeaving) return;
    const timer = setTimeout(() => setHomeVisible(false), HOME_LEAVE_MS);
    return () => clearTimeout(timer);
  }, [homeLeaving]);

  useReadAloud(messages);

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
      }),
    [
      conversation.streaming.isStreaming,
      conversation.streaming.isToolActive,
      conversation.streaming.answerLanded,
      conversation.streaming.activeToolName,
      conversation.streaming.activeToolCallId,
      conversation.streaming.runtimeStatusText,
      conversation.streaming.isCompacting,
    ],
  );
  const { isDragOver, dropHandlers } = useFileDrop({
    setChatContext: composer.setChatContext,
  });

  const { removeQueuedUserMessage } = conversation.streaming;
  const { setMessage: setComposerMessage, requestFocus: requestComposerFocus } =
    composer;
  const replyComposerRef = useRef(composer);
  replyComposerRef.current = composer;
  const handleReplyToMessage = useCallback((text: string) => {
    const quoted = text.trim();
    if (!quoted) return;
    const current = replyComposerRef.current;
    current.setSelectedText(quoted);
    current.requestFocus?.();
  }, []);

  const handleCancelQueued = useCallback(
    (message: QueuedUserMessage) => {
      removeQueuedUserMessage(message.id);
      setComposerMessage((current) =>
        restoreQueuedTextToComposer(current, message.text),
      );
      requestComposerFocus?.();
    },
    [removeQueuedUserMessage, setComposerMessage, requestComposerFocus],
  );

  const renderComposer = (
    surface: "chat" | "home",
    replyPeek: ComponentProps<typeof Composer>["replyPeek"],
  ) => {
    const isActiveSurface =
      surface === "home" ? showHomeContent : !showHomeContent;
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
        focusRequestId={isActiveSurface ? composer.focusRequestId : undefined}
        conversationId={conversationId}
        onSend={composer.onSend}
        onStop={composer.onStop}
        isDragOver={isDragOver}
        replyPeek={replyPeek}
        catchUp={CATCH_UP_ENABLED && surface === "chat"}
        suggestionsActive={isActiveSurface}
      />
    );
  };

  const {
    visible: replyPeekVisible,
    previewText: replyPeekText,
    dismiss: dismissReplyPeek,
  } = assistantReplyPeek;
  const chatReplyPeek = useMemo(
    () =>
      replyPeekVisible
        ? {
            text: replyPeekText,
            onJumpToBottom: () => scrollToBottom("smooth"),
            onDismiss: dismissReplyPeek,
          }
        : null,
    [dismissReplyPeek, replyPeekText, replyPeekVisible, scrollToBottom],
  );

  const extraTail = conversation.extraTail;
  const chatTail = useMemo(
    () => (
      <>
        {extraTail}
        <AppSourceOffers />
        <UsageLimitChatCard conversationId={conversationId} />
      </>
    ),
    [conversationId, extraTail],
  );

  return (
    <div className="full-body-row">
      {/* The whole chat layer (messages + composer + workspace strip +
          scrollbar) fades as one unit under the home overlay. Hiding the
          layer wholesale — rather than toggling the workspace strip's own
          `forceHidden` — avoids re-running the strip's 460ms width/slide
          animation on every home↔chat switch. */}
      <div
        className={`full-body-chat-layer${homeObscuresChat ? " full-body-chat-layer--hidden" : ""}`}
        data-testid="chat-surface"
        data-conversation-id={conversationId ?? undefined}
        data-has-older-messages={
          conversation.history.hasOlderMessages ? "true" : "false"
        }
        data-loading-older-messages={
          conversation.history.isLoadingOlder ? "true" : "false"
        }
        inert={homeObscuresChat || undefined}
      >
        <div className="full-body-main" {...dropHandlers}>
          {/* Viewport region: list + overlay scroll-to-bottom.
            The custom scrollbar deliberately hangs off the layer (sibling
            below) rather than the viewport region so it pins to the
            right edge of the entire chat surface — past the workspace
            strip — instead of sitting at the inside edge of the
            centered chat column. */}
          <div className="chat-viewport-region">
            <div
              style={{
                height: "100%",
                visibility: scroll.isOpeningScroll ? "hidden" : undefined,
              }}
              inert={Boolean(focus) || undefined}
            >
              <MessageReplyContext.Provider value={handleReplyToMessage}>
                <ConversationEvents
                  messages={messages}
                  conversationId={conversationId}
                  pendingUserMessageId={
                    conversation.streaming.pendingUserMessageId
                  }
                  queuedUserMessages={conversation.streaming.queuedUserMessages}
                  onCancelQueued={handleCancelQueued}
                  indicator={indicatorProps}
                  hasOlderMessages={conversation.history.hasOlderMessages}
                  isLoadingOlder={conversation.history.isLoadingOlder}
                  isLoadingHistory={conversation.history.isInitialLoading}
                  list={list}
                  className="session-content"
                  contentContainerStyle={FULL_CHAT_CONTENT_STYLE}
                  estimatedItemSize={140}
                  extraTail={chatTail}
                  takesMessageJumps
                  onLoadOlder={conversation.history.loadOlder}
                />
              </MessageReplyContext.Provider>

              {showScrollButton && !assistantReplyPeek.visible && (
                <button
                  className="scroll-to-bottom"
                  onClick={() => scrollToBottom("smooth")}
                  aria-label={t("app.chat.column.scrollToBottom")}
                >
                  <ChevronDown size={16} strokeWidth={2.5} />
                </button>
              )}
            </div>
            <ConversationFocusOverlay
              conversationId={conversationId}
            />
          </div>

          <AboveComposerCards conversationId={conversationId} />

          {/* Composer: normal flow below the scroll viewport */}
          <div
            className={
              composerEntering
                ? "composer-wrap composer-wrap--entering"
                : "composer-wrap"
            }
          >
            {renderComposer("chat", chatReplyPeek)}
          </div>
        </div>

        {/* Custom scrollbar thumb overlay — pinned to the right edge of
          the layer (past the workspace strip) so it tracks the app side
          rather than the inside edge of the chat column. */}
        <div className="chat-scrollbar">
          <div
            ref={thumbRef}
            className="chat-scrollbar__thumb"
            onPointerDown={handleThumbDown}
            onPointerMove={handleThumbMove}
            onPointerUp={handleThumbUp}
            onPointerCancel={handleThumbUp}
          />
        </div>
      </div>

      {homeVisible && !focus && (
        <div
          className={`full-body-home-overlay full-body-main--home${homeLeaving ? " full-body-main--home-leaving" : ""}`}
          {...dropHandlers}
        >
          <HomeContent>
            {conversation.extraTail ? (
              <div
                className="full-body-home-status"
                inert={showHomeContent ? undefined : true}
              >
                {conversation.extraTail}
              </div>
            ) : null}
            <div
              className="composer-wrap"
              inert={showHomeContent ? undefined : true}
            >
              {showHomeContent ? (
                <>
                  <AppSourceOffers />
                  <ComposerNotice conversationId={conversationId} />
                </>
              ) : null}
              {renderComposer("home", null)}
            </div>
          </HomeContent>
        </div>
      )}
    </div>
  );
});
