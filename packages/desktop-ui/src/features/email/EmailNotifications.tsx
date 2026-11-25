import { useEffect, useMemo } from "react";
import {
  setNotificationPanelOpen,
  useNotificationSource,
  type NotificationInput,
} from "@/features/notifications/notification-store";
import { useI18n } from "@/shared/i18n";
import { sidebarSections, useSidebarOpenTabs } from "@/features/workspace-display/sidebar-sections";
import { useEmailFeatureState } from "./email-feature";
import { useEmailPageView, useEmailSeenAt } from "./email-unseen";

const DETAIL_CHARS = 140;

const clip = (text: string): string =>
  text.length > DETAIL_CHARS ? `${text.slice(0, DETAIL_CHARS - 1).trimEnd()}…` : text;

export const openEmailPage = (): void => {
  sidebarSections.openSectionTab("email");
};

const openFromBell = () => {
  setNotificationPanelOpen(false);
  openEmailPage();
};

export function EmailNotifications() {
  const { on, known } = useEmailFeatureState();
  const tabs = useSidebarOpenTabs();
  useEffect(() => {
    if (!known || on) return;
    for (const tab of sidebarSections.getSnapshot().tabs) {
      if (tab.kind === "email") sidebarSections.closeTab(tab.id);
    }
  }, [known, on, tabs]);
  return on ? <UrgentEmailNotifications /> : null;
}

function UrgentEmailNotifications() {
  const { t } = useI18n();
  const page = useEmailPageView().value?.page;
  const seenAt = useEmailSeenAt();
  const items = useMemo(
    (): NotificationInput[] =>
      (page?.items ?? [])
        .filter((item) => item.urgent && item.at > seenAt)
        .map((item) => ({
          id: `email:${item.id}:${item.at}`,
          kind: "email",
          title: clip(item.title),
          detail: clip(item.gist),
          createdAt: item.at,
          actions: [
            { label: t("email.notify.open"), primary: true, lasting: { open: "email" }, run: openFromBell },
          ],
        })),
    [page, seenAt, t],
  );
  useNotificationSource("email", items);
  return null;
}
