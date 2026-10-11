import { useMemo } from "react";
import {
  REMINDER_DEFAULT_SNOOZE_MINUTES,
  type ReminderFire,
} from "@stella/contracts/reminders";
import { getBackendClient, useBackendView } from "./backend";

/** Recent reminder deliveries by fire id; undefined until the first read. */
export const useReminderFires = (
  enabled: boolean,
): ReadonlyMap<string, ReminderFire> | undefined => {
  const fires = useBackendView("schedules.reminders", enabled ? {} : "skip").value;
  return useMemo(
    () => (fires ? new Map(fires.map((fire) => [fire.fireId, fire])) : undefined),
    [fires],
  );
};

export const markReminderDone = (fireId: string): Promise<ReminderFire> =>
  getBackendClient().call("schedules.reminderDone", { fireId });

export const snoozeReminder = (
  fireId: string,
  minutes: number = REMINDER_DEFAULT_SNOOZE_MINUTES,
): Promise<ReminderFire> =>
  getBackendClient().call("schedules.reminderSnooze", {
    fireId,
    minutes: Math.max(1, Math.round(minutes)),
  });
