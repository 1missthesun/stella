/**
 * The owner's schedules, fired from the owner object's alarm: reminders,
 * tasks and cloud watches.
 */

import type { LocalCronSchedule } from "../scheduling.js";
import type { ReminderFire } from "../reminders.js";
import type { ScheduleZone, ScheduleZoneSource } from "../schedule-zone.js";

export type ScheduleStatus = "active" | "paused" | "done";

/**
 * `reminder`: the prompt is the text itself, delivered with no model.
 * `task`: the prompt starts a run at fire time.
 * `watch`: an AI-free check script runs at each fire; only what it finds
 * (or its failure) wakes AI, and the prompt is what to do with a finding.
 */
export type ScheduleKind = "reminder" | "task" | "watch";

/**
 * Who handles a fire that needs AI: the orchestrator (to tell, ask or act,
 * as it judges), or an agent of its, straight away, for work already
 * approved when the schedule was set.
 */
export type ScheduleRoute = "orchestrator" | "agent";

/**
 * A cloud watch's script: an ES module whose default export is
 * `async ({ state }) => ({ found?: string, state?: unknown })`. It may
 * `fetch`; `state` is what it returned last time (null at first). A
 * non-empty `found` is a finding; a throw is the watch failing.
 */
export const WATCH_SCRIPT_MAX_CHARS = 64_000;
export const WATCH_STATE_MAX_BYTES = 64_000;
export const WATCH_MIN_INTERVAL_MS = 5 * 60_000;

export type WatchCheckResult =
  | { ok: true; found: string; durationMs: number }
  | { ok: false; error: string; durationMs: number };

export type ScheduleRow = {
  scheduleId: string;
  kind: ScheduleKind;
  /** Tasks and watches: who handles a fire that needs AI. */
  route: ScheduleRoute;
  /** Watches: stop once a finding has been handed over. */
  once?: boolean;
  /** Watches: when the script last ran, and how. */
  lastCheckAt?: number;
  lastFinding?: string;
  /** Absent until the first fire picks the conversation it reports into. */
  conversationId?: string;
  /** The desktop a fire is offered to first; absent runs in the cloud. */
  targetDeviceId?: string;
  prompt: string;
  /** Serialized `LocalCronSchedule`. */
  schedule: string;
  /** A cron's zone now: its own, or the user's when it follows them. */
  zone?: string;
  nextRunAt: number;
  lastRunAt?: number;
  status: ScheduleStatus;
  description: string;
  /** Why the most recent fire did not run. */
  lastError?: string;
  lastErrorAt?: number;
  createdAt: number;
  updatedAt: number;
};

/** Every action answers with the owner's rows after it. */
export type ScheduleToolResult = {
  ok: boolean;
  replayed: boolean;
  schedule?: ScheduleRow;
  /** A watch's first check, run when it was set or its script changed. */
  check?: WatchCheckResult;
  removed?: boolean;
  schedules: ScheduleRow[];
};

export type ScheduleCalls = {
  /** `requestId` makes a retry return the first attempt's row. */
  "schedules.create": {
    args: {
      requestId: string;
      /** Defaults to `task`. */
      kind?: ScheduleKind;
      prompt: string;
      schedule: LocalCronSchedule;
      description?: string;
      conversationId?: string;
      targetDeviceId?: string;
      route?: ScheduleRoute;
      /** Watches: the check script, run once now to prove it works. */
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
  /** Fire an active schedule now. */
  "schedules.runNow": { args: { scheduleId: string }; result: null };
  /** The reminder was seen to: it stops asking for attention everywhere. */
  "schedules.reminderDone": { args: { fireId: string }; result: ReminderFire };
  /** Bring the reminder back in `minutes`, as a fresh delivery. */
  "schedules.reminderSnooze": {
    args: { fireId: string; minutes: number };
    result: ReminderFire;
  };
  /**
   * Where this device is. A phone's report sets the user's zone; a
   * computer's only while no phone has reported recently. Repeating
   * schedules with no zone of their own follow it at once.
   */
  "schedules.reportZone": {
    args: { timeZone: string; source: ScheduleZoneSource };
    result: ScheduleZone;
  };
};

export type ScheduleViews = {
  /** The user's zone, which repeating schedules follow, and where it came from. */
  "schedules.zone": { args: Record<string, never>; result: ScheduleZone };
  /** Live schedules: active ones soonest first, then paused ones. */
  "schedules.list": { args: Record<string, never>; result: ScheduleRow[] };
  /** Reminder deliveries of the last few days, newest first. */
  "schedules.reminders": { args: Record<string, never>; result: ReminderFire[] };
};
