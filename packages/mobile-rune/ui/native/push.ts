// Push notifications on the RN app's contract (packages/mobile/src/lib/notifications.ts and
// app/_layout.tsx): once an account is signed in the app asks for permission, takes its APNs
// token from iOS (ios/StellaRune/Push.swift), turns it into an Expo push token the way
// expo-notifications does (the backend sends through Expo), and registers that with
// `/api/mobile/push-token`. Signing out unregisters it. A tap on a notification opens what it
// is about: a reminder's action runs, urgent email opens Email, anything else the chat.

import { getAuthSessionSnapshot, subscribeAuthSession } from "@/global/auth/services/auth-session";
import { getAuthHeaders } from "@/global/auth/services/auth-token";
import { backendUrl } from "@/platform/backend/backend-url";
import { backendClient } from "@/platform/backend/backend-client";
import { translateNow } from "@/shared/i18n";
import { openEmailPage } from "@/features/email/EmailNotifications";
import { refreshUserAsks } from "@/features/user-ask/user-ask-store";
import { USER_ASK_PUSH_CATEGORY, USER_ASK_PUSH_KIND } from "../../../contracts/user-ask";
import { REMINDER_ACTION_DONE, REMINDER_ACTION_SNOOZE, REMINDER_PUSH_CATEGORY, parseReminderPushData } from "../../../contracts/reminders";
import { EMAIL_PUSH_KIND } from "../../../contracts/backend/email";
import { phoneNav } from "../phone/nav";
import { onPhoneEvent, phoneRequest } from "./app";

/** The Expo project the backend's push service belongs to (packages/mobile/app.json, set by js/build.ts). */
const EAS_PROJECT_ID = process.env.STELLA_EAS_PROJECT_ID ?? "";
const EXPO_TOKEN_URL = "https://exp.host/--/api/v2/push/getExpoPushToken";
const DEVICE_ID_KEY = "stella-mobile-device-id";
const TOKEN_KEY = "stella-mobile-push-token";

type Registration = { status: "granted" | "denied" | "undetermined"; deviceToken?: string; development?: boolean; appId?: string; installationId?: string };
type PushNotification = { id: string; title: string; body: string; category: string; data: Record<string, unknown> | null };
type PushResponse = { notification: PushNotification; action: string; text?: string };

const log = (msg: string) => console.info(`[push] ${msg}`);

function uuid(): string {
  const b = __native.random(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The phone's id with the backend (the RN app's `getOrCreateMobileDeviceId`). */
export function mobileDeviceId(): string {
  let id = __native.storageGet(DEVICE_ID_KEY);
  if (!id) {
    id = uuid();
    __native.storageSet(DEVICE_ID_KEY, id);
  }
  return id;
}

const accountSubject = (): string | null => {
  const user = (getAuthSessionSnapshot().data as { user?: { id?: string; isAnonymous?: boolean | null } } | null | undefined)?.user;
  return user?.id && user.isAnonymous !== true ? user.id : null;
};

async function expoPushToken(r: Registration): Promise<string> {
  const response = await fetch(EXPO_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "apns",
      deviceId: (r.installationId ?? "").toLowerCase(),
      development: r.development === true,
      appId: r.appId,
      deviceToken: r.deviceToken,
      projectId: EAS_PROJECT_ID,
    }),
  });
  const body = (await response.json().catch(() => null)) as { data?: { expoPushToken?: string }; errors?: Array<{ message?: string }> } | null;
  const token = body?.data?.expoPushToken;
  if (!response.ok || !token) throw new Error(`Expo push token: ${response.status} ${body?.errors?.[0]?.message ?? ""}`.trim());
  return token;
}

