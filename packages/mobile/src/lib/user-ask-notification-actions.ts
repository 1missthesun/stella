import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { requireOptionalNativeModule } from "expo-modules-core";
import {
  USER_ASK_ACTION_CATEGORY_PREFIX,
  USER_ASK_PUSH_CAPABILITY,
  isUserAskReplyActionId,
  userAskActionCategoryId,
  type UserAskActionablePushData,
  type UserAskNotificationAction,
} from "@stella/contracts/user-ask-notification";
import { USER_ASK_PUSH_KIND } from "@stella/contracts/user-ask";
import { i18nFallback } from "../i18n";

export const USER_ASK_NOTIFICATION_TASK = "stella-user-ask-notification";
const REPLY_TIMEOUT_MS = 20_000;
const MAX_KEPT_CATEGORIES = 24;

const nativeReplyModule =
  Platform.OS === "ios" ? requireOptionalNativeModule("StellaAskNotifications") : null;

export const nativeAskRepliesAvailable = (): boolean => nativeReplyModule !== null;

export const shareDeviceIdWithNativeReplies = (deviceId: string): void => {
  try {
    nativeReplyModule?.setDeviceId(deviceId);
  } catch {
    return;
  }
};

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const parseJsonRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "string") return record(value);
  try {
    return record(JSON.parse(value));
  } catch {
    return null;
  }
};

const readAction = (value: unknown): UserAskNotificationAction | null => {
  const source = record(value);
  if (!source) return null;
  const id = typeof source.id === "string" ? source.id : "";
  const title = typeof source.title === "string" ? source.title : "";
  if (!id.startsWith("ask.") || !title) return null;
  const input = record(source.input);
  return {
    id,
    title,
    ...(input
      ? {
          input: {
            placeholder: typeof input.placeholder === "string" ? input.placeholder : "",
            submit: typeof input.submit === "string" ? input.submit : "Send",
          },
        }
      : {}),
    ...(source.foreground === true ? { foreground: true as const } : {}),
  };
};

export const readActionableAskData = (
  value: unknown,
): UserAskActionablePushData | null => {
  const source = record(value);
  if (!source || source.kind !== USER_ASK_PUSH_KIND) return null;
  const askId = typeof source.askId === "string" ? source.askId.trim() : "";
  if (!askId) return null;
  const actions = Array.isArray(source.actions)
    ? source.actions.map(readAction).filter((action): action is UserAskNotificationAction => action !== null)
    : [];
  const text = (key: string): string | undefined =>
    typeof source[key] === "string" && (source[key] as string).length > 0
      ? (source[key] as string)
      : undefined;
  const replyUrl = text("replyUrl");
  const replyToken = text("replyToken");
  const alertTitle = text("alertTitle");
  const alertBody = text("alertBody");
  const channelId = text("channelId");
  return {
    kind: USER_ASK_PUSH_KIND,
    askId,
    conversationId: typeof source.conversationId === "string" ? source.conversationId : "",
    level: typeof source.level === "number" ? source.level : Number(source.level) || 1,
    ...(actions.length > 0 ? { actions } : {}),
    ...(replyUrl && replyUrl.startsWith("https://") ? { replyUrl } : {}),
    ...(replyToken ? { replyToken } : {}),
    ...(alertTitle ? { alertTitle } : {}),
    ...(alertBody ? { alertBody } : {}),
    ...(channelId ? { channelId } : {}),
    ...(source.quiet === true ? { quiet: true } : {}),
  };
};

const toExpoAction = (action: UserAskNotificationAction): Notifications.NotificationAction => ({
  identifier: action.id,
  buttonTitle: action.title,
  ...(action.input
    ? {
        textInput: {
          submitButtonTitle: action.input.submit,
          placeholder: action.input.placeholder,
        },
      }
    : {}),
  options: {
    opensAppToForeground: action.foreground === true,
    isAuthenticationRequired: true,
  },
});

const pruneAskCategories = async (keep: string): Promise<void> => {
  const categories = await Notifications.getNotificationCategoriesAsync().catch(() => []);
  const dynamic = categories
    .map((category) => category.identifier)
    .filter((id) => id.startsWith(USER_ASK_ACTION_CATEGORY_PREFIX) && id !== keep);
  const excess = dynamic.slice(0, Math.max(0, dynamic.length - (MAX_KEPT_CATEGORIES - 1)));
  await Promise.all(
    excess.map((id) => Notifications.deleteNotificationCategoryAsync(id).catch(() => false)),
  );
};

export const privateAskChannel = (channelId: string): string => `${channelId}-private`;

export const askNotificationIdentifier = (askId: string): string =>
  `${USER_ASK_PUSH_KIND}:${askId}`;

export const presentActionableAsk = async (
  data: UserAskActionablePushData,
): Promise<void> => {
  const categoryIdentifier = data.actions?.length
    ? userAskActionCategoryId(data.askId)
    : USER_ASK_PUSH_KIND;
  if (data.actions?.length) {
    await Notifications.setNotificationCategoryAsync(
      categoryIdentifier,
      data.actions.map(toExpoAction),
    );
    void pruneAskCategories(categoryIdentifier);
  }
  const { alertTitle, alertBody, channelId, ...rest } = data;
  await Notifications.scheduleNotificationAsync({
    identifier: askNotificationIdentifier(data.askId),
    content: {
      title: alertTitle ?? i18nFallback.t("mobile.userAsk.notification.title"),
      body: alertBody ?? i18nFallback.t("mobile.userAsk.notification.body"),
      data: rest,
      categoryIdentifier,
      sound: data.quiet ? false : "default",
    },
    trigger: { channelId: privateAskChannel(channelId ?? "user-ask") },
  });
};

export type AskReplyOutcome =
  | { ok: true; accepted: boolean; label?: string }
  | { ok: false; closed?: true };

