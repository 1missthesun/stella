import { Platform } from "react-native";
import { isPhoneInForeground } from "../carplay/native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import {
  USER_ASK_MAX_URGENCY,
  USER_ASK_PUSH_CATEGORY,
  USER_ASK_PUSH_KIND,
  clampUrgency,
  type UserAskUrgencyLevel,
} from "@stella/contracts/user-ask";
import {
  REMINDER_ACTION_DONE,
  REMINDER_ACTION_SNOOZE,
  REMINDER_PUSH_CATEGORY,
  parseReminderPushData,
} from "@stella/contracts/reminders";
import { markReminderDone, snoozeReminder } from "./reminders";
import { backendOrigin, postJson } from "./http";
import { getOrCreateMobileDeviceId } from "./phone-access";
import { getNotificationsMuted } from "./notifications-prefs";
import {
  focusUserAsk,
  getOpenUserAsks,
  refreshUserAsks,
  subscribeOpenUserAsks,
} from "./user-asks";
import { i18nFallback } from "../i18n";
import { requestMainChat } from "./main-chat-request";
import { userAskTitleOf } from "@stella/contracts/user-ask";
import {
  askPushCapabilities,
  dismissResolvedAskNotifications,
  handleAskReplyResponse,
  isAskReplyResponse,
  privateAskChannel,
  setAskReplyDeviceIdReader,
  shareDeviceIdWithNativeReplies,
} from "./user-ask-notification-actions";

setAskReplyDeviceIdReader(() => getOrCreateMobileDeviceId());
void getOrCreateMobileDeviceId()
  .then(shareDeviceIdWithNativeReplies)
  .catch(() => undefined);

const COMPUTER_REPLY_CATEGORY = "computer_reply";
const AGENT_ACTIVITY_CATEGORY = "agent_activity";
const USER_ASK_ANDROID_CHANNEL = "user-ask";
const USER_ASK_ANDROID_BREAKTHROUGH_CHANNEL = "user-ask-breakthrough";

const SILENT = {
  shouldShowAlert: false,
  shouldShowBanner: false,
  shouldShowList: false,
  shouldPlaySound: false,
  shouldSetBadge: false,
} as const;
const NOTIFICATION_ACTIONS = [
  {
    identifier: "open",
    buttonTitle: "Open",
    options: { opensAppToForeground: true },
  },
  {
    identifier: "dismiss",
    buttonTitle: "Dismiss",
    options: { opensAppToForeground: false, isDestructive: false },
  },
];

const USER_ASK_ACTIONS = [
  {
    identifier: "answer",
    buttonTitle: i18nFallback.t("mobile.userAsk.notification.answer"),
    options: { opensAppToForeground: true },
  },
  {
    identifier: "dismiss",
    buttonTitle: i18nFallback.t("mobile.userAsk.notification.dismiss"),
    options: { opensAppToForeground: false, isDestructive: false },
  },
];

const REMINDER_ACTIONS = [
  {
    identifier: REMINDER_ACTION_DONE,
    buttonTitle: i18nFallback.t("reminders.done"),
    options: { opensAppToForeground: false },
  },
  {
    identifier: REMINDER_ACTION_SNOOZE,
    buttonTitle: i18nFallback.t("reminders.snoozeFor"),
    options: { opensAppToForeground: false },
  },
];

const USER_ASK_REPEAT_COUNT = 3;
const USER_ASK_REPEAT_INTERVAL_MS = 60_000;

type UserAskPushData = {
  kind?: string;
  askId?: string;
  conversationId?: string;
  level?: number | string;
};

const readUserAskPush = (
  data: UserAskPushData | null | undefined,
): { askId: string; level: UserAskUrgencyLevel } | null => {
  if (!data || data.kind !== USER_ASK_PUSH_KIND) return null;
  const askId = typeof data.askId === "string" ? data.askId.trim() : "";
  if (!askId) return null;
  return { askId, level: clampUrgency(data.level) };
};

const repeatTimers = new Map<string, ReturnType<typeof setTimeout>[]>();

const stopUserAskRepeats = (askId: string) => {
  for (const timer of repeatTimers.get(askId) ?? []) clearTimeout(timer);
  repeatTimers.delete(askId);
};

