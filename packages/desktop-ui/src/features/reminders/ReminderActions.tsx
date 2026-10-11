import { memo, useState } from "react";
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
import "./reminders.css";

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

/** Done and Snooze under a reminder Stella delivered; the state is the same on every device. */
export const ReminderActions = memo(function ReminderActions({ mark }: { mark: ReminderMark }) {
  const { t } = useI18n();
  const fires = useReminderFires();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const fire = fires?.get(mark.fireId);
  if (!fire) return null;
  const due = mark.dueAt ? (
    <span className="reminder-actions__due">{t("reminders.due", { time: formatTime(mark.dueAt) })}</span>
  ) : null;

  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    setFailed(false);
    void action()
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };

  if (fire.state === "done") {
    return (
      <div className="reminder-actions reminder-actions--settled" data-reminder-state="done">
        {due}
        <Check size={14} strokeWidth={2} />
        <span>{t("reminders.doneState")}</span>
      </div>
    );
  }
  if (fire.state === "snoozed") {
    const until = fire.snoozedUntil;
    return (
      <div className="reminder-actions reminder-actions--settled" data-reminder-state="snoozed">
        {due}
        <Clock size={14} strokeWidth={1.75} />
        <span>
          {until && until > Date.now()
            ? t("reminders.snoozedUntil", { time: formatTime(until) })
            : t("reminders.snoozed")}
        </span>
      </div>
    );
  }
  return (
    <div className="reminder-actions" data-reminder-state="open">
      {due}
      <button
        type="button"
        className="reminder-actions__button reminder-actions__button--primary"
        disabled={busy}
        onClick={() => run(() => markReminderDone(fire.fireId))}
      >
        <Check size={14} strokeWidth={2} />
        {t("reminders.done")}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="reminder-actions__button" disabled={busy}>
            <Clock size={14} strokeWidth={1.75} />
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
      {failed ? <span className="reminder-actions__error">{t("reminders.failed")}</span> : null}
    </div>
  );
});
