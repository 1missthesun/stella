import { useEffect, useRef } from "react";
import { zoneLabel } from "@stella/contracts/schedule-zone";
import { useT, useTPlural } from "@/shared/i18n";
import { dismissToast, showToast } from "@/ui/toast";
import { useAnswerScheduleZone, useScheduleZoneNotice } from "./use-schedule-zone";

/**
 * Asks once, inside the app, when this computer is in a different time zone
 * from the schedules: one click moves them, keeping their clock times. An
 * answer from any device settles it everywhere.
 */
export function ScheduleZoneNoticeLayer() {
  const t = useT();
  const tPlural = useTPlural();
  const notice = useScheduleZoneNotice();
  const answer = useAnswerScheduleZone();
  const shown = useRef<{ key: string; toastId: string } | null>(null);

  useEffect(() => {
    const key = notice ? `${notice.from}>${notice.to}` : null;
    if (shown.current && shown.current.key !== key) {
      dismissToast(shown.current.toastId);
      shown.current = null;
    }
    if (!notice || !key || shown.current) return;
    const toastId = showToast({
      title: t("schedule.zone.title", { place: zoneLabel(notice.to) }),
      description: tPlural("schedule.zone.body", notice.count, { place: zoneLabel(notice.from) }),
      duration: 0,
      action: {
        label: t("schedule.zone.move"),
        onClick: () => void answer(notice, true).catch(() => undefined),
      },
      secondaryAction: {
        label: t("schedule.zone.keep"),
        onClick: () => void answer(notice, false).catch(() => undefined),
      },
    });
    shown.current = { key, toastId };
  }, [notice, answer, t, tPlural]);

  return null;
}