const scheduleUserAskRepeats = (askId: string) => {
  stopUserAskRepeats(askId);
  if (getNotificationsMuted()) return;
  const timers: ReturnType<typeof setTimeout>[] = [];
  for (let attempt = 1; attempt <= USER_ASK_REPEAT_COUNT; attempt += 1) {
    timers.push(
      setTimeout(() => {
        void (async () => {
          if (getNotificationsMuted()) {
            stopUserAskRepeats(askId);
            return;
          }
          await refreshUserAsks().catch(() => undefined);
          const open = getOpenUserAsks().find((ask) => ask.askId === askId);
          if (!open) {
            stopUserAskRepeats(askId);
            return;
          }
          if (isPhoneInForeground()) return;
          try {
            await Notifications.scheduleNotificationAsync({
              content: {
                title: open.agentLabel
                  ? i18nFallback.t("mobile.userAsk.notification.titleFrom", {
                      label: open.agentLabel,
                    })
                  : i18nFallback.t("mobile.userAsk.notification.title"),
                body:
                  userAskTitleOf(open.detail) ||
                  i18nFallback.t("mobile.userAsk.notification.body"),
                categoryIdentifier: USER_ASK_PUSH_CATEGORY,
                data: { kind: USER_ASK_PUSH_KIND, askId },
                interruptionLevel: "timeSensitive",
                sound: true,
              },
              trigger: null,
            });
          } catch {
            return;
          }
        })();
      }, attempt * USER_ASK_REPEAT_INTERVAL_MS),
    );
  }
  repeatTimers.set(askId, timers);
};

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    if (!pushDeliveryEnabled()) return { ...SILENT };
    // User-side mute wins over everything — drop the notification entirely.
    if (getNotificationsMuted()) return { ...SILENT };
    // A reminder is due now: it shows even over the app.
    if (parseReminderPushData(notification.request.content.data)) {
      return {
        shouldShowAlert: true,
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      };
    }
    const ask = readUserAskPush(
      notification.request.content.data as UserAskPushData | null | undefined,
    );
    if (ask) {
      void refreshUserAsks();
      if (isPhoneInForeground()) return { ...SILENT };
      if (ask.level >= USER_ASK_MAX_URGENCY) {
        scheduleUserAskRepeats(ask.askId);
        return {
          shouldShowAlert: true,
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        };
      }
    }
    // Don't surface pushes over the app the user is currently looking at.
    const isForeground = isPhoneInForeground();
    if (isForeground) return { ...SILENT };
    return {
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    };
  },
});

