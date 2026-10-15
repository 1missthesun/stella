import { memo, useState, type ReactNode } from "react";
import {
  tomorrowMorningMinutes,
  type ReminderMark,
} from "@stella/contracts/reminders";
import { useI18n } from "@/shared/i18n";
import { Check, ChevronDown, Clock } from "@/ui/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { markReminderDone, snoozeReminder, useReminderFires } from "./use-reminder-fires";
import "@/features/schedule/schedule-card.css";

const formatTime = (ms: number): string => {
  const date = new Date(ms);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : date.toLocaleString(undefined, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      });
};

/** A reminder that went off: what to do on row 1; "Reminder · 9:00 AM" and "Reminder · 9:00 AM" on row 2; Done / Snooze in a row under it while open. */
export const ReminderFireCard = memo(function ReminderFireCard({
  mark,
  text,
  firedAtMs,
}: {
  mark: ReminderMark;
  text: string;
  firedAtMs: number | undefined;
}) {
  const { t } = useI18n();
  const fires = useReminderFires();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const fire = fires?.get(mark.fireId);
  const atMs = mark.dueAt ?? firedAtMs;
  const status = [t("reminders.title"), atMs !== undefined ? formatTime(atMs) : null]
    .filter(Boolean)
    .join(" · ");

  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    setFailed(false);
    void action()
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };

  let trailing: ReactNode = null;
  if (fire?.state === "done") {
    trailing = (
      <span className="schedule-card__settled" data-reminder-state="done">
        <Check size={13} strokeWidth={2} />
        {t("reminders.doneState")}
      </span>
    );
  } else if (fire?.state === "snoozed") {
    const until = fire.snoozedUntil;
    trailing = (
      <span className="schedule-card__settled" data-reminder-state="snoozed">
        {until && until > Date.now()
          ? t("reminders.snoozedUntil", { time: formatTime(until) })
          : t("reminders.snoozed")}
      </span>
    );
  } else if (fire) {
    trailing = (
      <span className="schedule-card__actions" data-reminder-state="open">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="pill-btn schedule-card__button" disabled={busy}>
              {t("reminders.snooze")}
              <ChevronDown size={12} strokeWidth={1.75} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => run(() => snoozeReminder(fire.fireId, 10))}>
              {t("reminders.snooze10")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => run(() => snoozeReminder(fire.fireId, 60))}>
              {t("reminders.snooze60")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => run(() => snoozeReminder(fire.fireId, tomorrowMorningMinutes(new Date())))}
            >
              {t("reminders.snoozeTomorrow")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          className="pill-btn pill-btn--primary schedule-card__button"
          disabled={busy}
          onClick={() => run(() => markReminderDone(fire.fireId))}
        >
          {t("reminders.done")}
        </button>
      </span>
    );
  }

  return (
    <div className="schedule-card" data-testid="reminder-fire-card" title={text}>
      <span className="schedule-card__tile" aria-hidden="true">
        <Clock size={16} strokeWidth={1.9} />
      </span>
      <span className="schedule-card__body">
        <span className="schedule-card__headline">{text}</span>
        <span className="schedule-card__meta">
          <span className="schedule-card__status">{failed ? t("reminders.failed") : status}</span>
          {trailing}
        </span>
      </span>
    </div>
  );
});
