import { useCallback, useEffect, useState } from "react";
import { uiState } from "@/platform/ui-state";
import { viewAtom } from "@/platform/view-state/view-state";

const LAST_SURFACE_KEY = "stella.chatHomeSurface";

export type ConversationContent = "has-messages" | "empty" | "unknown";

type ChatHomeSurface = "home" | "chat";

const knownEmptyConversation = viewAtom<string | null>(
  "chat.emptyConversation",
  null,
  (value) => typeof value === "string",
);

export const chatHomeSurface = (
  conversationId: string | null,
  content: ConversationContent,
  knownEmptyId: string | null,
): ChatHomeSurface => {
  if (content !== "unknown") return content === "empty" ? "home" : "chat";
  if (knownEmptyId !== null) return conversationId === null || conversationId === knownEmptyId ? "home" : "chat";
  return uiState.getItem(LAST_SURFACE_KEY) === "chat" ? "chat" : "home";
};

type UseChatHomeSurfaceOptions = {
  conversationId: string | null;
  content: ConversationContent;
  hasVisibleMessages: boolean;
  hasOpenQuestion?: boolean;
};

type UseChatHomeSurfaceResult = {
  showHomeContent: boolean;
  enterChatSurfaceForInteraction: () => void;
  leaveChatSurfaceAfterFailedSend: () => void;
};

export function useChatHomeSurface({
  conversationId,
  content,
  hasVisibleMessages,
  hasOpenQuestion = false,
}: UseChatHomeSurfaceOptions): UseChatHomeSurfaceResult {
  const knownEmptyId = knownEmptyConversation.use();
  const [sendingIn, setSendingIn] = useState<string | null>(null);

  useEffect(() => {
    if (content === "has-messages") setSendingIn(null);
    if (!conversationId || content === "unknown") return;
    knownEmptyConversation.set((known) =>
      content === "empty"
        ? conversationId
        : known === conversationId
          ? null
          : known,
    );
    const surface: ChatHomeSurface = content === "empty" ? "home" : "chat";
    if (uiState.getItem(LAST_SURFACE_KEY) !== surface) {
      uiState.setItem(LAST_SURFACE_KEY, surface);
    }
  }, [conversationId, content]);

  const surface =
    hasVisibleMessages ||
    hasOpenQuestion ||
    (sendingIn !== null && sendingIn === conversationId)
      ? "chat"
      : chatHomeSurface(conversationId, content, knownEmptyId);

  const enterChatSurfaceForInteraction = useCallback(() => {
    setSendingIn(conversationId);
  }, [conversationId]);

  const leaveChatSurfaceAfterFailedSend = useCallback(() => {
    setSendingIn(null);
  }, []);

  return {
    showHomeContent: surface === "home",
    enterChatSurfaceForInteraction,
    leaveChatSurfaceAfterFailedSend,
  };
}
