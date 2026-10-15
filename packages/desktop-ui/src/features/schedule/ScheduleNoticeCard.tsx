import { memo, useMemo } from "react";
import { describeScheduleTiming } from "@stella/contracts/schedule-format";
import {
  scheduleNoticeTitleKey,
  scheduleTimingText,
  type ScheduleNoticeCard as ScheduleNotice,
} from "@stella/contracts/schedule-notice";
import { useI18n } from "@/shared/i18n";
import { Clock } from "@/ui/icons";
import { openScheduleFocused } from "./schedule-focus";
import "./schedule-card.css";

export const ScheduleNoticeCard = memo(function ScheduleNoticeCard({ card }: { card: ScheduleNotice }) {
  const { t, tPlural, locale } = useI18n();
  const removed = card.action === "removed";
  const when = useMemo(() => {
    if (removed || !card.schedule) return null;
    const timing = describeScheduleTiming(card.schedule, {
      nowMs: Date.now(),
      ...(card.nextRunAt !== undefined ? { nextRunAtMs: card.nextRunAt } : {}),
      ...(card.zone ? { zone: card.zone } : {}),
    });
    return scheduleTimingText(timing, { t, tPlural, locale });
  }, [card, locale, removed, t, tPlural]);
  const title = t(`schedule.notice.title.${scheduleNoticeTitleKey(card)}`);
  const status = [title, when].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      className="schedule-card"
      data-action={card.action}
      data-kind={card.kind}
      data-testid="schedule-notice-card"
      aria-label={`${card.name}, ${status}`}
      title={`${card.name}\n${status}`}
      onClick={() => openScheduleFocused(card.scheduleId)}
    >
      <span className="schedule-card__row">
        <Clock className="schedule-card__icon" size={13} strokeWidth={1.9} aria-hidden="true" />
        <span className="schedule-card__headline">{card.name}</span>
      </span>
      <span className="schedule-card__meta">
        <span className="schedule-card__status">{status}</span>
      </span>
    </button>
  );
});
