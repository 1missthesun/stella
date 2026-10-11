import type { LocalCronSchedule } from "@stella/contracts/scheduling";

export {
  formatNextRun,
  summarizeSchedule,
} from "@stella/contracts/schedule-format";

export type MobileScheduleShape = LocalCronSchedule;

/** Best-effort parse of the runtime's serialized LocalCronSchedule JSON. */
export const parseStoredSchedule = (
  value: string,
): MobileScheduleShape | null => {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const kind = parsed?.kind;
    if (kind === "at" && typeof parsed.atMs === "number") {
      return { kind: "at", atMs: parsed.atMs };
    }
    if (kind === "every" && typeof parsed.everyMs === "number") {
      return {
        kind: "every",
        everyMs: parsed.everyMs,
        ...(typeof parsed.anchorMs === "number"
          ? { anchorMs: parsed.anchorMs }
          : {}),
      };
    }
    if (kind === "cron" && typeof parsed.expr === "string") {
      return {
        kind: "cron",
        expr: parsed.expr,
        ...(typeof parsed.tz === "string" ? { tz: parsed.tz } : {}),
      };
    }
    return null;
  } catch {
    return null;
  }
};
