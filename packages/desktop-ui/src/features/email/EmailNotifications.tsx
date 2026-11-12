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

/**
 * The newest email briefing, until Email is opened, also sits in the top bar's
 * bell (and toasts once when it lands). Open shows it in the Email tab.
 */
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
  const { t } = useI18n();
  const { hasConnectedAccount } = useAuthSessionState();
  const view = useBackendView("email.digests", hasConnectedAccount ? {} : "skip");
  const seenAt = useEmailSeenAt();
  const newest = view.value?.digests[0];
  const items = useMemo((): NotificationInput[] => {
    if (!newest || newest.createdAt <= seenAt || newest.items.length === 0) return [];
    const first = newest.items[0]!;
    const title =
      newest.kind === "urgent"
        ? t("email.notify.urgent", { from: senderOf(first.from) })
        : newest.kind === "rule"
          ? t("email.notify.asked")
          : t("email.notify.briefing");
    const detail = newest.brief ? plainText(newest.brief.lead) : first.line ?? first.subject;
    return [
      {
        id: `email:${newest.digestId}`,
        kind: "email",
        title,
        detail: detail.length > DETAIL_CHARS ? `${detail.slice(0, DETAIL_CHARS - 1).trimEnd()}…` : detail,
        createdAt: newest.createdAt,
        actions: [{ label: t("email.notify.open"), primary: true, run: () => openEmailDigest(newest.digestId) }],
      },
    ];
  }, [newest, seenAt, t]);
  useNotificationSource("email", items);
  return null;
}
