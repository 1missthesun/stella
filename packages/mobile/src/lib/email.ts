import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ActionSheetIOS, Alert, Linking, Platform } from "react-native";
import type { EmailBucket, EmailFocusAction, EmailTargets } from "@stella/contracts/backend/email";
import { authClient } from "./auth-client";
import { useEmailFeature } from "./email-feature";
import { getBackendClient, useBackendView } from "./backend";

export const gmailThreadUrl = (threadId: string, account?: string): string =>
  `https://mail.google.com/mail/u/${account?.includes("@") ? encodeURIComponent(account) : "0"}/#all/${encodeURIComponent(threadId)}`;

export const openGmailThread = (threadId: string, account?: string): void => {
  void Linking.openURL(gmailThreadUrl(threadId, account)).catch(() => undefined);
};

export const senderName = (from: string): string =>
  from.replace(/\s*<[^>]*>\s*$/u, "").replace(/^"|"$/gu, "") || from;

export const correctEmail = (itemId: string, bucket: EmailBucket) =>
  getBackendClient().call("email.correct", { itemId, bucket });

export const dismissEmail = (itemId: string) => getBackendClient().call("email.dismiss", { itemId });

export const emailTime = (locale: string, at: number, now: number): string => {
  const sameDay = new Date(at).toDateString() === new Date(now).toDateString();
  const thisWeek = now - at < 6 * 86_400_000;
  return new Date(at).toLocaleString(locale, {
    ...(sameDay ? {} : thisWeek ? { weekday: "short" } : { month: "short", day: "numeric" }),
    ...(sameDay || thisWeek ? { hour: "numeric", minute: "2-digit" } : {}),
  });
};

/** A native list of choices; `onPick` gets the chosen index. */
export const chooseAction = (
  title: string | undefined,
  options: readonly { label: string; destructive?: boolean }[],
  cancelLabel: string,
  onPick: (index: number) => void,
): void => {
  if (Platform.OS === "ios") {
    const destructive = options.findIndex((option) => option.destructive);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        ...(title ? { title } : {}),
        options: [...options.map((option) => option.label), cancelLabel],
        cancelButtonIndex: options.length,
        ...(destructive >= 0 ? { destructiveButtonIndex: destructive } : {}),
      },
      (index) => {
        if (index < options.length) onPick(index);
      },
    );
    return;
  }
  Alert.alert(title ?? "", undefined, [
    ...options.map((option, index) => ({
      text: option.label,
      style: option.destructive ? ("destructive" as const) : ("default" as const),
      onPress: () => onPick(index),
    })),
    { text: cancelLabel, style: "cancel" as const },
  ]);
};

// When the Email page was last looked at on this phone. Sorted mail that arrived
// after it is "unseen" and badges the Email entry; the chat only ever shows the
// newest email line.
const SEEN_KEY = "stella.email.seenAt";
let seenAt = Number.POSITIVE_INFINITY;
const seenListeners = new Set<() => void>();
const setSeen = (at: number) => {
  seenAt = at;
  for (const listener of seenListeners) listener();
};
void AsyncStorage.getItem(SEEN_KEY)
  .then((raw) => {
    const stored = Number(raw);
    if (Number.isFinite(stored) && stored > 0) setSeen(stored);
    else {
      // First run on this phone: count from now, not from the whole week.
      const now = Date.now();
      setSeen(now);
      void AsyncStorage.setItem(SEEN_KEY, String(now));
    }
  })
  .catch(() => setSeen(Date.now()));

export const markEmailSeen = (): void => {
  const now = Date.now();
  setSeen(now);
  void AsyncStorage.setItem(SEEN_KEY, String(now)).catch(() => undefined);
};

const subscribeSeen = (listener: () => void) => {
  seenListeners.add(listener);
  return () => seenListeners.delete(listener);
};

/** Items open on Today that arrived (or came back from Later) since the Email page was last open. */
export function useEmailUnseenCount(): number {
  const signedIn = Boolean(authClient.useSession().data?.user);
  const on = useEmailFeature();
  const open = useBackendView("email.today", signedIn && on ? {} : "skip").value?.open;
  const seen = useSyncExternalStore(subscribeSeen, () => seenAt);
  return useMemo(
    () => (open ?? []).filter((matter) => Math.max(matter.arrivedAt, matter.returnedAt ?? 0) > seen).length,
    [open, seen],
  );
}

// Handing email to Stella ------------------------------------------------------

const askQueue: string[] = [];
const askListeners = new Set<() => void>();

/**
 * Hands emails to Stella as a plain chat message. A hidden note written just
 * before it names the exact emails, so Stella acts on the right ones and the
 * answer comes back in the chat like any other. The chat screen sends it.
 * With `matterId`, the Today item is handed over (and settled as with Stella).
 */
export const askStellaAboutEmail = async (
  targets: EmailTargets,
  action: EmailFocusAction,
  text: string,
  matterId?: string,
): Promise<void> => {
  await getBackendClient()
    .call("email.focus", { ...targets, action, ...(matterId ? { matterId } : {}) })
    .catch(() => undefined);
  askQueue.push(text);
  for (const listener of askListeners) listener();
};

/** The chat screen sends what Today's actions asked, as soon as it can. */
export const useEmailAsks = (send: ((text: string) => unknown) | undefined, ready: boolean): void => {
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    const drain = () => {
      if (!ready || !sendRef.current) return;
      while (askQueue.length > 0) {
        const text = askQueue.shift();
        if (text) sendRef.current(text);
      }
    };
    drain();
    askListeners.add(drain);
    return () => {
      askListeners.delete(drain);
    };
  }, [ready]);
};

export const archiveEmail = (targets: EmailTargets, archived: boolean) =>
  getBackendClient().call("email.archive", { ...targets, archived });

