/**
 * Schedules, fired from the owner object's alarm.
 *
 * A schedule is a prompt plus a `LocalCronSchedule`, of a kind: a `task`
 * starts a run at fire time; a `reminder`'s prompt is the text Stella wrote
 * when it was set, delivered with no model and no turn (a push to the
 * phone, a card in the conversation every client shows as Stella's message,
 * an in-app notice on the desktop); a `watch` runs its check script with no
 * model (`../watch-runner.ts`) and only a finding or a failure wakes AI, its
 * prompt saying what to do with a finding. What wakes AI goes to the
 * conversation's orchestrator, or with `route: agent` straight to an agent
 * of it, whose report comes back like any finished job. Each live schedule has
 * exactly one pending `schedules.fire` job, id `schedule:<id>`, at its
 * `next_run_at`; every write that moves the time or the status replaces it.
 * A fire claims the row (re-anchoring recurring schedules from the fire
 * time, marking one-shots done), spends one of the owner's daily scheduled
 * runs, and starts the turn through `host.startScheduledTurn`: on the named
 * desktop, or in the schedule's cloud conversation.
 *
 * Limits: at most MAX_SCHEDULES live rows, no schedule more often than
 * MIN_INTERVAL_MS, and a daily fire budget per plan held apart from the
 * interactive chat budget, so background work never spends the allowance
 * the person at the composer is about to need.
 */

import { Cron } from "croner";
import type { LocalCronSchedule } from "@stella/contracts/scheduling";
import {
  WATCH_MIN_INTERVAL_MS,
  WATCH_SCRIPT_MAX_CHARS,
  type ScheduleCalls,
  type ScheduleKind,
  type ScheduleRoute,
  type ScheduleRow,
  type ScheduleStatus,
  type ScheduleToolResult,
  type WatchCheckResult,
} from "@stella/contracts/backend/schedules";
import {
  REMINDER_CARD_TYPE,
  REMINDER_LATE_MS,
  REMINDER_MAX_SNOOZE_MINUTES,
  REMINDER_PUSH_CATEGORY,
  REMINDER_PUSH_KIND,
  type ReminderCard,
  type ReminderFire,
  type ReminderFireState,
  type ReminderPushData,
} from "@stella/contracts/reminders";
import { boolean, empty, literal, number, object, optional, string, type Parser } from "../args.js";
import { RpcError } from "../errors.js";
import { enforceOwnerRateLimit } from "../rate-limit.js";
import type { OwnerContext, OwnerDb, OwnerDbReader, OwnerDomain } from "../registry.js";
import { ScheduledTurnError } from "../scheduled-turn.js";
import { billingAccess } from "./billing.js";
import { livePushTokens, sendPushMessages } from "./devices.js";
import { runWatchCheck } from "../watch-runner.js";

export const SCHEDULE_FIRE_JOB = "schedules.fire";
export const scheduleJobId = (scheduleId: string): string => `schedule:${scheduleId}`;
export const REMINDER_RETURN_JOB = "schedules.reminderReturn";
const reminderReturnJobId = (fireId: string): string => `reminder:${fireId}`;

const MAX_SCHEDULES = 25;
const MIN_INTERVAL_MS = 15 * 60_000;
const MAX_PROMPT_CHARS = 4_000;
const MAX_DESCRIPTION_CHARS = 200;
const MAX_ERROR_CHARS = 300;
/** A fire that failed is retried this soon… */
const FIRE_RETRY_DELAY_MS = 60_000;
/** …at most this many times in a row, then the schedule waits for its next slot. */
const MAX_FIRE_RETRIES = 3;
const DAY_MS = 24 * 60 * 60_000;
const RECEIPT_TTL_MS = 7 * DAY_MS;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/u;
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;

/** Scheduled runs per day; their own budget, apart from interactive chat. */
const DAILY_FIRES = { free: 24, go: 60, pro: 120 } as const;
const UNLIMITED_DAILY_FIRES = 800;

