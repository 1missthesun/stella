import { serverNow } from "./server-clock.js";

/**
 * Claude's monthly spend cap does not lift at the session reset Claude may name
 * alongside it.
 */
export type ClaudeUsageLimit = { resetsAt?: number; monthly?: true };

const LIMIT_PATTERN =
  /usage limit|limit reached|hit your (?:[\w-]+ )?limit|out of (?:extra )?usage|\bspend(?:ing)? limit\b|\b(?:session|weekly|monthly|5-hour|opus|sonnet) limit\b/i;

const MONTHLY_PATTERN = /\bmonthly (?:spend(?:ing)? |usage |extra usage )?(?:limit|cap)\b|\bspend(?:ing)? (?:limit|cap)\b/i;

const RESET_PATTERN =
  /\bresets?\s+(?:at\s+)?(?:(?<month>[A-Za-z]{3,9})\.?\s+(?<day>\d{1,2})(?:st|nd|rd|th)?,?\s+(?:at\s+)?)?(?<hour>\d{1,2})(?::(?<minute>\d{2}))?\s*(?<meridiem>am|pm)?(?:\s*\((?<zone>[^)]+)\))?/i;

const JUST_RESET_MS = 10 * 60 * 1000;
const JUST_RESET_RECHECK_MS = 5 * 60 * 1000;
const TOMORROW_AFTER_MS = 12 * 60 * 60 * 1000;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const validZone = (zone: string | undefined): string | undefined => {
  if (!zone) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return undefined;
  }
};

const zoneParts = (epoch: number, zone: string | undefined) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    ...(zone ? { timeZone: zone } : {}),
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(epoch));
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  };
};

const zoneOffset = (epoch: number, zone: string | undefined) => {
  const wall = zoneParts(epoch, zone);
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - Math.floor(epoch / 1000) * 1000;
};

const zonedEpoch = (year: number, month: number, day: number, hour: number, minute: number, zone: string | undefined) => {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - zoneOffset(guess, zone);
  return guess - zoneOffset(first, zone);
};

const wallClockReset = (message: string, now: number): number | undefined => {
  const match = RESET_PATTERN.exec(message);
  const groups = match?.groups;
  if (!groups) return undefined;
  if (!groups.meridiem && !groups.minute) return undefined;
  let hour = Number(groups.hour);
  const minute = groups.minute ? Number(groups.minute) : 0;
  if (groups.meridiem) {
    if (hour < 1 || hour > 12) return undefined;
    hour = (hour % 12) + (groups.meridiem.toLowerCase() === "pm" ? 12 : 0);
  } else if (hour > 23) {
    return undefined;
  }
  if (minute > 59) return undefined;
  const zone = validZone(groups.zone?.trim());
  const today = zoneParts(now, zone);
  if (groups.month && groups.day) {
    const month = MONTHS.indexOf(groups.month.slice(0, 3).toLowerCase()) + 1;
    if (month === 0) return undefined;
    const day = Number(groups.day);
    let at = zonedEpoch(today.year, month, day, hour, minute, zone);
    if (at < now - 24 * 60 * 60 * 1000) at = zonedEpoch(today.year + 1, month, day, hour, minute, zone);
    if (at > now) return at;
    return now - at < JUST_RESET_MS ? now + JUST_RESET_RECHECK_MS : undefined;
  }
  let at = zonedEpoch(today.year, today.month, today.day, hour, minute, zone);
  if (at > now) return at;
  if (now - at < JUST_RESET_MS) return now + JUST_RESET_RECHECK_MS;
  if (now - at < TOMORROW_AFTER_MS) return undefined;
  const tomorrow = zoneParts(at + 24 * 60 * 60 * 1000, zone);
  return zonedEpoch(tomorrow.year, tomorrow.month, tomorrow.day, hour, minute, zone);
};

const future = (at: number, now: number): ClaudeUsageLimit => {
  if (at > now) return { resetsAt: at };
  return now - at < JUST_RESET_MS ? { resetsAt: now + JUST_RESET_RECHECK_MS } : {};
};

