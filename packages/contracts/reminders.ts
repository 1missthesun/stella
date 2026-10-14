export const REMINDER_CARD_TYPE = "reminder";
export const REMINDER_PUSH_KIND = "reminder";
export const REMINDER_PUSH_CATEGORY = "reminder";
export const REMINDER_ACTION_DONE = "reminder.done";
export const REMINDER_ACTION_SNOOZE = "reminder.snooze";

export const REMINDER_DEFAULT_SNOOZE_MINUTES = 10;
export const REMINDER_MAX_SNOOZE_MINUTES = 7 * 24 * 60;
export const REMINDER_LATE_MS = 10 * 60_000;

export type ReminderCard = {
  type: typeof REMINDER_CARD_TYPE;
  fireId: string;
  scheduleId: string;
  text: string;
  dueAt?: number;
};

export type ReminderMark = { fireId: string; scheduleId: string; dueAt?: number };

export type ReminderFireState = "open" | "done" | "snoozed";

export type ReminderFire = {
  fireId: string;
  scheduleId: string;
  conversationId?: string;
  text: string;
  firedAt: number;
  dueAt?: number;
  state: ReminderFireState;
  snoozedUntil?: number;
  updatedAt: number;
};

export type ReminderPushData = {
  kind: typeof REMINDER_PUSH_KIND;
  fireId: string;
  scheduleId: string;
  conversationId?: string;
};

const nonEmpty = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;

export const parseReminderCard = (value: unknown): ReminderCard | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.type !== REMINDER_CARD_TYPE) return null;
  const fireId = nonEmpty(raw.fireId);
  const scheduleId = nonEmpty(raw.scheduleId);
  const text = nonEmpty(raw.text);
  if (!fireId || !scheduleId || !text) return null;
  const dueAt = typeof raw.dueAt === "number" && Number.isFinite(raw.dueAt) ? raw.dueAt : undefined;
  return { type: REMINDER_CARD_TYPE, fireId, scheduleId, text, ...(dueAt !== undefined ? { dueAt } : {}) };
};

export const parseReminderMark = (value: unknown): ReminderMark | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const fireId = nonEmpty(raw.fireId);
  const scheduleId = nonEmpty(raw.scheduleId);
  const dueAt = typeof raw.dueAt === "number" && Number.isFinite(raw.dueAt) ? raw.dueAt : undefined;
  return fireId && scheduleId ? { fireId, scheduleId, ...(dueAt !== undefined ? { dueAt } : {}) } : null;
};

export const reminderMarkOf = (card: ReminderCard): ReminderMark => ({
  fireId: card.fireId,
  scheduleId: card.scheduleId,
  ...(card.dueAt !== undefined ? { dueAt: card.dueAt } : {}),
});

export const reminderAssistantMessage = (card: ReminderCard, createdAtMs: number) => ({
  role: "assistant" as const,
  content: [{ type: "text" as const, text: card.text }],
  api: "stella-reminder",
  provider: "stella",
  model: "reminder",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop" as const,
  timestamp: createdAtMs,
  reminder: reminderMarkOf(card),
});

export const parseReminderPushData = (value: unknown): ReminderPushData | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.kind !== REMINDER_PUSH_KIND) return null;
  const fireId = nonEmpty(raw.fireId);
  const scheduleId = nonEmpty(raw.scheduleId);
  if (!fireId || !scheduleId) return null;
  const conversationId = nonEmpty(raw.conversationId);
  return {
    kind: REMINDER_PUSH_KIND,
    fireId,
    scheduleId,
    ...(conversationId ? { conversationId } : {}),
  };
};

export const tomorrowMorningMinutes = (now: Date): number => {
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(9, 0, 0, 0);
  return Math.max(1, Math.round((next.getTime() - now.getTime()) / 60_000));
};
