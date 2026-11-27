import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getCronTriggerKind, type LocalCronJobRecord, type LocalCronJobUpdatePatch, type LocalCronPayload } from "@stella/contracts/scheduling";
import { formatNextRun, summarizeSchedule } from "@stella/contracts/schedule-format";
import { cronJobOfScheduleRow, scheduleUpdateArgsOf } from "@stella/contracts/schedule-records";
import { backendClient } from "@/platform/backend/backend-client";
import { useBackendView } from "@/platform/backend/use-backend-view";
import { useI18n, useT } from "@/shared/i18n";
import { useScheduleFocus } from "@/features/schedule/schedule-focus";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { draftOf, sameTiming, scheduleOf, type EveryUnit, type TimingDraft } from "@/shell/sidebar-sections/schedule-editing";
import { contextMenu } from "../../chat/context-menu";
import { EmptyState, Icon, Icons, type IconData } from "../../kit";
import { Form, Input, Select } from "../../kit/compat";
import { fontSize, look, mixOklch, useTokens } from "../../theme";
import type { Loop } from "../../../host/rune-jsx/props";
import { UpdateButton, UpdatesHeading } from "./UpdatesSection";

type Translate = ReturnType<typeof useT>;

const SUNDAY_MS = Date.UTC(2023, 0, 1, 12);
const SCROLL_ID = "schedule-section";
const XS = look(12, 400);

const weekdayNames = (locale: string, weekday: "narrow" | "long"): string[] => {
  const format = new Intl.DateTimeFormat(locale, { weekday, timeZone: "UTC" });
  return Array.from({ length: 7 }, (_, day) => format.format(new Date(SUNDAY_MS + day * 86_400_000)));
};

const errorText = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
};

type ScheduleApi = {
  update: (jobId: string, patch: LocalCronJobUpdatePatch) => Promise<unknown>;
  remove: (jobId: string) => Promise<unknown>;
};

const desktopScheduleApi: ScheduleApi = {
  update: async (jobId, patch) => window.electronAPI?.schedule.updateCronJob({ jobId, patch }),
  remove: async (jobId) => window.electronAPI?.schedule.removeCronJob({ jobId }),
};

const webRequestId = (action: string): string => `web-${action}-${crypto.randomUUID()}`;

const cloudScheduleApi: ScheduleApi = {
  update: (jobId, patch) => backendClient.call("schedules.update", { requestId: webRequestId("update"), ...scheduleUpdateArgsOf(jobId, patch) }),
  remove: (jobId) => backendClient.call("schedules.remove", { requestId: webRequestId("remove"), scheduleId: jobId }),
};

const ScheduleApiContext = createContext<ScheduleApi>(desktopScheduleApi);

type ScrollFrame = { y: number; h: number; scrollY: number };
const ScrollFrameContext = createContext<{ current: ScrollFrame }>({ current: { y: 0, h: 0, scrollY: 0 } });

