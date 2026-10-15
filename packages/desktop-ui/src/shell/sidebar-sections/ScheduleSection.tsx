import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  getCronTriggerKind,
  type LocalCronJobRecord,
  type LocalCronJobUpdatePatch,
  type LocalCronPayload,
} from "@stella/contracts/scheduling";
import { formatNextRun, summarizeSchedule } from "@stella/contracts/schedule-format";
import { cronJobOfScheduleRow, scheduleUpdateArgsOf } from "@stella/contracts/schedule-records";
import { backendClient } from "@/platform/backend/backend-client";
import { useBackendView } from "@/platform/backend/use-backend-view";
import { useI18n, useT } from "@/shared/i18n";
import { useScheduleFocus } from "@/features/schedule/schedule-focus";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { EmptyState } from "@/ui/empty-state/EmptyState";
import { Clock, Eye, Pause, Pencil, Play, Trash2, Wand2 } from "@/ui/icons";
import type { IconComponent } from "@/ui/icons";
import { draftOf, sameTiming, scheduleOf, type EveryUnit, type TimingDraft } from "./schedule-editing";
import "./updates-section.css";
import "./schedule-section.css";

type Translate = ReturnType<typeof useT>;

const SUNDAY_MS = Date.UTC(2023, 0, 1, 12);

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
  update: (jobId, patch) =>
    backendClient.call("schedules.update", { requestId: webRequestId("update"), ...scheduleUpdateArgsOf(jobId, patch) }),
  remove: (jobId) => backendClient.call("schedules.remove", { requestId: webRequestId("remove"), scheduleId: jobId }),
};

const ScheduleApiContext = createContext<ScheduleApi>(desktopScheduleApi);

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

const KIND_ICON: Record<string, IconComponent> = { reminder: Clock, task: Wand2, watch: Eye };

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

const textLabel = (payload: LocalCronPayload, t: Translate): string =>
  payload.kind === "notify"
    ? t("schedule.edit.message")
    : payload.kind === "watch"
      ? t("schedule.edit.onFound")
      : t("schedule.edit.task");

function TimingFields({ draft, onChange }: { draft: TimingDraft; onChange: (draft: TimingDraft) => void }) {
  const { t, locale } = useI18n();
  const letters = useMemo(() => weekdayNames(locale, "narrow"), [locale]);
  const names = useMemo(() => weekdayNames(locale, "long"), [locale]);
  if (draft.kind === "at") {
    return (
      <input
        className="schedule-edit__input"
        type="datetime-local"
        value={draft.local}
        aria-label={t("schedule.edit.when")}
        onChange={(event) => onChange({ ...draft, local: event.target.value })}
      />
    );
  }
  if (draft.kind === "every") {
    return (
      <div className="schedule-edit__row">
        <span className="schedule-edit__hint">{t("schedule.edit.every")}</span>
        <input
          className="schedule-edit__input schedule-edit__input--short"
          type="number"
          min={1}
          value={draft.amount}
          aria-label={t("schedule.edit.every")}
          onChange={(event) => onChange({ kind: "every", unit: draft.unit, amount: event.target.value })}
        />
        <select
          className="schedule-edit__input schedule-edit__input--short"
          value={draft.unit}
          aria-label={t("schedule.edit.unit")}
          onChange={(event) => onChange({ kind: "every", amount: draft.amount, unit: event.target.value as EveryUnit })}
        >
          <option value="minutes">{t("schedule.edit.minutes")}</option>
          <option value="hours">{t("schedule.edit.hours")}</option>
          <option value="days">{t("schedule.edit.days")}</option>
        </select>
      </div>
    );
  }
  if (draft.kind === "weekly") {
    return (
      <div className="schedule-edit__stack">
        <div className="schedule-edit__days" role="group" aria-label={t("schedule.edit.days")}>
          {letters.map((letter, day) => {
            const on = draft.days.includes(day);
            return (
              <button
                key={day}
                type="button"
                className="schedule-edit__day"
                aria-pressed={on}
                aria-label={names[day]}
                onClick={() =>
                  onChange({
                    ...draft,
                    days: on ? draft.days.filter((value) => value !== day) : [...draft.days, day],
                  })
                }
              >
                {letter}
              </button>
            );
          })}
        </div>
        <input
          className="schedule-edit__input schedule-edit__input--short"
          type="time"
          value={draft.time}
          aria-label={t("schedule.edit.time")}
          onChange={(event) => onChange({ ...draft, time: event.target.value })}
        />
        {draft.tz ? <span className="schedule-edit__hint">{t("schedule.edit.zone", { zone: draft.tz })}</span> : null}
      </div>
    );
  }
  return (
    <input
      className="schedule-edit__input"
      value={draft.expr}
      aria-label={t("schedule.edit.cron")}
      onChange={(event) => onChange({ ...draft, expr: event.target.value })}
    />
  );
}