async function ensureAndroidChannels(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("default", {
    name: "default",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  await Notifications.setNotificationChannelAsync(USER_ASK_ANDROID_CHANNEL, {
    name: "Stella needs you",
    importance: Notifications.AndroidImportance.HIGH,
  });
  await Notifications.setNotificationChannelAsync(
    USER_ASK_ANDROID_BREAKTHROUGH_CHANNEL,
    {
      name: "Stella needs you urgently",
      importance: Notifications.AndroidImportance.MAX,
      bypassDnd: true,
    },
  );
  await Notifications.setNotificationChannelAsync(
    privateAskChannel(USER_ASK_ANDROID_CHANNEL),
    {
      name: "Questions from Stella",
      importance: Notifications.AndroidImportance.HIGH,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    },
  );
  await Notifications.setNotificationChannelAsync(
    privateAskChannel(USER_ASK_ANDROID_BREAKTHROUGH_CHANNEL),
    {
      name: "Urgent questions from Stella",
      importance: Notifications.AndroidImportance.MAX,
      bypassDnd: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    },
  );
}

async function getExpoPushToken(): Promise<string | null> {
  if (!Device.isDevice) return null;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") return null;

  await ensureAndroidChannels();

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) return null;

  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  return data;
}

async function readGrantedPushToken(): Promise<string | null> {
  try {
    if (!Device.isDevice) return null;
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") return null;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    if (!projectId) return null;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return data;
  } catch {
    return null;
  }
}

let registeredSubject: string | null = null;
let registering: { subject: string; done: Promise<void> } | null = null;
let deliveryBlocked = false;

export function setPushDeliveryOwner(subject: string | null): void {
  deliveryBlocked = subject === null;
}

export function pushDeliveryEnabled(): boolean {
  return !deliveryBlocked;
}

export function registerForPushNotifications(subject: string): Promise<void> {
  if (!subject) return Promise.resolve();
  if (registeredSubject === subject) return Promise.resolve();
  if (registering?.subject === subject) return registering.done;
  const done = registerOnce(subject).finally(() => {
    if (registering?.subject === subject) registering = null;
  });
  registering = { subject, done };
  return done;
}

async function registerOnce(subject: string): Promise<void> {
  try {
    const token = await getExpoPushToken();
    if (!token) return;

    const mobileDeviceId = await getOrCreateMobileDeviceId();
    const capabilities = await askPushCapabilities().catch(() => []);
    await postJson("/api/mobile/push-token", {
      token,
      platform: Platform.OS,
      mobileDeviceId,
      capabilities,
    }, { origin: backendOrigin() });
    registeredSubject = subject;
  } catch {
    // Best-effort — don't block the app if registration fails.
  }
}

export async function tearDownPushNotifications(): Promise<void> {
  registeredSubject = null;
  registering = null;
  deliveryBlocked = true;
  for (const askId of [...repeatTimers.keys()]) stopUserAskRepeats(askId);
  await Promise.all([
    Notifications.dismissAllNotificationsAsync().catch(() => undefined),
    Notifications.cancelAllScheduledNotificationsAsync().catch(() => undefined),
    Notifications.setBadgeCountAsync(0).catch(() => undefined),
  ]);
  const token = await readGrantedPushToken();
  try {
    const mobileDeviceId = await getOrCreateMobileDeviceId();
    await postJson("/api/mobile/push-token/unregister", {
      mobileDeviceId,
      ...(token ? { token } : {}),
    }, { origin: backendOrigin() });
  } catch {
    // Best-effort — sign-out proceeds, and the server's own teardown covers it.
  }
}

const handledResponses = new Set<string>();

const clearLaunchResponse = (): void => {
  try {
    Notifications.clearLastNotificationResponse();
  } catch {
    return;
  }
};

const readLaunchResponse = (): Notifications.NotificationResponse | null => {
  try {
    return Notifications.getLastNotificationResponse();
  } catch {
    return null;
  }
};

const handleNotificationResponse = (
  response: Notifications.NotificationResponse,
): void => {
  const key = `${response.notification.request.identifier}:${response.actionIdentifier}`;
  if (handledResponses.has(key)) return;
  handledResponses.add(key);
  clearLaunchResponse();
  if (!pushDeliveryEnabled()) return;
  const reminder = parseReminderPushData(response.notification.request.content.data);
  if (reminder) {
    if (response.actionIdentifier === REMINDER_ACTION_DONE) {
      void markReminderDone(reminder.fireId).catch(() => undefined);
      return;
    }
    if (response.actionIdentifier === REMINDER_ACTION_SNOOZE) {
      void snoozeReminder(reminder.fireId).catch(() => undefined);
      return;
    }
    requestMainChat();
    return;
  }
  const data = response.notification.request.content.data as
    | UserAskPushData
    | null
    | undefined;
  const ask = readUserAskPush(data);
  if (isAskReplyResponse(response)) {
    if (ask) stopUserAskRepeats(ask.askId);
    void handleAskReplyResponse(response).then(() => refreshUserAsks());
    return;
  }
  if (response.actionIdentifier === "dismiss") {
    if (ask) stopUserAskRepeats(ask.askId);
    return;
  }
  if (ask) {
    stopUserAskRepeats(ask.askId);
    focusUserAsk(ask.askId);
  }
  requestMainChat();
};

export async function installNotificationCategoriesAndListeners(): Promise<() => void> {
  const subscription = Notifications.addNotificationResponseReceivedListener(
    handleNotificationResponse,
  );
  const launchResponse = readLaunchResponse();
  if (launchResponse) handleNotificationResponse(launchResponse);
  const stopWatchingAsks = subscribeOpenUserAsks((asks, loaded) => {
    if (!loaded) return;
    void dismissResolvedAskNotifications(new Set(asks.map((ask) => ask.askId)));
  });

  try {
    await Promise.all([
      Notifications.setNotificationCategoryAsync(
        COMPUTER_REPLY_CATEGORY,
        NOTIFICATION_ACTIONS,
      ),
      Notifications.setNotificationCategoryAsync(
        AGENT_ACTIVITY_CATEGORY,
        NOTIFICATION_ACTIONS,
      ),
      Notifications.setNotificationCategoryAsync(
        USER_ASK_PUSH_CATEGORY,
        USER_ASK_ACTIONS,
      ),
      Notifications.setNotificationCategoryAsync(
        REMINDER_PUSH_CATEGORY,
        REMINDER_ACTIONS,
      ),
    ]);
  } catch {
    // Best-effort; some platforms (Expo Go) just don't support categories.
  }

  return () => {
    subscription.remove();
    stopWatchingAsks();
  };
}
