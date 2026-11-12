import { useEffect, useMemo } from "react";
import { plainText, senderOf } from "@stella/contracts/email-brief";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { useNotificationSource, type NotificationInput } from "@/features/notifications/notification-store";
import { useBackendView } from "@/platform/backend/use-backend-view";
import { useI18n } from "@/shared/i18n";
import { useStaleEmailChipCleanup } from "./EmailDigest";
import { sidebarSections, useSidebarOpenTabs } from "@/features/workspace-display/sidebar-sections";
import { openEmailDigest } from "./email-digest-store";
import { useEmailFeatureState } from "./email-feature";
import { useEmailSeenAt } from "./email-unseen";

const DETAIL_CHARS = 140;
/** A new group of urgent mail toasts at most this often; the bell still lists it. */
const URGENT_TOAST_GAP_MS = 30 * 60_000;
const URGENT_TOAST_KEY = "stella.email.urgentToastAt";

const clip = (text: string): string =>
  text.length > DETAIL_CHARS ? `${text.slice(0, DETAIL_CHARS - 1).trimEnd()}…` : text;

/** Whether a new urgent group may toast now, and if so marks it as having toasted. */
const urgentToastAllowed = (groupId: string): boolean => {
  try {
    const raw = window.localStorage.getItem(URGENT_TOAST_KEY);
    const last = raw ? (JSON.parse(raw) as { id?: string; at?: number }) : {};
    if (last.id === groupId) return true; // the store itself never toasts the same id twice
    if (typeof last.at === "number" && Date.now() - last.at < URGENT_TOAST_GAP_MS) return false;
    window.localStorage.setItem(URGENT_TOAST_KEY, JSON.stringify({ id: groupId, at: Date.now() }));
    return true;
  } catch {
    return true;
  }
};

export function EmailNotifications() {
  const { on, known } = useEmailFeatureState();
  const tabs = useSidebarOpenTabs();
  useStaleEmailChipCleanup();
  useEffect(() => {
    if (!known || on) return;
    // Email is off here: an Email tab kept from before (or from the October digest) goes.
    for (const tab of sidebarSections.getSnapshot().tabs) {
      if (tab.kind === "email") sidebarSections.closeTab(tab.id);
    }
  }, [known, on, tabs]);
  return on ? <EmailBriefingNotifications /> : null;
}

function EmailBriefingNotifications() {
  const { t, tPlural } = useI18n();
  const { hasConnectedAccount } = useAuthSessionState();
  const view = useBackendView("email.digests", hasConnectedAccount ? {} : "skip");
  const seenAt = useEmailSeenAt();
  const digests = view.value?.digests;
  const items = useMemo((): NotificationInput[] => {
    const unseen = (digests ?? []).filter((digest) => digest.createdAt > seenAt && digest.items.length > 0);
    const out: NotificationInput[] = [];
    const briefing = unseen.find((digest) => digest.kind === "summary");
    if (briefing) {
      const first = briefing.items[0]!;
      out.push({
        id: `email:${briefing.digestId}`,
        kind: "email",
        title: t("email.notify.briefing"),
        detail: clip(briefing.brief ? plainText(briefing.brief.lead) : first.line ?? first.subject),
        createdAt: briefing.createdAt,
        actions: [{ label: t("email.notify.open"), primary: true, run: () => openEmailDigest(briefing.digestId) }],
      });
    }
    // Newest first; the group is named after its oldest entry so it keeps one id while it grows.
    const flagged = unseen.filter((digest) => digest.kind !== "summary");
    if (flagged.length > 0) {
      const newest = flagged[0]!;
      const oldest = flagged[flagged.length - 1]!;
      const mails = flagged.flatMap((digest) => digest.items);
      const urgent = flagged.filter((digest) => digest.kind === "urgent").length;
      const title =
        flagged.length === 1
          ? newest.kind === "urgent"
            ? t("email.notify.urgent", { from: senderOf(mails[0]!.from) })
            : t("email.notify.asked")
          : urgent === flagged.length
            ? tPlural("email.row.urgentEmails", flagged.length)
            : urgent === 0
              ? tPlural("email.row.askedEmails", flagged.length)
              : `${tPlural("email.row.urgentEmails", urgent)} · ${tPlural("email.row.askedEmails", flagged.length - urgent)}`;
      const detail =
        flagged.length === 1
          ? mails[0]!.line ?? mails[0]!.subject
          : [...new Set(mails.map((mail) => senderOf(mail.from)))].join(", ");
      const id = `email:flagged:${oldest.digestId}`;
      out.push({
        id,
        kind: "email",
        title,
        detail: clip(detail),
        createdAt: newest.createdAt,
        toast: urgentToastAllowed(id),
        actions: [{ label: t("email.notify.open"), primary: true, run: () => openEmailDigest(newest.digestId) }],
      });
    }
    return out;
  }, [digests, seenAt, t, tPlural]);
  useNotificationSource("email", items);
  return null;
}
