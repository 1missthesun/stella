/**
 * A Claude subscription limit (the 5-hour session window, the weekly window,
 * a per-model weekly window) as the `claude` CLI words it, with the time it
 * resets when the CLI says. The CLI has printed both an epoch suffix
 * (`Claude AI usage limit reached|1760000000`) and a wall-clock reset with
 * its time zone (`You've hit your session limit · resets 11:30pm
 * (America/Phoenix)`, `... · resets Oct 14, 9am (America/Phoenix)`).
 * Stella's own wording carries an exact instant (`It resets at
 * 2026-10-12T06:30:00.000Z.`), which is how the cloud reports it onward.
 */
export type ClaudeUsageLimit = { resetsAt?: number };

const LIMIT_PATTERN =
  /usage limit|limit reached|hit your (?:[\w-]+ )?limit|out of (?:extra )?usage|\b(?:session|weekly|5-hour|opus|sonnet) limit\b/i;

const RESET_PATTERN =
  /\bresets?\s+(?:at\s+)?(?:(?<month>[A-Za-z]{3,9})\.?\s+(?<day>\d{1,2})(?:st|nd|rd|th)?,?\s+(?:at\s+)?)?(?<hour>\d{1,2})(?::(?<minute>\d{2}))?\s*(?<meridiem>am|pm)?(?:\s*\((?<zone>[^)]+)\))?/i;

/**
 * A time of day that passed moments ago is this window's reset, seen late,
 * not tomorrow's: check again shortly rather than waiting a day.
 */
const JUST_RESET_MS = 3 * 60 * 60 * 1000;
const JUST_RESET_RECHECK_MS = 60 * 1000;

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

/** The epoch of a wall-clock time in `zone` (this computer's zone when absent). */
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
    return at;
  }
  let at = zonedEpoch(today.year, today.month, today.day, hour, minute, zone);
  if (at <= now && now - at < JUST_RESET_MS) return now + JUST_RESET_RECHECK_MS;
  if (at <= now) {
    const tomorrow = zoneParts(at + 24 * 60 * 60 * 1000, zone);
    at = zonedEpoch(tomorrow.year, tomorrow.month, tomorrow.day, hour, minute, zone);
  }
  return at;
};

/** The limit in a CLI result or error, or null when it names none. */
export const claudeUsageLimitOf = (error: unknown, now = Date.now()): ClaudeUsageLimit | null => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!LIMIT_PATTERN.test(message)) return null;
  const epoch = /\|(\d{10})\b/.exec(message)?.[1];
  if (epoch) return { resetsAt: Number(epoch) * 1000 };
  const instant = /\bresets? at (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z)/i.exec(message)?.[1];
  if (instant && Number.isFinite(Date.parse(instant))) return { resetsAt: Date.parse(instant) };
  const resetsAt = wallClockReset(message, now);
  return resetsAt !== undefined && Number.isFinite(resetsAt) ? { resetsAt } : {};
};

/** "11:30 PM" today, or "Tue 9:00 AM" on a later day, in this computer's zone. */
export const formatClaudeUsageLimitReset = (resetsAt: number, now = Date.now()) => {
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

/**
 * Claude Code work in a cloud conversation is held until the Claude usage
 * limit resets (`held`, with `until` when it was named), or the hold ended
 * and the work continues (`resumed`). `threadId` names a held agent; absent,
 * it is Stella's own turn. Clients show the waiting card and the one line.
 */
export type ClaudeUsageLimitCard = {
  type: "usage-limit";
  state: "held" | "resumed";
  until?: number;
  threadId?: string;
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
  };
};

/** The one line clients show when held work continues. */
export const CLAUDE_USAGE_LIMIT_RESUMED_TEXT = "Claude usage limit reset. Stella is continuing the held work.";

/** What a held turn or agent is told when it continues. */
export const CLAUDE_USAGE_LIMIT_RESUME_PROMPT =
  "The Claude usage limit has reset. Continue the work it interrupted, picking up where you left off.";
