import { useState } from "react";
import indexCss from "@/index.css?raw";
import "@/shell/full-shell.layout.css";
import { ConversationEvents } from "@/app/chat/ConversationEvents";
import { useChatScrollManagement } from "@/shell/use-chat-scroll-management";
import { CHAT_FIXTURE_CONTENT_STYLE, chatFixtureMessages } from "../ui/chat/fixtures/messages";

/**
 * Tailwind emits `@theme inline` variables only for usages it finds in its scanned sources, and the
 * reference's sources are this folder; the chat CSS reads them through var(), so set them on :root.
 */
const themeBlock = /@theme inline \{([\s\S]*?)\n\}/.exec(indexCss)?.[1] ?? "";
const style = document.createElement("style");
style.textContent = `:root {${themeBlock}}`;
document.head.append(style);

/** desktop-ui's chat column over the same fixture messages as ui/chat/fixtures/ChatFixture.tsx. */
export function ChatReference() {
  const rows = Number(new URLSearchParams(location.search).get("rows") ?? 40);
  const [messages] = useState(() => chatFixtureMessages(rows));
  const scroll = useChatScrollManagement({ paginationKey: "fixture" });
  return (
    <div className="full-body-main" style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column" }}>
      <div className="chat-viewport-region" style={{ flex: 1, minHeight: 0 }}>
        <div style={{ height: "100%" }}>
          <ConversationEvents messages={messages} conversationId="fixture" list={scroll.list} className="session-content" contentContainerStyle={CHAT_FIXTURE_CONTENT_STYLE} estimatedItemSize={140} />
        </div>
      </div>
    </div>
  );
}