const useDesktopSchedules = (enabled: boolean): LocalCronJobRecord[] | undefined => {
  const [jobs, setJobs] = useState<LocalCronJobRecord[] | undefined>(undefined);
  useEffect(() => {
    const api = window.electronAPI?.schedule;
    if (!enabled || !api) {
      setJobs(undefined);
      return;
    }
    let cancelled = false;
    const load = () =>
      api
        .listCronJobs()
        .then((list) => {
          if (!cancelled) setJobs(list);
        })
        .catch(() => {
          if (!cancelled) setJobs((current) => current ?? []);
        });
    void load();
    const unsubscribe = api.onUpdated(() => void load());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [enabled]);
  return jobs;
};

const useCloudSchedules = (enabled: boolean): LocalCronJobRecord[] | undefined => {
  const view = useBackendView("schedules.list", enabled ? {} : "skip");
  return useMemo(() => {
    if (!enabled) return undefined;
    if (view.value) return view.value.map(cronJobOfScheduleRow);
    return view.status === "error" ? [] : undefined;
  }, [enabled, view.value, view.status]);
};

const useAllSchedules = (enabled: boolean): { jobs: LocalCronJobRecord[] | undefined; api: ScheduleApi } => {
  const desktop = Boolean(window.electronAPI?.schedule);
  const desktopJobs = useDesktopSchedules(enabled && desktop);
  const cloudJobs = useCloudSchedules(enabled && !desktop);
  return desktop ? { jobs: desktopJobs, api: desktopScheduleApi } : { jobs: cloudJobs, api: cloudScheduleApi };
};

const KIND_ICON: Record<string, IconData> = { reminder: Icons.stella.Clock, task: Icons.stella.Wand2, watch: Icons.stella.Eye };

const kindLabel = (job: LocalCronJobRecord, t: Translate): string => {
  const kind = getCronTriggerKind(job.payload);
  if (kind === "reminder") return t("schedule.kind.reminder");
  if (kind === "watch") return t("schedule.kind.watch");
  return t("schedule.kind.task");
};

const textOf = (payload: LocalCronPayload): string => {
  if (payload.kind === "notify") return payload.text;
  if (payload.kind === "task" || payload.kind === "agent") return payload.prompt;
  if (payload.kind === "watch") return payload.instructions ?? "";
  return "";
};

const withText = (payload: LocalCronPayload, text: string): LocalCronPayload | null => {
  if (text === textOf(payload)) return null;
  if (payload.kind === "notify") return { kind: "notify", text };
  if (payload.kind === "task" || payload.kind === "agent") return { ...payload, prompt: text };
  if (payload.kind === "watch") return { ...payload, instructions: text };
  return null;
};

const textLabel = (payload: LocalCronPayload, t: Translate): string => (payload.kind === "notify" ? t("schedule.edit.message") : payload.kind === "watch" ? t("schedule.edit.onFound") : t("schedule.edit.task"));

/** `.schedule-edit__input`. */
function EditInput({ value, label, onChange, short = false, multiline = false, rows }: { value: string; label?: string; onChange: (value: string) => void; short?: boolean; multiline?: boolean; rows?: number }) {
  const t = useTokens();
  return (
    <Input
      value={value}
      aria-label={label}
      multiline={multiline}
      rows={rows}
      w={short ? undefined : "full"}
      minW={short ? 72 : undefined}
      minH={30}
      py={5}
      px={9}
      radius={8}
      border={t.c.border}
      color={t.c.textStrong}
      size={fontSize.sm}
      focusRing={{ width: 2, offset: 0, color: t.c.ring, radius: 8 }}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function Hint({ children }: { children: string }) {
  const t = useTokens();
  return (
    <text {...XS} color={t.c.textWeak}>
      {children}
    </text>
  );
}

const splitLocal = (local: string): [string, string] => {
  const [date = "", time = ""] = local.split("T");
  return [date, time.slice(0, 5)];
};

function TimingFields({ draft, onChange }: { draft: TimingDraft; onChange: (draft: TimingDraft) => void }) {
  const { t, locale } = useI18n();
  const tk = useTokens();
  const letters = useMemo(() => weekdayNames(locale, "narrow"), [locale]);
  const names = useMemo(() => weekdayNames(locale, "long"), [locale]);
  if (draft.kind === "at") {
    const [date, time] = splitLocal(draft.local);
    return (
      <row align="center" gap={6}>
        <EditInput value={date} label={t("schedule.edit.when")} onChange={(next) => onChange({ ...draft, local: `${next}T${time}` })} />
        <Input type="time" value={time} aria-label={t("schedule.edit.time")} onChange={(event) => onChange({ ...draft, local: `${date}T${event.target.value}` })} />
      </row>
    );
  }
  if (draft.kind === "every") {
    return (
      <row align="center" gap={6}>
        <Hint>{t("schedule.edit.every")}</Hint>
        <EditInput short value={draft.amount} label={t("schedule.edit.every")} onChange={(amount) => onChange({ kind: "every", unit: draft.unit, amount: amount.replace(/[^\d]/g, "") })} />
        <Select<EveryUnit>
          value={draft.unit}
          aria-label={t("schedule.edit.unit")}
          minW={72}
          onValueChange={(unit) => onChange({ kind: "every", amount: draft.amount, unit })}
          options={[
            { value: "minutes", label: t("schedule.edit.minutes") },
            { value: "hours", label: t("schedule.edit.hours") },
            { value: "days", label: t("schedule.edit.days") },
          ]}
        />
      </row>
    );
  }
  if (draft.kind === "weekly") {
    return (
      <col gap={4}>
        <row role="group" label={t("schedule.edit.days")} gap={4}>
          {letters.map((letter, day) => {
            const on = draft.days.includes(day);
            return (
              <box
                key={day}
                role="button"
                label={names[day]}
                checked={on}
                focusable
                w={28}
                h={28}
                radius={999}
                center
                border={on ? undefined : tk.c.border}
                fill={on ? tk.c.primary : undefined}
                focusRing={{ width: 2, offset: 0, color: tk.c.ring, radius: 999 }}
                onPress={() => onChange({ ...draft, days: on ? draft.days.filter((value) => value !== day) : [...draft.days, day] })}
              >
                <text {...XS} color={on ? tk.c.primaryForeground : tk.c.textBase}>
                  {letter}
                </text>
              </box>
            );
          })}
        </row>
        <row>
          <Input type="time" value={draft.time} aria-label={t("schedule.edit.time")} onChange={(event) => onChange({ ...draft, time: event.target.value })} />
        </row>
        {draft.tz ? <Hint>{t("schedule.edit.zone", { zone: draft.tz })}</Hint> : null}
      </col>
    );
  }
  return <EditInput value={draft.expr} label={t("schedule.edit.cron")} onChange={(expr) => onChange({ ...draft, expr })} />;
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <col gap={4}>
      <Hint>{label}</Hint>
      {children}
    </col>
  );
}

function ScheduleEditor({ job, onDone }: { job: LocalCronJobRecord; onDone: () => void }) {
  const t = useT();
  const tk = useTokens();
  const api = useContext(ScheduleApiContext);
  const [name, setName] = useState(job.name);
  const [text, setText] = useState(textOf(job.payload));
  const [draft, setDraft] = useState<TimingDraft>(() => draftOf(job.schedule));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const timing = sameTiming(draft, job.schedule) ? null : scheduleOf(draft);
    if (timing && "error" in timing) {
      setError(t(`schedule.edit.errors.${timing.error}`));
      return;
    }
    const payload = text.trim() ? withText(job.payload, text.trim()) : null;
    const patch: LocalCronJobUpdatePatch = {
      ...(name.trim() && name.trim() !== job.name ? { name: name.trim() } : {}),
      ...(timing ? { schedule: timing.schedule } : {}),
      ...(payload ? { payload } : {}),
    };
    if (Object.keys(patch).length === 0) {
      onDone();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.update(job.id, patch);
      onDone();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Form gap={10} mt={10} mb={4} ml={40} w={undefined} onSubmit={() => void save()}>
      <EditField label={t("schedule.edit.name")}>
        <EditInput value={name} label={t("schedule.edit.name")} onChange={setName} />
      </EditField>
      {job.payload.kind !== "script" ? (
        <EditField label={textLabel(job.payload, t)}>
          <EditInput multiline rows={3} value={text} label={textLabel(job.payload, t)} onChange={setText} />
        </EditField>
      ) : null}
      <EditField label={t("schedule.edit.when")}>
        <TimingFields draft={draft} onChange={setDraft} />
      </EditField>
      {error ? (
        <text {...XS} color={tk.c.destructive}>
          {error}
        </text>
      ) : null}
      <row justify="end" gap={6}>
        <UpdateButton id={`schedule-edit-cancel-${job.id}`} label={t("schedule.edit.cancel")} disabled={saving} onPress={onDone} />
        <UpdateButton id={`schedule-edit-save-${job.id}`} label={t("schedule.edit.save")} primary disabled={saving} onPress={() => void save()} />
      </row>
    </Form>
  );
}

/** `.schedule-section__icon-button`, with the delete confirmation's words to its left. */
function ItemIconButton({ id, label, icon, disabled, confirm = false, confirmLabel, expanded, onPress }: { id: string; label: string; icon: IconData; disabled: boolean; confirm?: boolean; confirmLabel?: string; expanded?: boolean; onPress: () => void }) {
  const t = useTokens();
  const confirmFill = mixOklch(t.c.destructive, 10, t.c.background);
  return (
    <row id={id} align="center" shrink={false}>
      {confirm && confirmLabel ? (
        <row h={26} align="center" pl={8} pr={2} corners={[8, 0, 0, 8]} fill={confirmFill} inert>
          <text {...XS} color={t.c.destructive} nowrap>
            {confirmLabel}
          </text>
        </row>
      ) : null}
      <box
        role="button"
        label={label}
        title={label}
        expanded={expanded}
        focusable={!disabled}
        disabled={disabled}
        h={26}
        minW={26}
        px={6}
        center
        corners={confirm ? [0, 8, 8, 0] : [8, 8, 8, 8]}
        fill={confirm ? confirmFill : undefined}
        hover={disabled || confirm ? undefined : mixOklch(t.c.foreground, 7, "transparent")}
        hoverColor={disabled || confirm ? undefined : t.c.textStrong}
        focusRing={{ width: 2, offset: 0, color: t.c.ring, radius: 8 }}
        onPress={disabled ? undefined : onPress}
      >
        <Icon icon={icon} size={14} strokeWidth={1.75} color={confirm ? t.c.destructive : t.c.textWeak} />
      </box>
    </row>
  );
}

const FOCUS_PULSE: Loop = { kind: "sequence", period: 2.4, times: 1, frames: [{ at: 0, opacity: 1 }, { at: 0.45, opacity: 1 }, { at: 1, opacity: 0 }] };

function ScheduleItem({ job, nowMs, editing, focusedAt, onEdit, onEditDone }: { job: LocalCronJobRecord; nowMs: number; editing: boolean; focusedAt: number | null; onEdit: () => void; onEditDone: () => void }) {
  const t = useT();
  const tk = useTokens();
  const frame = useContext(ScrollFrameContext);
  const layout = useRef<{ y: number; h: number } | null>(null);
  useEffect(() => {
    if (focusedAt === null || !layout.current) return;
    const panel = frame.current;
    const target = panel.scrollY + layout.current.y - panel.y - (panel.h - layout.current.h) / 2;
    void stella.engine.scroll.to(SCROLL_ID, Math.max(0, target), { animate: true });
  }, [focusedAt, frame]);
  const [flash, setFlash] = useState<number | null>(null);
  useEffect(() => {
    if (focusedAt === null) return;
    setFlash(focusedAt);
    const timer = setTimeout(() => setFlash(null), FOCUS_PULSE.period * 1000);
    return () => clearTimeout(timer);
  }, [focusedAt]);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kind = getCronTriggerKind(job.payload);
  const cadence = summarizeSchedule(job.schedule, undefined, job.nextRunAtMs, job.zone);
  const local = job.id.startsWith("cron:");
  const where =
    local || (job.payload.kind === "watch" && job.payload.scriptPath)
      ? t("schedule.runsOnComputer")
      : job.runsOn === "computer"
        ? t("schedule.runsOnYourComputer")
        : job.payload.kind === "watch"
          ? t("schedule.runsInCloud")
          : null;
  const waiting = job.enabled && job.waitingSinceMs !== undefined;
  const route = job.payload.kind === "watch" || job.payload.kind === "task" ? (job.payload.route === "agent" ? t("schedule.toAgent") : t("schedule.toStella")) : null;
  const once = job.payload.kind === "watch" && job.payload.once ? t("schedule.once") : null;
  const detail = [kindLabel(job, t), cadence, waiting ? t("schedule.waiting") : job.enabled ? t("schedule.next", { when: formatNextRun(job.nextRunAtMs, nowMs) }) : t("schedule.paused"), where, route, once].filter(Boolean).join(" · ");

  useEffect(() => {
    if (!confirmDelete) return;
    const timer = setTimeout(() => setConfirmDelete(false), 4_000);
    return () => clearTimeout(timer);
  }, [confirmDelete]);

  const api = useContext(ScheduleApiContext);
  const act = async (action: () => Promise<unknown> | undefined) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  const toggle = () => void act(() => api.update(job.id, { enabled: !job.enabled }));
  const pauseLabel = job.enabled ? t("schedule.pause") : t("schedule.resume");
  const hoverFill = mixOklch(tk.c.foreground, 4, "transparent");
  const focusFill = mixOklch(tk.c.foreground, 9, "transparent");

  return (
    <col
      id={`schedule-item-${job.id}`}
      role="listitem"
      pt={8}
      pb={8}
      pl={10}
      pr={6}
      radius={12}
      hover={hoverFill}
      hoverGroup
      motion={{ dur: 0.12 }}
      opacity={busy ? 0.7 : 1}
      onLayout={(r) => {
        layout.current = { y: r.y, h: r.h };
      }}
      onContextMenu={contextMenu(() => [
        [
          { label: pauseLabel, enabled: !busy, run: toggle },
          { label: t("schedule.edit.title"), enabled: !busy, run: editing ? onEditDone : onEdit },
        ],
        [{ label: t("schedule.delete"), enabled: !busy, run: () => setConfirmDelete(true) }],
      ])}
    >
      {flash !== null ? <box key={flash} absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} radius={12} fill={focusFill} inert loop={FOCUS_PULSE} /> : null}
      <row align="center" gap={12} minH={28}>
        <box w={28} h={28} radius={9} center shrink={false} fill={mixOklch(tk.c.foreground, 5, "transparent")}>
          <Icon icon={KIND_ICON[kind] ?? Icons.stella.Clock} size={15} strokeWidth={1.75} color={tk.c.textBase} />
        </box>
        <col grow={1} minW={0}>
          <text {...look(fontSize.sm, 500)} color={job.enabled ? tk.c.textStrong : tk.c.textBase} nowrap truncate>
            {job.name}
          </text>
          <text {...XS} pt={1} color={tk.c.textWeak} nowrap truncate title={detail}>
            {detail}
          </text>
          {job.enabled && job.lastError ? (
            <text {...XS} pt={2} color={tk.c.destructive}>
              {t("schedule.lastFailed", { error: job.lastError })}
            </text>
          ) : null}
          {error ? (
            <text {...XS} pt={2} color={tk.c.destructive}>
              {error}
            </text>
          ) : null}
        </col>
        <row align="center" gap={2} shrink={false} hoverOpacity={confirmDelete ? undefined : [0, 1]} opacity={confirmDelete ? 1 : undefined} motion={{ dur: 0.12 }}>
          <ItemIconButton id={`schedule-pause-${job.id}`} label={pauseLabel} icon={job.enabled ? Icons.stella.Pause : Icons.stella.Play} disabled={busy} onPress={toggle} />
          <ItemIconButton id={`schedule-edit-${job.id}`} label={t("schedule.edit.title")} icon={Icons.stella.Pencil} disabled={busy} expanded={editing} onPress={editing ? onEditDone : onEdit} />
          <ItemIconButton
            id={`schedule-delete-${job.id}`}
            label={confirmDelete ? t("schedule.deleteConfirm") : t("schedule.delete")}
            icon={Icons.stella.Trash2}
            disabled={busy}
            confirm={confirmDelete}
            confirmLabel={t("schedule.deleteConfirm")}
            onPress={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              void act(() => api.remove(job.id));
            }}
          />
        </row>
      </row>
      {editing ? <ScheduleEditor job={job} onDone={onEditDone} /> : null}
    </col>
  );
}

