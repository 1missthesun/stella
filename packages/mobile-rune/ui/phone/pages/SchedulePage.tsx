import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { ScheduleRow } from "@stella/contracts/backend/schedules";
import type { LocalCronSchedule } from "@stella/contracts/scheduling";
import { describeScheduleTiming, formatNextRun, summarizeSchedule } from "@stella/contracts/schedule-format";
import { scheduleTimingText } from "@stella/contracts/schedule-notice";
import { backendClient } from "@/platform/backend/backend-client";
import { useBackendView } from "@/platform/backend/use-backend-view";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { useScheduleFocus } from "@/features/schedule/schedule-focus";
import { useLocale, useT, useTPlural } from "@/shared/i18n";
import { Icon } from "../../../../desktop-rune/ui/kit";
import { alpha } from "../../../../desktop-rune/ui/theme";
import { glyph, type GlyphName } from "../icons";
import { phoneAlert, phoneSheet, useStartChatWith } from "../ask";
import { GUTTER, TEXT, useRn } from "../rn";
import { EmptyState } from "./EmptyState";
import { timeOfDay, upcomingSection } from "./list-sections";

// packages/mobile's SchedulePage: the upcoming schedules by day (Today, Tomorrow, a weekday, a
// date), then the paused ones, each an airy row with its kind's glyph, its title, and when it
// next runs; a tap offers Pause or Resume, Edit (a chat that asks Stella to change it) and Delete.

type PhoneSchedule = {
  key: string;
  kind: ScheduleRow["kind"];
  id: string;
  title: string;
  enabled: boolean;
  nextRunAtMs: number;
  schedule: LocalCronSchedule | null;
  zone?: string;
  lastError?: string;
  waitingSinceMs?: number;
};

const parse = (value: string): LocalCronSchedule | null => {
  try {
    const parsed = JSON.parse(value) as LocalCronSchedule;
    return parsed && typeof parsed === "object" && "kind" in parsed ? parsed : null;
  } catch {
    return null;
  }
};

const ofRow = (row: ScheduleRow): PhoneSchedule => ({
  key: `cron:${row.scheduleId}`,
  kind: row.kind,
  id: row.scheduleId,
  title: row.description || row.prompt,
  enabled: row.status === "active",
  nextRunAtMs: row.nextRunAt,
  schedule: parse(row.schedule),
  ...(row.zone ? { zone: row.zone } : {}),
  ...(row.lastError ? { lastError: row.lastError } : {}),
  ...(row.waitingSince !== undefined ? { waitingSinceMs: row.waitingSince } : {}),
});

const iconOf = (s: PhoneSchedule): GlyphName => (s.kind === "watch" ? "eye" : s.kind === "task" ? "checklist" : s.kind === "reminder" ? "bell" : "clock");

const requestId = (action: string, id: string) => `phone-${action}-${id}-${Date.now().toString(36)}`.slice(0, 128);

type Item = { kind: "section"; key: string; label: string; first: boolean } | { kind: "schedule"; key: string; schedule: PhoneSchedule; when: string };

const ScheduleListRow = memo(function ScheduleListRow({ schedule, when, failed, busy, highlighted, onPress }: { schedule: PhoneSchedule; when: string; failed: string | null; busy: boolean; highlighted: boolean; onPress: (s: PhoneSchedule) => void }) {
  const c = useRn();
  return (
    <row
      id={`phone-schedule-${schedule.id}`}
      role="button"
      label={[schedule.title, when, failed].filter(Boolean).join(", ")}
      focusable={!busy}
      minH={60}
      py={9}
      gap={16}
      align="center"
      opacity={busy ? 0.45 : 1}
      pressScale={0.985}
      onPress={busy ? undefined : () => onPress(schedule)}
    >
      {highlighted ? <box absolute={{ left: -12, right: -12, top: 0, bottom: 0 }} radius={16} fill={alpha(c.text, 0.07)} inert enter={{ opacity: 0, dur: 0.2 }} exit={{ opacity: 0, dur: 0.5 }} /> : null}
      <box w={28} center shrink={false}>
        <Icon icon={glyph(iconOf(schedule))} size={23} color={schedule.enabled ? c.accent : c.textMuted} />
      </box>
      <col grow={1} minW={0} gap={2}>
        <text {...TEXT.listTitle} color={schedule.enabled ? c.text : c.textMuted} maxLines={2}>
          {schedule.title}
        </text>
        {when || failed ? (
          <row minW={0}>
            {when ? (
              <text {...TEXT.listDetail} color={c.textMuted} maxLines={1} shrink>
                {when}
              </text>
            ) : null}
            {failed ? (
              <text {...TEXT.listDetail} color={c.danger} maxLines={1} shrink={false}>
                {when ? ` · ${failed}` : failed}
              </text>
            ) : null}
          </row>
        ) : null}
      </col>
    </row>
  );
});