export const sendAskReply = async (args: {
  data: UserAskActionablePushData;
  action: string;
  text?: string;
  deviceId?: string | null;
}): Promise<AskReplyOutcome> => {
  const { data } = args;
  if (!data.replyUrl || !data.replyToken) return { ok: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REPLY_TIMEOUT_MS);
  try {
    const response = await fetch(data.replyUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        token: data.replyToken,
        action: args.action,
        ...(args.text ? { text: args.text } : {}),
        ...(args.deviceId ? { deviceId: args.deviceId } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) return response.status === 409 ? { ok: false, closed: true } : { ok: false };
    const body = record(await response.json().catch(() => null));
    return {
      ok: true,
      accepted: body?.accepted === true,
      ...(typeof body?.label === "string" ? { label: body.label } : {}),
    };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
};

const presentReplyFailure = async (
  data: UserAskActionablePushData,
  alreadyClosed: boolean,
): Promise<void> => {
  await Notifications.scheduleNotificationAsync({
    identifier: `${askNotificationIdentifier(data.askId)}:failed`,
    content: {
      title: i18nFallback.t(
        alreadyClosed
          ? "mobile.userAsk.notification.alreadyAnsweredTitle"
          : "mobile.userAsk.notification.sendFailedTitle",
      ),
      body: i18nFallback.t(
        alreadyClosed
          ? "mobile.userAsk.notification.alreadyAnsweredBody"
          : "mobile.userAsk.notification.sendFailedBody",
      ),
      data: { kind: USER_ASK_PUSH_KIND, askId: data.askId, conversationId: data.conversationId, level: data.level },
      categoryIdentifier: USER_ASK_PUSH_KIND,
    },
    trigger: Platform.OS === "android"
      ? { channelId: privateAskChannel(data.channelId ?? "user-ask") }
      : null,
  }).catch(() => undefined);
};

export const isAskReplyResponse = (
  response: Pick<Notifications.NotificationResponse, "actionIdentifier">,
): boolean => isUserAskReplyActionId(response.actionIdentifier);

let deviceIdReader: (() => Promise<string | null>) | null = null;

export const setAskReplyDeviceIdReader = (reader: () => Promise<string | null>): void => {
  deviceIdReader = reader;
};

const handledReplies = new Set<string>();

export const handleAskReplyResponse = async (
  response: Notifications.NotificationResponse,
): Promise<AskReplyOutcome | null> => {
  if (!isAskReplyResponse(response)) return null;
  if (nativeAskRepliesAvailable()) return null;
  const request = response.notification.request;
  const key = `${request.identifier}:${response.actionIdentifier}`;
  if (handledReplies.has(key)) return null;
  handledReplies.add(key);
  const data = readActionableAskData(request.content.data);
  if (!data) return null;
  const deviceId = deviceIdReader ? await deviceIdReader().catch(() => null) : null;
  const outcome = await sendAskReply({
    data,
    action: response.actionIdentifier,
    ...(response.userText ? { text: response.userText } : {}),
    deviceId,
  });
  await Notifications.dismissNotificationAsync(request.identifier).catch(() => undefined);
  if (!outcome.ok) await presentReplyFailure(data, outcome.closed === true);
  else if (!outcome.accepted) await presentReplyFailure(data, true);
  return outcome;
};

const actionablePushFromTaskPayload = (payload: unknown): UserAskActionablePushData | null => {
  const source = record(payload);
  const data = record(source?.data);
  if (!data) return null;
  for (const candidate of [data.dataString, data.body, data]) {
    const parsed = readActionableAskData(parseJsonRecord(candidate));
    if (parsed) return parsed;
  }
  return null;
};

const responseFromTaskPayload = (payload: unknown): Notifications.NotificationResponse | null => {
  const source = record(payload);
  if (!source || typeof source.actionIdentifier !== "string") return null;
  return source as unknown as Notifications.NotificationResponse;
};

if (Platform.OS === "android") {
  TaskManager.defineTask(USER_ASK_NOTIFICATION_TASK, async ({ data }) => {
    const response = responseFromTaskPayload(data);
    if (response) {
      await handleAskReplyResponse(response);
      return;
    }
    const push = actionablePushFromTaskPayload(data);
    if (!push || !push.alertTitle) return;
    if (AppState.currentState === "active") return;
    await presentActionableAsk(push);
  });
}

let taskRegistered: Promise<boolean> | null = null;

export const registerAskNotificationTask = (): Promise<boolean> => {
  if (Platform.OS !== "android") return Promise.resolve(false);
  taskRegistered ??= Notifications.registerTaskAsync(USER_ASK_NOTIFICATION_TASK)
    .then(() => true)
    .catch(() => false);
  return taskRegistered;
};

export const askPushCapabilities = async (): Promise<string[]> => {
  if (Platform.OS === "ios") {
    return nativeAskRepliesAvailable() ? [USER_ASK_PUSH_CAPABILITY] : [];
  }
  if (Platform.OS === "android") {
    return (await registerAskNotificationTask()) ? [USER_ASK_PUSH_CAPABILITY] : [];
  }
  return [];
};

export const dismissResolvedAskNotifications = async (
  openAskIds: ReadonlySet<string>,
): Promise<void> => {
  const presented = await Notifications.getPresentedNotificationsAsync().catch(() => []);
  await Promise.all(
    presented
      .filter((notification) => {
        const data = record(notification.request.content.data);
        const askId = typeof data?.askId === "string" ? data.askId : "";
        return data?.kind === USER_ASK_PUSH_KIND && askId && !openAskIds.has(askId);
      })
      .map((notification) =>
        Notifications.dismissNotificationAsync(notification.request.identifier).catch(() => undefined),
      ),
  );
};
