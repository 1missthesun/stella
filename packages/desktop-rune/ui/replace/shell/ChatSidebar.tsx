import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import type { MessageRecord } from "@stella/contracts/local-chat";
import type { ChatContext } from "@/shared/types/electron";
import type { ChatColumnScroll } from "@/features/chat/chat-column-types";
import { CompactConversationSurface } from "@/features/chat/CompactConversationSurface";
import { UsageLimitChatCard } from "@/features/chat/UsageLimitChatCard";
import { SafeguardChatCard } from "@/features/chat/SafeguardChatCard";
import { useChatScrollManagement } from "@/shell/use-chat-scroll-management";
import { ConnectorConnectCard } from "@/app/chat/ConnectorConnectCard";
import { ComposerNotice } from "@/app/chat/ComposerNotice";
import { Composer } from "../../chat/Composer";
import { setSelectionHideZone } from "../../shell/selection/AskStellaSelectionChip";
import { useRetainedSurfaceActive } from "../../kit";
import type { Layout } from "../../../host/rune-jsx/props";
import { CloudBrowserInterventionCard } from "@/features/cloud/CloudBrowserInterventionCard";
import { deriveComposerState } from "@/features/chat/composer-context";
import { buildInlineWorkingIndicatorProps } from "@/features/chat/working-indicator-state";
import { useComposerMessage, useComposerMessageStore, type ComposerMessageStore } from "@/features/chat/hooks/use-composer-message-state";
import { useOptimisticStop } from "@/features/chat/hooks/use-optimistic-stop";
import { useOverdueStop } from "@/features/chat/hooks/use-overdue-stop";
import { useReadAloud } from "@/features/voice/services/read-aloud/use-read-aloud";
import { useAssistantReplyPeek } from "@/features/chat/hooks/use-assistant-reply-peek";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import { useCapturedChatContext } from "@/shell/use-captured-chat-context";
import type { LegendContentStyle } from "../../chat/ChatTimeline";
import { useFileDrop } from "../../chat/use-file-drop";

const SIDEBAR_CONTENT_STYLE: LegendContentStyle = { paddingLeft: 10, paddingRight: 10, paddingTop: 8, paddingBottom: 12 };

const WIDE_PANEL_CONTENT_STYLE: LegendContentStyle = {
  maxWidth: "min(50rem, 100%)",
  marginLeft: "auto",
  marginRight: "auto",
  paddingLeft: 24,
  paddingRight: 24,
  paddingTop: 16,
  paddingBottom: 16,
};

type ChatSidebarOpenOptions = { chatContext?: ChatContext | null; prefillText?: string };

export type ChatPanelOpenRequest = ChatSidebarOpenOptions & { id: number };

type ChatPanelTabProps = {
  openRequest?: ChatPanelOpenRequest | null;
  messages: MessageRecord[];
  conversationId?: string | null;
  isStreaming: boolean;
  answerLanded?: boolean;
  runtimeStatusText?: string | null;
  isCompacting?: boolean;
  activeToolCallId?: string | null;
  activeToolName?: string | null;
  isToolActive?: boolean;
  pendingUserMessageId: string | null;
  hasOlderMessages: boolean;
  hasNewerMessages: boolean;
  isLoadingOlder: boolean;
  isLoadingNewer: boolean;
  isInitialLoading: boolean;
  extraTail?: ReactNode;
  onLoadOlder: () => boolean | void | Promise<boolean>;
  onLoadNewer: () => boolean | void | Promise<boolean>;
  onLoadLatest: () => boolean | void | Promise<boolean>;
  onSend: (text: string, chatContext?: ChatContext | null, selectedText?: string | null, onOptimisticStart?: () => void) => boolean | Promise<boolean>;
  onStop?: () => void;
  wideLayout?: boolean;
};

/** desktop-ui's `ChatPanelTab`: the conversation as a display tab, with its own composer; a new account starts it fresh. */
export function ChatPanelTab(props: ChatPanelTabProps) {
  const { accountScope } = useCloudConversationSession();
  const previousAccountScopeRef = useRef(accountScope);
  const ignoredOpenRequestIdRef = useRef<number | null>(null);

  if (previousAccountScopeRef.current !== accountScope) {
    previousAccountScopeRef.current = accountScope;
    ignoredOpenRequestIdRef.current = props.openRequest?.id ?? null;
  }

  const openRequest = props.openRequest?.id === ignoredOpenRequestIdRef.current ? null : props.openRequest;

  return <AccountScopedChatPanelTab key={accountScope} {...props} openRequest={openRequest} />;
}

