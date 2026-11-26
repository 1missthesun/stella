import type { ReactNode } from "react";
import type { MessageRecord } from "@stella/contracts/local-chat";
import type { ChatColumnScroll } from "@/features/chat/chat-column-types";
import { useDeferredChatMessages } from "@/features/chat/hooks/use-deferred-chat-messages";
import { ConversationEvents } from "@/app/chat/ConversationEvents";
import type { InlineWorkingIndicatorMountProps } from "@/app/chat/InlineWorkingIndicator";
import type { LegendContentStyle } from "../../../chat/ChatTimeline";

type CompactConversationSurfaceProps = {
  className: string;
  contentContainerStyle?: LegendContentStyle;
  variant: "orb" | "sidebar";
  scroll: ChatColumnScroll;
  messages: MessageRecord[];
  conversationId?: string | null;
  maxItems?: number;
  isStreaming: boolean;
  runtimeStatusText?: string | null;
  pendingUserMessageId: string | null;
  indicator?: InlineWorkingIndicatorMountProps;
  hasOlderMessages?: boolean;
  isLoadingOlder?: boolean;
  isLoadingHistory?: boolean;
  showConversation?: boolean;
  estimatedItemSize?: number;
  extraTail?: ReactNode;
};

/** desktop-ui's `CompactConversationSurface`: the conversation in a smaller surface (the chat tab, the orb). */
export function CompactConversationSurface({
  className,
  contentContainerStyle,
  variant,
  scroll,
  messages,
  conversationId,
  maxItems,
  pendingUserMessageId,
  indicator,
  hasOlderMessages,
  isLoadingOlder,
  isLoadingHistory,
  showConversation = true,
  estimatedItemSize = 96,
  extraTail,
}: CompactConversationSurfaceProps) {
  const paintedMessages = useDeferredChatMessages(messages, scroll.isUserScrolling, conversationId);
  return (
    <col id={`chat-viewport-region-${variant}`} grow={showConversation ? 1 : undefined} minH={0} w="full" clip={0}>
      {showConversation ? (
        <col grow={1} minH={0} w="full" justify="end">
          <ConversationEvents
            messages={paintedMessages}
            conversationId={conversationId}
            maxItems={maxItems}
            pendingUserMessageId={pendingUserMessageId}
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
        </col>
      ) : null}
    </col>
  );
}
