import { memo, useId, useMemo, useState } from "react";
import type { ScheduleNoticeCard as ScheduleNotice } from "@stella/contracts/schedule-notice";
import {
  scheduleNoticeRunRowText,
  scheduleNoticeSummaryText,
  showsAsSingleScheduleCard,
  summarizeScheduleNotices,
} from "@stella/contracts/schedule-notice-group";
import { useI18n } from "@/shared/i18n";
import { Clock } from "@/ui/icons";
import { ScheduleNoticeCard } from "./ScheduleNoticeCard";
import { openScheduleFocused } from "./schedule-focus";
import "./schedule-card.css";

/**
 * Schedule notices that arrived one after another. One the user will care
 * about keeps its own card; a run reads as one card with what it left behind,
 * opening in place to every notice. A background task's own follow-ups sit on
 * a plain line, without the card's bubble.
 */
export const ScheduleNotices = memo(function ScheduleNotices({
  first,
  run,
}: {
  first: ScheduleNotice;
  /** The whole run when more than one notice arrived in a row. */
  run?: readonly ScheduleNotice[];
}) {
  const cards = useMemo(() => run ?? [first], [first, run]);
  if (showsAsSingleScheduleCard(cards)) return <ScheduleNoticeCard card={cards[0]!} />;
  return <ScheduleNoticeGroup cards={cards} />;
});

const ScheduleNoticeGroup = memo(function ScheduleNoticeGroup({
  cards,
}: {
  cards: readonly ScheduleNotice[];
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const [open, setOpen] = useState(false);
  const listId = useId();
  const nowMs = useMemo(() => Date.now(), [cards]);
  const summary = useMemo(() => summarizeScheduleNotices(cards, nowMs), [cards, nowMs]);
  const text = useMemo(
    () => scheduleNoticeSummaryText(summary, i18n, nowMs),
    [i18n, nowMs, summary],
  );
  const rows = useMemo(
    () =>
      open
        ? cards.map((card) => ({ card, status: scheduleNoticeRunRowText(card, i18n, nowMs) }))
        : [],
    [cards, i18n, nowMs, open],
  );
  const expandable = cards.length > 1;
  const quiet = summary.agentOnly;
  const only = cards.length === 1 ? cards[0]! : null;

  return (
    <div
      className={quiet ? "schedule-run schedule-run--quiet" : "schedule-card schedule-run"}
      data-open={open ? "true" : undefined}
      data-testid="schedule-notice-run"
    >
      <button
        type="button"
        className="schedule-run__head"
        data-undone={text.undone ? "true" : undefined}
        aria-label={`${text.headline}, ${text.status}`}
        title={`${text.headline}\n${text.status}`}
        {...(expandable ? { "aria-expanded": open, "aria-controls": listId } : {})}
        onClick={() => {
          if (only) {
            openScheduleFocused(only.scheduleId);
            return;
          }
          setOpen((value) => !value);
        }}
      >
        <span className="schedule-card__tile" aria-hidden="true">
          <Clock size={16} strokeWidth={1.9} />
        </span>
        <span className="schedule-card__body">
          <span className="schedule-card__headline">{text.headline}</span>
          <span className="schedule-card__meta">
            <span className="schedule-card__status">{text.status}</span>
            {expandable ? (
              <span className="schedule-card__actions" aria-hidden="true">
                <span className="schedule-card__button">
                  {open ? t("schedule.notice.group.showLess") : t("schedule.notice.group.showAll")}
                </span>
              </span>
            ) : null}
          </span>
        </span>
      </button>
      {open ? (
        <ul className="schedule-run__list" id={listId}>
          {rows.map(({ card, status }, index) => (
            <li key={`${card.scheduleId}:${card.action}:${index}`}>
              <button
                type="button"
                className="schedule-run__item"
                data-action={card.action}
                title={`${card.name}\n${status}`}
                onClick={() => openScheduleFocused(card.scheduleId)}
              >
                <span className="schedule-run__name">{card.name}</span>
                <span className="schedule-run__status">{status}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});
