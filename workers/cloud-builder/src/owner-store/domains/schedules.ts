/**
 * Schedules, fired from the owner object's alarm.
 *
 * A schedule is a prompt plus a `LocalCronSchedule`, of a kind: a `task`
 * starts a run at fire time; a `reminder`'s prompt is the text Stella wrote
 * when it was set, delivered with no model and no turn (a push to the
 * phone, a card in the conversation every client shows as Stella's message,
 * an in-app notice on the desktop). Each live schedule has
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
import type {
  ScheduleCalls,
  ScheduleKind,
  ScheduleRow,
  ScheduleStatus,
  ScheduleToolResult,
} from "@stella/contracts/backend/schedules";
import {
  REMINDER_CARD_TYPE,
  REMINDER_MAX_SNOOZE_MINUTES,
  REMINDER_PUSH_CATEGORY,
  REMINDER_PUSH_KIND,
  type ReminderCard,
  type ReminderFire,
  type ReminderFireState,
  type ReminderPushData,
} from "@stella/contracts/reminders";
import { empty, literal, number, object, optional, string, type Parser } from "../args.js";
import { RpcError } from "../errors.js";
import { enforceOwnerRateLimit } from "../rate-limit.js";
import type { OwnerContext, OwnerDb, OwnerDbReader, OwnerDomain } from "../registry.js";
import { ScheduledTurnError } from "../scheduled-turn.js";
import { billingAccess } from "./billing.js";
import { livePushTokens, sendPushMessages } from "./devices.js";

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

type Row = {
  schedule_id: string;
  kind: string;
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

const toScheduleKind = (value: string): ScheduleKind => (value === "reminder" ? "reminder" : "task");

const toScheduleRow = (row: Row): ScheduleRow => ({
  scheduleId: row.schedule_id,
  kind: toScheduleKind(row.kind),
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

const assertAllowed = (schedule: LocalCronSchedule, nowMs: number): void => {
  const interval = intervalMs(schedule, nowMs);
  if (interval !== null && interval < MIN_INTERVAL_MS) {
    bad(`Schedules can run at most once every ${MIN_INTERVAL_MS / 60_000} minutes. Space this one out.`);
  }
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
};

const createSchedule = (ctx: OwnerContext, input: CreateInput, isAnonymous: boolean) => {
  if (isAnonymous) signInRequired();
  const kind: ScheduleKind = input.kind ?? "task";
  const prompt = cleanPrompt(input.prompt);
  const schedule = normalizeSchedule(input.schedule);
  const description = cleanDescription(input.description, prompt);
  const conversationId = input.conversationId?.trim() || null;
  // A reminder runs nowhere: it needs no computer.
  const targetDeviceId = kind === "reminder" ? null : input.targetDeviceId?.trim() || null;
  return withReceipt(
    ctx.db,
    ctx.now,
    input.requestId.trim(),
    "create",
    { kind, prompt, schedule, description, conversationId, targetDeviceId },
    (): ScheduleRow => {
      assertAllowed(schedule, ctx.now);
      const live =
        ctx.db.one<{ n: number }>(
          "SELECT COUNT(*) AS n FROM schedules WHERE status IN ('active', 'paused')",
        )?.n ?? 0;
      if (live >= MAX_SCHEDULES) {
        bad(`You already have ${MAX_SCHEDULES} schedules. Remove one before adding another.`);
      }
      const row: Row = {
        schedule_id: `sch-${crypto.randomUUID().slice(0, 18)}`,
        kind,
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
      return toScheduleRow(row);
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
};

const updateSchedule = (ctx: OwnerContext, input: UpdateInput, isAnonymous: boolean) => {
  if (isAnonymous && input.status === "active") signInRequired();
  const prompt = input.prompt === undefined ? undefined : cleanPrompt(input.prompt);
  const schedule = input.schedule === undefined ? undefined : normalizeSchedule(input.schedule);
  return withReceipt(
    ctx.db,
    ctx.now,
    input.requestId.trim(),
    "update",
    {
      scheduleId: input.scheduleId,
      prompt: prompt ?? null,
      schedule: schedule ?? null,
      description: input.description === undefined ? null : input.description.trim(),
      status: input.status ?? null,
    },
    (): ScheduleRow => {
      const row = readRow(ctx.db, input.scheduleId);
      if (!row) throw new RpcError("NOT_FOUND", `No schedule with id ${input.scheduleId}.`);
      const nextPrompt = prompt ?? row.prompt;
      let scheduleJson = row.schedule_json;
      let nextRunAt = row.next_run_at;
      if (schedule) {
        assertAllowed(schedule, ctx.now);
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
        updated_at: ctx.now,
      };
      ctx.db.run(
        `UPDATE schedules SET prompt = ?, schedule_json = ?, next_run_at = ?, status = ?,
                description = ?, updated_at = ? WHERE schedule_id = ?`,
        next.prompt,
        next.schedule_json,
        next.next_run_at,
        next.status,
        next.description,
        next.updated_at,
        next.schedule_id,
      );
      if (next.status !== row.status || next.next_run_at !== row.next_run_at) arm(ctx, next);
      return toScheduleRow(next);
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
  kind: optional(literal("reminder", "task")),
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
    const created = createSchedule(
      ctx,
      {
        requestId,
        ...(args.kind ? { kind: args.kind } : {}),
        prompt: args.prompt!,
        schedule: args.schedule!,
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.conversationId !== undefined ? { conversationId: args.conversationId } : {}),
      },
      isAnonymous,
    );
    return { ok: true, replayed: created.replayed, schedule: created.result, schedules: list() };
  }
  if (!args.scheduleId) bad("scheduleId is required.");
  if (args.action === "update") {
    const updated = updateSchedule(
      ctx,
      {
        requestId,
        scheduleId: args.scheduleId!,
        ...(args.prompt !== undefined ? { prompt: args.prompt } : {}),
        ...(args.schedule !== undefined ? { schedule: args.schedule } : {}),
        ...(args.description !== undefined ? { description: args.description } : {}),
        ...(args.status !== undefined ? { status: args.status } : {}),
      },
      isAnonymous,
    );
    return { ok: true, replayed: updated.replayed, schedule: updated.result, schedules: list() };
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
  fire: { fireId: string; scheduleId: string; conversationId: string | null; text: string },
): FireRow => {
  ctx.db.run(
    `INSERT OR IGNORE INTO reminder_fires
       (fire_id, schedule_id, conversation_id, text, fired_at, state, updated_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?)`,
    fire.fireId,
    fire.scheduleId,
    fire.conversationId,
    fire.text,
    ctx.now,
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
  if (!retrying) {
    const budget = dailyFires(ctx);
    try {
      enforceOwnerRateLimit(
        ctx.db,
        ctx.now,
        SCHEDULE_FIRE_JOB,
        { count: budget.count, windowMs: DAY_MS },
        "Daily scheduled runs are used up.",
      );
    } catch (error) {
      if (!(error instanceof RpcError) || error.code !== "RATE_LIMITED") throw error;
      // A fact about the account, not a transient failure: wait for the next
      // slot rather than retrying into the same wall.
      finishFire(ctx, scheduleId, fireId, {
        error: `This run was skipped: today's ${budget.count} scheduled runs on the ${planLabel(budget.plan)} plan are used up.`,
        oneShot,
      });
      return;
    }
  }
  // Conversation ids are minted here and pinned before the start, so every
  // retry of this fire and every later fire reports into the same thread.
  let conversationId = row.conversation_id ?? crypto.randomUUID();
  if (!row.conversation_id) {
    ctx.db.run("UPDATE schedules SET conversation_id = ? WHERE schedule_id = ?", conversationId, scheduleId);
  }
  const start = async (id: string) =>
    await ctx.host.startScheduledTurn({
      ownerGeneration: snapshot.ownerGeneration,
      conversationId: id,
      clientMsgId: `schedule:${fireId}`,
      prompt: row.prompt,
      title: row.description,
      ...(row.target_device_id ? { targetDeviceId: row.target_device_id } : {}),
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
    finishFire(ctx, scheduleId, fireId, {
      error: message,
      oneShot,
      ...(!definite || error.retryable ? { retry: { sameFire: !definite } } : {}),
    });
    return;
  }
  finishFire(ctx, scheduleId, fireId, {});
};

// ── Domain ────────────────────────────────────────────────────────────────

const createArgs = object({
  requestId: string({ max: 128 }),
  kind: optional(literal("reminder", "task")),
  prompt: string({ max: MAX_PROMPT_CHARS * 2 }),
  schedule: scheduleParser,
  description: optional(string({ max: 1_000 })),
  conversationId: optional(string({ max: 128 })),
  targetDeviceId: optional(string({ max: 256 })),
});

const updateArgs = object({
  requestId: string({ max: 128 }),
  scheduleId: string({ max: 128, pattern: ID_PATTERN }),
  prompt: optional(string({ max: MAX_PROMPT_CHARS * 2 })),
  schedule: optional(scheduleParser),
  description: optional(string({ max: 1_000 })),
  status: optional(literal("active", "paused")),
});

const removeArgs = object({
  requestId: string({ max: 128 }),
  scheduleId: string({ max: 128, pattern: ID_PATTERN }),
});

export const schedulesDomain = {
  name: "schedules",
  migrations: [SCHEDULES_MIGRATION, SCHEDULES_KINDS_MIGRATION],
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
      handler: (ctx: OwnerContext, args: ScheduleCalls["schedules.create"]["args"]) =>
        createSchedule(ctx, args, ctx.caller?.isAnonymous ?? false).result,
    },
    "schedules.update": {
      scope: "owner",
      parse: updateArgs,
      handler: (ctx: OwnerContext, args: ScheduleCalls["schedules.update"]["args"]) =>
        updateSchedule(ctx, args, ctx.caller?.isAnonymous ?? false).result,
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
