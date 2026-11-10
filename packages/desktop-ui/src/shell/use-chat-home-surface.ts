import { useCallback, useEffect, useState } from "react";
import { uiState } from "@/platform/ui-state";
import { viewAtom } from "@/platform/view-state/view-state";

/**
 * Home (a greeting above a centred composer) is the empty state of a
 * conversation and nothing else. `chatHomeSurface` is the one place that
 * decides. A conversation with messages never shows Home, and neither does
 * one whose messages have not arrived yet (launch, reload, sign-in, slow
 * sync), unless this computer last knew that same conversation to be empty.
 */

/** What is known about the conversation's messages right now. */
export type ConversationContent = "has-messages" | "empty" | "unknown";

type ChatHomeSurface = "home" | "chat";

/**
 * The conversation last known here to be empty. View state, so it is
 * forgotten with the account it belongs to.
 */
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
  // Before the conversation resolves there is only the one last shown here.
  const wasEmpty =
    knownEmptyId !== null &&
    (conversationId === null || conversationId === knownEmptyId);
  return wasEmpty ? "home" : "chat";
};

/** Read by the web shell's static first paint (`web-static-home.html`). */
const LAST_SURFACE_KEY = "stella.chatHomeSurface";

type UseChatHomeSurfaceOptions = {
  conversationId: string | null;
  content: ConversationContent;
  /** Messages on screen, including one being sent. */
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
  // A send leaves Home at once, before its message is on screen.
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
