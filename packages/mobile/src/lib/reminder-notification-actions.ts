import * as Notifications from "expo-notifications";
import {
  REMINDER_ACTION_DONE,
  REMINDER_ACTION_SNOOZE,
  parseReminderPushData,
} from "@stella/contracts/reminders";
import { markReminderDone, snoozeReminder } from "./reminders";
import {
  claimNotificationAction,
  releaseNotificationAction,
} from "./notification-action-claims";

export const isReminderActionId = (actionIdentifier: string): boolean =>
  actionIdentifier === REMINDER_ACTION_DONE || actionIdentifier === REMINDER_ACTION_SNOOZE;

export const handleReminderActionResponse = async (
  response: Pick<Notifications.NotificationResponse, "actionIdentifier" | "notification">,
): Promise<boolean> => {
  const action = response.actionIdentifier;
  if (!isReminderActionId(action)) return false;
  const request = response.notification.request;
  const reminder = parseReminderPushData(request.content.data);
  if (!reminder) return false;
  const key = `reminder:${reminder.fireId}:${action}`;
  if (!claimNotificationAction(key)) return true;
  try {
    if (action === REMINDER_ACTION_DONE) await markReminderDone(reminder.fireId);
    else await snoozeReminder(reminder.fireId);
  } catch {
    releaseNotificationAction(key);
    return true;
  }
  await Notifications.dismissNotificationAsync(request.identifier).catch(() => undefined);
  return true;
};
