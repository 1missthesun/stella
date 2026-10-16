import type { LocalCronSchedule } from "../scheduling.js";
import type { ReminderFire } from "../reminders.js";
import type { ScheduleZone, ScheduleZoneSource } from "../schedule-zone.js";

export type ScheduleStatus = "active" | "paused" | "done";

export type ScheduleKind = "reminder" | "task" | "watch";

export type ScheduleRoute = "orchestrator" | "agent";

export const WATCH_SCRIPT_MAX_CHARS = 64_000;
export const WATCH_STATE_MAX_BYTES = 64_000;
export const WATCH_MIN_INTERVAL_MS = 5 * 60_000;

export type WatchCheckResult =
  | { ok: true; found: string; durationMs: number }
  | { ok: false; error: string; durationMs: number };

export type ScheduleRow = {
  scheduleId: string;
  kind: ScheduleKind;
  route: ScheduleRoute;
  once?: boolean;
  lastCheckAt?: number;
  lastFinding?: string;
  conversationId?: string;
  targetDeviceId?: string;
  prompt: string;
  schedule: string;
  zone?: string;
  nextRunAt: number;
  lastRunAt?: number;
  status: ScheduleStatus;
  description: string;
  lastError?: string;
  lastErrorAt?: number;
  /** The account's plan runs scheduled work only on a computer, never in the cloud. */
  computerOnly?: true;
  /** A run came due while its computer was away; it runs once the computer is back. */
  waitingSince?: number;
  createdAt: number;
  updatedAt: number;
};

export type ScheduleToolResult = {
  ok: boolean;
  replayed: boolean;
  schedule?: ScheduleRow;
  check?: WatchCheckResult;
  removed?: boolean;
  schedules: ScheduleRow[];
};

export type ScheduleCalls = {
  "schedules.create": {
    args: {
      requestId: string;
      kind?: ScheduleKind;
      prompt: string;
      schedule: LocalCronSchedule;
      description?: string;
      conversationId?: string;
      targetDeviceId?: string;
      route?: ScheduleRoute;
      script?: string;
      once?: boolean;
    };
    result: ScheduleRow & { check?: WatchCheckResult };
  };
  "schedules.update": {
    args: {
      requestId: string;
      scheduleId: string;
      prompt?: string;
      schedule?: LocalCronSchedule;
      description?: string;
      status?: "active" | "paused";
      route?: ScheduleRoute;
      script?: string;
      once?: boolean;
    };
    result: ScheduleRow & { check?: WatchCheckResult };
  };
  "schedules.remove": {
    args: { requestId: string; scheduleId: string };
    result: null;
  };
  "schedules.runNow": { args: { scheduleId: string }; result: null };
  "schedules.reminderDone": { args: { fireId: string }; result: ReminderFire };
  "schedules.reminderSnooze": {
    args: { fireId: string; minutes: number };
    result: ReminderFire;
  };
  "schedules.reportZone": {
    args: { timeZone: string; source: ScheduleZoneSource };
    result: ScheduleZone;
  };
};

export type ScheduleViews = {
  "schedules.zone": { args: Record<string, never>; result: ScheduleZone };
  "schedules.list": { args: Record<string, never>; result: ScheduleRow[] };
  "schedules.reminders": { args: Record<string, never>; result: ReminderFire[] };
};