async function postBackend(path: string, body: unknown): Promise<Response> {
  return await fetch(`${backendUrl!.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: await getAuthHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
}

let registeredSubject: string | null = null;
let registering: { subject: string; done: Promise<void> } | null = null;

function register(subject: string): Promise<void> {
  if (registeredSubject === subject) return Promise.resolve();
  if (registering?.subject === subject) return registering.done;
  const done = (async () => {
    const r = await phoneRequest<Registration>("push.register");
    if (r.status !== "granted" || !r.deviceToken) {
      log(`not registered: notifications ${r.status}`);
      return;
    }
    const token = await expoPushToken(r);
    const response = await postBackend("/api/mobile/push-token", { token, platform: "ios", mobileDeviceId: mobileDeviceId(), capabilities: [] });
    if (!response.ok) throw new Error(`push-token: ${response.status} ${await response.text().catch(() => "")}`);
    __native.storageSet(TOKEN_KEY, token);
    if (accountSubject() === subject) registeredSubject = subject;
    log(`registered ${token.slice(0, 22)}… (APNs ${r.development ? "development" : "production"}, device ${mobileDeviceId().slice(0, 8)})`);
  })()
    .catch((error: unknown) => log(`registration failed: ${error instanceof Error ? error.message : String(error)}`))
    .finally(() => {
      if (registering?.subject === subject) registering = null;
    });
  registering = { subject, done };
  return done;
}

async function tearDown(): Promise<void> {
  log("signed out: unregistering");
  registeredSubject = null;
  const token = __native.storageGet(TOKEN_KEY);
  __native.storageRemove(TOKEN_KEY);
  await phoneRequest("push.clear").catch(() => undefined);
  await postBackend("/api/mobile/push-token/unregister", { mobileDeviceId: mobileDeviceId(), ...(token ? { token } : {}) }).catch(() => undefined);
}

function setCategories() {
  const open = [
    { id: "open", title: "Open", foreground: true },
    { id: "dismiss", title: "Dismiss" },
  ];
  void phoneRequest("push.categories", {
    categories: [
      { id: "computer_reply", actions: open },
      { id: "agent_activity", actions: open },
      {
        id: USER_ASK_PUSH_CATEGORY,
        actions: [
          { id: "answer", title: translateNow("mobile.userAsk.notification.answer"), foreground: true },
          { id: "dismiss", title: translateNow("mobile.userAsk.notification.dismiss") },
        ],
      },
      {
        id: REMINDER_PUSH_CATEGORY,
        actions: [
          { id: REMINDER_ACTION_DONE, title: translateNow("reminders.done") },
          { id: REMINDER_ACTION_SNOOZE, title: translateNow("reminders.snoozeFor") },
        ],
      },
    ],
  }).catch(() => undefined);
}

const handled = new Set<string>();

function openChat() {
  phoneNav.selectTab("chat");
}

function respond(r: PushResponse) {
  const key = `${r.notification.id}:${r.action}`;
  if (handled.has(key)) return;
  handled.add(key);
  if (!accountSubject()) return;
  const data = r.notification.data ?? {};
  log(`opened ${r.notification.category || "notification"} (${String(data.kind ?? "")}) via ${r.action}`);
  const reminder = parseReminderPushData(data);
  if (reminder) {
    if (r.action === REMINDER_ACTION_DONE) void backendClient.call("schedules.reminderDone", { fireId: reminder.fireId }).catch(() => undefined);
    else if (r.action === REMINDER_ACTION_SNOOZE) void backendClient.call("schedules.reminderSnooze", { fireId: reminder.fireId, minutes: 10 }).catch(() => undefined);
    else openChat();
    return;
  }
  if (r.action === "dismiss") return;
  if (data.kind === EMAIL_PUSH_KIND) {
    openChat();
    openEmailPage();
    return;
  }
  if (data.kind === USER_ASK_PUSH_KIND) void refreshUserAsks().catch(() => undefined);
  openChat();
}

let started = false;

export function startPush(): void {
  if (started) return;
  started = true;
  setCategories();
  onPhoneEvent<PushResponse & { kind: string }>("push", (e) => {
    if (e.kind === "response") respond(e);
    else if (e.kind === "received" && e.notification.data?.kind === USER_ASK_PUSH_KIND) void refreshUserAsks().catch(() => undefined);
  });
  let wasSignedIn = false;
  const sync = () => {
    const subject = accountSubject();
    if (subject) {
      wasSignedIn = true;
      void register(subject);
      void phoneRequest<PushResponse[]>("push.takeLaunch").then((list) => list.forEach(respond), () => undefined);
    } else if (wasSignedIn && !getAuthSessionSnapshot().isPending) {
      // Signed out for real, not a session refresh in flight (which reads as no account).
      wasSignedIn = false;
      void tearDown();
    }
  };
  subscribeAuthSession(sync);
  sync();
}