function ScheduleEditor({ job, onDone }: { job: LocalCronJobRecord; onDone: () => void }) {
  const t = useT();
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
    <form
      className="schedule-edit"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label className="schedule-edit__field">
        <span className="schedule-edit__label">{t("schedule.edit.name")}</span>
        <input className="schedule-edit__input" value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      {job.payload.kind !== "script" ? (
        <label className="schedule-edit__field">
          <span className="schedule-edit__label">{textLabel(job.payload, t)}</span>
          <textarea
            className="schedule-edit__input schedule-edit__textarea"
            value={text}
            rows={3}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
      ) : null}
      <div className="schedule-edit__field">
        <span className="schedule-edit__label">{t("schedule.edit.when")}</span>
        <TimingFields draft={draft} onChange={setDraft} />
      </div>
      {error ? <p className="schedule-edit__error">{error}</p> : null}
      <div className="schedule-edit__actions">
        <button type="button" className="updates-section__button" onClick={onDone} disabled={saving}>
          {t("schedule.edit.cancel")}
        </button>
        <button type="submit" className="updates-section__button" data-primary disabled={saving}>
          {t("schedule.edit.save")}
        </button>
      </div>
    </form>
  );
}

function ScheduleItem({
  job,
  nowMs,
  editing,
  focusedAt,
  onEdit,
  onEditDone,
}: {
  job: LocalCronJobRecord;
  nowMs: number;
  editing: boolean;
  focusedAt: number | null;
  onEdit: () => void;
  onEditDone: () => void;
}) {
  const t = useT();
  const itemRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focusedAt === null) return;
    itemRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusedAt]);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kind = getCronTriggerKind(job.payload);
  const Icon = KIND_ICON[kind] ?? Clock;
  const cadence = summarizeSchedule(job.schedule, undefined, job.nextRunAtMs, job.zone);
  const where =
    job.payload.kind === "watch"
      ? job.payload.scriptPath
        ? t("schedule.runsOnComputer")
        : t("schedule.runsInCloud")
      : null;
  const route =
    job.payload.kind === "watch" || job.payload.kind === "task"
      ? job.payload.route === "agent"
        ? t("schedule.toAgent")
        : t("schedule.toStella")
      : null;
  const once = job.payload.kind === "watch" && job.payload.once ? t("schedule.once") : null;
  const detail = [
    kindLabel(job, t),
    cadence,
    job.enabled ? t("schedule.next", { when: formatNextRun(job.nextRunAtMs, nowMs) }) : t("schedule.paused"),
    where,
    route,
    once,
  ]
    .filter(Boolean)
    .join(" · ");

  useEffect(() => {
    if (!confirmDelete) return;
    const timer = window.setTimeout(() => setConfirmDelete(false), 4_000);
    return () => window.clearTimeout(timer);
  }, [confirmDelete]);

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
  const api = useContext(ScheduleApiContext);

  return (
    <li
      ref={itemRef}
      className="schedule-section__item"
      data-paused={job.enabled ? undefined : "true"}
      data-busy={busy || undefined}
      data-focused={focusedAt !== null || undefined}
    >
      <div className="schedule-section__row">
        <span className="schedule-section__glyph" aria-hidden="true">
          <Icon size={15} strokeWidth={1.75} />
        </span>
        <div className="updates-section__text">
          <div className="updates-section__title">{job.name}</div>
          <div className="updates-section__detail" title={detail}>
            {detail}
          </div>
          {job.enabled && job.lastError ? (
            <div className="schedule-section__error">{t("schedule.lastFailed", { error: job.lastError })}</div>
          ) : null}
          {error ? <div className="schedule-section__error">{error}</div> : null}
        </div>
        <div className="schedule-section__actions">
          <button
            type="button"
            className="schedule-section__icon-button"
            aria-label={job.enabled ? t("schedule.pause") : t("schedule.resume")}
            title={job.enabled ? t("schedule.pause") : t("schedule.resume")}
            disabled={busy}
            onClick={() => void act(() => api.update(job.id, { enabled: !job.enabled }))}
          >
            {job.enabled ? <Pause size={14} strokeWidth={1.75} /> : <Play size={14} strokeWidth={1.75} />}
          </button>
          <button
            type="button"
            className="schedule-section__icon-button"
            aria-label={t("schedule.edit.title")}
            title={t("schedule.edit.title")}
            aria-expanded={editing}
            disabled={busy}
            onClick={editing ? onEditDone : onEdit}
          >
            <Pencil size={14} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className="schedule-section__icon-button"
            data-confirm={confirmDelete || undefined}
            aria-label={confirmDelete ? t("schedule.deleteConfirm") : t("schedule.delete")}
            title={confirmDelete ? t("schedule.deleteConfirm") : t("schedule.delete")}
            disabled={busy}
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              void act(() => api.remove(job.id));
            }}
          >
            <Trash2 size={14} strokeWidth={1.75} />
            {confirmDelete ? <span>{t("schedule.deleteConfirm")}</span> : null}
          </button>
        </div>
      </div>
      {editing ? <ScheduleEditor job={job} onDone={onEditDone} /> : null}
    </li>
  );
}

