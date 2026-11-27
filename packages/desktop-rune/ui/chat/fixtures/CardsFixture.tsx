import { useState } from "react";
import { I18nProvider } from "@/shared/i18n/RemoteI18nProvider";
import { GALLERY_THEMES } from "../../gallery/spec";
import { ThemeBackdrop, ThemeScope } from "../../theme";
import { SafeguardChatCard, UsageLimitChatCard } from "../cards/LimitCards";
import { ReminderFireCard } from "../cards/ReminderFireCard";
import { ScheduleNotices } from "../cards/ScheduleNotices";
import { VoiceSessionCard } from "../VoiceSessionCard";
import { UserAskRecordCard } from "../UserAskRecordCard";
import { UserAskDeck } from "../user-ask/UserAskDeck";
import { ComposerNotice } from "../ComposerNotice";
import { CARDS_ASK_RECORD, CARDS_FIXTURE_CONVERSATION, CARDS_REMINDER, CARDS_SCHEDULE, CARDS_VOICE_MS, cardsAsk, seedCardStores } from "./cards";

seedCardStores();

function Cards() {
  const [asks] = useState(() => [cardsAsk(Date.now())]);
  return (
    <col w="full" h="full">
      <ThemeBackdrop id="cards-fixture-backdrop" />
      <col id="cards-fixture-scroll" w="full" h="full" scrollY>
        <box w="full" h={900}>
          <col absolute={{ top: 24, left: 66 }} w={620} gap={16}>
            <UsageLimitChatCard conversationId={CARDS_FIXTURE_CONVERSATION} />
            <SafeguardChatCard conversationId={CARDS_FIXTURE_CONVERSATION} replying={false} />
            <ReminderFireCard mark={CARDS_REMINDER.mark} text={CARDS_REMINDER.text} firedAtMs={CARDS_REMINDER.firedAtMs} />
            <ScheduleNotices first={CARDS_SCHEDULE} />
            <VoiceSessionCard durationMs={CARDS_VOICE_MS} />
            <UserAskRecordCard record={CARDS_ASK_RECORD} />
          </col>
          <col absolute={{ top: 24, left: 714 }} w={620} gap={16}>
            <UserAskDeck asks={asks} />
            <ComposerNotice conversationId={CARDS_FIXTURE_CONVERSATION} />
          </col>
        </box>
      </col>
    </col>
  );
}

/** desktop-ui's chat cards over fixture data, for side-by-sides with reference/?page=cards (`STELLA_CHAT_FIXTURE_THEME`: light, dark, gradient). */
export function App() {
  const requested = process.env.STELLA_CHAT_FIXTURE_THEME ?? "dark";
  const key = (requested in GALLERY_THEMES ? requested : "dark") as keyof typeof GALLERY_THEMES;
  const theme = GALLERY_THEMES[key];
  return (
    <I18nProvider>
      <ThemeScope themeId={theme.themeId} mode={theme.mode} customBase={theme.base}>
        <Cards />
      </ThemeScope>
    </I18nProvider>
  );
}

export function initialState() {
  return { error: null, swaps: 0, lastSwapMs: null };
}