export const claudeUsageLimitOf = (error: unknown, now = serverNow()): ClaudeUsageLimit | null => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!LIMIT_PATTERN.test(message)) return null;
  if (MONTHLY_PATTERN.test(message)) return { monthly: true };
  const epoch = /\|(\d{10})\b/.exec(message)?.[1];
  if (epoch) return future(Number(epoch) * 1000, now);
  const instant = /\bresets? at (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z)/i.exec(message)?.[1];
  if (instant && Number.isFinite(Date.parse(instant))) return future(Date.parse(instant), now);
  const resetsAt = wallClockReset(message, now);
  return resetsAt !== undefined && Number.isFinite(resetsAt) ? { resetsAt } : {};
};

export const formatClaudeUsageLimitReset = (resetsAt: number, now = serverNow()) => {
  const at = new Date(resetsAt);
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const sameDay = new Date(now).toDateString() === at.toDateString();
  if (sameDay) return time;
  const day = at.toLocaleDateString(undefined, {
    weekday: "short",
    ...(resetsAt - now > 6 * 24 * 60 * 60 * 1000 ? { month: "short", day: "numeric" } : {}),
  });
  return `${day} ${time}`;
};

export type ClaudeUsageLimitCard = {
  type: "usage-limit";
  state: "held" | "resumed";
  until?: number;
  threadId?: string;
  deviceId?: string;
  monthly?: true;
  resume?: true;
  requestId?: string;
};

export const parseClaudeUsageLimitCard = (value: unknown): ClaudeUsageLimitCard | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.type !== "usage-limit" || (raw.state !== "held" && raw.state !== "resumed")) return null;
  return {
    type: "usage-limit",
    state: raw.state,
    ...(typeof raw.until === "number" && Number.isFinite(raw.until) ? { until: raw.until } : {}),
    ...(typeof raw.threadId === "string" && raw.threadId ? { threadId: raw.threadId } : {}),
    ...(typeof raw.deviceId === "string" && raw.deviceId ? { deviceId: raw.deviceId } : {}),
    ...(raw.monthly === true ? { monthly: true as const } : {}),
    ...(raw.resume === true ? { resume: true as const } : {}),
    ...(typeof raw.requestId === "string" && raw.requestId ? { requestId: raw.requestId } : {}),
  };
};

export const USAGE_LIMIT_PAUSE_STALE_MS = 15 * 60_000;
export const USAGE_LIMIT_PAUSE_UNTIMED_MS = 24 * 60 * 60_000;

export const USAGE_LIMIT_STILL_LIMITED_MS = 90_000;

export const usageLimitPauseKey = (card: Pick<ClaudeUsageLimitCard, "threadId">): string => card.threadId ?? "";

export type UsageLimitPauses = {
  held: Map<string, { until?: number; monthly?: true; at: number; deviceId?: string }>;
  resumedAt?: number;
  resumed: boolean;
};

export const emptyUsageLimitPauses = (): UsageLimitPauses => ({ held: new Map(), resumed: false });

export const applyUsageLimitCard = (pauses: UsageLimitPauses, card: ClaudeUsageLimitCard, at: number): void => {
  if (card.resume) {
    for (const [key, pause] of pauses.held) if (pause.at <= at) pauses.held.delete(key);
    pauses.resumedAt = Math.max(pauses.resumedAt ?? 0, at);
    pauses.resumed = pauses.held.size === 0;
    return;
  }
  const key = usageLimitPauseKey(card);
  if (card.state === "held") {
    pauses.held.set(key, {
      at,
      ...(card.until !== undefined ? { until: card.until } : {}),
      ...(card.monthly ? { monthly: true as const } : {}),
      ...(card.deviceId ? { deviceId: card.deviceId } : {}),
    });
    pauses.resumed = false;
    return;
  }
  if (pauses.held.delete(key) && pauses.held.size === 0 && pauses.resumedAt !== undefined) pauses.resumed = true;
};

export const dropStaleUsageLimitPauses = (pauses: UsageLimitPauses, now = serverNow()): void => {
  for (const [key, pause] of pauses.held) {
    const stale =
      pause.until !== undefined
        ? pause.until < now - USAGE_LIMIT_PAUSE_STALE_MS
        : pause.at < now - USAGE_LIMIT_PAUSE_UNTIMED_MS;
    if (stale) pauses.held.delete(key);
  }
  if (pauses.held.size > 0) pauses.resumed = false;
};