export const SCHEDULES_MIGRATION = {
  id: "schedules.1-init",
  statements: [
    `CREATE TABLE schedules (
       schedule_id TEXT PRIMARY KEY,
       conversation_id TEXT,
       target_device_id TEXT,
       prompt TEXT NOT NULL,
       schedule_json TEXT NOT NULL,
       next_run_at INTEGER NOT NULL,
       last_run_at INTEGER,
       status TEXT NOT NULL,
       description TEXT NOT NULL,
       last_error TEXT,
       last_error_at INTEGER,
       failure_count INTEGER NOT NULL DEFAULT 0,
       active_fire_id TEXT,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
    `CREATE INDEX schedules_status_next ON schedules (status, next_run_at)`,
    `CREATE TABLE schedule_receipts (
       request_id TEXT PRIMARY KEY,
       action TEXT NOT NULL,
       intent_json TEXT NOT NULL,
       result_json TEXT NOT NULL,
       created_at INTEGER NOT NULL
     )`,
    `CREATE INDEX schedule_receipts_created ON schedule_receipts (created_at)`,
  ],
};

const LEGACY_REMINDER_PREFIX =
  "Reminder for the user (deliver this exact message to them now, and nothing else): ";

/**
 * Reminders become their own kind. Ones stored as a prompt telling a turn to
 * repeat the text keep just the text.
 */
export const SCHEDULES_KINDS_MIGRATION = {
  id: "schedules.2-kinds",
  statements: [
    `ALTER TABLE schedules ADD COLUMN kind TEXT NOT NULL DEFAULT 'task'`,
    `UPDATE schedules SET kind = 'reminder', prompt = substr(prompt, ${LEGACY_REMINDER_PREFIX.length + 1})
      WHERE substr(prompt, 1, ${LEGACY_REMINDER_PREFIX.length}) = '${LEGACY_REMINDER_PREFIX}'`,
    `CREATE TABLE reminder_fires (
       fire_id TEXT PRIMARY KEY,
       schedule_id TEXT NOT NULL,
       conversation_id TEXT,
       text TEXT NOT NULL,
       fired_at INTEGER NOT NULL,
       state TEXT NOT NULL,
       snoozed_until INTEGER,
       pushed_at INTEGER,
       updated_at INTEGER NOT NULL
     )`,
    `CREATE INDEX reminder_fires_fired ON reminder_fires (fired_at DESC)`,
  ],
};

/**
 * Cloud watches and routing: who handles a fire that needs AI, a watch's
 * script and the state it carries between checks, and a finding waiting to
 * be handed over.
 */
export const SCHEDULES_WATCHES_MIGRATION = {
  id: "schedules.3-watches",
  statements: [
    `ALTER TABLE schedules ADD COLUMN route TEXT NOT NULL DEFAULT 'orchestrator'`,
    `ALTER TABLE schedules ADD COLUMN once INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE schedules ADD COLUMN script TEXT`,
    `ALTER TABLE schedules ADD COLUMN state_json TEXT`,
    `ALTER TABLE schedules ADD COLUMN pending_finding TEXT`,
    `ALTER TABLE schedules ADD COLUMN last_check_at INTEGER`,
    `ALTER TABLE schedules ADD COLUMN last_finding TEXT`,
    `ALTER TABLE schedules ADD COLUMN failing_since INTEGER`,
  ],
};

/** When a late delivery was due, so it can say so. */
export const SCHEDULES_DUE_MIGRATION = {
  id: "schedules.4-due",
  statements: [`ALTER TABLE reminder_fires ADD COLUMN due_at INTEGER`],
};

type Row = {
  schedule_id: string;
  kind: string;
  route: string;
  once: number;
  script: string | null;
  state_json: string | null;
  pending_finding: string | null;
  last_check_at: number | null;
  last_finding: string | null;
  failing_since: number | null;
  conversation_id: string | null;
  target_device_id: string | null;
  prompt: string;
  schedule_json: string;
  next_run_at: number;
  last_run_at: number | null;
  status: string;
  description: string;
  last_error: string | null;
  last_error_at: number | null;
  failure_count: number;
  active_fire_id: string | null;
  created_at: number;
  updated_at: number;
};

const toScheduleKind = (value: string): ScheduleKind =>
  value === "reminder" || value === "watch" ? value : "task";

const toRoute = (value: string): ScheduleRoute => (value === "agent" ? "agent" : "orchestrator");

const toScheduleRow = (row: Row): ScheduleRow => ({
  scheduleId: row.schedule_id,
  kind: toScheduleKind(row.kind),
  route: toRoute(row.route),
  ...(row.once ? { once: true } : {}),
  ...(row.last_check_at !== null ? { lastCheckAt: row.last_check_at } : {}),
  ...(row.last_finding ? { lastFinding: row.last_finding } : {}),
  ...(row.conversation_id ? { conversationId: row.conversation_id } : {}),
  ...(row.target_device_id ? { targetDeviceId: row.target_device_id } : {}),
  prompt: row.prompt,
  schedule: row.schedule_json,
  nextRunAt: row.next_run_at,
  ...(row.last_run_at !== null ? { lastRunAt: row.last_run_at } : {}),
  status: row.status as ScheduleStatus,
  description: row.description,
  ...(row.last_error ? { lastError: row.last_error } : {}),
  ...(row.last_error_at !== null ? { lastErrorAt: row.last_error_at } : {}),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const readRow = (db: OwnerDbReader, scheduleId: string): Row | null =>
  db.one<Row>("SELECT * FROM schedules WHERE schedule_id = ?", scheduleId);

/** Active schedules soonest first, then paused ones. */
const listRows = (db: OwnerDbReader): ScheduleRow[] =>
  db
    .all<Row>(
      `SELECT * FROM schedules WHERE status IN ('active', 'paused')
        ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, next_run_at
        LIMIT ?`,
      MAX_SCHEDULES * 2,
    )
    .map(toScheduleRow);

const bad = (message: string): never => {
  throw new RpcError("BAD_REQUEST", message);
};

// ── Schedules and their times ─────────────────────────────────────────────

/** Untrusted JSON to a `LocalCronSchedule`, with the desktop scheduler's errors. */
export const normalizeSchedule = (value: unknown): LocalCronSchedule => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return bad("schedule must be an object.");
  }
  const record = value as Record<string, unknown>;
  const kind = typeof record.kind === "string" ? record.kind.trim() : "";
  if (kind === "at") {
    const atMs = Number(record.atMs);
    if (!Number.isFinite(atMs) || atMs <= 0) {
      return bad('schedule.kind="at" requires atMs (epoch ms).');
    }
    return { kind: "at", atMs: Math.floor(atMs) };
  }
  if (kind === "every") {
    const everyMs = Number(record.everyMs);
    if (!Number.isFinite(everyMs) || everyMs <= 0) {
      return bad('schedule.kind="every" requires everyMs (> 0).');
    }
    const anchorRaw = Number(record.anchorMs);
    const anchorMs = Number.isFinite(anchorRaw) && anchorRaw > 0 ? Math.floor(anchorRaw) : undefined;
    return { kind: "every", everyMs: Math.floor(everyMs), ...(anchorMs ? { anchorMs } : {}) };
  }
  if (kind === "cron") {
    const expr = typeof record.expr === "string" ? record.expr.trim() : "";
    if (!expr || expr.length > 200) return bad('schedule.kind="cron" requires expr.');
    const tz = typeof record.tz === "string" ? record.tz.trim().slice(0, 64) : "";
    return { kind: "cron", expr, ...(tz ? { tz } : {}) };
  }
  return bad('schedule.kind must be "at", "every", or "cron".');
};

const scheduleParser: Parser<LocalCronSchedule> = (value) => normalizeSchedule(value);

const buildCron = (schedule: { expr: string; tz?: string }): Cron => {
  try {
    return new Cron(schedule.expr, { timezone: schedule.tz?.trim() || undefined, catch: false });
  } catch {
    return bad(`"${schedule.expr}" is not a cron expression Stella can read.`);
  }
};

export const computeNextRunAt = (schedule: LocalCronSchedule, nowMs: number): number => {
  if (schedule.kind === "at") return Math.max(schedule.atMs, nowMs);
  if (schedule.kind === "every") {
    const everyMs = Math.max(1, Math.floor(schedule.everyMs));
    const anchor = Math.max(0, Math.floor(schedule.anchorMs ?? nowMs));
    if (nowMs < anchor) return anchor;
    return anchor + Math.max(1, Math.ceil((nowMs - anchor) / everyMs)) * everyMs;
  }
  const next = buildCron(schedule).nextRun(new Date(nowMs));
  if (!next) return bad(`"${schedule.expr}" has no future run times. Pick a different schedule.`);
  return next.getTime();
};

/** The gap between consecutive fires, or null for a one-shot. */
const intervalMs = (schedule: LocalCronSchedule, nowMs: number): number | null => {
  if (schedule.kind === "at") return null;
  if (schedule.kind === "every") return schedule.everyMs;
  const cron = buildCron(schedule);
  const first = cron.nextRun(new Date(nowMs));
  const second = first ? cron.nextRun(first) : null;
  return first && second ? second.getTime() - first.getTime() : null;
};

const assertAllowed = (schedule: LocalCronSchedule, nowMs: number, kind: ScheduleKind = "task"): void => {
  const interval = intervalMs(schedule, nowMs);
  // A watch's check runs no model, so it may look more often.
  const floor = kind === "watch" ? WATCH_MIN_INTERVAL_MS : MIN_INTERVAL_MS;
  if (interval !== null && interval < floor) {
    bad(`${kind === "watch" ? "Watches" : "Schedules"} can run at most once every ${floor / 60_000} minutes. Space this one out.`);
  }
  if (kind === "watch" && schedule.kind === "at") {
    bad("A watch checks again and again: give it an every or cron schedule.");
  }
};

const cleanScript = (value: string | undefined): string => {
  const script = (value ?? "").trim();
  if (!script) bad("A watch needs its check script.");
  if (script.length > WATCH_SCRIPT_MAX_CHARS) bad(`A watch script must be under ${WATCH_SCRIPT_MAX_CHARS} characters.`);
  return script;
};

/**
 * A watch's first check, run before it is saved: a script that cannot run
 * is refused with its error, and one that runs starts from the state it
 * returned. What it found already is reported, not handed over.
 */
const firstCheck = async (
  ctx: OwnerContext,
  scheduleId: string,
  script: string,
): Promise<{ check: WatchCheckResult; stateJson: string | null }> => {
  const run = await runWatchCheck(ctx.env, { ownerId: ctx.ownerId, scheduleId, script, stateJson: null });
  if (!run.ok) {
    bad(`The watch script failed its first check, so it was not saved. Fix it and try again.\n${run.error}`);
  }
  const ran = run as Extract<typeof run, { ok: true }>;
  return { check: { ok: true, found: ran.found, durationMs: ran.durationMs }, stateJson: ran.stateJson };
};

const cleanPrompt = (value: string): string => {
  const prompt = value.trim();
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) {
    bad(`A scheduled prompt needs 1–${MAX_PROMPT_CHARS} characters.`);
  }
  return prompt;
};

const cleanDescription = (value: string | undefined, prompt: string): string => {
  const description = (value ?? "").trim() || prompt;
  return description.length > MAX_DESCRIPTION_CHARS
    ? `${description.slice(0, MAX_DESCRIPTION_CHARS - 1)}…`
    : description;
};

const parseStored = (json: string): LocalCronSchedule => {
  try {
    return normalizeSchedule(JSON.parse(json));
  } catch {
    throw new RpcError("INTERNAL", "Stored schedule is unreadable.");
  }
};

/** Keep exactly one pending fire for a live schedule, and none otherwise. */
const arm = (ctx: OwnerContext, row: Pick<Row, "schedule_id" | "status" | "next_run_at">, fireId?: string): void => {
  if (row.status === "active") {
    ctx.jobs.schedule(
      SCHEDULE_FIRE_JOB,
      row.next_run_at,
      { scheduleId: row.schedule_id, ...(fireId ? { fireId } : {}) },
      { id: scheduleJobId(row.schedule_id) },
    );
  } else {
    ctx.jobs.cancel(scheduleJobId(row.schedule_id));
  }
};

// ── Writes, replayed by request id ────────────────────────────────────────

type Action = "create" | "update" | "remove";

/**
 * Run `write` once per request id. A retry with the same id and intent
 * returns the stored result instead of writing again; the same id with a
 * different intent is refused.
 */
const withReceipt = <T>(
  db: OwnerDb,
  now: number,
  requestId: string,
  action: Action,
  intent: unknown,
  write: () => T,
): { replayed: boolean; result: T } => {
  if (!REQUEST_ID_PATTERN.test(requestId)) bad("Schedule request id is invalid.");
  const intentJson = JSON.stringify(intent);
  const existing = db.one<{ action: string; intent_json: string; result_json: string }>(
    "SELECT action, intent_json, result_json FROM schedule_receipts WHERE request_id = ?",
    requestId,
  );
  if (existing) {
    if (existing.action !== action || existing.intent_json !== intentJson) {
      throw new RpcError("CONFLICT", "Schedule request id was already used for a different operation.");
    }
    return { replayed: true, result: JSON.parse(existing.result_json) as T };
  }
  const result = write();
  db.run("DELETE FROM schedule_receipts WHERE created_at < ?", now - RECEIPT_TTL_MS);
  db.run(
    `INSERT INTO schedule_receipts (request_id, action, intent_json, result_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    requestId,
    action,
    intentJson,
    JSON.stringify(result ?? null),
    now,
  );
  return { replayed: false, result };
};

const signInRequired = (): never => {
  throw new RpcError("FORBIDDEN", "Sign in with an account to use schedules.", {
    reason: "sign_in_required",
  });
};

type CreateInput = {
  requestId: string;
  kind?: ScheduleKind;
  prompt: string;
  schedule: LocalCronSchedule;
  description?: string;
  conversationId?: string;
  targetDeviceId?: string;
  route?: ScheduleRoute;
  script?: string;
  once?: boolean;
};

const createSchedule = async (
  ctx: OwnerContext,
  input: CreateInput,
  isAnonymous: boolean,
): Promise<{ replayed: boolean; result: ScheduleRow & { check?: WatchCheckResult } }> => {
  if (isAnonymous) signInRequired();
  const kind: ScheduleKind = input.kind ?? "task";
  const prompt = cleanPrompt(input.prompt);
  const schedule = normalizeSchedule(input.schedule);
  const description = cleanDescription(input.description, prompt);
  const conversationId = input.conversationId?.trim() || null;
  // A reminder runs nowhere: it needs no computer.
  const targetDeviceId = kind === "reminder" ? null : input.targetDeviceId?.trim() || null;
  const route: ScheduleRoute = kind === "reminder" ? "orchestrator" : (input.route ?? "orchestrator");
  const script = kind === "watch" ? cleanScript(input.script) : null;
  const once = kind === "watch" && input.once === true;
  const requestId = input.requestId.trim();
  const intent = { kind, prompt, schedule, description, conversationId, targetDeviceId, route, script, once };
  const scheduleId = `sch-${crypto.randomUUID().slice(0, 18)}`;
  // The first check awaits, so it runs before the receipt's write; a replay
  // of the same request skips it and answers with the first result.
  const replay = ctx.db.one<{ request_id: string }>(
    "SELECT request_id FROM schedule_receipts WHERE request_id = ?",
    requestId,
  );
  let first: { check: WatchCheckResult; stateJson: string | null } | null = null;
  if (script && !replay) {
    assertAllowed(schedule, ctx.now, kind);
    first = await firstCheck(ctx, scheduleId, script);
  }
  return withReceipt(
    ctx.db,
    ctx.now,
    requestId,
    "create",
    intent,
    (): ScheduleRow & { check?: WatchCheckResult } => {
      assertAllowed(schedule, ctx.now, kind);
      const live =
        ctx.db.one<{ n: number }>(
          "SELECT COUNT(*) AS n FROM schedules WHERE status IN ('active', 'paused')",
        )?.n ?? 0;
      if (live >= MAX_SCHEDULES) {
        bad(`You already have ${MAX_SCHEDULES} schedules. Remove one before adding another.`);
      }
      const row: Row = {
        schedule_id: scheduleId,
        kind,
        route,
        once: once ? 1 : 0,
        script,
        state_json: first?.stateJson ?? null,
        pending_finding: null,
        last_check_at: first ? ctx.now : null,
        last_finding: first?.check.ok && first.check.found ? first.check.found : null,
        failing_since: null,
        conversation_id: conversationId,
        target_device_id: targetDeviceId,
        prompt,
        schedule_json: JSON.stringify(schedule),
        next_run_at: computeNextRunAt(schedule, ctx.now),
        last_run_at: null,
        status: "active",
        description,
        last_error: null,
        last_error_at: null,
        failure_count: 0,
        active_fire_id: null,
        created_at: ctx.now,
        updated_at: ctx.now,
      };
      const columns = Object.keys(row) as (keyof Row)[];
      ctx.db.run(
        `INSERT INTO schedules (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
        ...columns.map((column) => row[column]),
      );
      arm(ctx, row);
      return { ...toScheduleRow(row), ...(first ? { check: first.check } : {}) };
    },
  );
};

type UpdateInput = {
  requestId: string;
  scheduleId: string;
  prompt?: string;
  schedule?: LocalCronSchedule;
  description?: string;
  status?: "active" | "paused";
  route?: ScheduleRoute;
  script?: string;
  once?: boolean;
};

const updateSchedule = async (
  ctx: OwnerContext,
  input: UpdateInput,
  isAnonymous: boolean,
): Promise<{ replayed: boolean; result: ScheduleRow & { check?: WatchCheckResult } }> => {
  if (isAnonymous && input.status === "active") signInRequired();
  const prompt = input.prompt === undefined ? undefined : cleanPrompt(input.prompt);
  const schedule = input.schedule === undefined ? undefined : normalizeSchedule(input.schedule);
  const script = input.script === undefined ? undefined : cleanScript(input.script);
  const requestId = input.requestId.trim();
  const existing = readRow(ctx.db, input.scheduleId);
  if (script !== undefined && existing && toScheduleKind(existing.kind) !== "watch") {
    bad("Only a watch has a check script.");
  }
  const replay = ctx.db.one<{ request_id: string }>(
    "SELECT request_id FROM schedule_receipts WHERE request_id = ?",
    requestId,
  );
  // A new script proves itself first and starts over from its own state.
  const first = script !== undefined && existing && !replay ? await firstCheck(ctx, existing.schedule_id, script) : null;
  return withReceipt(
    ctx.db,
    ctx.now,
    requestId,
    "update",
    {
      scheduleId: input.scheduleId,
      prompt: prompt ?? null,
      schedule: schedule ?? null,
      description: input.description === undefined ? null : input.description.trim(),
      status: input.status ?? null,
      route: input.route ?? null,
      script: script ?? null,
      once: input.once ?? null,
    },
    (): ScheduleRow & { check?: WatchCheckResult } => {
      const row = readRow(ctx.db, input.scheduleId);
      if (!row) throw new RpcError("NOT_FOUND", `No schedule with id ${input.scheduleId}.`);
      const kind = toScheduleKind(row.kind);
      const nextPrompt = prompt ?? row.prompt;
      let scheduleJson = row.schedule_json;
      let nextRunAt = row.next_run_at;
      if (schedule) {
        assertAllowed(schedule, ctx.now, kind);
        scheduleJson = JSON.stringify(schedule);
        nextRunAt = computeNextRunAt(schedule, ctx.now);
      }
      // Resuming re-anchors to now, so a schedule that slept through a dozen
      // fires wakes up once rather than catching up.
      if (input.status === "active" && row.status !== "active") {
        nextRunAt = computeNextRunAt(parseStored(scheduleJson), ctx.now);
      }
      const next: Row = {
        ...row,
        prompt: nextPrompt,
        schedule_json: scheduleJson,
        next_run_at: nextRunAt,
        status: input.status ?? row.status,
        description:
          input.description === undefined ? row.description : cleanDescription(input.description, nextPrompt),
        route: kind === "reminder" ? row.route : (input.route ?? row.route),
        once: kind === "watch" && input.once !== undefined ? (input.once ? 1 : 0) : row.once,
        ...(first
          ? {
              script: script ?? row.script,
              state_json: first.stateJson,
              pending_finding: null,
              last_check_at: ctx.now,
              last_finding: first.check.ok && first.check.found ? first.check.found : null,
              failing_since: null,
              last_error: null,
              last_error_at: null,
            }
          : {}),
        updated_at: ctx.now,
      };
      ctx.db.run(
        `UPDATE schedules SET prompt = ?, schedule_json = ?, next_run_at = ?, status = ?,
                description = ?, route = ?, once = ?, script = ?, state_json = ?, pending_finding = ?,
                last_check_at = ?, last_finding = ?, failing_since = ?, last_error = ?, last_error_at = ?,
                updated_at = ? WHERE schedule_id = ?`,
        next.prompt,
        next.schedule_json,
        next.next_run_at,
        next.status,
        next.description,
        next.route,
        next.once,
        next.script,
        next.state_json,
        next.pending_finding,
        next.last_check_at,
        next.last_finding,
        next.failing_since,
        next.last_error,
        next.last_error_at,
        next.updated_at,
        next.schedule_id,
      );
      if (next.status !== row.status || next.next_run_at !== row.next_run_at) arm(ctx, next);
      return { ...toScheduleRow(next), ...(first ? { check: first.check } : {}) };
    },
  );
};

const removeSchedule = (ctx: OwnerContext, input: { requestId: string; scheduleId: string }) =>
  withReceipt(
    ctx.db,
    ctx.now,
    input.requestId.trim(),
    "remove",
    { scheduleId: input.scheduleId },
    (): { removed: boolean } => {
      const row = readRow(ctx.db, input.scheduleId);
      ctx.jobs.cancel(scheduleJobId(input.scheduleId));
      if (!row) return { removed: false };
      ctx.db.run("DELETE FROM schedules WHERE schedule_id = ?", input.scheduleId);
      return { removed: true };
    },
  );

const runNow = (ctx: OwnerContext, scheduleId: string): null => {
  const row = readRow(ctx.db, scheduleId);
  if (!row || row.status !== "active") {
    throw new RpcError("NOT_FOUND", `No active schedule with id ${scheduleId}.`);
  }
  ctx.db.run(
    "UPDATE schedules SET next_run_at = ?, updated_at = ? WHERE schedule_id = ?",
    ctx.now,
    ctx.now,
    scheduleId,
  );
  arm(ctx, { ...row, next_run_at: ctx.now });
  return null;
};

// ── The cloud Schedule tool ───────────────────────────────────────────────

const toolParser = object({
  action: literal("list", "create", "update", "remove"),
  kind: optional(literal("reminder", "task", "watch")),
  route: optional(literal("orchestrator", "agent")),
  script: optional(string({ max: WATCH_SCRIPT_MAX_CHARS + 1_000 })),
  once: optional(boolean()),
  requestId: optional(string({ max: 128 })),
  scheduleId: optional(string({ max: 128, pattern: ID_PATTERN })),
  prompt: optional(string({ max: MAX_PROMPT_CHARS * 2 })),
  description: optional(string({ max: 1_000 })),
  conversationId: optional(string({ max: 128 })),
  status: optional(literal("active", "paused")),
  schedule: optional(scheduleParser),
});

const scheduleTool = async (ctx: OwnerContext, raw: unknown): Promise<ScheduleToolResult> => {
  const args = toolParser(raw);
  const list = (): ScheduleRow[] => listRows(ctx.db);
  if (args.action === "list") return { ok: true, replayed: false, schedules: list() };
  if (!args.requestId) bad("requestId is required for schedule changes.");
  const requestId = args.requestId!;
  const { isAnonymous } = await ctx.host.snapshot();
  if (args.action === "create") {
    if (!args.prompt) bad("prompt is required.");
    if (!args.schedule) bad("schedule is required.");
    const created = await createSchedule(
      ctx,
      {
        requestId,
        ...(args.kind ? { kind: args.kind } : {}),
        prompt: args.prompt!,
        schedule: args.schedule!,
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.conversationId !== undefined ? { conversationId: args.conversationId } : {}),
        ...(args.route !== undefined ? { route: args.route } : {}),
        ...(args.script !== undefined ? { script: args.script } : {}),
        ...(args.once !== undefined ? { once: args.once } : {}),
      },
      isAnonymous,
    );
    const { check, ...schedule } = created.result;
    return {
      ok: true,
      replayed: created.replayed,
      schedule,
      ...(check ? { check } : {}),
      schedules: list(),
    };
  }
  if (!args.scheduleId) bad("scheduleId is required.");
  if (args.action === "update") {
    const updated = await updateSchedule(
      ctx,
      {
        requestId,
        scheduleId: args.scheduleId!,
        ...(args.prompt !== undefined ? { prompt: args.prompt } : {}),
        ...(args.schedule !== undefined ? { schedule: args.schedule } : {}),
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.status !== undefined ? { status: args.status } : {}),
        ...(args.route !== undefined ? { route: args.route } : {}),
        ...(args.script !== undefined ? { script: args.script } : {}),
        ...(args.once !== undefined ? { once: args.once } : {}),
      },
      isAnonymous,
    );
    const { check, ...schedule } = updated.result;
    return {
      ok: true,
      replayed: updated.replayed,
      schedule,
      ...(check ? { check } : {}),
      schedules: list(),
    };
  }
  const removed = removeSchedule(ctx, { requestId, scheduleId: args.scheduleId! });
  return {
    ok: removed.result.removed,
    replayed: removed.replayed,
    removed: removed.result.removed,
    schedules: list(),
  };
};

// ── Reminders ─────────────────────────────────────────────────────────────

const REMINDER_KEEP_MS = 30 * DAY_MS;
const REMINDER_LIST_MS = 7 * DAY_MS;
const REMINDER_LIST_LIMIT = 100;
const REMINDER_PUSH_TITLE = "Reminder";

type FireRow = {
  fire_id: string;
  schedule_id: string;
  conversation_id: string | null;
  text: string;
  fired_at: number;
  state: string;
  snoozed_until: number | null;
  pushed_at: number | null;
  due_at: number | null;
  updated_at: number;
};

const toFireState = (value: string): ReminderFireState =>
  value === "done" || value === "snoozed" ? value : "open";

const toReminderFire = (row: FireRow): ReminderFire => ({
  fireId: row.fire_id,
  scheduleId: row.schedule_id,
  ...(row.conversation_id ? { conversationId: row.conversation_id } : {}),
  text: row.text,
  firedAt: row.fired_at,
  ...(row.due_at !== null ? { dueAt: row.due_at } : {}),
  state: toFireState(row.state),
  ...(row.snoozed_until !== null ? { snoozedUntil: row.snoozed_until } : {}),
  updatedAt: row.updated_at,
});

const readFire = (db: OwnerDbReader, fireId: string): FireRow | null =>
  db.one<FireRow>("SELECT * FROM reminder_fires WHERE fire_id = ?", fireId);

const listFires = (db: OwnerDbReader, now: number): ReminderFire[] =>
  db
    .all<FireRow>(
      `SELECT * FROM reminder_fires WHERE fired_at >= ? OR state = 'snoozed'
        ORDER BY fired_at DESC LIMIT ?`,
      now - REMINDER_LIST_MS,
      REMINDER_LIST_LIMIT,
    )
    .map(toReminderFire);

/** The delivery's row, once per fire id: a retried fire finds the first one. */
const recordFire = (
  ctx: OwnerContext,
  fire: { fireId: string; scheduleId: string; conversationId: string | null; text: string; dueAt?: number },
): FireRow => {
  // Late past a point, it says when it was due; it is still delivered just once.
  const dueAt = fire.dueAt !== undefined && ctx.now - fire.dueAt > REMINDER_LATE_MS ? fire.dueAt : null;
  ctx.db.run(
    `INSERT OR IGNORE INTO reminder_fires
       (fire_id, schedule_id, conversation_id, text, fired_at, due_at, state, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
    fire.fireId,
    fire.scheduleId,
    fire.conversationId,
    fire.text,
    ctx.now,
    dueAt,
    ctx.now,
  );
  ctx.db.run(
    "DELETE FROM reminder_fires WHERE fired_at < ? AND state != 'snoozed'",
    ctx.now - REMINDER_KEEP_MS,
  );
  return readFire(ctx.db, fire.fireId)!;
};

const reminderPushMessages = (ctx: OwnerContext, fire: FireRow) => {
  const tokens = livePushTokens(ctx);
  const data: ReminderPushData = {
    kind: REMINDER_PUSH_KIND,
    fireId: fire.fire_id,
    scheduleId: fire.schedule_id,
    ...(fire.conversation_id ? { conversationId: fire.conversation_id } : {}),
  };
  const collapse = `reminder:${fire.fire_id}`.slice(0, 64);
  const body = fire.text.length > 600 ? `${fire.text.slice(0, 599)}…` : fire.text;
  return {
    tokens,
    messages: tokens.map((token) => ({
      to: token.token,
      title: REMINDER_PUSH_TITLE,
      body,
      data,
      sound: "default",
      priority: "high",
      categoryId: REMINDER_PUSH_CATEGORY,
      ...(token.platform === "android"
        ? { tag: collapse }
        : { threadId: REMINDER_PUSH_CATEGORY, collapseId: collapse, interruptionLevel: "time-sensitive" }),
    })),
  };
};

/**
 * Deliver one reminder: the push once, and the card, which the journal takes
 * once per fire. False when something has to be tried again.
 */
const deliverReminder = async (ctx: OwnerContext, ownerGeneration: string, fire: FireRow): Promise<boolean> => {
  let delivered = true;
  if (fire.pushed_at === null) {
    const { tokens, messages } = reminderPushMessages(ctx, fire);
    if (await sendPushMessages(ctx, tokens, messages)) {
      ctx.db.run("UPDATE reminder_fires SET pushed_at = ? WHERE fire_id = ?", ctx.now, fire.fire_id);
    } else {
      delivered = false;
    }
  }
  const conversationId = fire.conversation_id;
  if (conversationId && !conversationId.startsWith("local_")) {
    const card: ReminderCard = {
      type: REMINDER_CARD_TYPE,
      fireId: fire.fire_id,
      scheduleId: fire.schedule_id,
      text: fire.text,
      ...(fire.due_at !== null ? { dueAt: fire.due_at } : {}),
    };
    const posted = await ctx.host.postConversationCard({
      conversationId,
      ownerGeneration,
      sourceTurnId: `reminder:${fire.fire_id}`,
      card,
    });
    if (!posted) delivered = false;
  }
  return delivered;
};

const setReminderState = (
  ctx: OwnerContext,
  fireId: string,
  next: { state: "done" } | { state: "snoozed"; minutes: number },
): ReminderFire => {
  enforceOwnerRateLimit(ctx.db, ctx.now, "schedules.reminder", { count: 60, windowMs: 60_000 }, "Slow down a moment and try again.");
  const row = readFire(ctx.db, fireId);
  if (!row) throw new RpcError("NOT_FOUND", "That reminder is gone.");
  const snoozedUntil = next.state === "snoozed" ? ctx.now + Math.round(next.minutes) * 60_000 : null;
  ctx.db.run(
    "UPDATE reminder_fires SET state = ?, snoozed_until = ?, updated_at = ? WHERE fire_id = ?",
    next.state,
    snoozedUntil,
    ctx.now,
    fireId,
  );
  if (snoozedUntil !== null) {
    ctx.jobs.schedule(REMINDER_RETURN_JOB, snoozedUntil, { fireId }, { id: reminderReturnJobId(fireId) });
  } else {
    ctx.jobs.cancel(reminderReturnJobId(fireId));
  }
  return toReminderFire(readFire(ctx.db, fireId)!);
};

/** A snoozed reminder comes back as a fresh delivery, at the foot of the chat. */
const reminderReturn = async (ctx: OwnerContext, payload: unknown): Promise<void> => {
  const { fireId } = object({ fireId: string({ max: 128 }) })(payload);
  const old = readFire(ctx.db, fireId);
  if (!old || old.state !== "snoozed" || old.snoozed_until === null) return;
  if (old.snoozed_until > ctx.now) {
    ctx.jobs.schedule(REMINDER_RETURN_JOB, old.snoozed_until, { fireId }, { id: reminderReturnJobId(fireId) });
    return;
  }
  const snapshot = await ctx.host.snapshot();
  if (!snapshot.writable) return;
  const fresh = recordFire(ctx, {
    fireId: `${old.fire_id.slice(0, 64)}.${old.snoozed_until.toString(36)}`,
    scheduleId: old.schedule_id,
    conversationId: old.conversation_id,
    text: old.text,
  });
  if (!(await deliverReminder(ctx, snapshot.ownerGeneration, fresh))) {
    throw new Error("The snoozed reminder could not be delivered yet.");
  }
};

// ── Firing ────────────────────────────────────────────────────────────────

const firePayload = object({
  scheduleId: string({ max: 128 }),
  /** Set on a retry whose first start may have happened: start it again under the same id. */
  fireId: optional(string({ max: 64 })),
});

const dailyFires = (ctx: OwnerContext): { plan: string; count: number } => {
  const access = billingAccess(ctx);
  return {
    plan: access.plan,
    count: access.unlimited ? UNLIMITED_DAILY_FIRES : DAILY_FIRES[access.plan],
  };
};

const planLabel = (plan: string): string => (plan === "free" ? "Free" : plan === "go" ? "Go" : "Pro");

/**
 * Close out a fire `claim` advanced. A failure goes on the row, where the
 * Schedule tool and the lists read it back; a retryable one pulls the next
 * run forward a minute (at most MAX_FIRE_RETRIES times in a row), and a
 * one-shot that gives up stays done rather than active-and-overdue.
 */
const finishFire = (
  ctx: OwnerContext,
  scheduleId: string,
  fireId: string,
  outcome: { error?: string; retry?: { sameFire: boolean }; pause?: boolean; oneShot?: boolean },
): void => {
  const row = readRow(ctx.db, scheduleId);
  // Removed or rewritten since the claim: whatever changed it owns the row now.
  if (!row || row.active_fire_id !== fireId) return;
  if (!outcome.error) {
    ctx.db.run(
      `UPDATE schedules SET active_fire_id = NULL, last_error = NULL, last_error_at = NULL,
              failure_count = 0, updated_at = ? WHERE schedule_id = ?`,
      ctx.now,
      scheduleId,
    );
    arm(ctx, row);
    return;
  }
  const failureCount = row.failure_count + 1;
  const retryAt = ctx.now + FIRE_RETRY_DELAY_MS;
  const retry =
    !outcome.pause &&
    outcome.retry !== undefined &&
    failureCount <= MAX_FIRE_RETRIES &&
    (outcome.oneShot ? row.status === "done" : retryAt < row.next_run_at);
  const status = outcome.pause ? "paused" : retry && outcome.oneShot ? "active" : row.status;
  const nextRunAt = retry ? retryAt : row.next_run_at;
  ctx.db.run(
    `UPDATE schedules SET active_fire_id = ?, last_error = ?, last_error_at = ?, failure_count = ?,
            status = ?, next_run_at = ?, updated_at = ? WHERE schedule_id = ?`,
    retry && outcome.retry?.sameFire ? fireId : null,
    outcome.error.slice(0, MAX_ERROR_CHARS),
    ctx.now,
    failureCount,
    status,
    nextRunAt,
    ctx.now,
    scheduleId,
  );
  arm(
    ctx,
    { schedule_id: scheduleId, status, next_run_at: nextRunAt },
    retry && outcome.retry?.sameFire ? fireId : undefined,
  );
};

const fire = async (ctx: OwnerContext, payload: unknown): Promise<void> => {
  const { scheduleId, fireId: retryFireId } = firePayload(payload);
  const snapshot = await ctx.host.snapshot();
  // Everything from here to the start is synchronous, so nothing interleaves
  // between reading the row and claiming it.
  const row = readRow(ctx.db, scheduleId);
  if (!row || row.status !== "active") return;
  if (row.next_run_at > ctx.now) {
    arm(ctx, row);
    return;
  }
  const retrying = retryFireId !== undefined && retryFireId === row.active_fire_id;
  const fireId = retrying ? retryFireId : crypto.randomUUID();
  let schedule: LocalCronSchedule;
  let oneShot = false;
  let nextRunAt = row.next_run_at;
  try {
    schedule = parseStored(row.schedule_json);
    oneShot = schedule.kind === "at";
    // Recurring schedules re-anchor from the fire, so an owner object that
    // slept through several fires wakes up once, not N times.
    if (!oneShot) nextRunAt = computeNextRunAt(schedule, ctx.now + 1_000);
  } catch (error) {
    ctx.db.run("UPDATE schedules SET active_fire_id = ? WHERE schedule_id = ?", fireId, scheduleId);
    finishFire(ctx, scheduleId, fireId, {
      error: error instanceof Error ? error.message : String(error),
      pause: true,
    });
    return;
  }
  ctx.db.run(
    `UPDATE schedules SET active_fire_id = ?, last_run_at = ?, next_run_at = ?, status = ?,
            updated_at = ? WHERE schedule_id = ?`,
    fireId,
    ctx.now,
    nextRunAt,
    oneShot ? "done" : "active",
    ctx.now,
    scheduleId,
  );
  if (!snapshot.writable) {
    finishFire(ctx, scheduleId, fireId, {
      error: "This run was skipped: your cloud account isn't accepting work right now.",
      oneShot,
    });
    return;
  }
  if (toScheduleKind(row.kind) === "reminder") {
    // No model and no turn, so no scheduled-run budget either.
    const delivery = recordFire(ctx, {
      fireId,
      scheduleId,
      conversationId: row.conversation_id,
      text: row.prompt,
      dueAt: row.next_run_at,
    });
    const delivered = await deliverReminder(ctx, snapshot.ownerGeneration, delivery);
    finishFire(
      ctx,
      scheduleId,
      fireId,
      delivered ? {} : { error: "The reminder could not be delivered everywhere yet.", oneShot, retry: { sameFire: true } },
    );
    return;
  }
  if (toScheduleKind(row.kind) === "watch") {
    await fireWatch(ctx, row, fireId, retrying, snapshot.ownerGeneration);
    return;
  }
  if (!retrying && !spendRun(ctx, scheduleId, fireId, oneShot)) return;
  const started = await startRun(ctx, row, fireId, snapshot.ownerGeneration, {
    prompt: `${row.prompt}${retrying ? "" : lateNote(row.next_run_at, ctx.now)}`,
    ...(toRoute(row.route) === "agent" ? { agent: { description: row.description } } : {}),
  });
  finishFire(ctx, scheduleId, fireId, started.ok ? {} : { ...started.outcome, oneShot });
};

/** A run that starts well after it was due says so: it runs once, not once per missed slot. */
const lateNote = (dueAt: number, now: number): string =>
  now - dueAt > REMINDER_LATE_MS
    ? `\n\n(This was due at ${new Date(dueAt).toISOString()} and runs now instead, once, in place of any runs it missed.)`
    : "";

/**
 * One of the owner's daily scheduled runs, for a fire about to wake AI.
 * When they are used up the fire is closed with why, and this is false.
 */
const spendRun = (ctx: OwnerContext, scheduleId: string, fireId: string, oneShot: boolean): boolean => {
  const budget = dailyFires(ctx);
  try {
    enforceOwnerRateLimit(
      ctx.db,
      ctx.now,
      SCHEDULE_FIRE_JOB,
      { count: budget.count, windowMs: DAY_MS },
      "Daily scheduled runs are used up.",
    );
    return true;
  } catch (error) {
    if (!(error instanceof RpcError) || error.code !== "RATE_LIMITED") throw error;
    // A fact about the account, not a transient failure: wait for the next
    // slot rather than retrying into the same wall.
    finishFire(ctx, scheduleId, fireId, {
      error: `This run was skipped: today's ${budget.count} scheduled runs on the ${planLabel(budget.plan)} plan are used up.`,
      oneShot,
    });
    return false;
  }
};

type StartOutcome =
  | { ok: true }
  | { ok: false; outcome: { error: string; retry?: { sameFire: boolean } } };

/**
 * Start a fire's run in the schedule's conversation: a turn of its
 * orchestrator, or with `agent` an agent of it.
 */
const startRun = async (
  ctx: OwnerContext,
  row: Row,
  fireId: string,
  ownerGeneration: string,
  run: { prompt: string; agent?: { description: string } },
): Promise<StartOutcome> => {
  const scheduleId = row.schedule_id;
  // Conversation ids are minted here and pinned before the start, so every
  // retry of this fire and every later fire reports into the same thread.
  let conversationId = row.conversation_id ?? crypto.randomUUID();
  if (!row.conversation_id) {
    ctx.db.run("UPDATE schedules SET conversation_id = ? WHERE schedule_id = ?", conversationId, scheduleId);
  }
  const start = async (id: string) =>
    await ctx.host.startScheduledTurn({
      ownerGeneration,
      conversationId: id,
      clientMsgId: `schedule:${fireId}`,
      prompt: run.prompt,
      title: row.description,
      ...(row.target_device_id ? { targetDeviceId: row.target_device_id } : {}),
      ...(run.agent ? { agent: run.agent } : {}),
    });
  try {
    try {
      await start(conversationId);
    } catch (error) {
      // The pinned conversation was deleted while the schedule lived on:
      // start a fresh one rather than failing every fire from now on.
      if (!(error instanceof ScheduledTurnError) || !error.conversationGone || !row.conversation_id) throw error;
      conversationId = crypto.randomUUID();
      await start(conversationId);
      const current = readRow(ctx.db, scheduleId);
      if (current && current.active_fire_id === fireId) {
        ctx.db.run("UPDATE schedules SET conversation_id = ? WHERE schedule_id = ?", conversationId, scheduleId);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A definite refusal never started anything, so its retry is a fresh
    // fire. Anything else may have started; its retry reuses the fire id,
    // which the start replays instead of running the prompt twice.
    const definite = error instanceof ScheduledTurnError;
    return {
      ok: false,
      outcome: {
        error: message,
        ...(!definite || error.retryable ? { retry: { sameFire: !definite } } : {}),
      },
    };
  }
  return { ok: true };
};

// ── Watches ───────────────────────────────────────────────────────────────

const watchFoundPrompt = (row: Row, found: string): string =>
  [
    `[Watch "${row.description}" found something] (${row.schedule_id})`,
    found,
    "",
    `When it was set up, the user asked: ${row.prompt}`,
    row.once ? "It has done its job and stops checking now." : "It keeps checking on its schedule.",
    "Handle the finding as they asked: tell them, ask them, or act.",
  ].join("\n");

const watchAgentPrompt = (row: Row, found: string): string =>
  [
    row.prompt,
    "",
    `A watch ("${row.description}") just found what the user was waiting for:`,
    found,
    "",
    "The user approved this when they set the watch up, so go ahead now, then report what you did.",
  ].join("\n");

const watchFailedPrompt = (row: Row, error: string): string =>
  [
    `[Watch "${row.description}" failed] (${row.schedule_id})`,
    error,
    "",
    `It was set up for: ${row.prompt}`,
    "It keeps trying on its schedule. Repair it: find out what changed, rewrite the check script and replace it with schedule_update({ jobId, script }), which checks it once before saving. Tell the user only if it can't be fixed.",
  ].join("\n");

/**
 * A watch's fire: its script runs with no model. Nothing found is the end of
 * it. A finding is handed to the orchestrator, or to an agent when the user
 * already approved the action; it waits on the row until it is, so a busy
 * or refused start never loses it and never runs the check again for it. A
 * failing script is reported once per failing streak, for repair.
 */
const fireWatch = async (
  ctx: OwnerContext,
  row: Row,
  fireId: string,
  retrying: boolean,
  ownerGeneration: string,
): Promise<void> => {
  const scheduleId = row.schedule_id;
  let found = row.pending_finding ?? "";
  let failure = "";
  if (!found) {
    if (!row.script) {
      finishFire(ctx, scheduleId, fireId, { error: "This watch has no check script.", pause: true });
      return;
    }
    const run = await runWatchCheck(ctx.env, {
      ownerId: ctx.ownerId,
      scheduleId,
      script: row.script,
      stateJson: row.state_json,
    });
    const current = readRow(ctx.db, scheduleId);
    if (!current) return;
    // Its script was replaced while this one ran: the new one starts its own state.
    if (current.script !== row.script) {
      finishFire(ctx, scheduleId, fireId, {});
      return;
    }
    if (run.ok) {
      ctx.db.run(
        `UPDATE schedules SET state_json = ?, last_check_at = ?, failing_since = NULL, pending_finding = ?,
                last_finding = COALESCE(?, last_finding) WHERE schedule_id = ?`,
        run.stateJson,
        ctx.now,
        run.found || null,
        run.found || null,
        scheduleId,
      );
      if (!run.found) {
        finishFire(ctx, scheduleId, fireId, {});
        return;
      }
      found = run.found;
    } else {
      ctx.db.run(
        "UPDATE schedules SET last_check_at = ?, failing_since = COALESCE(failing_since, ?) WHERE schedule_id = ?",
        ctx.now,
        ctx.now,
        scheduleId,
      );
      if (current.failing_since !== null) {
        finishFire(ctx, scheduleId, fireId, { error: run.error });
        return;
      }
      failure = run.error;
    }
  }
  if (!retrying && !spendRun(ctx, scheduleId, fireId, false)) return;
  const toAgent = Boolean(found) && toRoute(row.route) === "agent";
  const started = await startRun(
    ctx,
    row,
    fireId,
    ownerGeneration,
    found
      ? {
          prompt: toAgent ? watchAgentPrompt(row, found) : watchFoundPrompt(row, found),
          ...(toAgent ? { agent: { description: row.description } } : {}),
        }
      : { prompt: watchFailedPrompt(row, failure) },
  );
  if (!started.ok) {
    finishFire(ctx, scheduleId, fireId, started.outcome);
    return;
  }
  if (found) {
    // Handed over. A one-off watch has answered its question.
    ctx.db.run(
      `UPDATE schedules SET pending_finding = NULL, status = CASE WHEN once = 1 THEN 'done' ELSE status END
        WHERE schedule_id = ?`,
      scheduleId,
    );
  }
  finishFire(ctx, scheduleId, fireId, failure ? { error: failure } : {});
};

// ── Domain ────────────────────────────────────────────────────────────────

const createArgs = object({
  requestId: string({ max: 128 }),
  kind: optional(literal("reminder", "task", "watch")),
  prompt: string({ max: MAX_PROMPT_CHARS * 2 }),
  schedule: scheduleParser,
  description: optional(string({ max: 1_000 })),
  conversationId: optional(string({ max: 128 })),
  targetDeviceId: optional(string({ max: 256 })),
  route: optional(literal("orchestrator", "agent")),
  script: optional(string({ max: WATCH_SCRIPT_MAX_CHARS + 1_000 })),
  once: optional(boolean()),
});

const updateArgs = object({
  requestId: string({ max: 128 }),
  scheduleId: string({ max: 128, pattern: ID_PATTERN }),
  prompt: optional(string({ max: MAX_PROMPT_CHARS * 2 })),
  schedule: optional(scheduleParser),
  description: optional(string({ max: 1_000 })),
  status: optional(literal("active", "paused")),
  route: optional(literal("orchestrator", "agent")),
  script: optional(string({ max: WATCH_SCRIPT_MAX_CHARS + 1_000 })),
  once: optional(boolean()),
});

const removeArgs = object({
  requestId: string({ max: 128 }),
  scheduleId: string({ max: 128, pattern: ID_PATTERN }),
});

export const schedulesDomain = {
  name: "schedules",
  migrations: [SCHEDULES_MIGRATION, SCHEDULES_KINDS_MIGRATION, SCHEDULES_WATCHES_MIGRATION, SCHEDULES_DUE_MIGRATION],
  views: {
    "schedules.list": {
      parse: empty(),
      read: (ctx) => listRows(ctx.db),
    },
    "schedules.reminders": {
      parse: empty(),
      read: (ctx) => listFires(ctx.db, ctx.now),
    },
  },
  calls: {
    "schedules.create": {
      scope: "owner",
      parse: createArgs,
      handler: async (ctx: OwnerContext, args: ScheduleCalls["schedules.create"]["args"]) =>
        (await createSchedule(ctx, args, ctx.caller?.isAnonymous ?? false)).result,
    },
    "schedules.update": {
      scope: "owner",
      parse: updateArgs,
      handler: async (ctx: OwnerContext, args: ScheduleCalls["schedules.update"]["args"]) =>
        (await updateSchedule(ctx, args, ctx.caller?.isAnonymous ?? false)).result,
    },
    "schedules.remove": {
      scope: "owner",
      parse: removeArgs,
      handler: (ctx: OwnerContext, args: ScheduleCalls["schedules.remove"]["args"]) => {
        removeSchedule(ctx, args);
        return null;
      },
    },
    "schedules.runNow": {
      scope: "owner",
      parse: object({ scheduleId: string({ max: 128, pattern: ID_PATTERN }) }),
      handler: (ctx: OwnerContext, args: ScheduleCalls["schedules.runNow"]["args"]) =>
        runNow(ctx, args.scheduleId),
    },
    "schedules.reminderDone": {
      scope: "owner",
      parse: object({ fireId: string({ max: 128, pattern: ID_PATTERN }) }),
      handler: (ctx: OwnerContext, args: ScheduleCalls["schedules.reminderDone"]["args"]) =>
        setReminderState(ctx, args.fireId, { state: "done" }),
    },
    "schedules.reminderSnooze": {
      scope: "owner",
      parse: object({
        fireId: string({ max: 128, pattern: ID_PATTERN }),
        minutes: number({ min: 1, max: REMINDER_MAX_SNOOZE_MINUTES }),
      }),
      handler: (ctx: OwnerContext, args: ScheduleCalls["schedules.reminderSnooze"]["args"]) =>
        setReminderState(ctx, args.fireId, { state: "snoozed", minutes: args.minutes }),
    },
  },
  internal: {
    "schedules.tool": (ctx: OwnerContext, args: unknown) => scheduleTool(ctx, args),
  },
  jobs: {
    [SCHEDULE_FIRE_JOB]: {
      run: fire,
      // Fires handle their own failures; this only covers an unreadable
      // owner snapshot, which the store retries with backoff.
      maxAttempts: 10,
    },
    [REMINDER_RETURN_JOB]: {
      run: reminderReturn,
      maxAttempts: 6,
    },
  },
  purge: (ctx) => {
    for (const { schedule_id } of ctx.db.all<{ schedule_id: string }>("SELECT schedule_id FROM schedules")) {
      ctx.jobs.cancel(scheduleJobId(schedule_id));
    }
    for (const { fire_id } of ctx.db.all<{ fire_id: string }>(
      "SELECT fire_id FROM reminder_fires WHERE state = 'snoozed'",
    )) {
      ctx.jobs.cancel(reminderReturnJobId(fire_id));
    }
    ctx.db.run("DELETE FROM schedules");
    ctx.db.run("DELETE FROM schedule_receipts");
    ctx.db.run("DELETE FROM reminder_fires");
    return { pending: false };
  },
} satisfies OwnerDomain;
