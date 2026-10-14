import { type ReactNode } from "react";
import { useFullShellChat } from "@/shell/use-full-shell-chat";
import { ChatRuntimeContext } from "@/context/chat-runtime-context";
import { ChatMessagesContext } from "@/context/chat-messages-context";

type ChatRuntimeProviderProps = {
  activeConversationId: string | null;
  isOnChatRoute: boolean;
  children: ReactNode;
};

export function ChatRuntimeProvider({
  activeConversationId,
  isOnChatRoute,
  children,
}: ChatRuntimeProviderProps) {
  const { runtime, messages } = useFullShellChat({
    activeConversationId,
    isOnChatRoute,
  });

  return (
    <ChatRuntimeContext.Provider value={runtime}>
      <ChatMessagesContext.Provider value={messages}>
        {children}
      </ChatMessagesContext.Provider>
    </ChatRuntimeContext.Provider>
  );
}
