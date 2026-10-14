import type { LocalCronSchedule } from "@stella/contracts/scheduling";

export type EveryUnit = "minutes" | "hours" | "days";

export type TimingDraft =
  | { kind: "at"; local: string }
  | { kind: "every"; amount: string; unit: EveryUnit; anchorMs?: number }
  | { kind: "weekly"; time: string; days: number[]; tz?: string }
  | { kind: "cron"; expr: string; tz?: string };

const pad = (value: number): string => String(value).padStart(2, "0");

const UNIT_MS: Record<EveryUnit, number> = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };

export const toLocalInput = (atMs: number): string => {
  const date = new Date(atMs);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const simpleCron = (expr: string): { h: number; m: number; days: number[] } | null => {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, dom, mon, dow] = fields as [string, string, string, string, string];
  const h = Number(hour);
  const m = Number(minute);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  if (dom !== "*" || mon !== "*") return null;
  if (dow === "*") return { h, m, days: [0, 1, 2, 3, 4, 5, 6] };
  const days = new Set<number>();
  for (const part of dow.split(",")) {
    const range = /^([0-7])(?:-([0-7]))?$/.exec(part);
    if (!range) return null;
    const start = Number(range[1]) % 7;
    const end = range[2] !== undefined ? Number(range[2]) % 7 : start;
    if (end < start) return null;
    for (let day = start; day <= end; day += 1) days.add(day);
  }
  return { h, m, days: [...days].sort((a, b) => a - b) };
};

export const draftOf = (schedule: LocalCronSchedule): TimingDraft => {
  if (schedule.kind === "at") return { kind: "at", local: toLocalInput(schedule.atMs) };
  if (schedule.kind === "every") {
    const unit: EveryUnit =
      schedule.everyMs % UNIT_MS.days === 0 ? "days" : schedule.everyMs % UNIT_MS.hours === 0 ? "hours" : "minutes";
    return {
      kind: "every",
      amount: String(Math.max(1, Math.round(schedule.everyMs / UNIT_MS[unit]))),
      unit,
      ...(schedule.anchorMs !== undefined ? { anchorMs: schedule.anchorMs } : {}),
    };
  }
  const simple = simpleCron(schedule.expr);
  if (simple) {
    return {
      kind: "weekly",
      time: `${pad(simple.h)}:${pad(simple.m)}`,
      days: simple.days,
      ...(schedule.tz ? { tz: schedule.tz } : {}),
    };
  }
  return { kind: "cron", expr: schedule.expr, ...(schedule.tz ? { tz: schedule.tz } : {}) };
};

export type TimingError = "pickWhen" | "pickFuture" | "pickEvery" | "pickTime" | "pickDays" | "pickCron";

export const scheduleOf = (draft: TimingDraft): { schedule: LocalCronSchedule } | { error: TimingError } => {
  if (draft.kind === "at") {
    const atMs = new Date(draft.local).getTime();
    if (!Number.isFinite(atMs)) return { error: "pickWhen" };
    if (atMs <= Date.now()) return { error: "pickFuture" };
    return { schedule: { kind: "at", atMs } };
  }
  if (draft.kind === "every") {
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { error: "pickEvery" };
    return {
      schedule: {
        kind: "every",
        everyMs: Math.round(amount * UNIT_MS[draft.unit]),
        ...(draft.anchorMs !== undefined ? { anchorMs: draft.anchorMs } : {}),
      },
    };
  }
  const tz = draft.tz;
  if (draft.kind === "weekly") {
    const match = /^(\d{1,2}):(\d{2})$/.exec(draft.time);
    if (!match) return { error: "pickTime" };
    if (draft.days.length === 0) return { error: "pickDays" };
    const days = draft.days.length === 7 ? "*" : [...draft.days].sort((a, b) => a - b).join(",");
    return {
      schedule: { kind: "cron", expr: `${Number(match[2])} ${Number(match[1])} * * ${days}`, ...(tz ? { tz } : {}) },
    };
  }
  if (!draft.expr.trim()) return { error: "pickCron" };
  return { schedule: { kind: "cron", expr: draft.expr.trim(), ...(tz ? { tz } : {}) } };
};

export const sameTiming = (draft: TimingDraft, schedule: LocalCronSchedule): boolean =>
  JSON.stringify(draft) === JSON.stringify(draftOf(schedule));
