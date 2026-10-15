import { memo, useMemo } from "react";
import { describeScheduleTiming } from "@stella/contracts/schedule-format";
import {
  scheduleNoticeTitleKey,
  scheduleTimingText,
  type ScheduleNoticeCard as ScheduleNotice,
} from "@stella/contracts/schedule-notice";
import { useI18n } from "@/shared/i18n";
import { Clock, Eye, Wand2 } from "@/ui/icons";
import type { IconComponent } from "@/ui/icons";
import { openScheduleFocused } from "./schedule-focus";
import "./schedule-notice-card.css";

const KIND_ICON: Record<ScheduleNotice["kind"], IconComponent> = {
  reminder: Clock,
  task: Wand2,
  watch: Eye,
};

export const ScheduleNoticeCard = memo(function ScheduleNoticeCard({ card }: { card: ScheduleNotice }) {
  const { t, tPlural, locale } = useI18n();
  const Icon = KIND_ICON[card.kind];
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

  return (
    <button
      type="button"
      className="schedule-notice-card"
      data-action={card.action}
      data-kind={card.kind}
      data-testid="schedule-notice-card"
      aria-label={`${title}: ${card.name}`}
      title={t("schedule.notice.open")}
      onClick={() => openScheduleFocused(card.scheduleId)}
    >
      <span className="schedule-notice-card__label">
        <Icon size={13} strokeWidth={1.9} aria-hidden="true" />
        <span>{title}</span>
      </span>
      <span className="schedule-notice-card__name">{card.name}</span>
      {when ? <span className="schedule-notice-card__when">{when}</span> : null}
      {card.message && !removed ? (
        <span className="schedule-notice-card__message">{card.message}</span>
      ) : null}
    </button>
  );
});
