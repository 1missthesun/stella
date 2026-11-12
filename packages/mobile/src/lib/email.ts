import { useMemo } from "react";
import { ActionSheetIOS, Alert, Linking, Platform } from "react-native";
import type { EmailBucket, EmailItem } from "@stella/contracts/backend/email";
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
