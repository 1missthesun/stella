import type { ReminderMark } from "@stella/contracts/reminders";
import type { ScheduleNoticeCard } from "@stella/contracts/schedule-notice";
import type { UserAsk } from "@stella/contracts/user-ask";
import type { UserAskRecord } from "@stella/contracts/user-ask-deck";
import { presentUsageLimitPaused } from "@/features/chat/usage-limit-card";
import { presentSafeguardBlock } from "@/features/chat/safeguard-card";
import { showComposerNotice } from "@/features/chat/composer-notice-store";
import { CHAT_FIXTURE_START } from "./messages";

export const CARDS_FIXTURE_CONVERSATION = "fixture-cards";

const never = () => new Promise<never>(() => {});

/** Puts the store-driven cards (usage limit, safeguard, composer notice) on the fixture conversation. */
export function seedCardStores(conversationId = CARDS_FIXTURE_CONVERSATION) {
  presentUsageLimitPaused(conversationId, { reply: true, tasks: 2, until: CHAT_FIXTURE_START + 3 * 3_600_000 }, never);
  presentSafeguardBlock(
    conversationId,
    {
      turnId: "fixture-turn",
      title: "This reply was stopped",
      description: "Claude's safety system stopped it. You can remove the message or switch models.",
      remove: { label: "Remove message" },
      switchTo: { label: "GPT", model: "codex/gpt", actionLabel: "Switch to GPT" } as never,
    },
    never,
  );
  showComposerNotice({
    conversationId,
    kind: "upgrade",
    title: "You've used today's included messages",
    description: "Upgrade to keep going, or wait until tomorrow.",
    action: { label: "Upgrade", onClick: () => {} },
    secondaryAction: { label: "Not now", onClick: () => {} },
  });
}

export const CARDS_REMINDER: { mark: ReminderMark; text: string; firedAtMs: number } = {
  mark: { fireId: "fixture-fire", scheduleId: "fixture-schedule", dueAt: CHAT_FIXTURE_START + 30 * 60_000 },
  text: "Call the dentist to move Thursday's appointment.",
  firedAtMs: CHAT_FIXTURE_START + 30 * 60_000,
};

export const CARDS_SCHEDULE: ScheduleNoticeCard = {
  type: "schedule-notice",
  action: "created",
  scheduleId: "fixture-schedule",
  kind: "reminder",
  name: "Water the plants",
  nextRunAt: CHAT_FIXTURE_START + 26 * 3_600_000,
  message: "Water the plants on the balcony.",
};

export const CARDS_VOICE_MS = 3 * 60_000 + 24_000;

export const CARDS_ASK_RECORD: UserAskRecord = {
  id: "fixture-record",
  createdAt: CHAT_FIXTURE_START,
  defaulted: false,
  answers: [
    { question: "Which city should the trip start in?", answer: "Lisbon", kind: "option" },
    { question: "Anything to avoid?", answer: "Early flights", kind: "text" },
  ],
};

export const cardsAsk = (now: number): UserAsk => ({
  schemaVersion: 1,
  askId: "fixture-ask",
  kind: "question",
  conversationId: CARDS_FIXTURE_CONVERSATION,
  threadId: "fixture-thread",
  toolCallId: "fixture-tool",
  originDeviceId: "fixture-device",
  revision: 1,
  state: "pending",
  urgency: 1,
  escalationLevel: 1,
  blocking: false,
  expiresAt: now + 3 * 60_000,
  createdAt: now,
  updatedAt: now,
  detail: {
    kind: "question",
    questions: [
      {
        id: "city",
        question: "Which city should the trip start in?",
        detail: "Flights are cheapest from Lisbon this month.",
        options: [
          { id: "lisbon", label: "Lisbon", hint: "Cheapest" },
          { id: "porto", label: "Porto" },
          { id: "madrid", label: "Madrid" },
        ],
        defaultChoiceId: "lisbon",
      },
      { id: "pace", question: "How packed should the days be?", options: [{ id: "slow", label: "Slow" }, { id: "full", label: "Full" }] },
    ],
  },
});
