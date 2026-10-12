/**
 * Reminders: text Stella wrote when the reminder was set, delivered at fire
 * time with no model and no turn. A fire is three things at once: a push to
 * the phone, an in-app notice on the desktop, and a `reminder` card in the
 * conversation's journal, which every client shows as Stella's message with
 * Done and Snooze, and every host reads as Stella's own line.
 */

export const REMINDER_CARD_TYPE = "reminder";
export const REMINDER_PUSH_KIND = "reminder";
export const REMINDER_PUSH_CATEGORY = "reminder";
export const REMINDER_ACTION_DONE = "reminder.done";
export const REMINDER_ACTION_SNOOZE = "reminder.snooze";

/** What a push's Snooze and the default in-app Snooze wait. */
export const REMINDER_DEFAULT_SNOOZE_MINUTES = 10;
export const REMINDER_MAX_SNOOZE_MINUTES = 7 * 24 * 60;
/** A delivery this much later than it was due says when it was due. */
export const REMINDER_LATE_MS = 10 * 60_000;

export type ReminderCard = {
  type: typeof REMINDER_CARD_TYPE;
  fireId: string;
  scheduleId: string;
  text: string;
  /** Set when it went out late (the cloud or the account was away): when it was due. */
  dueAt?: number;
};

export type ReminderMark = { fireId: string; scheduleId: string; dueAt?: number };

export type ReminderFireState = "open" | "done" | "snoozed";

/** One delivery of a reminder, as `schedules.reminders` lists it. */
export type ReminderFire = {
  fireId: string;
  scheduleId: string;
  conversationId?: string;
  text: string;
  firedAt: number;
  /** Set when it went out late: when it was due. */
  dueAt?: number;
  state: ReminderFireState;
  /** Set while snoozed: when it comes back. */
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

/** The mark a reminder card gives its line. */
export const reminderMarkOf = (card: ReminderCard): ReminderMark => ({
  fireId: card.fireId,
  scheduleId: card.scheduleId,
  ...(card.dueAt !== undefined ? { dueAt: card.dueAt } : {}),
});

/**
 * The reminder as a line Stella said: what a host's transcript imports, so
 * the model knows it was delivered, and what a timeline renders, with the
 * `reminder` mark that brings Done and Snooze.
 */
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

/** The next 9:00 local after `now`, for "Tomorrow morning". */
export const tomorrowMorningMinutes = (now: Date): number => {
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(9, 0, 0, 0);
  return Math.max(1, Math.round((next.getTime() - now.getTime()) / 60_000));
};
