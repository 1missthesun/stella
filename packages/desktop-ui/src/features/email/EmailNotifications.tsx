import { useEffect, useMemo } from "react";
import type { EmailMatter } from "@stella/contracts/backend/email";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { useNotificationSource, type NotificationInput } from "@/features/notifications/notification-store";
import { useBackendView } from "@/platform/backend/use-backend-view";
import { useI18n } from "@/shared/i18n";
import { useStaleEmailChipCleanup } from "./EmailDigest";
import { sidebarSections, useSidebarOpenTabs } from "@/features/workspace-display/sidebar-sections";
import { openEmailToday } from "./email-digest-store";
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
  const view = useBackendView("email.today", hasConnectedAccount ? {} : "skip");
  const seenAt = useEmailSeenAt();
  const today = view.value;
  const items = useMemo((): NotificationInput[] => {
    if (!today) return [];
    const open = new Map(today.open.map((matter) => [matter.matterId, matter]));
    const openIn = (ids: string[]): EmailMatter[] => ids.flatMap((id) => (open.has(id) ? [open.get(id)!] : []));
    const out: NotificationInput[] = [];
    const more = (count: number) => (count > 0 ? tPlural("email.notify.more", count) : undefined);
    // Each entry says in one sentence what the email wants.
    const summary = today.alerts.find((alert) => alert.kind === "summary" && alert.at > seenAt && openIn(alert.matterIds).length > 0);
    if (summary) {
      const matters = openIn(summary.matterIds);
      out.push({
        id: `email:${summary.briefingId}`,
        kind: "email",
        title: clip(matters[0]!.wants),
        detail: more(matters.length - 1),
        createdAt: summary.at,
        actions: [{ label: t("email.notify.open"), primary: true, run: openEmailToday }],
      });
    }
    // Urgent mail and mail you asked about: one entry that grows, named after its oldest alert.
    const flagged = today.alerts.filter((alert) => alert.kind !== "summary" && alert.at > seenAt && openIn(alert.matterIds).length > 0);
    if (flagged.length > 0) {
      const matters = flagged.flatMap((alert) => openIn(alert.matterIds));
      const id = `email:flagged:${flagged[flagged.length - 1]!.briefingId}`;
      out.push({
        id,
        kind: "email",
        title: clip(matters[0]!.wants),
        detail: more(matters.length - 1),
        createdAt: flagged[0]!.at,
        toast: urgentToastAllowed(id),
        actions: [{ label: t("email.notify.open"), primary: true, run: openEmailToday }],
      });
    }
    for (const matter of today.open) {
      if (!matter.returnedAt || matter.returnedAt <= seenAt) continue;
      out.push({
        id: `email:back:${matter.matterId}:${matter.returnedAt}`,
        kind: "email",
        title: clip(matter.wants),
        detail: t("email.notify.back"),
        createdAt: matter.returnedAt,
        actions: [{ label: t("email.notify.open"), primary: true, run: openEmailToday }],
      });
    }
    return out;
  }, [today, seenAt, t, tPlural]);
  useNotificationSource("email", items);
  return null;
}
