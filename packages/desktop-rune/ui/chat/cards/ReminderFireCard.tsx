import { memo, useState, type ReactNode } from "react";
import { serverNow } from "@stella/contracts/server-clock";
import { tomorrowMorningMinutes, type ReminderMark } from "@stella/contracts/reminders";
import { useI18n } from "@/shared/i18n";
import { markReminderDone, snoozeReminder, useReminderFires } from "@/features/reminders/use-reminder-fires";
import { DropdownMenu, Icon, Icons, MenuItem } from "../../kit";
import { useTokens } from "../../theme";
import { META_TEXT, ScheduleButton, ScheduleCard, ScheduleStatus } from "./ScheduleCard";

const formatTime = (ms: number): string => {
  const date = new Date(ms);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : date.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
};

/** desktop-ui's `ReminderFireCard`: a reminder that fired, with Snooze and Done until it's settled. */
export const ReminderFireCard = memo(function ReminderFireCard({ mark, text, firedAtMs }: { mark: ReminderMark; text: string; firedAtMs: number | undefined }) {
  const { t } = useI18n();
  const tokens = useTokens();
  const fires = useReminderFires();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const fire = fires?.get(mark.fireId);
  const atMs = mark.dueAt ?? firedAtMs;
  const status = [t("reminders.title"), atMs !== undefined ? formatTime(atMs) : null].filter(Boolean).join(" · ");
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
      <row align="center" gap={4} shrink={false}>
        <Icon icon={Icons.stella.Check} size={13} strokeWidth={2} color={tokens.c.textWeak} />
        <text {...META_TEXT} color={tokens.c.textWeak}>
          {t("reminders.doneState")}
        </text>
      </row>
    );
  } else if (fire?.state === "snoozed") {
    const until = fire.snoozedUntil;
    trailing = (
      <text {...META_TEXT} color={tokens.c.textWeak} shrink={false}>
        {until && until > serverNow() ? t("reminders.snoozedUntil", { time: formatTime(until) }) : t("reminders.snoozed")}
      </text>
    );
  } else if (fire) {
    trailing = (
      <row align="center" gap={12} shrink={false}>
        <DropdownMenu
          id={`reminder-snooze:${fire.fireId}`}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          align="start"
          trigger={(trigger) => (
            <box id={trigger.id}>
              <ScheduleButton label={t("reminders.snooze")} disabled={busy} onPress={trigger.toggle} trailing={<Icon icon={Icons.stella.ChevronDown} size={12} strokeWidth={1.75} color={tokens.c.textWeak} />} />
            </box>
          )}
        >
          <MenuItem onSelect={() => run(() => snoozeReminder(fire.fireId, 10))}>{t("reminders.snooze10")}</MenuItem>
          <MenuItem onSelect={() => run(() => snoozeReminder(fire.fireId, 60))}>{t("reminders.snooze60")}</MenuItem>
          <MenuItem onSelect={() => run(() => snoozeReminder(fire.fireId, tomorrowMorningMinutes(new Date())))}>{t("reminders.snoozeTomorrow")}</MenuItem>
        </DropdownMenu>
        <ScheduleButton primary label={t("reminders.done")} disabled={busy} onPress={() => run(() => markReminderDone(fire.fireId))} />
      </row>
    );
  }
  return (
    <ScheduleCard
      headline={text}
      title={text}
      meta={
        <>
          <ScheduleStatus>{failed ? t("reminders.failed") : status}</ScheduleStatus>
          {trailing}
        </>
      }
    />
  );
});