export function ScheduleSection({ active }: { active: boolean }) {
  const t = useT();
  const { hasConnectedAccount } = useAuthSessionState();
  const { jobs, api } = useAllSchedules(hasConnectedAccount);
  const [editing, setEditing] = useState<string | null>(null);
  const focus = useScheduleFocus();
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [active, jobs]);
  const { running, paused } = useMemo(() => {
    const list = jobs ?? [];
    return {
      running: list.filter((job) => job.enabled).sort((a, b) => a.nextRunAtMs - b.nextRunAtMs),
      paused: list.filter((job) => !job.enabled).sort((a, b) => b.updatedAt - a.updatedAt),
    };
  }, [jobs]);
  const closeEditor = useCallback(() => setEditing(null), []);

  if (!hasConnectedAccount) {
    return <EmptyState motif="blank" title={t("schedule.signedOutTitle")} body={t("schedule.signedOutBody")} />;
  }
  if (jobs === undefined) return null;
  if (jobs.length === 0) {
    return <EmptyState motif="blank" title={t("schedule.emptyTitle")} body={t("schedule.emptyBody")} />;
  }
  const renderList = (list: LocalCronJobRecord[], testId: string) => (
    <ul className="updates-section__list" data-testid={testId}>
      {list.map((job) => (
        <ScheduleItem
          key={job.id}
          job={job}
          nowMs={nowMs}
          editing={editing === job.id}
          focusedAt={focus?.scheduleId === job.id && active ? focus.at : null}
          onEdit={() => setEditing(job.id)}
          onEditDone={closeEditor}
        />
      ))}
    </ul>
  );
  return (
    <ScheduleApiContext.Provider value={api}>
      <div className="updates-section schedule-section sidebar-section__scroll" data-testid="schedule-section">
        {running.length > 0 ? (
          <>
            <h2 className="updates-section__heading">{t("schedule.upcoming")}</h2>
            {renderList(running, "schedule-upcoming")}
          </>
        ) : null}
        {paused.length > 0 ? (
          <>
            <h2 className="updates-section__heading">{t("schedule.pausedHeading")}</h2>
            {renderList(paused, "schedule-paused")}
          </>
        ) : null}
      </div>
    </ScheduleApiContext.Provider>
  );
}
