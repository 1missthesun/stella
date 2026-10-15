import type { LocalCronSchedule } from "./scheduling.js";
import type { ScheduleTiming } from "./schedule-notice.js";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const SHORT_WEEKDAYS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;
const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const padTime = (h: number, m: number): string =>
  `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

const formatClock12 = (h: number, m: number): string => {
  const period = h >= 12 ? "PM" : "AM";
  const displayHour = h % 12 === 0 ? 12 : h % 12;
  return `${displayHour}:${String(m).padStart(2, "0")} ${period}`;
};

let deviceHourCycle: () => "h12" | "h23" | null = () => null;

/**
 * Where the device's own 12/24-hour choice comes from, for a platform whose
 * `Intl` reports only its locale's default (Hermes on iOS ignores the
 * 24-Hour Time switch). Answer null to fall back to `Intl`.
 */
export const setDeviceHourCycle = (read: () => "h12" | "h23" | null): void => {
  deviceHourCycle = read;
};

const chosenHourCycle = (): "h12" | "h23" | null => {
  try {
    return deviceHourCycle();
  } catch {
    return null;
  }
};

const uses12HourClock = (): boolean => {
  const chosen = chosenHourCycle();
  if (chosen) return chosen === "h12";
  try {
    const options = new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
    }).resolvedOptions();
    if (options.hourCycle) {
      return options.hourCycle === "h11" || options.hourCycle === "h12";
    }
    return options.hour12 !== false;
  } catch {
    return true;
  }
};

const formatClock = (h: number, m: number): string =>
  uses12HourClock() ? formatClock12(h, m) : padTime(h, m);

const isSameCalendarDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export const formatNextRun = (nextRunAtMs: number, nowMs: number): string => {
  if (!Number.isFinite(nextRunAtMs)) return "";
  const delta = nextRunAtMs - nowMs;
  if (delta <= -MINUTE_MS) return "due";
  if (delta < MINUTE_MS) return "now";
  if (delta < HOUR_MS) {
    const mins = Math.round(delta / MINUTE_MS);
    return `in ${mins}m`;
  }
  if (delta < 6 * HOUR_MS) {
    const hours = Math.floor(delta / HOUR_MS);
    const mins = Math.round((delta - hours * HOUR_MS) / MINUTE_MS);
    return mins > 0 ? `in ${hours}h ${mins}m` : `in ${hours}h`;
  }

  const next = new Date(nextRunAtMs);
  const now = new Date(nowMs);
  if (isSameCalendarDay(next, now)) {
    return formatClock(next.getHours(), next.getMinutes());
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (isSameCalendarDay(next, tomorrow)) {
    return `tomorrow ${formatClock(next.getHours(), next.getMinutes())}`;
  }
  if (delta < 7 * DAY_MS) {
    return `${SHORT_WEEKDAYS[next.getDay()]} ${formatClock(next.getHours(), next.getMinutes())}`;
  }
  return `${SHORT_MONTHS[next.getMonth()]} ${next.getDate()}`;
};

const formatIntervalEvery = (everyMs: number): string => {
  if (everyMs >= DAY_MS && everyMs % DAY_MS === 0) {
    const days = everyMs / DAY_MS;
    return days === 1 ? "Daily" : `Every ${days} days`;
  }
  if (everyMs >= HOUR_MS && everyMs % HOUR_MS === 0) {
    const hours = everyMs / HOUR_MS;
    return hours === 1 ? "Hourly" : `Every ${hours}h`;
  }
  const minutes = Math.max(1, Math.round(everyMs / MINUTE_MS));
  return `Every ${minutes} min`;
};

const isAllOrStar = (value: string): boolean => value === "*" || value === "?";

const parseClockTimeFromCron = (
  minute: string,
  hour: string,
): { h: number; m: number } | null => {
  const h = Number(hour);
  const m = Number(minute);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
};

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

const parseWeekdays = (dow: string): Set<number> | null => {
  if (isAllOrStar(dow)) return new Set(ALL_DAYS);
  if (dow.toUpperCase() === "MON-FRI") return new Set([1, 2, 3, 4, 5]);
  const days = new Set<number>();
  for (const part of dow.split(",")) {
    const match = part.match(/^([0-7])(?:-([0-7]))?$/);
    if (!match) return null;
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (end < start) return null;
    for (let day = start; day <= end; day += 1) days.add(day % 7);
  }
  return days.size > 0 ? days : null;
};

const shiftWeekdays = (days: Set<number>, delta: number): Set<number> =>
  delta === 0
    ? days
    : new Set([...days].map((day) => (((day + delta) % 7) + 7) % 7));

const describeWeekdays = (days: Set<number>): string => {
  if (days.size === 7) return "Daily";
  if (days.size === 2 && days.has(0) && days.has(6)) return "Weekends";
  if (days.size === 1) return SHORT_WEEKDAYS[[...days][0]!];
  const starts = ALL_DAYS.filter(
    (day) => days.has(day) && !days.has((day + 6) % 7),
  );
  if (starts.length === 1 && days.size >= 3) {
    const start = starts[0]!;
    const end = (start + days.size - 1) % 7;
    return `${SHORT_WEEKDAYS[start]}–${SHORT_WEEKDAYS[end]}`;
  }
  return ALL_DAYS.filter((day) => days.has(day))
    .map((day) => SHORT_WEEKDAYS[day])
    .join(", ");
};

const UTC_ZONES = new Set(["UTC", "ETC/UTC", "GMT", "ETC/GMT", "Z"]);

type WallClock = { dayIndex: number; h: number; m: number };

const dayIndexOf = (year: number, month: number, day: number): number =>
  Math.floor(Date.UTC(year, month, day) / DAY_MS);

const wallClockInZone = (atMs: number, tz: string): WallClock | null => {
  if (!tz || UTC_ZONES.has(tz.toUpperCase())) {
    const date = new Date(atMs);
    return {
      dayIndex: Math.floor(atMs / DAY_MS),
      h: date.getUTCHours(),
      m: date.getUTCMinutes(),
    };
  }
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    }).formatToParts(new Date(atMs));
    const part = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((entry) => entry.type === type)?.value);
    const year = part("year");
    const month = part("month");
    const day = part("day");
    const h = part("hour") % 24;
    const m = part("minute");
    if (![year, month, day, h, m].every(Number.isFinite)) return null;
    return { dayIndex: dayIndexOf(year, month - 1, day), h, m };
  } catch {
    return null;
  }
};

const localWallClock = (atMs: number): WallClock => {
  const date = new Date(atMs);
  return {
    dayIndex: dayIndexOf(date.getFullYear(), date.getMonth(), date.getDate()),
    h: date.getHours(),
    m: date.getMinutes(),
  };
};

const toLocalClock = (
  time: { h: number; m: number },
  tz: string | undefined,
  nextRunAtMs: number | undefined,
): { h: number; m: number; dayDelta: number } => {
  if (nextRunAtMs === undefined || !Number.isFinite(nextRunAtMs)) {
    return { ...time, dayDelta: 0 };
  }
  const zone = wallClockInZone(nextRunAtMs, tz?.trim() ?? "");
  if (!zone || zone.h !== time.h || zone.m !== time.m) {
    return { ...time, dayDelta: 0 };
  }
  const local = localWallClock(nextRunAtMs);
  return { h: local.h, m: local.m, dayDelta: local.dayIndex - zone.dayIndex };
};

const summarizeCron = (
  expr: string,
  tz: string | undefined,
  nextRunAtMs: number | undefined,
): string => {
  const parts = expr.trim().split(/\s+/);
  const fields = parts.length === 6 ? parts.slice(1) : parts;
  if (fields.length !== 5) return expr;
  const [minute, hour, dom, mon, dow] = fields;
  const time = parseClockTimeFromCron(minute, hour);
  if (!time || !isAllOrStar(dom) || !isAllOrStar(mon)) return expr;
  const days = parseWeekdays(dow);
  if (!days) return expr;
  const local = toLocalClock(time, tz, nextRunAtMs);
  const clock = formatClock(local.h, local.m);
  return `${describeWeekdays(shiftWeekdays(days, local.dayDelta))} ${clock}`;
};

export const summarizeSchedule = (
  schedule: LocalCronSchedule | null | undefined,
  intervalMs?: number,
  nextRunAtMs?: number,
  zone?: string,
): string => {
  if (!schedule) {
    if (typeof intervalMs === "number" && intervalMs > 0) {
      return formatIntervalEvery(intervalMs);
    }
    return "";
  }
  if (schedule.kind === "every") return formatIntervalEvery(schedule.everyMs);
  if (schedule.kind === "at") {
    const date = new Date(schedule.atMs);
    return `Once at ${SHORT_MONTHS[date.getMonth()]} ${date.getDate()}, ${formatClock(date.getHours(), date.getMinutes())}`;
  }
  return summarizeCron(schedule.expr, schedule.tz || zone, nextRunAtMs);
};

const startOfLocalDay = (ms: number): number => {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

const timingOfOnce = (atMs: number, nowMs: number): ScheduleTiming => {
  const at = new Date(atMs);
  const time = formatClock(at.getHours(), at.getMinutes());
  const days = Math.round((startOfLocalDay(atMs) - startOfLocalDay(nowMs)) / DAY_MS);
  if (days === 0) return { kind: "today", time };
  if (days === 1) return { kind: "tomorrow", time };
  if (days > 1 && days < 7) return { kind: "weekday", day: at.getDay(), time };
  return { kind: "date", atMs, time };
};

const timingOfInterval = (everyMs: number): ScheduleTiming => {
  if (everyMs >= DAY_MS && everyMs % DAY_MS === 0) {
    return { kind: "interval", unit: "days", count: everyMs / DAY_MS };
  }
  if (everyMs >= HOUR_MS && everyMs % HOUR_MS === 0) {
    return { kind: "interval", unit: "hours", count: everyMs / HOUR_MS };
  }
  return { kind: "interval", unit: "minutes", count: Math.max(1, Math.round(everyMs / MINUTE_MS)) };
};

const timingOfCron = (expr: string, tz: string | undefined, nextRunAtMs: number | undefined): ScheduleTiming => {
  const parts = expr.trim().split(/\s+/);
  const fields = parts.length === 6 ? parts.slice(1) : parts;
  const raw: ScheduleTiming = { kind: "raw", text: summarizeCron(expr, tz, nextRunAtMs) };
  if (fields.length !== 5) return raw;
  const [minute, hour, dom, mon, dow] = fields;
  const clock = parseClockTimeFromCron(minute, hour);
  if (!clock || !isAllOrStar(dom) || !isAllOrStar(mon)) return raw;
  const parsed = parseWeekdays(dow);
  if (!parsed) return raw;
  const local = toLocalClock(clock, tz, nextRunAtMs);
  const days = shiftWeekdays(parsed, local.dayDelta);
  const time = formatClock(local.h, local.m);
  if (days.size === 7) return { kind: "daily", time };
  if (days.size === 5 && [1, 2, 3, 4, 5].every((day) => days.has(day))) return { kind: "weekdays", time };
  if (days.size === 2 && days.has(0) && days.has(6)) return { kind: "weekends", time };
  if (days.size === 1) return { kind: "weekly", day: [...days][0]!, time };
  return { kind: "days", days: ALL_DAYS.filter((day) => days.has(day)), time };
};

/** When a schedule runs, in this device's time zone, as parts a client words in its own language. */
export const describeScheduleTiming = (
  schedule: LocalCronSchedule,
  options: { nextRunAtMs?: number; zone?: string; nowMs: number },
): ScheduleTiming => {
  if (schedule.kind === "at") return timingOfOnce(schedule.atMs, options.nowMs);
  if (schedule.kind === "every") return timingOfInterval(schedule.everyMs);
  return timingOfCron(schedule.expr, schedule.tz || options.zone, options.nextRunAtMs);
};
