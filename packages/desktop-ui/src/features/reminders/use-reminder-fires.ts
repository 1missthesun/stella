import { useMemo } from "react";
import {
  REMINDER_DEFAULT_SNOOZE_MINUTES,
  type ReminderFire,
} from "@stella/contracts/reminders";
import { backendClient } from "@/platform/backend/backend-client";
import { useBackendView } from "@/platform/backend/use-backend-view";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";

export const useReminderFires = (): ReadonlyMap<string, ReminderFire> | undefined => {
  const { hasConnectedAccount } = useAuthSessionState();
  const fires = useBackendView(
    "schedules.reminders",
    hasConnectedAccount ? {} : "skip",
  ).value;
  return useMemo(
    () => (fires ? new Map(fires.map((fire) => [fire.fireId, fire])) : undefined),
    [fires],
  );
};

export const useReminderFireList = (): readonly ReminderFire[] | undefined => {
  const { hasConnectedAccount } = useAuthSessionState();
  return useBackendView("schedules.reminders", hasConnectedAccount ? {} : "skip").value;
};

export const markReminderDone = (fireId: string): Promise<ReminderFire> =>
  backendClient.call("schedules.reminderDone", { fireId });

export const snoozeReminder = (
  fireId: string,
  minutes: number = REMINDER_DEFAULT_SNOOZE_MINUTES,
): Promise<ReminderFire> =>
  backendClient.call("schedules.reminderSnooze", { fireId, minutes: Math.max(1, Math.round(minutes)) });
