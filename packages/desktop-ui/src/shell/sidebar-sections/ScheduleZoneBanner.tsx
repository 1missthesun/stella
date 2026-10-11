import { useState } from "react";
import { zoneLabel } from "@stella/contracts/schedule-zone";
import { useT, useTPlural } from "@/shared/i18n";
import { useAnswerScheduleZone, useScheduleZoneNotice } from "@/features/schedule/use-schedule-zone";

/** The time zone question, at the top of Schedule until it is answered. */
export function ScheduleZoneBanner() {
  const t = useT();
  const tPlural = useTPlural();
  const notice = useScheduleZoneNotice();
  const answer = useAnswerScheduleZone();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!notice) return null;
  const reply = async (move: boolean) => {
    setBusy(true);
    setFailed(false);
    try {
      await answer(notice, move);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="schedule-zone" role="status" data-testid="schedule-zone">
      <div className="schedule-zone__text">
        <div className="updates-section__title">{t("schedule.zone.title", { place: zoneLabel(notice.to) })}</div>
        <div className="schedule-zone__body">
          {tPlural("schedule.zone.body", notice.count, { place: zoneLabel(notice.from) })}
        </div>
        {failed ? <div className="schedule-section__error">{t("schedule.zone.failed")}</div> : null}
      </div>
      <div className="schedule-zone__actions">
        <button type="button" className="updates-section__button" disabled={busy} onClick={() => void reply(false)}>
          {t("schedule.zone.keep")}
        </button>
        <button
          type="button"
          className="updates-section__button"
          data-primary
          disabled={busy}
          onClick={() => void reply(true)}
        >
          {t("schedule.zone.move")}
        </button>
      </div>
    </div>
  );
}
