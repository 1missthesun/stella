import { useMemo } from "react";
import type { EmailBucket, EmailItem } from "@stella/contracts/backend/email";
import { backendClient } from "@/platform/backend/backend-client";
import { useBackendView } from "@/platform/backend/use-backend-view";
import { openExternalUrl } from "@/platform/electron/open-external";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";

export const gmailThreadUrl = (threadId: string, account?: string): string =>
  `https://mail.google.com/mail/u/${account?.includes("@") ? encodeURIComponent(account) : "0"}/#all/${encodeURIComponent(threadId)}`;

export const openGmailThread = (threadId: string, account?: string): void =>
  openExternalUrl(gmailThreadUrl(threadId, account));

export const senderName = (from: string): string =>
  from.replace(/\s*<[^>]*>\s*$/u, "").replace(/^"|"$/gu, "") || from;

export const correctEmail = (itemId: string, bucket: EmailBucket) =>
  backendClient.call("email.correct", { itemId, bucket });

export const dismissEmail = (itemId: string) => backendClient.call("email.dismiss", { itemId });

/**
 * The sorted week's items by id, so a card shows corrections made anywhere,
 * and whether more than one inbox is sorted (only then is an item's account shown).
 */
export function useEmailFeedItems(): {
  items: ReadonlyMap<string, EmailItem> | undefined;
  showAccounts: boolean;
} {
  const { hasConnectedAccount } = useAuthSessionState();
  const feed = useBackendView("email.feed", hasConnectedAccount ? {} : "skip").value;
  const list = feed?.items;
  const items = useMemo(
    () => (list ? new Map(list.map((item) => [item.itemId, item])) : undefined),
    [list],
  );
  return { items, showAccounts: (feed?.status.accounts.length ?? 0) > 1 };
}

export const emailTime = (locale: string, at: number, now: number): string => {
  const sameDay = new Date(at).toDateString() === new Date(now).toDateString();
  return new Intl.DateTimeFormat(locale, {
    ...(sameDay ? {} : now - at < 6 * 86_400_000 ? { weekday: "short" } : { month: "short", day: "numeric" }),
    ...(sameDay || now - at < 6 * 86_400_000 ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(at);
};
