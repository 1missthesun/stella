export type ScheduleZoneSource = "phone" | "computer";

export type ScheduleZone = {
  zone?: string;
  source?: ScheduleZoneSource;
  phoneReportedAt?: number;
};

export const PHONE_ZONE_STALE_MS = 14 * 24 * 60 * 60_000;

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

export const zoneReportDecides = (
  current: ScheduleZone,
  source: ScheduleZoneSource,
  nowMs: number,
): boolean =>
  source === "phone" ||
  current.phoneReportedAt === undefined ||
  nowMs - current.phoneReportedAt > PHONE_ZONE_STALE_MS;

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

export const formatTurnClock = (atMs: number, zone?: string | null): string =>
  `${new Date(atMs).toISOString()} (${formatZonedNow(atMs, zone)})`;
