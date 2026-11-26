import { useState } from "react";
import { I18nProvider } from "@/shared/i18n/RemoteI18nProvider";
import { ConversationEvents } from "@/app/chat/ConversationEvents";
import { GALLERY_THEMES } from "../../gallery/spec";
import { ThemeBackdrop, ThemeScope } from "../../theme";
import { useChatScrollManagement } from "../use-chat-scroll-management";
import { ComposerShell } from "../ComposerShell";
import { ChatVariantContext } from "../chat-text";
import { CHAT_FIXTURE_CONTENT_STYLE, CHAT_FIXTURE_REPLY, chatFixtureMessage, chatFixtureMessages } from "./messages";

const ROWS = Number(process.env.STELLA_CHAT_FIXTURE_ROWS ?? 40);
const SIDEBAR = process.env.STELLA_CHAT_FIXTURE_VARIANT === "sidebar";
const SIDEBAR_CONTENT_STYLE = { paddingLeft: 12, paddingRight: 12, paddingTop: 48, paddingBottom: 12 };

function Fixture() {
  const [messages, setMessages] = useState(() => chatFixtureMessages(ROWS));
  const [draft, setDraft] = useState("");
  const scroll = useChatScrollManagement({ paginationKey: "fixture" });
  const column = (
    <col w="full" h="full">
      <ThemeBackdrop id="chat-fixture-backdrop" />
      <box grow={1} minH={0} w="full">
        <ConversationEvents messages={messages} conversationId="fixture" list={scroll.list as never} contentContainerStyle={SIDEBAR ? SIDEBAR_CONTENT_STYLE : CHAT_FIXTURE_CONTENT_STYLE} estimatedItemSize={140} />
      </box>
      <ComposerShell
        value={draft}
        placeholder="Do anything"
        onChange={setDraft}
        onSubmit={() => {
          const text = draft.trim();
          if (!text) return;
          setDraft("");
          setMessages((prev) => [...prev, chatFixtureMessage(prev.length, "user_message", text), chatFixtureMessage(prev.length + 1, "assistant_message", CHAT_FIXTURE_REPLY)]);
        }}
      />
    </col>
  );
  return SIDEBAR ? (
    <ChatVariantContext.Provider value="sidebar">
      <row w="full" h="full" justify="end">
        <col w={480} h="full">{column}</col>
      </row>
    </ChatVariantContext.Provider>
  ) : (
    column
  );
}

/** A chat column over fixture messages, for side-by-sides with reference/ (`STELLA_CHAT_FIXTURE_THEME`: light, dark, gradient). */
export function App() {
  const requested = process.env.STELLA_CHAT_FIXTURE_THEME ?? "dark";
  const key = (requested in GALLERY_THEMES ? requested : "dark") as keyof typeof GALLERY_THEMES;
  const theme = GALLERY_THEMES[key];
  return (
    <I18nProvider>
      <ThemeScope themeId={theme.themeId} mode={theme.mode} customBase={theme.base}>
        <Fixture />
      </ThemeScope>
    </I18nProvider>
  );
}

export function initialState() {
  return { error: null, swaps: 0, lastSwapMs: null };
}