export function SchedulePage({ active, bottom }: { active: boolean; bottom: number }) {
  const c = useRn();
  const t = useT();
  const tPlural = useTPlural();
  const locale = useLocale();
  const startChatWith = useStartChatWith();
  const { hasConnectedAccount } = useAuthSessionState();
  const view = useBackendView("schedules.list", hasConnectedAccount ? {} : "skip", { keepPreviousValue: true });
  const loaded = useMemo(() => (view.value ? view.value.map(ofRow) : view.status === "error" ? [] : undefined), [view.value, view.status]);
  const schedules = loaded ?? EMPTY;
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (active) setNowMs(Date.now());
  }, [active, schedules]);

  // A schedule a notification or a chat card points at: highlighted for a moment (RN's `focus`).
  const focus = useScheduleFocus();
  const [highlight, setHighlight] = useState<string | null>(null);
  useEffect(() => {
    if (!focus || !active) return;
    setHighlight(`cron:${focus.scheduleId}`);
    const clear = setTimeout(() => setHighlight(null), 2_400);
    return () => clearTimeout(clear);
  }, [focus, active]);

  const run = useCallback(
    async (s: PhoneSchedule, action: "pause" | "resume" | "remove") => {
      setBusyKey(s.key);
      try {
        if (action === "remove") await backendClient.call("schedules.remove", { requestId: requestId("remove", s.id), scheduleId: s.id });
        else await backendClient.call("schedules.update", { requestId: requestId(action, s.id), scheduleId: s.id, status: action === "resume" ? "active" : "paused" });
      } catch (e) {
        void phoneAlert(t("mobile.activityHub.schedule.alertTitle"), e instanceof Error ? e.message : t("mobile.activityHub.schedule.actionFailed"), t("common.gotIt"));
      } finally {
        setBusyKey(null);
      }
    },
    [t],
  );

  const remove = useCallback(
    async (s: PhoneSchedule) => {
      const picked = await phoneSheet({
        alert: true,
        title: t("mobile.activityHub.schedule.deleteSchedule"),
        message: t("mobile.activityHub.schedule.deleteConfirm", { title: s.title }),
        actions: [{ id: "delete", label: t("mobile.common.delete") }],
        destructive: "delete",
        cancel: t("mobile.common.cancel"),
      });
      if (picked === "delete") void run(s, "remove");
    },
    [run, t],
  );

  const openActions = useCallback(
    async (s: PhoneSchedule) => {
      if (busyKey) return;
      const cadence = summarizeSchedule(s.schedule, undefined, s.nextRunAtMs, s.zone) || t("mobile.activityHub.schedule.customCadence");
      const status = !s.enabled ? t("mobile.activityHub.schedule.paused") : s.waitingSinceMs !== undefined ? t("schedule.waiting") : t("mobile.activityHub.schedule.next", { when: formatNextRun(s.nextRunAtMs, Date.now()) });
      const message = [[cadence, status].join(" · "), s.enabled && s.lastError ? t("mobile.activityHub.schedule.lastRunFailed", { error: s.lastError }) : null].filter(Boolean).join("\n");
      const picked = await phoneSheet({
        title: s.title,
        message,
        actions: [
          { id: "toggle", label: s.enabled ? t("mobile.activityHub.schedule.pauseSchedule") : t("mobile.activityHub.schedule.resumeSchedule") },
          { id: "edit", label: t("schedule.edit.title") },
          { id: "delete", label: t("mobile.activityHub.schedule.deleteSchedule") },
        ],
        destructive: "delete",
        cancel: t("mobile.common.cancel"),
      });
      if (picked === "toggle") void run(s, s.enabled ? "pause" : "resume");
      else if (picked === "edit") startChatWith(t("mobile.activityHub.schedule.editPrompt", { title: s.title }));
      else if (picked === "delete") void remove(s);
    },
    [busyKey, remove, run, startChatWith, t],
  );

  const whenOf = useCallback(
    (s: PhoneSchedule): string => {
      if (s.waitingSinceMs !== undefined) return t("schedule.waiting");
      const time = timeOfDay(s.nextRunAtMs);
      if (!s.schedule || s.schedule.kind === "at") return s.enabled ? time : "";
      const cadence = scheduleTimingText(describeScheduleTiming(s.schedule, { nowMs, nextRunAtMs: s.nextRunAtMs, ...(s.zone ? { zone: s.zone } : {}) }), { t, tPlural, locale });
      return s.schedule.kind === "every" && s.enabled ? `${time} · ${cadence}` : cadence;
    },
    [locale, nowMs, t, tPlural],
  );

  const items = useMemo<Item[]>(() => {
    const upcoming = schedules.filter((s) => s.enabled).sort((a, b) => a.nextRunAtMs - b.nextRunAtMs);
    const paused = schedules.filter((s) => !s.enabled);
    const out: Item[] = [];
    let previous: string | null = null;
    for (const s of upcoming) {
      const section = upcomingSection(s.nextRunAtMs, nowMs, t);
      if (section.key !== previous) {
        out.push({ kind: "section", key: `section:${section.key}`, label: section.label, first: out.length === 0 });
        previous = section.key;
      }
      out.push({ kind: "schedule", key: s.key, schedule: s, when: whenOf(s) });
    }
    if (paused.length > 0) {
      out.push({ kind: "section", key: "section:paused", label: t("mobile.activityHub.schedule.paused"), first: out.length === 0 });
      for (const s of paused) out.push({ kind: "schedule", key: s.key, schedule: s, when: whenOf(s) });
    }
    return out;
  }, [nowMs, schedules, t, whenOf]);

  if (!hasConnectedAccount) return <EmptyState id="phone-schedule-empty" motif="schedule" message={t("mobile.sidebar.signedOutHint")} live={active} bottom={bottom} />;
  if (loaded === undefined) return <col grow={1} />;
  if (schedules.length === 0)
    return (
      <EmptyState
        id="phone-schedule-empty"
        motif="schedule"
        message={t("mobile.activityHub.schedule.empty")}
        action={{ label: t("mobile.activityHub.schedule.emptyAction"), onPress: () => startChatWith(t("mobile.activityHub.schedule.emptyActionPrompt")) }}
        live={active}
        bottom={bottom}
      />
    );
  const failedLabel = t("mobile.activityHub.task.failed");
  return (
    <col id="phone-schedule-list" role="list" grow={1} minH={0} scrollY px={GUTTER} pb={bottom + 24}>
      {items.map((item) =>
        item.kind === "section" ? (
          <text key={item.key} role="heading" {...TEXT.listSection} color={c.textMuted} pt={item.first ? 14 : 30} pb={6} maxLines={1}>
            {item.label}
          </text>
        ) : (
          <ScheduleListRow
            key={item.key}
            schedule={item.schedule}
            when={item.when}
            failed={item.schedule.enabled && item.schedule.lastError ? failedLabel : null}
            busy={busyKey === item.key}
            highlighted={highlight === item.key}
            onPress={openActions}
          />
        ),
      )}
    </col>
  );
}

const EMPTY: PhoneSchedule[] = [];