/** desktop-ui's `ScheduleSection`: upcoming and paused schedules, each with pause, edit and delete. */
export function ScheduleSection({ active }: { active: boolean }) {
  const t = useT();
  const { hasConnectedAccount } = useAuthSessionState();
  const desktop = Boolean(window.electronAPI?.schedule);
  const { jobs, api } = useAllSchedules(hasConnectedAccount || desktop);
  const [editing, setEditing] = useState<string | null>(null);
  const focus = useScheduleFocus();
  const frame = useRef<ScrollFrame>({ y: 0, h: 0, scrollY: 0 });
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [active, jobs]);
  const { running, paused } = useMemo(() => {
    const list = (jobs ?? []).filter((job) => !(job.schedule.kind === "at" && !job.enabled && job.lastRunAtMs !== undefined && job.lastRunAtMs >= job.schedule.atMs && job.lastStatus !== "error"));
    return {
      running: list.filter((job) => job.enabled).sort((a, b) => a.nextRunAtMs - b.nextRunAtMs),
      paused: list.filter((job) => !job.enabled).sort((a, b) => b.updatedAt - a.updatedAt),
    };
  }, [jobs]);
  const closeEditor = useCallback(() => setEditing(null), []);

  if (!hasConnectedAccount && !desktop) return <EmptyState motif="blank" title={t("schedule.signedOutTitle")} body={t("schedule.signedOutBody")} />;
  if (jobs === undefined) return null;
  if (running.length === 0 && paused.length === 0) return <EmptyState motif="blank" title={t("schedule.emptyTitle")} body={t("schedule.emptyBody")} />;
  const renderList = (list: LocalCronJobRecord[], id: string) => (
    <col id={id} role="list" gap={2}>
      {list.map((job) => (
        <ScheduleItem key={job.id} job={job} nowMs={nowMs} editing={editing === job.id} focusedAt={focus?.scheduleId === job.id && active ? focus.at : null} onEdit={() => setEditing(job.id)} onEditDone={closeEditor} />
      ))}
    </col>
  );
  return (
    <ScheduleApiContext.Provider value={api}>
      <ScrollFrameContext.Provider value={frame}>
        <col
          id={SCROLL_ID}
          grow={1}
          minH={0}
          scrollY
          gap={4}
          pt={14}
          px={14}
          pb={20}
          onLayout={(r) => {
            frame.current = { ...frame.current, y: r.y, h: r.h };
          }}
          onScroll={(p) => {
            frame.current = { ...frame.current, scrollY: p.y };
          }}
        >
          {running.length > 0 ? (
            <>
              <UpdatesHeading first>{t("schedule.upcoming")}</UpdatesHeading>
              {renderList(running, "schedule-upcoming")}
            </>
          ) : null}
          {paused.length > 0 ? (
            <>
              <UpdatesHeading first={running.length === 0}>{t("schedule.pausedHeading")}</UpdatesHeading>
              {renderList(paused, "schedule-paused")}
            </>
          ) : null}
        </col>
      </ScrollFrameContext.Provider>
    </ScheduleApiContext.Provider>
  );
}
