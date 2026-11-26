import { useState } from "react";
import "@/shell/full-shell.layout.css";
import { UsageLimitChatCard } from "@/features/chat/UsageLimitChatCard";
import { SafeguardChatCard } from "@/features/chat/SafeguardChatCard";
import { ReminderFireCard } from "@/features/reminders/ReminderFireCard";
import { ScheduleNotices } from "@/features/schedule/ScheduleNotices";
import { VoiceSessionCard } from "@/app/chat/VoiceSessionCard";
import { UserAskRecordCard } from "@/features/user-ask/UserAskRecordCard";
import { UserAskDeck } from "@/features/user-ask/UserAskDeck";
import { ComposerNotice } from "@/app/chat/ComposerNotice";
import { CARDS_ASK_RECORD, CARDS_FIXTURE_CONVERSATION, CARDS_REMINDER, CARDS_SCHEDULE, CARDS_VOICE_MS, cardsAsk, seedCardStores } from "../ui/chat/fixtures/cards";

seedCardStores();

/** desktop-ui's chat cards over the same fixture data as ui/chat/fixtures/CardsFixture.tsx. */
export function CardsReference() {
  const [asks] = useState(() => [cardsAsk(Date.now())]);
  return (
    <div className="full-body-main" style={{ position: "fixed", inset: 0, overflowY: "auto" }}>
      <div className="session-content" style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", gap: 32, padding: "24px 24px 40px" }}>
        <div style={{ width: 620, display: "flex", flexDirection: "column", gap: 16 }}>
          <UsageLimitChatCard conversationId={CARDS_FIXTURE_CONVERSATION} />
          <SafeguardChatCard conversationId={CARDS_FIXTURE_CONVERSATION} replying={false} />
          <ReminderFireCard mark={CARDS_REMINDER.mark} text={CARDS_REMINDER.text} firedAtMs={CARDS_REMINDER.firedAtMs} />
          <ScheduleNotices first={CARDS_SCHEDULE} />
          <VoiceSessionCard durationMs={CARDS_VOICE_MS} />
          <UserAskRecordCard record={CARDS_ASK_RECORD} />
        </div>
        <div style={{ width: 620, display: "flex", flexDirection: "column", gap: 16 }}>
          <UserAskDeck asks={asks} />
          <ComposerNotice conversationId={CARDS_FIXTURE_CONVERSATION} />
        </div>
      </div>
    </div>
  );
}
