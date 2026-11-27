// What the phone does for a view's `stella.*` calls. fetch reaches only the public internet over
// https, the same rule the desktop host and the VM's own fetch keep.
import { Linking, Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import type { ViewCapabilities } from "@stella/views/session";
import { sendToChat } from "../lib/chat-send-queue";
import { openWebLink } from "../lib/open-web-link";

const PRIVATE_HOST =
  /^(localhost|.*\.local|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|0\.|\[?::1?\]?$|\[?f[cd][0-9a-f]{2}:|\[?fe80:)/iu;
const MAX_RESPONSE_CHARS = 8 * 1024 * 1024;

const string = (value: unknown) => (typeof value === "string" ? value : String(value ?? ""));

const HAPTICS: Record<string, () => Promise<void>> = {
  light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  heavy: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  warning: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  selection: () => Haptics.selectionAsync(),
};

export const viewCapabilities: ViewCapabilities = {
  fetch: async ([url, init]) => {
    const target = new URL(string(url));
    if (target.protocol !== "https:") throw new Error(`fetch reaches only https URLs, not ${target.protocol}`);
    if (target.username || target.password) throw new Error("fetch URLs can't carry credentials");
    if (PRIVATE_HOST.test(target.hostname)) throw new Error(`fetch can't reach ${target.hostname}: views reach only the public internet`);
    const options = (init ?? {}) as { method?: string; headers?: Record<string, string>; body?: string };
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      if (!/^(cookie|host|content-length)$/iu.test(name)) headers[name] = string(value);
    }
    const response = await fetch(target.toString(), {
      method: (options.method ?? "GET").toUpperCase(),
      headers,
      ...(typeof options.body === "string" ? { body: options.body } : {}),
      credentials: "omit",
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.text();
    if (body.length > MAX_RESPONSE_CHARS) throw new Error("The response is bigger than 8 MB");
    const out: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== "set-cookie") out[key] = value;
    });
    return { status: response.status, statusText: response.statusText, headers: out, url: response.url || target.toString(), body };
  },
  "clipboard.writeText": async ([text]) => {
    await Clipboard.setStringAsync(string(text));
  },
  "clipboard.readText": async () => Clipboard.getStringAsync(),
  openUrl: async ([url]) => {
    const target = new URL(string(url));
    if (!/^(https?|mailto|tel|sms):$/u.test(target.protocol)) throw new Error(`openUrl opens web, mail and phone links, not ${target.protocol}`);
    if (target.protocol.startsWith("http")) await openWebLink(target.toString());
    else await Linking.openURL(target.toString());
  },
  notify: async ([title, options], context) => {
    const permission = await Notifications.getPermissionsAsync();
    const granted = permission.granted || (permission.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
    if (!granted) throw new Error("Notifications are off for Stella");
    const body = (options as { body?: unknown } | undefined)?.body;
    await Notifications.scheduleNotificationAsync({
      content: { title: string(title) || context.title, ...(typeof body === "string" && body ? { body } : {}), data: { kind: "view", viewId: context.viewId } },
      trigger: null,
    });
  },
  haptic: async ([kind]) => {
    await (HAPTICS[string(kind)] ?? HAPTICS.light!)();
  },
  share: async ([content]) => {
    const c = (content ?? {}) as { text?: unknown; url?: unknown; title?: unknown };
    const text = typeof c.text === "string" ? c.text : "";
    const url = typeof c.url === "string" ? c.url : "";
    if (!text && !url) throw new Error("share needs text or a url");
    await Share.share({ message: [text, url].filter(Boolean).join("\n"), ...(url ? { url } : {}), ...(typeof c.title === "string" ? { title: c.title } : {}) });
  },
  send: async ([text]) => {
    const message = string(text).trim();
    if (!message) return;
    if (!(await sendToChat(message))) throw new Error("The message couldn't be sent");
  },
};