type StoreBackedComposerProps = Omit<ComponentProps<typeof Composer>, "message" | "canSubmit"> & { messageStore: ComposerMessageStore };

const StoreBackedComposer = memo(function StoreBackedComposer({ messageStore, ...props }: StoreBackedComposerProps) {
  const message = useComposerMessage(messageStore);
  const { canSubmit } = deriveComposerState({ message, chatContext: props.chatContext, selectedText: props.selectedText });
  return <Composer {...props} message={message} canSubmit={canSubmit} />;
});

function AccountScopedChatPanelTab({
  openRequest,
  wideLayout = false,
  messages,
  conversationId,
  isStreaming,
  answerLanded,
  runtimeStatusText,
  isCompacting,
  activeToolCallId,
  activeToolName,
  isToolActive,
  pendingUserMessageId,
  hasOlderMessages,
  hasNewerMessages,
  isLoadingOlder,
  isLoadingNewer,
  isInitialLoading,
  extraTail,
  onLoadOlder,
  onLoadNewer,
  onLoadLatest,
  onSend,
  onStop,
}: ChatPanelTabProps) {
  const { store: inputTextStore, setMessage: setInputText } = useComposerMessageStore();
  const { canStop, requestStop } = useOptimisticStop(isStreaming, onStop);
  const [focusRequestId, setFocusRequestId] = useState(0);
  const overdueStop = useOverdueStop({ working: isStreaming && canStop, messageId: pendingUserMessageId, stop: requestStop });

  const sidebarScroll = useChatScrollManagement({
    hasOlderEvents: hasOlderMessages,
    isLoadingOlder,
    onLoadOlder,
    hasNewerEvents: hasNewerMessages,
    isLoadingNewer,
    onLoadNewer,
    onLoadLatest,
    paginationKey: conversationId,
    surface: "compact",
  });
  const { scrollToBottom: scrollSidebarToBottom } = sidebarScroll;

  const assistantReplyPeek = useAssistantReplyPeek({ messages, isFollowingLatest: sidebarScroll.isFollowingLatest, isNearBottom: sidebarScroll.isNearBottom });

  const sidebarScrollApi = useMemo<ChatColumnScroll>(
    () => ({
      list: sidebarScroll.list as unknown as ChatColumnScroll["list"],
      showScrollButton: sidebarScroll.showScrollButton,
      isAtBottom: sidebarScroll.isAtBottom,
      isNearBottom: sidebarScroll.isNearBottom,
      isFollowingLatest: sidebarScroll.isFollowingLatest,
      isUserScrolling: sidebarScroll.isUserScrolling,
      noteManualScroll: sidebarScroll.noteManualScroll,
      getIsFollowing: sidebarScroll.getIsFollowing,
      scrollToBottom: sidebarScroll.scrollToBottom,
      thumbRef: sidebarScroll.thumbRef,
    }),
    [
      sidebarScroll.list,
      sidebarScroll.showScrollButton,
      sidebarScroll.isAtBottom,
      sidebarScroll.isNearBottom,
      sidebarScroll.isFollowingLatest,
      sidebarScroll.isUserScrolling,
      sidebarScroll.noteManualScroll,
      sidebarScroll.getIsFollowing,
      sidebarScroll.scrollToBottom,
      sidebarScroll.thumbRef,
    ],
  );

  useReadAloud(messages);
  const { visible: replyPeekVisible, previewText: replyPeekText, dismiss: dismissReplyPeek } = assistantReplyPeek;
  const replyPeek = useMemo(
    () => (replyPeekVisible ? { text: replyPeekText, onJumpToBottom: () => scrollSidebarToBottom("smooth"), onDismiss: dismissReplyPeek } : null),
    [dismissReplyPeek, replyPeekText, replyPeekVisible, scrollSidebarToBottom],
  );
  const indicatorProps = useMemo(
    () =>
      buildInlineWorkingIndicatorProps({
        isStreaming: Boolean(isStreaming),
        isToolActive: Boolean(isToolActive),
        answerLanded: Boolean(answerLanded),
        activeToolName,
        activeToolCallId,
        runtimeStatusText,
        isCompacting: Boolean(isCompacting),
        onStop: overdueStop,
      }),
    [isStreaming, isToolActive, answerLanded, activeToolName, activeToolCallId, runtimeStatusText, isCompacting, overdueStop],
  );

  const { chatContext, setChatContext, selectedText, setSelectedText } = useCapturedChatContext();
  const { isDragOver, dropHandlers } = useFileDrop({ setChatContext });

  useEffect(() => {
    if (!openRequest) return;
    if (openRequest.chatContext !== undefined) setChatContext(openRequest.chatContext);
    if (typeof openRequest.prefillText === "string") setInputText(openRequest.prefillText);
    setFocusRequestId((id) => id + 1);
  }, [openRequest, setChatContext, setInputText]);

  const sendCurrentMessage = useCallback(async () => {
    const { canSubmit, trimmedMessage } = deriveComposerState({ message: inputTextStore.getSnapshot(), chatContext, selectedText });
    if (!canSubmit) return;
    const shouldFollowSend = sidebarScroll.getShouldFollowSend();
    const accepted = await onSend(trimmedMessage, chatContext, selectedText, () => {
      if (shouldFollowSend) sidebarScroll.followAfterSend();
      else if (!isStreaming) sidebarScroll.releaseFollow();
    });
    if (!accepted) return;
    setInputText("");
    setChatContext(null);
    setSelectedText(null);
  }, [chatContext, inputTextStore, isStreaming, onSend, selectedText, setChatContext, setInputText, setSelectedText, sidebarScroll]);

  const tail = useMemo(
    () => (
      <>
        {extraTail}
        <UsageLimitChatCard conversationId={conversationId} />
        <SafeguardChatCard conversationId={conversationId} replying={isStreaming} />
      </>
    ),
    [conversationId, extraTail, isStreaming],
  );

  const shown = useRetainedSurfaceActive();
  const [panelRect, setPanelRect] = useState<Layout | null>(null);
  useEffect(() => {
    setSelectionHideZone("chat-panel-tab", shown ? panelRect : null);
    return () => setSelectionHideZone("chat-panel-tab", null);
  }, [panelRect, shown]);

  return (
    <col id="chat-panel-tab" w="full" h="full" grow={1} minH={0} {...dropHandlers} onLayout={setPanelRect}>
      <col grow={1} minH={0} w="full">
        <CompactConversationSurface
          className="chat-sidebar-messages"
          variant="sidebar"
          scroll={sidebarScrollApi}
          messages={messages}
          conversationId={conversationId}
          isStreaming={isStreaming}
          runtimeStatusText={runtimeStatusText}
          pendingUserMessageId={pendingUserMessageId}
          indicator={indicatorProps}
          hasOlderMessages={hasOlderMessages}
          isLoadingOlder={isLoadingOlder}
          isLoadingHistory={isInitialLoading}
          contentContainerStyle={wideLayout ? WIDE_PANEL_CONTENT_STYLE : SIDEBAR_CONTENT_STYLE}
          estimatedItemSize={wideLayout ? 140 : undefined}
          extraTail={tail}
        />
        <col id="chat-sidebar-composer" w="full" shrink={false} align="center" gap={6} px={wideLayout ? 24 : window.innerWidth <= 600 ? 6 : 12}>
          <ConnectorConnectCard compact conversationId={conversationId} />
          <CloudBrowserInterventionCard compact conversationId={conversationId} />
          <ComposerNotice compact conversationId={conversationId} />
        </col>
        <StoreBackedComposer
          messageStore={inputTextStore}
          setMessage={setInputText}
          chatContext={chatContext}
          setChatContext={setChatContext}
          selectedText={selectedText}
          setSelectedText={setSelectedText}
          isStreaming={isStreaming}
          focusRequestId={focusRequestId}
          conversationId={conversationId ?? null}
          onSend={() => void sendCurrentMessage()}
          onStop={requestStop}
          isDragOver={isDragOver}
          replyPeek={replyPeek}
          suggestionsActive={false}
          variant={wideLayout ? "sidebar-wide" : "sidebar"}
        />
      </col>
    </col>
  );
}
