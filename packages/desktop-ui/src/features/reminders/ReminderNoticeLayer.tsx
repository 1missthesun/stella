import { useEffect, useRef } from "react";
import { REMINDER_DEFAULT_SNOOZE_MINUTES } from "@stella/contracts/reminders";
import { useT } from "@/shared/i18n";
import { dismissToast, showToast } from "@/ui/toast";
import { markReminderDone, snoozeReminder, useReminderFireList } from "./use-reminder-fires";

/** How long after it fired a reminder still pops up when the app opens. */
const NOTICE_WINDOW_MS = 30 * 60_000;
const SEEN_KEY = "stella.reminders.noticed";
const SEEN_LIMIT = 200;

const readSeen = (): string[] => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
};

const writeSeen = (ids: readonly string[]): void => {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-SEEN_LIMIT)));
  } catch {
    return;
  }
};

/**
 * A reminder that fires shows here, inside the app, instead of as a system
 * notification: once per delivery, with Done and Snooze. Settled from
 * another device, it goes away here too.
 */
export function ReminderNoticeLayer() {
  const t = useT();
  const fires = useReminderFireList();
  const shown = useRef(new Map<string, string>());

  useEffect(() => {
    if (!fires) return;
    const now = Date.now();
    const seen = readSeen();
    const seenSet = new Set(seen);
    const open = new Set<string>();
    for (const fire of [...fires].reverse()) {
      if (fire.state !== "open") continue;
      open.add(fire.fireId);
      if (seenSet.has(fire.fireId) || shown.current.has(fire.fireId)) continue;
      if (now - fire.firedAt > NOTICE_WINDOW_MS) continue;
      const toastId = showToast({
        title: t("reminders.title"),
        description: fire.text,
        duration: 0,
        action: {
          label: t("reminders.done"),
          onClick: () => void markReminderDone(fire.fireId).catch(() => undefined),
        },
        secondaryAction: {
          label: t("reminders.snoozeFor"),
          onClick: () =>
            void snoozeReminder(fire.fireId, REMINDER_DEFAULT_SNOOZE_MINUTES).catch(() => undefined),
        },
      });
      shown.current.set(fire.fireId, toastId);
      seen.push(fire.fireId);
      seenSet.add(fire.fireId);
    }
    writeSeen(seen);
    for (const [fireId, toastId] of shown.current) {
      if (open.has(fireId)) continue;
      dismissToast(toastId);
      shown.current.delete(fireId);
    }
  }, [fires, t]);

  return null;
}
