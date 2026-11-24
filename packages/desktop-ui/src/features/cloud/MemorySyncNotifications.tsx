import { useMemo } from "react";
import {
  useNotificationSource,
  type NotificationInput,
} from "@/features/notifications/notification-store";
import { useT } from "@/shared/i18n";
import { useMemorySyncStatus } from "./use-memory-sync-status";

export function MemorySyncNotifications() {
  const t = useT();
  const status = useMemorySyncStatus();
  const refused = status?.refused;
  const items = useMemo((): NotificationInput[] => {
    if (!refused || refused.length === 0) return [];
    const names = refused.map((file) => file.split("/").at(-1) ?? file);
    return [
      {
        id: `memory-sync:refused:${refused.join(",")}`,
        kind: "problem",
        title: t("settings.account.cloudHome.memory.refusedTitle"),
        detail: t("settings.account.cloudHome.memory.refused", {
          files: names.join(", "),
        }),
      },
    ];
  }, [refused, t]);
  useNotificationSource("memory-sync", items);
  return null;
}
