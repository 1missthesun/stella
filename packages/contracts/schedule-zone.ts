/**
 * The user's time zone, which repeating schedules follow. A cron with no
 * zone of its own runs at its clock time wherever the user is, so "every day
 * at 8" is 8 local, and daylight saving comes with the zone. A one-off is an
 * instant and never moves; each device shows it in its own zone.
 *
 * Devices report where they are. The phone decides, since it travels with
 * the user; a computer's report counts only while no phone has reported
 * recently, so a laptop left at home never pulls the schedules back.
 */

export type ScheduleZoneSource = "phone" | "computer";

/** What `schedules.zone` reads. */
export type ScheduleZone = {
  /** The user's zone; absent until a device first reports one. */
  zone?: string;
  /** The kind of device the zone came from. */
  source?: ScheduleZoneSource;
  /** When a phone last reported, so a phone no longer in use stops deciding. */
  phoneReportedAt?: number;
};

/** A phone silent this long no longer decides the zone. */
export const PHONE_ZONE_STALE_MS = 14 * 24 * 60 * 60_000;

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

/** Whether a report from `source` sets the user's zone. */
export const zoneReportDecides = (
  current: ScheduleZone,
  source: ScheduleZoneSource,
  nowMs: number,
): boolean =>
  source === "phone" ||
  current.phoneReportedAt === undefined ||
  nowMs - current.phoneReportedAt > PHONE_ZONE_STALE_MS;

/** `UTC-07:00` for `America/Los_Angeles` in October. */
export const zoneOffsetLabel = (zone: string, atMs: number): string => {
  try {
    const name = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "longOffset",
    })
      .formatToParts(new Date(atMs))
      .find((part) => part.type === "timeZoneName")?.value;
    if (!name || name === "GMT") return "UTC";
    return name.replace(/^GMT/, "UTC").replace("−", "-");
  } catch {
    return "";
  }
};

/**
 * The time as the user reads it: `Sunday, October 11, 2026, 4:40 PM in
 * America/Los_Angeles (UTC-07:00)`. Falls back to UTC when the zone is
 * unknown or unusable.
 */
export const formatZonedNow = (atMs: number, zone?: string | null): string => {
  const usable = zone && isUsableTimeZone(zone) ? zone : "UTC";
  const value = new Date(atMs).toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: usable,
  });
  const offset = zoneOffsetLabel(usable, atMs);
  return usable === "UTC" ? `${value} UTC` : `${value} in ${usable}${offset ? ` (${offset})` : ""}`;
};

/** The `<current-time>` text: the exact instant, then the user's own clock. */
export const formatTurnClock = (atMs: number, zone?: string | null): string =>
  `${new Date(atMs).toISOString()} (${formatZonedNow(atMs, zone)})`;
