/**
 * Scheduled turns: prompts the owner's object starts from its alarm, in a
 * cloud chat or on a named desktop.
 */

import type { LocalCronSchedule } from "../scheduling.js";
import type { ReminderFire } from "../reminders.js";

export type ScheduleStatus = "active" | "paused" | "done";

/**
 * `reminder`: the prompt is the text itself, delivered with no model.
 * `task`: the prompt starts a run at fire time.
 */
export type ScheduleKind = "reminder" | "task";

export type ScheduleRow = {
  scheduleId: string;
  kind: ScheduleKind;
  /** Absent until the first fire picks the conversation it reports into. */
  conversationId?: string;
  /** The desktop a fire is offered to first; absent runs in the cloud. */
  targetDeviceId?: string;
  prompt: string;
  /** Serialized `LocalCronSchedule`. */
  schedule: string;
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

/** What the cloud Schedule tool sends through `schedules.tool`. */
export type ScheduleToolRequest =
  | { action: "list" }
  | {
      action: "create";
      requestId: string;
      kind?: ScheduleKind;
      prompt: string;
      schedule: LocalCronSchedule;
      description?: string;
      conversationId?: string;
    }
  | {
      action: "update";
      requestId: string;
      scheduleId: string;
      prompt?: string;
      schedule?: LocalCronSchedule;
      description?: string;
      status?: "active" | "paused";
    }
  | { action: "remove"; requestId: string; scheduleId: string };

/** Every action answers with the owner's rows after it. */
export type ScheduleToolResult = {
  ok: boolean;
  replayed: boolean;
  schedule?: ScheduleRow;
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
    };
    result: ScheduleRow;
  };
  "schedules.update": {
    args: {
      requestId: string;
      scheduleId: string;
      prompt?: string;
      schedule?: LocalCronSchedule;
      description?: string;
      status?: "active" | "paused";
    };
    result: ScheduleRow;
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
};

export type ScheduleViews = {
  /** Live schedules: active ones soonest first, then paused ones. */
  "schedules.list": { args: Record<string, never>; result: ScheduleRow[] };
  /** Reminder deliveries of the last few days, newest first. */
  "schedules.reminders": { args: Record<string, never>; result: ReminderFire[] };
};
