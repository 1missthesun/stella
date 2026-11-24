import { useMemo } from "react";
import {
  useNotificationSource,
  type NotificationInput,
} from "@/features/notifications/notification-store";
import { useT } from "@/shared/i18n";
import { useSavedValuesSync } from "./use-saved-values-sync";

const day = (at: number) => {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
};

/**
 * A quiet line in the bell (no pop-up) the first time each day a cloud task
 * gets a saved login from this computer, so a use the user didn't expect is
 * there to see.
 */
export function SavedValuesNotifications() {
  const t = useT();
  const { status } = useSavedValuesSync();
  const releases = status?.releases;
  const items = useMemo((): NotificationInput[] => {
    if (!releases) return [];
    const firsts = new Map<string, NotificationInput>();
    for (const entry of [...releases].sort((a, b) => a.at - b.at)) {
      if (entry.refused) continue;
      const id = `saved-values:use:${entry.label}:${day(entry.at)}`;
      if (firsts.has(id)) continue;
      firsts.set(id, {
        id,
        kind: "info",
        title: t("global.savedValuesDevices.cloudUsed", { label: entry.label }),
        detail: entry.taskName,
        createdAt: entry.at,
        toast: false,
      });
    }
    return [...firsts.values()];
  }, [releases, t]);
  useNotificationSource("saved-values", items);
  return null;
}
