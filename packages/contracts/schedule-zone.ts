/**
 * The time zone the owner's schedules run in. A cron set without a zone runs
 * in it, so "every day at 9" means 9 where the user is. When a device finds
 * itself somewhere else, it asks once, with one click to move the schedules
 * there: their clock times stay, their zone changes. A one-off at a fixed
 * moment (a flight) is an instant, not a clock time, so it never moves.
 */

/** What `schedules.zone` reads. */
export type ScheduleZone = {
  /** Where schedules run; absent until a device first reports its zone. */
  zone?: string;
  /** The last zone the user was asked about, so each move is asked once. */
  answered?: string;
};

export type ScheduleZoneNotice = {
  /** Where the schedules run now. */
  from: string;
  /** Where this device is. */
  to: string;
  /** How many schedules would move. */
  count: number;
};

/** This device's IANA zone, or null when the platform cannot say. */
export const deviceTimeZone = (): string | null => {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone ? zone : null;
  } catch {
    return null;
  }
};

export const isUsableTimeZone = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

const offsetMinutes = (zone: string, atMs: number): number | null => {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    }).formatToParts(new Date(atMs));
    const part = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((entry) => entry.type === type)?.value);
    const wall = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour") % 24, part("minute"));
    return Number.isFinite(wall) ? Math.round((wall - Math.floor(atMs / 60_000) * 60_000) / 60_000) : null;
  } catch {
    return null;
  }
};

/** Whether two zones keep the same clock now and half a year from now. */
export const sameClock = (a: string, b: string, nowMs: number = Date.now()): boolean => {
  if (a === b) return true;
  const later = nowMs + 182 * 24 * 60 * 60_000;
  const a1 = offsetMinutes(a, nowMs);
  const b1 = offsetMinutes(b, nowMs);
  const a2 = offsetMinutes(a, later);
  const b2 = offsetMinutes(b, later);
  return a1 !== null && a1 === b1 && a2 !== null && a2 === b2;
};

/** `America/New_York` as `New York`. */
export const zoneLabel = (zone: string): string =>
  (zone.split("/").pop() ?? zone).replace(/_/g, " ");

type ZoneRow = { schedule: string; status: string };

const cronZoneOf = (row: ZoneRow): string | null => {
  try {
    const parsed = JSON.parse(row.schedule) as { kind?: unknown; tz?: unknown };
    return parsed.kind === "cron" && typeof parsed.tz === "string" && parsed.tz ? parsed.tz : null;
  } catch {
    return null;
  }
};

/** The schedules a move from `from` would carry: live crons that run in that zone. */
export const schedulesInZone = <T extends ZoneRow>(rows: readonly T[], from: string): T[] =>
  rows.filter((row) => (row.status === "active" || row.status === "paused") && cronZoneOf(row) === from);

/**
 * Whether this device should ask to move the schedules: it is somewhere
 * whose clock differs from the schedules' zone, it has not been asked about
 * this zone before, and there is something to move.
 */
export const scheduleZoneNotice = (
  rows: readonly ZoneRow[] | undefined,
  zone: ScheduleZone | undefined,
  device: string | null,
  nowMs: number = Date.now(),
): ScheduleZoneNotice | null => {
  if (!rows || !zone?.zone || !device) return null;
  if (zone.answered && sameClock(zone.answered, device, nowMs)) return null;
  if (sameClock(zone.zone, device, nowMs)) return null;
  const count = schedulesInZone(rows, zone.zone).length;
  return count > 0 ? { from: zone.zone, to: device, count } : null;
};