export const foldUsageLimitPauses = (
  cards: Iterable<{ card: ClaudeUsageLimitCard; createdAtMs: number }>,
  now = serverNow(),
): UsageLimitPauses => {
  const pauses = emptyUsageLimitPauses();
  for (const { card, createdAtMs } of cards) applyUsageLimitCard(pauses, card, createdAtMs);
  dropStaleUsageLimitPauses(pauses, now);
  return pauses;
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export const usageLimitPausedWhat = (pauses: { reply: boolean; tasks: number }): string =>
  [...(pauses.reply ? ["your reply"] : []), ...(pauses.tasks > 0 ? [plural(pauses.tasks, "task")] : [])].join(" and ") ||
  "your work";

export type UsageLimitSummary = {
  reply: boolean;
  tasks: number;
  until?: number;
  monthly?: true;
  stillLimited?: true;
};

export const usageLimitHoldsCloudReply = (pauses: UsageLimitPauses, now = serverNow()): boolean => {
  const reply = pauses.held.get("");
  return Boolean(reply && !reply.deviceId && (reply.until === undefined || reply.until > now));
};

export const summarizeUsageLimitPauses = (pauses: UsageLimitPauses): UsageLimitSummary | null => {
  if (pauses.held.size === 0) return null;
  const values = [...pauses.held.values()];
  const reply = pauses.held.has("");
  const times = values.flatMap((pause) => (pause.until !== undefined ? [pause.until] : []));
  const resumedAt = pauses.resumedAt;
  const stillLimited =
    resumedAt !== undefined &&
    values.every((pause) => pause.at >= resumedAt && pause.at - resumedAt <= USAGE_LIMIT_STILL_LIMITED_MS);
  return {
    reply,
    tasks: pauses.held.size - (reply ? 1 : 0),
    ...(times.length > 0 ? { until: Math.max(...times) } : {}),
    ...(values.some((pause) => pause.monthly) ? { monthly: true as const } : {}),
    ...(stillLimited ? { stillLimited: true as const } : {}),
  };
};

export const parseUsageLimitSummary = (value: unknown): UsageLimitSummary | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.reply !== "boolean" || typeof raw.tasks !== "number" || !Number.isFinite(raw.tasks)) return null;
  return {
    reply: raw.reply,
    tasks: Math.max(0, Math.floor(raw.tasks)),
    ...(typeof raw.until === "number" && Number.isFinite(raw.until) ? { until: raw.until } : {}),
    ...(raw.monthly === true ? { monthly: true as const } : {}),
    ...(raw.stillLimited === true ? { stillLimited: true as const } : {}),
  };
};

export type UsageLimitNotice = {
  title: string;
  description?: string;
  canResume: boolean;
};

export const USAGE_LIMIT_RESUMED_TITLE = "Resumed";

export const usageLimitNotice = (
  summary: UsageLimitSummary | "resumed",
  formatTime: (at: number) => string,
): UsageLimitNotice => {
  if (summary === "resumed") return { title: USAGE_LIMIT_RESUMED_TITLE, canResume: false };
  const base = summary.monthly
    ? "Claude's monthly spend limit is reached for this account. Switch accounts, then press Resume."
    : summary.until !== undefined
      ? `It resets at ${formatTime(summary.until)}.`
      : undefined;
  const description = summary.stillLimited ? ["Still limited.", ...(base ? [base] : [])].join(" ") : base;
  return {
    title: `Paused by the Claude usage limit: ${usageLimitPausedWhat(summary)}`,
    ...(description ? { description } : {}),
    canResume: true,
  };
};

export const USAGE_LIMIT_PAUSED_STATUS = "paused: usage limit";


export const USAGE_LIMIT_BACKGROUND_NOTE =
  "Background shell commands you had started were stopped while the work was paused; check what they were doing and rerun any you still need.";

export const CLAUDE_USAGE_LIMIT_RESUME_PROMPT = `A Claude usage limit paused this work, and it is continuing now. Continue the work it interrupted, picking up where you left off. ${USAGE_LIMIT_BACKGROUND_NOTE}`;
