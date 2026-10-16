import type { LocalCronSchedule } from "./scheduling.js";

export type ScheduleTiming =
  | { kind: "today" | "tomorrow"; time: string }
  | { kind: "weekday"; day: number; time: string }
  | { kind: "date"; atMs: number; time: string }
  | { kind: "daily" | "weekdays" | "weekends"; time: string }
  | { kind: "weekly"; day: number; time: string }
  | { kind: "days"; days: number[]; time: string }
  | { kind: "interval"; unit: "minutes" | "hours" | "days"; count: number }
  | { kind: "raw"; text: string };

export const SCHEDULE_NOTICE_CARD_TYPE = "schedule-notice";
export const SCHEDULE_NOTICE_MESSAGE_MAX_CHARS = 600;

/** `waiting`: a run came due while the computer it runs on was away; it runs once that computer is back. */
export type ScheduleNoticeAction = "created" | "updated" | "paused" | "resumed" | "removed" | "waiting";
export type ScheduleNoticeKind = "reminder" | "task" | "watch";

/** A schedule was set up, changed or removed; shown in its conversation. */
export type ScheduleNoticeCard = {
  type: typeof SCHEDULE_NOTICE_CARD_TYPE;
  action: ScheduleNoticeAction;
  scheduleId: string;
  kind: ScheduleNoticeKind;
  name: string;
  schedule?: LocalCronSchedule;
  zone?: string;
  nextRunAt?: number;
  /** A reminder's own words, when they differ from its name. */
  message?: string;
};

const ACTIONS: readonly ScheduleNoticeAction[] = ["created", "updated", "paused", "resumed", "removed", "waiting"];
const KINDS: readonly ScheduleNoticeKind[] = ["reminder", "task", "watch"];

const nonEmpty = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value : null;

const finite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const parseSchedule = (value: unknown): LocalCronSchedule | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.kind === "at") {
    const atMs = finite(raw.atMs);
    return atMs === undefined ? undefined : { kind: "at", atMs };
  }
  if (raw.kind === "every") {
    const everyMs = finite(raw.everyMs);
    const anchorMs = finite(raw.anchorMs);
    return everyMs === undefined || everyMs <= 0
      ? undefined
      : { kind: "every", everyMs, ...(anchorMs !== undefined ? { anchorMs } : {}) };
  }
  if (raw.kind === "cron") {
    const expr = nonEmpty(raw.expr);
    const tz = nonEmpty(raw.tz);
    return expr ? { kind: "cron", expr, ...(tz ? { tz } : {}) } : undefined;
  }
  return undefined;
};

export const parseScheduleNoticeCard = (value: unknown): ScheduleNoticeCard | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.type !== SCHEDULE_NOTICE_CARD_TYPE) return null;
  const action = ACTIONS.find((entry) => entry === raw.action);
  const kind = KINDS.find((entry) => entry === raw.kind);
  const scheduleId = nonEmpty(raw.scheduleId);
  const name = nonEmpty(raw.name);
  if (!action || !kind || !scheduleId || !name) return null;
  const schedule = parseSchedule(raw.schedule);
  const zone = nonEmpty(raw.zone);
  const nextRunAt = finite(raw.nextRunAt);
  const message = nonEmpty(raw.message);
  return {
    type: SCHEDULE_NOTICE_CARD_TYPE,
    action,
    scheduleId,
    kind,
    name,
    ...(schedule ? { schedule } : {}),
    ...(zone ? { zone } : {}),
    ...(nextRunAt !== undefined ? { nextRunAt } : {}),
    ...(message ? { message } : {}),
  };
};

/** The i18n key under `schedule.notice.title` for a card's heading. */
export const scheduleNoticeTitleKey = (card: Pick<ScheduleNoticeCard, "action" | "kind">): string =>
  `${card.action}.${card.kind}`;

type Translate = (key: string, params?: Record<string, string | number>) => string;
type TranslatePlural = (key: string, count: number, params?: Record<string, string | number>) => string;

const SUNDAY_NOON_UTC = Date.UTC(2023, 0, 1, 12);

const weekdayName = (locale: string, day: number, width: "long" | "short"): string => {
  try {
    return new Intl.DateTimeFormat(locale, { weekday: width, timeZone: "UTC" }).format(
      new Date(SUNDAY_NOON_UTC + day * 86_400_000),
    );
  } catch {
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day] ?? "";
  }
};

const monthDay = (locale: string, atMs: number): string => {
  try {
    const sameYear = new Date(atMs).getFullYear() === new Date().getFullYear();
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
    }).format(new Date(atMs));
  } catch {
    return new Date(atMs).toDateString();
  }
};

const KEY = "schedule.notice.when";

/** Words for when a schedule runs, from the catalog's `schedule.notice.when` strings. */
export const scheduleTimingText = (
  timing: ScheduleTiming,
  i18n: { t: Translate; tPlural: TranslatePlural; locale: string },
): string => {
  const { t, tPlural, locale } = i18n;
  switch (timing.kind) {
    case "today":
      return t(`${KEY}.today`, { time: timing.time });
    case "tomorrow":
      return t(`${KEY}.tomorrow`, { time: timing.time });
    case "weekday":
      return t(`${KEY}.onDay`, { day: weekdayName(locale, timing.day, "long"), time: timing.time });
    case "date":
      return t(`${KEY}.onDate`, { date: monthDay(locale, timing.atMs), time: timing.time });
    case "daily":
      return t(`${KEY}.daily`, { time: timing.time });
    case "weekdays":
      return t(`${KEY}.weekdays`, { time: timing.time });
    case "weekends":
      return t(`${KEY}.weekends`, { time: timing.time });
    case "weekly":
      return t(`${KEY}.weekly`, { day: weekdayName(locale, timing.day, "long"), time: timing.time });
    case "days":
      return t(`${KEY}.onDays`, {
        days: timing.days.map((day) => weekdayName(locale, day, "short")).join(", "),
        time: timing.time,
      });
    case "interval":
      return tPlural(
        `${KEY}.${timing.unit === "minutes" ? "everyMinutes" : timing.unit === "hours" ? "everyHours" : "everyDays"}`,
        timing.count,
      );
    case "raw":
      return timing.text;
  }
};
