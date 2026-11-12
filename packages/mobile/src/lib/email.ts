import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ActionSheetIOS, Alert, Linking, Platform } from "react-native";
import type { EmailBucket, EmailFocusAction, EmailItem, EmailTargets } from "@stella/contracts/backend/email";
import { authClient } from "./auth-client";
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

/**
 * The sorted week's items by id, so a card shows corrections made anywhere,
 * and whether more than one inbox is sorted (only then is an item's account shown).
 */
export function useEmailFeedItems(): {
  items: ReadonlyMap<string, EmailItem> | undefined;
  showAccounts: boolean;
} {
  const signedIn = Boolean(authClient.useSession().data?.user);
  const feed = useBackendView("email.feed", signedIn ? {} : "skip").value;
  const list = feed?.items;
  const items = useMemo(
    () => (list ? new Map(list.map((item) => [item.itemId, item])) : undefined),
    [list],
  );
  return { items, showAccounts: (feed?.status.accounts.length ?? 0) > 1 };
}

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

/** Sorted mail worth showing that arrived since the Email page was last open. */
export function useEmailUnseenCount(): number {
  const { items } = useEmailFeedItems();
  const seen = useSyncExternalStore(subscribeSeen, () => seenAt);
  return useMemo(() => {
    if (!items) return 0;
    let count = 0;
    for (const item of items.values()) {
      if (item.bucket !== "noise" && item.state !== "dismissed" && item.receivedAt > seen) count += 1;
    }
    return count;
  }, [items, seen]);
}

// The opened digest ----------------------------------------------------------

type DigestSheetState = { digestId: string | null; open: boolean };
let digestSheet: DigestSheetState = { digestId: null, open: false };
const digestSheetListeners = new Set<() => void>();
const emitDigestSheet = (next: DigestSheetState) => {
  digestSheet = next;
  for (const listener of digestSheetListeners) listener();
};
const subscribeDigestSheet = (listener: () => void) => {
  digestSheetListeners.add(listener);
  return () => {
    digestSheetListeners.delete(listener);
  };
};

/** Opens the digest behind a chat email row in the top sheet. */
export const openEmailDigest = (digestId: string): void => emitDigestSheet({ digestId, open: true });
export const closeEmailDigest = (): void => emitDigestSheet({ ...digestSheet, open: false });
export const selectEmailDigest = (digestId: string): void => emitDigestSheet({ ...digestSheet, digestId });
export const useEmailDigestSheet = (): DigestSheetState =>
  useSyncExternalStore(subscribeDigestSheet, () => digestSheet);

// Handing an email to Stella -------------------------------------------------

const askQueue: string[] = [];
const askListeners = new Set<() => void>();

/**
 * Hands emails to Stella as a plain chat message. A hidden note written just
 * before it names the exact emails, so Stella acts on the right ones and the
 * answer comes back in the chat like any other. The chat screen sends it.
 */
export const askStellaAboutEmail = async (
  targets: EmailTargets,
  action: EmailFocusAction,
  text: string,
): Promise<void> => {
  await getBackendClient()
    .call("email.focus", { ...targets, action })
    .catch(() => undefined);
  askQueue.push(text);
  for (const listener of askListeners) listener();
};

/** The chat screen sends what briefing actions asked, as soon as it can. */
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

// What the open briefing puts in front of the composer ------------------------

/**
 * While the briefing sheet is open, what's on screen (the briefing, a picked
 * point, a found email or an open thread) shows as a chip on the composer. A
 * message typed with it goes to Stella through the same hidden note the
 * briefing's actions use, so "tell them Thursday works" needs no more words.
 */
export type EmailComposerContext = { key: string; label: string; targets: EmailTargets };

let composerContext: EmailComposerContext | null = null;
let removedKey: string | null = null;
const contextListeners = new Set<() => void>();
const emitContext = () => {
  for (const listener of contextListeners) listener();
};

export const setEmailComposerContext = (next: EmailComposerContext | null, picked = false): void => {
  if (picked) removedKey = null;
  const shown = next && next.key !== removedKey ? next : null;
  if (shown?.key === composerContext?.key && shown?.label === composerContext?.label) return;
  composerContext = shown;
  emitContext();
};

/** The user took the chip off; it stays off until something else is picked. */
export const removeEmailComposerContext = (): void => {
  removedKey = composerContext?.key ?? null;
  composerContext = null;
  emitContext();
};

export const getEmailComposerContext = (): EmailComposerContext | null => composerContext;

export const useEmailComposerContext = (): EmailComposerContext | null =>
  useSyncExternalStore(
    (listener) => {
      contextListeners.add(listener);
      return () => {
        contextListeners.delete(listener);
      };
    },
    () => composerContext,
  );
