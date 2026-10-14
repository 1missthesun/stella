import { cn } from "@/shared/lib/utils";
import { useDeferredChatMessages } from "@/features/chat/hooks/use-deferred-chat-messages";
import type { MessageRecord } from "@stella/contracts/local-chat";
import type { QueuedUserMessage } from "@/features/chat/hooks/use-streaming-chat";
import type { ChatColumnScroll } from "@/features/chat/chat-column-types";
import { ConversationEvents } from "@/app/chat/ConversationEvents";
import type { LegendContentStyle } from "@/app/chat/ChatTimeline";
import type { InlineWorkingIndicatorMountProps } from "@/app/chat/InlineWorkingIndicator";
import "@/app/chat/full-shell.chat.css";
import "./compact-conversation.css";

type CompactConversationVariant = "orb" | "sidebar";

type CompactConversationSurfaceProps = {
  className: string;
  contentContainerStyle?: LegendContentStyle;
  variant: CompactConversationVariant;
  scroll: ChatColumnScroll;
  messages: MessageRecord[];
  conversationId?: string | null;
  maxItems?: number;
  isStreaming: boolean;
  runtimeStatusText?: string | null;
  pendingUserMessageId: string | null;
  queuedUserMessages?: QueuedUserMessage[];
  onCancelQueued?: (message: QueuedUserMessage) => void;
  indicator?: InlineWorkingIndicatorMountProps;
  hasOlderMessages?: boolean;
  isLoadingOlder?: boolean;
  isLoadingHistory?: boolean;
  showConversation?: boolean;
  estimatedItemSize?: number;
  extraTail?: React.ReactNode;
};

export function CompactConversationSurface({
  className,
  contentContainerStyle,
  variant,
  scroll,
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
  showConversation = true,
  estimatedItemSize = 96,
  extraTail,
}: CompactConversationSurfaceProps) {
  const paintedMessages = useDeferredChatMessages(
    messages,
    scroll.isUserScrolling,
    conversationId,
  );
  return (
    <div
      className={cn(
        "chat-viewport-region",
        `chat-viewport-region--${variant}`,
        showConversation && "has-messages",
      )}
    >
      {showConversation ? (
        <div
          className={cn(
            "chat-conversation-surface",
            `chat-conversation-surface--${variant}`,
          )}
        >
          <ConversationEvents
            messages={paintedMessages}
            conversationId={conversationId}
            maxItems={maxItems}
            pendingUserMessageId={pendingUserMessageId}
            queuedUserMessages={queuedUserMessages}
            onCancelQueued={onCancelQueued}
            indicator={indicator}
            hasOlderMessages={hasOlderMessages}
            isLoadingOlder={isLoadingOlder}
            isLoadingHistory={isLoadingHistory}
            list={scroll.list}
            className={className}
            contentContainerStyle={contentContainerStyle}
            estimatedItemSize={estimatedItemSize}
            extraTail={extraTail}
          />
        </div>
      ) : null}
    </div>
  );
}
