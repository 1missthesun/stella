import { PLAN_CATALOG, planLabel } from "@stella/contracts/billing-plans";
import { Cron } from "croner";
import type { LocalCronSchedule } from "@stella/contracts/scheduling";
import type { DeviceDestination } from "@stella/contracts/turn-plane/placement";
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
import {
  parseScheduleNoticeCard,
  SCHEDULE_NOTICE_CARD_TYPE,
  SCHEDULE_NOTICE_MESSAGE_MAX_CHARS,
  type ScheduleNoticeAction,
  type ScheduleNoticeCard,
} from "@stella/contracts/schedule-notice";
import { boolean, empty, json, literal, number, object, optional, string, type Parser } from "../args.js";
import { RpcError } from "../errors.js";
import { enforceOwnerRateLimit } from "../rate-limit.js";
import type { OwnerContext, OwnerDb, OwnerDbReader, OwnerDomain, ScheduledTurnStarted } from "../registry.js";
import { ScheduledTurnError } from "../scheduled-turn.js";
import { billingAccess, cloudSandboxAccess } from "./billing.js";
import { livePushTokens, resolveCurrentDeviceId, sendPushMessages } from "./devices.js";
import { queueAgentNote, queueStellaNote, tellWaitingScheduleGone } from "./agent-reports.js";
import { agentReportReceipt } from "@stella/contracts/backend/agent-reports";
import { deliverScheduledMessage, scheduleTargetThread } from "./agent-threads.js";
import { agentChangeHooks } from "./agent-events.js";
import { isAgentStopReason } from "@stella/contracts/agent-status";
import type { OwnerEvent } from "@stella/contracts/turn-plane/owner-events";
import {
  scheduledThreadFallbackNote,
  scheduledThreadMessage,
  type ScheduledThreadFire,
} from "@stella/contracts/schedule-thread";
import { runWatchCheck } from "../watch-runner.js";
import { log } from "../../build-session/shared/keys.js";
import {
  isUsableTimeZone,
  zoneReportDecides,
  type ScheduleZone,
  type ScheduleZoneSource,
} from "@stella/contracts/schedule-zone";

export const SCHEDULE_FIRE_JOB = "schedules.fire";
export const scheduleJobId = (scheduleId: string): string => `schedule:${scheduleId}`;
export const REMINDER_RETURN_JOB = "schedules.reminderReturn";
const reminderReturnJobId = (fireId: string): string => `reminder:${fireId}`;

export const SCHEDULE_NOTICE_JOB = "schedules.notice";

const MAX_SCHEDULES = 25;
const MIN_INTERVAL_MS = 15 * 60_000;
const MAX_PROMPT_CHARS = 4_000;
const MAX_DESCRIPTION_CHARS = 200;
const MAX_ERROR_CHARS = 300;
const FIRE_RETRY_DELAY_MS = 60_000;
const MAX_FIRE_RETRIES = 3;
const DAY_MS = 24 * 60 * 60_000;
const RECEIPT_TTL_MS = 7 * DAY_MS;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/u;
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;


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

export const SCHEDULES_DUE_MIGRATION = {
  id: "schedules.4-due",
  statements: [`ALTER TABLE reminder_fires ADD COLUMN due_at INTEGER`],
};

export const SCHEDULES_ZONE_MIGRATION = {
  id: "schedules.5-zone",
  statements: [
    `CREATE TABLE schedule_zone (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       zone TEXT,
       answered TEXT,
       updated_at INTEGER NOT NULL
     )`,
  ],
};

export const SCHEDULES_ZONE_SOURCE_MIGRATION = {
  id: "schedules.6-zone-source",
  statements: [
    `ALTER TABLE schedule_zone ADD COLUMN source TEXT`,
    `ALTER TABLE schedule_zone ADD COLUMN phone_reported_at INTEGER`,
    `UPDATE schedules SET schedule_json = json_remove(schedule_json, '$.tz')
       WHERE json_valid(schedule_json)
         AND json_extract(schedule_json, '$.kind') = 'cron'
         AND json_extract(schedule_json, '$.tz') = (SELECT zone FROM schedule_zone WHERE id = 1)`,
  ],
};

export const SCHEDULES_WATCH_REPAIR_MIGRATION = {
  id: "schedules.7-watch-repair",
  statements: [`ALTER TABLE schedules ADD COLUMN repair_sent_at INTEGER`],
};

export const SCHEDULES_WAITING_MIGRATION = {
  id: "schedules.8-waiting",
  statements: [`ALTER TABLE schedules ADD COLUMN waiting_since INTEGER`],
};

export const SCHEDULES_RUN_STATE_MIGRATION = {
  id: "schedules.9-run-state",
  statements: [
    `ALTER TABLE schedules ADD COLUMN run_state TEXT NOT NULL DEFAULT 'armed' CHECK (run_state IN ('armed', 'firing'))`,
    `ALTER TABLE schedules ADD COLUMN fire_started_at INTEGER`,
  ],
};

export const SCHEDULES_TARGET_THREAD_MIGRATION = {
  id: "schedules.10-target-thread",
  statements: [`ALTER TABLE schedules ADD COLUMN target_thread_id TEXT`],
};

export const SCHEDULES_RUNS_MIGRATION = {
  id: "schedules.11-runs",
  statements: [
    `ALTER TABLE schedules ADD COLUMN created_by_thread_id TEXT`,
    `ALTER TABLE schedules ADD COLUMN retry_of TEXT`,
    `ALTER TABLE schedules ADD COLUMN retry_attempt INTEGER`,
    `ALTER TABLE schedules ADD COLUMN failure_told_at INTEGER`,
    `CREATE TABLE schedule_runs (
       fire_id TEXT PRIMARY KEY,
       schedule_id TEXT NOT NULL,
       first_fire_id TEXT NOT NULL,
       attempt INTEGER NOT NULL,
       due_at INTEGER NOT NULL,
       handed INTEGER NOT NULL DEFAULT 0,
       outcome TEXT,
       started INTEGER,
       on_purpose INTEGER,
       device_id TEXT,
       error TEXT,
       created_at INTEGER NOT NULL,
       settled_at INTEGER
     )`,
    `CREATE INDEX schedule_runs_created ON schedule_runs (created_at)`,
  ],
};

export const SCHEDULES_CLOUD_RUNS_MIGRATION = {
  id: "schedules.12-cloud-runs",
  statements: [
    `ALTER TABLE schedule_runs ADD COLUMN dispatch_id TEXT`,
    `ALTER TABLE schedule_runs ADD COLUMN cloud_turn_id TEXT`,
    `ALTER TABLE schedule_runs ADD COLUMN cloud_thread_id TEXT`,
    `ALTER TABLE schedule_runs ADD COLUMN done_at INTEGER`,
    `CREATE INDEX schedule_runs_dispatch ON schedule_runs (dispatch_id) WHERE dispatch_id IS NOT NULL`,
    `CREATE INDEX schedule_runs_cloud_turn ON schedule_runs (cloud_turn_id) WHERE cloud_turn_id IS NOT NULL`,
    `CREATE INDEX schedule_runs_cloud_thread ON schedule_runs (cloud_thread_id) WHERE cloud_thread_id IS NOT NULL`,
  ],
};

type Row = {
  schedule_id: string;
  kind: string;
  route: string;
  target_thread_id: string | null;
  once: number;
  script: string | null;
  state_json: string | null;
  pending_finding: string | null;
  last_check_at: number | null;
  last_finding: string | null;
  failing_since: number | null;
  repair_sent_at: number | null;
  waiting_since: number | null;
  created_by_thread_id: string | null;
  retry_of: string | null;
  retry_attempt: number | null;
  failure_told_at: number | null;
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
  run_state: string;
  fire_started_at: number | null;
  created_at: number;
  updated_at: number;
};

type RunState =
  | { kind: "armed"; retryFireId: string | null }
  | { kind: "firing"; fireId: string; startedAt: number };

const FIRE_LEASE_MS = 5 * 60_000;

const runStateOf = (row: Pick<Row, "run_state" | "active_fire_id" | "fire_started_at">): RunState =>
  row.run_state === "firing" && row.active_fire_id
    ? { kind: "firing", fireId: row.active_fire_id, startedAt: row.fire_started_at ?? 0 }
    : { kind: "armed", retryFireId: row.active_fire_id };

const sameRun = (a: RunState, b: RunState): boolean =>
  a.kind === "firing"
    ? b.kind === "firing" && a.fireId === b.fireId && a.startedAt === b.startedAt
    : b.kind === "armed" && a.retryFireId === b.retryFireId;

const transitionRun = (
  ctx: OwnerContext,
  scheduleId: string,
  from: RunState,
  to: RunState,
  fields: Partial<
    Pick<
      Row,
      | "status"
      | "next_run_at"
      | "last_run_at"
      | "last_error"
      | "last_error_at"
      | "failure_count"
      | "waiting_since"
      | "failure_told_at"
    >
  > = {},
): boolean => {
  const current = readRow(ctx.db, scheduleId);
  if (!current || !sameRun(runStateOf(current), from)) return false;
  const entries = Object.entries(fields);
  ctx.db.run(
    `UPDATE schedules SET run_state = ?, active_fire_id = ?, fire_started_at = ?,
            ${entries.map(([column]) => `${column} = ?, `).join("")}updated_at = ?
      WHERE schedule_id = ? AND run_state = ? AND active_fire_id IS ?`,
    to.kind,
    to.kind === "firing" ? to.fireId : to.retryFireId,
    to.kind === "firing" ? to.startedAt : null,
    ...entries.map(([, value]) => value as string | number | null),
    ctx.now,
    scheduleId,
    current.run_state,
    current.active_fire_id,
  );
  arm(ctx, scheduleId);
  return true;
};

const toScheduleKind = (value: string): ScheduleKind =>
  value === "reminder" || value === "watch" ? value : "task";

const toRoute = (value: string): ScheduleRoute => (value === "agent" ? "agent" : "orchestrator");

const toScheduleRow = (row: Row, ownerZone?: string, computerOnly = false): ScheduleRow => ({
  scheduleId: row.schedule_id,
  kind: toScheduleKind(row.kind),
  route: toRoute(row.route),
  ...(row.target_thread_id ? { targetThreadId: row.target_thread_id } : {}),
  ...(row.once ? { once: true } : {}),
  ...(row.last_check_at !== null ? { lastCheckAt: row.last_check_at } : {}),
  ...(row.last_finding ? { lastFinding: row.last_finding } : {}),
  ...(row.conversation_id ? { conversationId: row.conversation_id } : {}),
  ...(row.target_device_id ? { targetDeviceId: row.target_device_id } : {}),
  prompt: row.prompt,
  schedule: row.schedule_json,
  ...zoneField(row.schedule_json, ownerZone),
  nextRunAt: row.next_run_at,
  ...(row.last_run_at !== null ? { lastRunAt: row.last_run_at } : {}),
  status: row.status as ScheduleStatus,
  description: row.description,
  ...(row.last_error ? { lastError: row.last_error } : {}),
  ...(row.last_error_at !== null ? { lastErrorAt: row.last_error_at } : {}),
  ...(computerOnly ? { computerOnly: true as const } : {}),
  ...(row.waiting_since !== null ? { waitingSince: row.waiting_since } : {}),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const zoneField = (scheduleJson: string, ownerZone?: string): { zone?: string } => {
  try {
    const parsed = JSON.parse(scheduleJson) as { kind?: unknown; tz?: unknown };
    if (parsed.kind !== "cron") return {};
    const zone = typeof parsed.tz === "string" && parsed.tz.trim() ? parsed.tz.trim() : ownerZone;
    return zone ? { zone } : {};
  } catch {
    return {};
  }
};

const readRow = (db: OwnerDbReader, scheduleId: string): Row | null =>
  db.one<Row>("SELECT * FROM schedules WHERE schedule_id = ?", scheduleId);

const noticeCardOf = (row: Row, action: ScheduleNoticeAction, zone?: string): ScheduleNoticeCard => {
  const kind = toScheduleKind(row.kind);
  let schedule: LocalCronSchedule | undefined;
  try {
    schedule = JSON.parse(row.schedule_json) as LocalCronSchedule;
  } catch {
    schedule = undefined;
  }
  const message = kind === "reminder" && row.prompt.trim() !== row.description.trim() ? row.prompt.trim() : "";
  const { zone: scheduleZone } = zoneField(row.schedule_json, zone);
  return {
    type: SCHEDULE_NOTICE_CARD_TYPE,
    action,
    scheduleId: row.schedule_id,
    kind,
    name: row.description,
    ...(schedule ? { schedule } : {}),
    ...(scheduleZone ? { zone: scheduleZone } : {}),
    ...(action !== "removed" && action !== "waiting" && row.status === "active" ? { nextRunAt: row.next_run_at } : {}),
    ...(message
      ? {
          message:
            message.length > SCHEDULE_NOTICE_MESSAGE_MAX_CHARS
              ? `${message.slice(0, SCHEDULE_NOTICE_MESSAGE_MAX_CHARS - 1)}…`
              : message,
        }
      : {}),
    ...(kind !== "reminder" && row.target_thread_id ? { threadId: row.target_thread_id } : {}),
  };
};

const queueNotice = (ctx: OwnerContext, row: Row, action: ScheduleNoticeAction): void => {
  const conversationId = row.conversation_id;
  if (!conversationId || conversationId.startsWith("local_")) return;
  const stamp = ctx.now.toString(36);
  ctx.jobs.schedule(
    SCHEDULE_NOTICE_JOB,
    ctx.now,
    {
      conversationId,
      sourceTurnId: `schedule:${row.schedule_id}:${action}:${stamp}`,
      card: noticeCardOf(row, action, ownerZone(ctx.db)),
    },
    { id: `schedule-notice:${row.schedule_id}:${action}:${stamp}` },
  );
};

const noticePayload = object({
  conversationId: string({ max: 128 }),
  sourceTurnId: string({ max: 256 }),
  card: json({ maxBytes: 16 * 1024 }),
});

const postNotice = async (ctx: OwnerContext, payload: unknown): Promise<void> => {
  const { conversationId, sourceTurnId, card: raw } = noticePayload(payload);
  const card = parseScheduleNoticeCard(raw);
  if (!card) return;
  const live = ctx.db.one<{ conversation_id: string }>(
    "SELECT conversation_id FROM conversations WHERE conversation_id = ? AND deleted_at IS NULL",
    conversationId,
  );
  if (!live) return;
  const snapshot = await ctx.host.snapshot();
  if (!snapshot.writable) return;
  const posted = await ctx.host.postConversationCard({
    conversationId,
    ownerGeneration: snapshot.ownerGeneration,
    sourceTurnId,
    card,
  });
  if (!posted) throw new Error("The schedule notice could not be posted yet.");
};

const computerOnly = (ctx: { db: OwnerDbReader; env: Cloudflare.Env; now: number }): boolean =>
  !cloudSandboxAccess(ctx).enabled;

const listRows = (ctx: { db: OwnerDbReader; env: Cloudflare.Env; now: number }): ScheduleRow[] => {
  const { db } = ctx;
  const { zone } = readZone(db);
  const onComputer = computerOnly(ctx);
  return db
    .all<Row>(
      `SELECT * FROM schedules WHERE status IN ('active', 'paused')
        ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, next_run_at
        LIMIT ?`,
      MAX_SCHEDULES * 2,
    )
    .map((row) => toScheduleRow(row, zone, onComputer));
};

const bad = (message: string): never => {
  throw new RpcError("BAD_REQUEST", message);
};

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

const readZone = (db: OwnerDbReader): ScheduleZone => {
  const row = db.one<{ zone: string | null; source: string | null; phone_reported_at: number | null }>(
    "SELECT zone, source, phone_reported_at FROM schedule_zone WHERE id = 1",
  );
  return {
    ...(row?.zone ? { zone: row.zone } : {}),
    ...(row?.source === "phone" || row?.source === "computer" ? { source: row.source } : {}),
    ...(row?.phone_reported_at != null ? { phoneReportedAt: row.phone_reported_at } : {}),
  };
};

export const ownerZone = (db: OwnerDbReader): string | undefined => readZone(db).zone;

export const snapshotTimeZone = (db: OwnerDbReader): { timeZone?: string } => {
  const zone = ownerZone(db);
  return zone ? { timeZone: zone } : {};
};

const followingOwner = (db: OwnerDbReader, schedule: LocalCronSchedule): LocalCronSchedule => {
  if (schedule.kind !== "cron" || !schedule.tz) return schedule;
  return schedule.tz === readZone(db).zone ? { kind: "cron", expr: schedule.expr } : schedule;
};

const zoneArgs = object({
  timeZone: string({ max: 64 }),
  source: literal("phone", "computer"),
});

const reportZone = (
  ctx: OwnerContext,
  input: { timeZone: string; source: ScheduleZoneSource },
): ScheduleZone => {
  const timeZone = input.timeZone.trim();
  if (!timeZone || !isUsableTimeZone(timeZone)) bad(`"${input.timeZone}" is not a time zone Stella knows.`);
  const current = readZone(ctx.db);
  const phoneReportedAt = input.source === "phone" ? ctx.now : (current.phoneReportedAt ?? null);
  const decides = zoneReportDecides(current, input.source, ctx.now);
  const zone = decides ? timeZone : (current.zone ?? timeZone);
  const source = decides ? input.source : (current.source ?? input.source);
  ctx.db.run(
    `INSERT INTO schedule_zone (id, zone, answered, source, phone_reported_at, updated_at) VALUES (1, ?, NULL, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET zone = excluded.zone, source = excluded.source,
       phone_reported_at = excluded.phone_reported_at, updated_at = excluded.updated_at`,
    zone,
    source,
    phoneReportedAt,
    ctx.now,
  );
  retimeFollowing(ctx, zone);
  return readZone(ctx.db);
};

const retimeFollowing = (ctx: OwnerContext, zone: string): void => {
  const rows = ctx.db.all<Row>("SELECT * FROM schedules WHERE status = 'active'");
  for (const row of rows) {
    let schedule: LocalCronSchedule;
    try {
      schedule = parseStored(row.schedule_json);
    } catch {
      continue;
    }
    if (schedule.kind !== "cron" || schedule.tz || row.active_fire_id || row.next_run_at <= ctx.now) continue;
    let nextRunAt: number;
    try {
      nextRunAt = computeNextRunAt(schedule, ctx.now, zone);
    } catch {
      continue;
    }
    if (nextRunAt === row.next_run_at) continue;
    ctx.db.run(
      "UPDATE schedules SET next_run_at = ?, updated_at = ? WHERE schedule_id = ?",
      nextRunAt,
      ctx.now,
      row.schedule_id,
    );
    arm(ctx, row.schedule_id);
  }
};

const buildCron = (schedule: { expr: string; tz?: string }, zone?: string): Cron => {
  try {
    return new Cron(schedule.expr, { timezone: schedule.tz?.trim() || zone || undefined, catch: false });
  } catch {
    return bad(`"${schedule.expr}" is not a cron expression Stella can read.`);
  }
};

export const computeNextRunAt = (schedule: LocalCronSchedule, nowMs: number, zone?: string): number => {
  if (schedule.kind === "at") return Math.max(schedule.atMs, nowMs);
  if (schedule.kind === "every") {
    const everyMs = Math.max(1, Math.floor(schedule.everyMs));
    const anchor = Math.max(0, Math.floor(schedule.anchorMs ?? nowMs));
    if (nowMs < anchor) return anchor;
    return anchor + Math.max(1, Math.ceil((nowMs - anchor) / everyMs)) * everyMs;
  }
  const next = buildCron(schedule, zone).nextRun(new Date(nowMs));
  if (!next) return bad(`"${schedule.expr}" has no future run times. Pick a different schedule.`);
  return next.getTime();
};

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

const arm = (ctx: OwnerContext, scheduleId: string): void => {
  const row = readRow(ctx.db, scheduleId);
  const run = row ? runStateOf(row) : null;
  if (!row || !run || (run.kind === "armed" && row.status !== "active")) {
    ctx.jobs.cancel(scheduleJobId(scheduleId));
    return;
  }
  const fireId = run.kind === "firing" ? run.fireId : run.retryFireId;
  ctx.jobs.schedule(
    SCHEDULE_FIRE_JOB,
    run.kind === "firing" ? run.startedAt + FIRE_LEASE_MS : row.next_run_at,
    { scheduleId, ...(fireId ? { fireId } : {}) },
    { id: scheduleJobId(scheduleId) },
  );
};

type Action = "create" | "update" | "remove";

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

type CreateInput = {
  requestId: string;
  kind?: ScheduleKind;
  prompt: string;
  schedule: LocalCronSchedule;
  description?: string;
  conversationId?: string;
  targetDeviceId?: string;
  route?: ScheduleRoute;
  targetThreadId?: string;
  script?: string;
  once?: boolean;
  createdByThreadId?: string;
};

const targetThreadOf = (ctx: OwnerContext, kind: ScheduleKind, threadId: string | undefined): string | null => {
  const wanted = threadId?.trim();
  if (!wanted) return null;
  if (kind === "reminder") bad("A reminder goes to the user as written; a task or watch can target an agent thread.");
  const thread = scheduleTargetThread(ctx.db, wanted);
  if (!thread) {
    bad(`No agent has the thread_id ${wanted}. agent_status lists the agents you can reach.`);
  }
  return thread!.thread_id;
};

const createSchedule = async (
  ctx: OwnerContext,
  input: CreateInput,
): Promise<{ replayed: boolean; result: ScheduleRow & { check?: WatchCheckResult } }> => {
  const kind: ScheduleKind = input.kind ?? "task";
  const prompt = cleanPrompt(input.prompt);
  const schedule = followingOwner(ctx.db, normalizeSchedule(input.schedule));
  const description = cleanDescription(input.description, prompt);
  const conversationId = input.conversationId?.trim() || null;
  const targetDeviceId = kind === "reminder" ? null : input.targetDeviceId?.trim() || null;
  const route: ScheduleRoute = kind === "reminder" ? "orchestrator" : (input.route ?? "orchestrator");
  const script = kind === "watch" ? cleanScript(input.script) : null;
  const once = kind === "watch" && input.once === true;
  const requestId = input.requestId.trim();
  const targetThreadId = targetThreadOf(ctx, kind, input.targetThreadId);
  const createdBy = input.createdByThreadId?.trim() ?? "";
  const createdByThreadId =
    kind === "reminder" || !createdBy ? null : (scheduleTargetThread(ctx.db, createdBy)?.thread_id ?? createdBy);
  const intent = {
    kind,
    prompt,
    schedule,
    description,
    conversationId,
    targetDeviceId,
    route,
    script,
    once,
    ...(targetThreadId ? { targetThreadId } : {}),
  };
  const scheduleId = `sch-${crypto.randomUUID().slice(0, 18)}`;
  const replay = ctx.db.one<{ request_id: string }>(
    "SELECT request_id FROM schedule_receipts WHERE request_id = ?",
    requestId,
  );
  if (kind !== "reminder" && !targetDeviceId && !replay && computerOnly(ctx)) {
    const computers = await ctx.host.deviceDestinations();
    if (computers.length === 0) {
      bad(
        "On the Free plan, scheduled tasks and watches run on the user's computer, never in the cloud, and no computer has Stella set up yet. Once Stella is installed on a computer, set it up from there; a paid plan runs them in the cloud. Reminders work without a computer.",
      );
    }
  }
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
        target_thread_id: targetThreadId,
        once: once ? 1 : 0,
        script,
        state_json: first?.stateJson ?? null,
        pending_finding: null,
        last_check_at: first ? ctx.now : null,
        last_finding: first?.check.ok && first.check.found ? first.check.found : null,
        failing_since: null,
        repair_sent_at: null,
        waiting_since: null,
        created_by_thread_id: createdByThreadId,
        retry_of: null,
        retry_attempt: null,
        failure_told_at: null,
        conversation_id: conversationId,
        target_device_id: targetDeviceId,
        prompt,
        schedule_json: JSON.stringify(schedule),
        next_run_at: computeNextRunAt(schedule, ctx.now, ownerZone(ctx.db)),
        last_run_at: null,
        status: "active",
        description,
        last_error: null,
        last_error_at: null,
        failure_count: 0,
        active_fire_id: null,
        run_state: "armed",
        fire_started_at: null,
        created_at: ctx.now,
        updated_at: ctx.now,
      };
      const columns = Object.keys(row) as (keyof Row)[];
      ctx.db.run(
        `INSERT INTO schedules (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
        ...columns.map((column) => row[column]),
      );
      arm(ctx, row.schedule_id);
      queueNotice(ctx, row, "created");
      return {
        ...toScheduleRow(row, ownerZone(ctx.db), computerOnly(ctx)),
        ...(first ? { check: first.check } : {}),
      };
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
  targetThreadId?: string;
  script?: string;
  once?: boolean;
};

const updateSchedule = async (
  ctx: OwnerContext,
  input: UpdateInput,
): Promise<{ replayed: boolean; result: ScheduleRow & { check?: WatchCheckResult } }> => {
  const prompt = input.prompt === undefined ? undefined : cleanPrompt(input.prompt);
  const schedule = input.schedule === undefined ? undefined : followingOwner(ctx.db, normalizeSchedule(input.schedule));
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
  const targetThreadId =
    input.targetThreadId === undefined || !existing || replay
      ? input.targetThreadId?.trim()
      : (targetThreadOf(ctx, toScheduleKind(existing.kind), input.targetThreadId) ?? undefined);
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
      ...(targetThreadId ? { targetThreadId } : {}),
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
        nextRunAt = computeNextRunAt(schedule, ctx.now, ownerZone(ctx.db));
      }
      const ran = row.status === "done";
      if (ran && input.status !== undefined && !schedule) {
        bad("This one already ran. Give it a new time to run it again.");
      }
      const status = input.status ?? (ran && schedule ? "active" : row.status);
      if (status === "active" && row.status === "paused") {
        nextRunAt = computeNextRunAt(parseStored(scheduleJson), ctx.now, ownerZone(ctx.db));
      }
      const next: Row = {
        ...row,
        prompt: nextPrompt,
        schedule_json: scheduleJson,
        next_run_at: nextRunAt,
        status,
        description:
          input.description === undefined ? row.description : cleanDescription(input.description, nextPrompt),
        route: kind === "reminder" ? row.route : (input.route ?? row.route),
        target_thread_id:
          kind === "reminder"
            ? null
            : targetThreadId
              ? targetThreadId
              : input.route !== undefined
                ? null
                : row.target_thread_id,
        once: kind === "watch" && input.once !== undefined ? (input.once ? 1 : 0) : row.once,
        waiting_since: schedule || input.status === "paused" ? null : row.waiting_since,
        ...(first
          ? {
              script: script ?? row.script,
              state_json: first.stateJson,
              pending_finding: null,
              last_check_at: ctx.now,
              last_finding: first.check.ok && first.check.found ? first.check.found : null,
              failing_since: null,
              repair_sent_at: null,
              last_error: null,
              last_error_at: null,
            }
          : {}),
        updated_at: ctx.now,
      };
      ctx.db.run(
        `UPDATE schedules SET prompt = ?, schedule_json = ?, next_run_at = ?, status = ?,
                description = ?, route = ?, target_thread_id = ?, once = ?, script = ?, state_json = ?, pending_finding = ?,
                last_check_at = ?, last_finding = ?, failing_since = ?, repair_sent_at = ?, last_error = ?,
                last_error_at = ?, waiting_since = ?, updated_at = ? WHERE schedule_id = ?`,
        next.prompt,
        next.schedule_json,
        next.next_run_at,
        next.status,
        next.description,
        next.route,
        next.target_thread_id,
        next.once,
        next.script,
        next.state_json,
        next.pending_finding,
        next.last_check_at,
        next.last_finding,
        next.failing_since,
        next.repair_sent_at,
        next.last_error,
        next.last_error_at,
        next.waiting_since,
        next.updated_at,
        next.schedule_id,
      );
      if (next.status !== row.status || next.next_run_at !== row.next_run_at) arm(ctx, next.schedule_id);
      const edited =
        next.prompt !== row.prompt ||
        next.schedule_json !== row.schedule_json ||
        next.description !== row.description ||
        next.route !== row.route ||
        next.target_thread_id !== row.target_thread_id ||
        next.once !== row.once ||
        next.script !== row.script;
      if (edited) queueNotice(ctx, next, "updated");
      else if (next.status !== row.status) queueNotice(ctx, next, next.status === "active" ? "resumed" : "paused");
      if (row.status === "active" && row.target_thread_id && (next.status !== "active" || next.target_thread_id !== row.target_thread_id)) {
        tellWaitingScheduleGone(ctx, {
          threadId: row.target_thread_id,
          name: row.description || row.prompt,
          change: next.status !== "active" ? "paused" : "removed",
          key: `${row.schedule_id}:${ctx.now}`,
        });
      }
      return {
        ...toScheduleRow(next, ownerZone(ctx.db), computerOnly(ctx)),
        ...(first ? { check: first.check } : {}),
      };
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
      queueNotice(ctx, row, "removed");
      if (row.status === "active" && row.target_thread_id) {
        tellWaitingScheduleGone(ctx, {
          threadId: row.target_thread_id,
          name: row.description || row.prompt,
          change: "removed",
          key: `${row.schedule_id}:${ctx.now}`,
        });
      }
      return { removed: true };
    },
  );

const runNow = (ctx: OwnerContext, scheduleId: string): null => {
  const row = readRow(ctx.db, scheduleId);
  if (!row || row.status !== "active") {
    throw new RpcError("NOT_FOUND", `No active schedule with id ${scheduleId}.`);
  }
  if (runStateOf(row).kind === "firing") throw new RpcError("CONFLICT", "It's running right now.");
  ctx.db.run(
    "UPDATE schedules SET next_run_at = ?, updated_at = ? WHERE schedule_id = ?",
    ctx.now,
    ctx.now,
    scheduleId,
  );
  arm(ctx, scheduleId);
  return null;
};

const toolParser = object({
  action: literal("list", "create", "update", "remove"),
  kind: optional(literal("reminder", "task", "watch")),
  route: optional(literal("orchestrator", "agent")),
  targetThreadId: optional(string({ max: 128, pattern: ID_PATTERN })),
  script: optional(string({ max: WATCH_SCRIPT_MAX_CHARS + 1_000 })),
  once: optional(boolean()),
  requestId: optional(string({ max: 128 })),
  scheduleId: optional(string({ max: 128, pattern: ID_PATTERN })),
  prompt: optional(string({ max: MAX_PROMPT_CHARS * 2 })),
  description: optional(string({ max: 1_000 })),
  conversationId: optional(string({ max: 128 })),
  status: optional(literal("active", "paused")),
  schedule: optional(scheduleParser),
  createdByThreadId: optional(string({ max: 128, pattern: ID_PATTERN })),
});

const scheduleTool = async (ctx: OwnerContext, raw: unknown): Promise<ScheduleToolResult> => {
  const args = toolParser(raw);
  const list = (): ScheduleRow[] => listRows(ctx);
  if (args.action === "list") return { ok: true, replayed: false, schedules: list() };
  if (!args.requestId) bad("requestId is required for schedule changes.");
  const requestId = args.requestId!;
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
        ...(args.targetThreadId !== undefined ? { targetThreadId: args.targetThreadId } : {}),
        ...(args.script !== undefined ? { script: args.script } : {}),
        ...(args.once !== undefined ? { once: args.once } : {}),
        ...(args.createdByThreadId ? { createdByThreadId: args.createdByThreadId } : {}),
      },
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
        ...(args.targetThreadId !== undefined ? { targetThreadId: args.targetThreadId } : {}),
        ...(args.script !== undefined ? { script: args.script } : {}),
        ...(args.once !== undefined ? { once: args.once } : {}),
      },
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
      `SELECT * FROM reminder_fires WHERE fired_at >= ? OR (state = 'snoozed' AND snoozed_until >= ?)
        ORDER BY fired_at DESC LIMIT ?`,
      now - REMINDER_LIST_MS,
      now,
      REMINDER_LIST_LIMIT,
    )
    .map(toReminderFire);

const recordFire = (
  ctx: OwnerContext,
  fire: { fireId: string; scheduleId: string; conversationId: string | null; text: string; dueAt?: number },
): FireRow => {
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
    "DELETE FROM reminder_fires WHERE fired_at < ? AND (state != 'snoozed' OR snoozed_until < ?)",
    ctx.now - REMINDER_KEEP_MS,
    ctx.now,
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
  let row = readFire(ctx.db, fireId);
  while (row?.state === "snoozed" && row.snoozed_until !== null && row.snoozed_until <= ctx.now) {
    const returned = readFire(ctx.db, returnedFireId(row));
    if (!returned) break;
    row = returned;
    fireId = returned.fire_id;
  }
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

const returnedFireId = (snoozed: FireRow): string =>
  `${snoozed.fire_id.slice(0, 64)}.${(snoozed.snoozed_until ?? 0).toString(36)}`;

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
    fireId: returnedFireId(old),
    scheduleId: old.schedule_id,
    conversationId: old.conversation_id,
    text: old.text,
  });
  if (!(await deliverReminder(ctx, snapshot.ownerGeneration, fresh))) {
    throw new Error("The snoozed reminder could not be delivered yet.");
  }
};

const firePayload = object({
  scheduleId: string({ max: 128 }),
  fireId: optional(string({ max: 64 })),
});

const dailyFires = (ctx: OwnerContext): { plan: string; count: number } => {
  const access = billingAccess(ctx);
  return {
    plan: access.plan,
    count: access.unlimited ? UNLIMITED_DAILY_FIRES : PLAN_CATALOG[access.plan].limits.scheduleFiresPerDay,
  };
};



type FireOutcome = {
  error?: string;
  retry?: { sameFire: boolean };
  pause?: boolean;
  last?: boolean;
  quiet?: boolean;
  tracked?: boolean;
};

const finishFire = (ctx: OwnerContext, scheduleId: string, fireId: string, outcome: FireOutcome): void => {
  const row = readRow(ctx.db, scheduleId);
  if (!row) return;
  const run = runStateOf(row);
  if (run.kind !== "firing" || run.fireId !== fireId) return;
  let upcoming = row.next_run_at;
  let last = Boolean(outcome.last);
  let error = outcome.error;
  let pause = Boolean(outcome.pause);
  try {
    const schedule = parseStored(row.schedule_json);
    last ||= schedule.kind === "at";
    if (!last) upcoming = computeNextRunAt(schedule, ctx.now + 1_000, ownerZone(ctx.db));
  } catch (parseError) {
    error ??= parseError instanceof Error ? parseError.message : String(parseError);
    pause = true;
  }
  const armed = (retryFireId: string | null): RunState => ({ kind: "armed", retryFireId });
  if (!error) {
    transitionRun(ctx, scheduleId, run, armed(null), {
      status: last ? "done" : row.status,
      next_run_at: upcoming,
      last_error: null,
      last_error_at: null,
      failure_count: 0,
      waiting_since: null,
      ...(outcome.tracked ? {} : { failure_told_at: null }),
    });
    return;
  }
  const failureCount = row.failure_count + 1;
  const retryAt = ctx.now + FIRE_RETRY_DELAY_MS;
  const retry =
    !pause && outcome.retry !== undefined && failureCount <= MAX_FIRE_RETRIES && (last || retryAt < upcoming);
  const moved = transitionRun(ctx, scheduleId, run, armed(retry && outcome.retry?.sameFire ? fireId : null), {
    status: pause ? "paused" : retry || !last ? row.status : "done",
    next_run_at: retry ? retryAt : upcoming,
    last_error: error.slice(0, MAX_ERROR_CHARS),
    last_error_at: ctx.now,
    failure_count: failureCount,
  });
  if (moved && !retry && !outcome.quiet) {
    tellRunFailed(ctx, scheduleId, {
      fireId,
      error,
      attempts: failureCount,
      after: pause ? "paused" : last ? "ended" : "continues",
    });
  }
};

const RUN_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;
const RUN_RECORD_TTL_MS = 7 * DAY_MS;
const RUN_RECORD_MAX_MS = 30 * DAY_MS;
const CLOUD_RUN_CHECK_MS = 12 * 60 * 60_000;
export const SCHEDULE_FAILED_JOB = "schedules.tellFailed";
const SCHEDULE_SETTLE_JOB = "schedules.settleRun";
const SCHEDULE_CHECK_RUN_JOB = "schedules.checkRun";

type RunRecord = {
  fire_id: string;
  schedule_id: string;
  first_fire_id: string;
  attempt: number;
  due_at: number;
  handed: number;
  outcome: string | null;
  started: number | null;
  on_purpose: number | null;
  device_id: string | null;
  error: string | null;
  created_at: number;
  settled_at: number | null;
  dispatch_id: string | null;
  cloud_turn_id: string | null;
  cloud_thread_id: string | null;
  done_at: number | null;
};

const readRun = (db: OwnerDbReader, fireId: string): RunRecord | null =>
  db.one<RunRecord>("SELECT * FROM schedule_runs WHERE fire_id = ?", fireId);

const recordRun = (ctx: OwnerContext, row: Row, fireId: string): void => {
  ctx.db.run(
    "DELETE FROM schedule_runs WHERE (done_at IS NOT NULL AND created_at < ?) OR created_at < ?",
    ctx.now - RUN_RECORD_TTL_MS,
    ctx.now - RUN_RECORD_MAX_MS,
  );
  ctx.db.run(
    `INSERT INTO schedule_runs (fire_id, schedule_id, first_fire_id, attempt, due_at, handed, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?) ON CONFLICT (fire_id) DO NOTHING`,
    fireId,
    row.schedule_id,
    row.retry_of ?? fireId,
    row.retry_attempt ?? 1,
    row.waiting_since ?? row.next_run_at,
    ctx.now,
  );
};

const runHandedOver = (ctx: OwnerContext, fireId: string, started: ScheduledTurnStarted): void => {
  ctx.db.run(
    `UPDATE schedule_runs SET handed = 1,
       dispatch_id = COALESCE(dispatch_id, ?),
       cloud_turn_id = COALESCE(cloud_turn_id, ?),
       cloud_thread_id = COALESCE(cloud_thread_id, ?)
     WHERE fire_id = ?`,
    started.dispatchId ?? null,
    started.cloudTurnId ?? null,
    started.agentThreadId ?? null,
    fireId,
  );
  if (started.cloudTurnId) {
    ctx.jobs.schedule(SCHEDULE_CHECK_RUN_JOB, ctx.now + CLOUD_RUN_CHECK_MS, { fireId }, { id: checkRunJobId(fireId) });
  }
  const run = readRun(ctx.db, fireId);
  if (run?.outcome) settleRun(ctx, run);
};

const checkRunJobId = (fireId: string): string => `schedule-check:${fireId}`;

const runNotHandedOver = (ctx: OwnerContext, fireId: string): void => {
  ctx.db.run("DELETE FROM schedule_runs WHERE fire_id = ? AND handed = 0", fireId);
};

const runSettledArgs = object({
  clientMsgId: string({ max: 256 }),
  state: string({ max: 64 }),
  started: boolean(),
  onPurpose: optional(boolean()),
  deviceId: optional(string({ max: 256 })),
  errorCode: optional(string({ max: 256 })),
  errorMessage: optional(string({ max: 4_000 })),
});

const runSettled = (ctx: OwnerContext, raw: unknown): { known: boolean } => {
  const args = runSettledArgs(raw);
  const fireId = args.clientMsgId.startsWith("schedule:") ? args.clientMsgId.slice("schedule:".length) : "";
  const run = fireId ? readRun(ctx.db, fireId) : null;
  if (!run) {
    log("info", "schedule_run_settled_unknown", { clientMsgId: args.clientMsgId, state: args.state });
    return { known: false };
  }
  if (run.outcome !== null) return { known: true };
  const error =
    args.state === "completed"
      ? null
      : (args.errorMessage?.trim() || args.errorCode?.trim() || `It ended ${args.state}.`).slice(0, 2_000);
  ctx.db.run(
    `UPDATE schedule_runs SET outcome = ?, started = ?, on_purpose = ?, device_id = ?, error = ?, settled_at = ?
      WHERE fire_id = ? AND outcome IS NULL`,
    args.state,
    args.started ? 1 : 0,
    args.onPurpose ? 1 : 0,
    args.deviceId ?? null,
    error,
    ctx.now,
    fireId,
  );
  const settled = readRun(ctx.db, fireId);
  if (settled?.handed) settleRun(ctx, settled);
  return { known: true };
};

const SCHEDULE_TURN_KEY = /^(?:pia:)?schedule:(.+)$/u;

const queueSettle = (db: OwnerDb, fireId: string, now: number): void => {
  db.run(
    `INSERT INTO owner_jobs (id, kind, run_at, payload, attempts) VALUES (?, ?, ?, ?, 0)
     ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, run_at = excluded.run_at,
       payload = excluded.payload, attempts = 0`,
    `schedule-settle:${fireId}`,
    SCHEDULE_SETTLE_JOB,
    Math.max(0, Math.floor(now)),
    JSON.stringify({ fireId }),
  );
};

const noteRunOutcome = (
  db: OwnerDb,
  fireId: string,
  end: { outcome: string; started: boolean; onPurpose?: boolean; error?: string | null },
  now: number,
): void => {
  const error =
    end.outcome === "completed" ? null : (end.error?.trim() || `It ended ${end.outcome}.`).slice(0, 2_000);
  db.run(
    `UPDATE schedule_runs SET outcome = ?, started = ?, on_purpose = ?, error = ?, settled_at = ?
      WHERE fire_id = ? AND outcome IS NULL`,
    end.outcome,
    end.started ? 1 : 0,
    end.onPurpose ? 1 : 0,
    error,
    now,
    fireId,
  );
  queueSettle(db, fireId, now);
};

export const followScheduledRuns = (
  ctx: Pick<OwnerContext, "db" | "now">,
  events: readonly OwnerEvent[],
): void => {
  for (const event of events) {
    if (event.kind === "turn.started") {
      const clientMsgId = event.clientMsgId ?? "";
      const fireId = SCHEDULE_TURN_KEY.exec(clientMsgId)?.[1] ?? "";
      ctx.db.run(
        `UPDATE schedule_runs SET cloud_turn_id = ?
          WHERE (fire_id = ? OR dispatch_id = ?) AND cloud_turn_id IS NULL AND outcome IS NULL`,
        event.turnId,
        fireId,
        clientMsgId,
      );
      continue;
    }
    if (event.kind !== "turn.event" || !event.terminal || !event.terminalStatus) continue;
    const run = ctx.db.one<RunRecord>(
      "SELECT * FROM schedule_runs WHERE cloud_turn_id = ? AND outcome IS NULL",
      event.turnId,
    );
    if (!run) continue;
    const status = event.terminalStatus;
    if (run.cloud_thread_id) {
      if (status === "completed" || status === "waiting_for_user") continue;
      const agent = ctx.db.one<{ status: string }>(
        "SELECT status FROM agent_threads WHERE thread_id = ?",
        run.cloud_thread_id,
      );
      if (agent) continue;
      noteRunOutcome(
        ctx.db,
        run.fire_id,
        { outcome: status, started: false, error: event.errorMessage ?? null },
        ctx.now,
      );
      continue;
    }
    noteRunOutcome(
      ctx.db,
      run.fire_id,
      {
        outcome: status === "waiting_for_user" ? "completed" : status,
        started: event.began !== false,
        error: event.errorMessage ?? null,
      },
      ctx.now,
    );
  }
};

const AGENT_ENDED = new Set(["completed", "failed", "canceled"]);

agentChangeHooks.push((db, threadId, now) => {
  const run = db.one<{ fire_id: string }>(
    "SELECT fire_id FROM schedule_runs WHERE cloud_thread_id = ? AND outcome IS NULL",
    threadId,
  );
  if (!run) return;
  const thread = db.one<{ status: string; error_message: string | null }>(
    "SELECT status, error_message FROM agent_threads WHERE thread_id = ?",
    threadId,
  );
  if (!thread || !AGENT_ENDED.has(thread.status)) return;
  noteRunOutcome(
    db,
    run.fire_id,
    {
      outcome: thread.status,
      started: true,
      onPurpose: thread.status === "canceled" && isAgentStopReason(thread.error_message),
      error: thread.error_message,
    },
    now,
  );
});

const fireIdPayload = object({ fireId: string({ max: 128 }) });

const settleQueued = (ctx: OwnerContext, payload: unknown): void => {
  const run = readRun(ctx.db, fireIdPayload(payload).fireId);
  if (run?.handed) settleRun(ctx, run);
};

const checkRun = (ctx: OwnerContext, payload: unknown): void => {
  const { fireId } = fireIdPayload(payload);
  const run = readRun(ctx.db, fireId);
  if (!run || run.outcome !== null) return;
  if (run.cloud_thread_id) {
    const agent = ctx.db.one<{ status: string }>(
      "SELECT status FROM agent_threads WHERE thread_id = ?",
      run.cloud_thread_id,
    );
    if (agent && !AGENT_ENDED.has(agent.status) && ctx.now - run.created_at < RUN_RECORD_MAX_MS) {
      ctx.jobs.schedule(SCHEDULE_CHECK_RUN_JOB, ctx.now + CLOUD_RUN_CHECK_MS, { fireId }, { id: checkRunJobId(fireId) });
      return;
    }
  }
  log("error", "schedule_run_unheard", { scheduleId: run.schedule_id, fireId, cloudTurnId: run.cloud_turn_id });
  noteRunOutcome(
    ctx.db,
    fireId,
    { outcome: "failed", started: true, error: "No word came back on how it ended" },
    ctx.now,
  );
};

const settleRun = (ctx: OwnerContext, run: RunRecord): void => {
  if (run.done_at !== null || run.outcome === null) return;
  ctx.db.run("UPDATE schedule_runs SET done_at = ? WHERE fire_id = ? AND done_at IS NULL", ctx.now, run.fire_id);
  ctx.jobs.cancel(checkRunJobId(run.fire_id));
  const row = readRow(ctx.db, run.schedule_id);
  if (run.outcome === "completed") {
    if (row?.failure_told_at !== null && row?.failure_told_at !== undefined) {
      ctx.db.run("UPDATE schedules SET failure_told_at = NULL WHERE schedule_id = ?", run.schedule_id);
    }
    return;
  }
  if (run.outcome === "canceled" && run.on_purpose) return;
  const error = run.error ?? `It ended ${run.outcome ?? "without finishing"}.`;
  log("error", "schedule_run_failed", {
    scheduleId: run.schedule_id,
    fireId: run.fire_id,
    attempt: run.attempt,
    outcome: run.outcome,
    started: Boolean(run.started),
    error: error.slice(0, 300),
  });
  if (!row) return;
  ctx.db.run(
    "UPDATE schedules SET last_error = ?, last_error_at = ?, updated_at = ? WHERE schedule_id = ?",
    error.slice(0, MAX_ERROR_CHARS),
    ctx.now,
    ctx.now,
    row.schedule_id,
  );
  const stoppedInCloud = run.outcome === "canceled" && run.cloud_turn_id !== null;
  if (!run.started && !stoppedInCloud && retryRun(ctx, row, run)) return;
  let after: "ended" | "continues" | "paused" = "ended";
  try {
    after = row.status === "paused" ? "paused" : parseStored(row.schedule_json).kind === "at" ? "ended" : "continues";
  } catch {
    after = "ended";
  }
  tellRunFailed(ctx, row.schedule_id, {
    fireId: run.fire_id,
    error,
    started: Boolean(run.started),
    attempts: run.attempt,
    after,
    dueAt: run.due_at,
    ...(run.device_id ? { deviceId: run.device_id } : run.cloud_turn_id ? { inCloud: true } : {}),
  });
};

const retryRun = (ctx: OwnerContext, row: Row, run: RunRecord): boolean => {
  const delay = RUN_RETRY_DELAYS_MS[run.attempt - 1];
  if (delay === undefined) return false;
  const state = runStateOf(row);
  if (state.kind !== "armed" || state.retryFireId !== null) return false;
  let oneTime: boolean;
  try {
    oneTime = parseStored(row.schedule_json).kind === "at";
  } catch {
    return false;
  }
  const retryAt = ctx.now + delay;
  if (oneTime ? row.status !== "done" : row.status !== "active" || retryAt >= row.next_run_at) return false;
  ctx.db.run(
    `UPDATE schedules SET status = 'active', next_run_at = ?, retry_of = ?, retry_attempt = ?, updated_at = ?
      WHERE schedule_id = ? AND run_state = 'armed' AND active_fire_id IS NULL`,
    retryAt,
    run.first_fire_id,
    run.attempt + 1,
    ctx.now,
    row.schedule_id,
  );
  arm(ctx, row.schedule_id);
  log("info", "schedule_run_retry", {
    scheduleId: row.schedule_id,
    fireId: run.fire_id,
    attempt: run.attempt + 1,
    retryAt,
  });
  return true;
};

type FailedRun = {
  fireId: string;
  error: string;
  started?: boolean;
  attempts: number;
  after: "ended" | "continues" | "paused";
  dueAt?: number;
  deviceId?: string;
  inCloud?: boolean;
};

const tellRunFailed = (ctx: OwnerContext, scheduleId: string, failed: FailedRun): void => {
  const row = readRow(ctx.db, scheduleId);
  if (!row) return;
  if (failed.after === "continues" && row.failure_told_at !== null) return;
  ctx.db.run("UPDATE schedules SET failure_told_at = ? WHERE schedule_id = ?", ctx.now, scheduleId);
  ctx.jobs.schedule(
    SCHEDULE_FAILED_JOB,
    ctx.now,
    { scheduleId, ...failed, error: failed.error.slice(0, 2_000) },
    { id: `schedule-failed:${failed.fireId}` },
  );
};

const failedPayload = object({
  scheduleId: string({ max: 128 }),
  fireId: string({ max: 128 }),
  error: string({ max: 4_000 }),
  started: optional(boolean()),
  attempts: number({ min: 1, max: 1_000 }),
  after: literal("ended", "continues", "paused"),
  dueAt: optional(number({ min: 0 })),
  deviceId: optional(string({ max: 256 })),
  inCloud: optional(boolean()),
});

const isoMinute = (ms: number): string => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;

const tellFailed = async (ctx: OwnerContext, payload: unknown): Promise<void> => {
  const failed = failedPayload(payload);
  const row = readRow(ctx.db, failed.scheduleId);
  if (!row) return;
  const snapshot = await ctx.host.snapshot();
  const kind = toScheduleKind(row.kind);
  let where = "";
  if (failed.deviceId) {
    const devices = await ctx.host.deviceDestinations().catch(() => []);
    const device = devices.find((candidate) => candidate.deviceId === failed.deviceId);
    where = ` on ${device?.label?.trim() || "the computer it was sent to"}`;
  } else if (failed.inCloud) {
    where = " in the cloud";
  }
  const error = failed.error.trim().replace(/\.$/u, "");
  const how =
    failed.started === true
      ? `It started${where} but ended before finishing (${error}); what it did before that is not known.`
      : failed.started === false
        ? `It never started${where}: ${error}.`
        : `Its run failed${where}: ${error}.`;
  const tries = failed.attempts > 1 ? ` It was tried ${failed.attempts} times.` : "";
  const after =
    failed.after === "paused"
      ? "The schedule is paused now."
      : failed.after === "continues"
        ? `The schedule stays on; its next run is at ${isoMinute(row.next_run_at)}.`
        : "It won't run again by itself.";
  const due = failed.dueAt ?? row.last_run_at ?? row.next_run_at;
  const what = kind === "reminder" ? "Its message" : "Its instructions";
  const creator =
    row.created_by_thread_id && kind !== "reminder" ? scheduleTargetThread(ctx.db, row.created_by_thread_id) : null;
  const reachable =
    creator && (creator.owner_generation === null || creator.owner_generation === snapshot.ownerGeneration)
      ? creator
      : null;
  const name = row.description.trim() || row.schedule_id;
  const label = kind === "reminder" ? "Reminder" : kind === "watch" ? "Watch" : "Scheduled task";
  const facts = [`It was due at ${isoMinute(due)}. ${how}${tries}`, after];
  const instructions = `${what}:\n${row.prompt}`;
  const from = `schedule:${row.schedule_id}`;
  const conversationId = row.conversation_id;
  if (conversationId && !conversationId.startsWith("local_")) {
    const live = ctx.db.one<{ conversation_id: string }>(
      "SELECT conversation_id FROM conversations WHERE conversation_id = ? AND deleted_at IS NULL",
      conversationId,
    );
    if (live) {
      queueStellaNote(ctx, {
        noteId: agentReportReceipt(`schedule-failed:${failed.fireId}`),
        conversationId,
        ownerGeneration: snapshot.ownerGeneration,
        fromThreadId: from,
        text: [
          `[${label} "${name}" didn't run] (${row.schedule_id})`,
          ...facts,
          reachable
            ? `The task that set it up (${reachable.thread_id}) was told too and handles it; it's yours only if that task can't.`
            : "Nobody else was told.",
          "",
          instructions,
        ].join("\n"),
      });
    }
  }
  if (reachable) {
    queueAgentNote(ctx, {
      noteId: agentReportReceipt(`schedule:failed:${failed.fireId}:by`),
      parentThreadId: reachable.thread_id,
      conversationId: reachable.conversation_id,
      ownerGeneration: snapshot.ownerGeneration,
      fromThreadId: from,
      text: [
        `[Your ${label.toLowerCase()} "${name}" didn't run] (${row.schedule_id})`,
        ...facts,
        "You set it up, so it's yours to handle; Stella was told too.",
        "",
        instructions,
      ].join("\n"),
    });
  }
};

const INTERRUPTED_RUN = "This run was cut off before it finished starting.";

const claimRun = (
  ctx: OwnerContext,
  row: Row,
  payloadFireId: string | undefined,
): { fireId: string; retrying: boolean } | null => {
  const run = runStateOf(row);
  if (run.kind === "firing") {
    if (run.startedAt + FIRE_LEASE_MS > ctx.now) {
      arm(ctx, row.schedule_id);
      return null;
    }
    log("error", "schedule_fire_interrupted", { scheduleId: row.schedule_id, fireId: run.fireId });
    if (row.status !== "active" || row.failure_count + 1 > MAX_FIRE_RETRIES) {
      finishFire(ctx, row.schedule_id, run.fireId, { error: INTERRUPTED_RUN });
      return null;
    }
    const resumed: RunState = { kind: "firing", fireId: run.fireId, startedAt: ctx.now };
    if (!transitionRun(ctx, row.schedule_id, run, resumed, { failure_count: row.failure_count + 1 })) return null;
    return { fireId: run.fireId, retrying: true };
  }
  if (row.status !== "active") return null;
  if (row.next_run_at > ctx.now) {
    arm(ctx, row.schedule_id);
    return null;
  }
  const retrying = payloadFireId !== undefined && payloadFireId === run.retryFireId;
  const fireId = retrying ? payloadFireId : crypto.randomUUID();
  const firing: RunState = { kind: "firing", fireId, startedAt: ctx.now };
  if (!transitionRun(ctx, row.schedule_id, run, firing, { last_run_at: ctx.now })) return null;
  return { fireId, retrying };
};

const fire = async (ctx: OwnerContext, payload: unknown): Promise<void> => {
  const { scheduleId, fireId: payloadFireId } = firePayload(payload);
  const snapshot = await ctx.host.snapshot();
  const row = readRow(ctx.db, scheduleId);
  if (!row) return;
  const claimed = claimRun(ctx, row, payloadFireId);
  if (!claimed) return;
  const { fireId, retrying } = claimed;
  try {
    await runFire(ctx, row, fireId, retrying, snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("error", "schedule_fire_failed", { scheduleId, fireId, message });
    finishFire(ctx, scheduleId, fireId, { error: message.slice(0, MAX_ERROR_CHARS), retry: { sameFire: true } });
  }
};

const runFire = async (
  ctx: OwnerContext,
  row: Row,
  fireId: string,
  retrying: boolean,
  snapshot: { writable: boolean; ownerGeneration: string },
): Promise<void> => {
  const scheduleId = row.schedule_id;
  if (!snapshot.writable) {
    finishFire(ctx, scheduleId, fireId, {
      error: "This run was skipped: your cloud account isn't accepting work right now.",
      quiet: true,
    });
    return;
  }
  if (toScheduleKind(row.kind) === "reminder") {
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
      delivered ? {} : { error: "The reminder could not be delivered everywhere yet.", retry: { sameFire: true } },
    );
    return;
  }
  if (toScheduleKind(row.kind) === "watch") {
    await fireWatch(ctx, row, fireId, retrying, snapshot.ownerGeneration);
    return;
  }
  const late = retrying ? "" : lateNote(row.waiting_since ?? row.next_run_at, ctx.now);
  let spent = retrying;
  let fallback = "";
  if (row.target_thread_id) {
    if (!spent && !spendRun(ctx, scheduleId, fireId)) return;
    spent = true;
    const sent = await sendToThread(ctx, row, fireId, snapshot.ownerGeneration, {
      kind: "task",
      prompt: row.prompt,
      ...(late ? { note: late.trim() } : {}),
    });
    if (sent.kind !== "fallback") {
      finishFire(ctx, scheduleId, fireId, sent.kind === "retry" ? { error: sent.error, retry: { sameFire: true } } : {});
      return;
    }
    fallback = `${sent.note}\n\n`;
  }
  const placement = await placementOf(ctx, row);
  if (placement.away) {
    await waitForComputer(ctx, row, fireId, placement.device);
    return;
  }
  if (!spent && !spendRun(ctx, scheduleId, fireId)) return;
  const started = await startRun(
    ctx,
    row,
    fireId,
    snapshot.ownerGeneration,
    {
      prompt: `${fallback}${row.prompt}${late}${retryNote(row)}`,
      ...(toRoute(row.route) === "agent" && !row.target_thread_id
        ? { agent: { description: row.description } }
        : {}),
    },
    placement,
  );
  if (!started.ok && started.computerAway) {
    await waitForComputer(ctx, row, fireId, placement.device);
    return;
  }
  finishFire(ctx, scheduleId, fireId, started.ok ? { tracked: started.tracked } : started.outcome);
};

const retryNote = (row: Row): string =>
  row.retry_of && row.retry_attempt
    ? `\n\n(Try ${row.retry_attempt}: the earlier try never started${row.last_error ? ` (${row.last_error})` : ""}, so nothing of it was done.)`
    : "";

type Placement =
  | { computerOnly: false; away: false; device?: undefined }
  | { computerOnly: true; away: boolean; device?: DeviceDestination; ownDevice: boolean };

const WAIT_RECHECK_MS = 30 * 60_000;

const placementOf = async (ctx: OwnerContext, row: Row): Promise<Placement> => {
  if (!computerOnly(ctx)) return { computerOnly: false, away: false };
  const computers = await ctx.host.deviceDestinations();
  const own = row.target_device_id
    ? computers.find((device) => device.deviceId === row.target_device_id)
    : undefined;
  const device =
    own ??
    [...computers].sort(
      (a, b) =>
        Number(Boolean(b.brainHome)) - Number(Boolean(a.brainHome)) ||
        Number(b.online) - Number(a.online) ||
        (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0),
    )[0];
  return { computerOnly: true, away: !device?.online, ownDevice: Boolean(own), ...(device ? { device } : {}) };
};

const waitForComputer = async (
  ctx: OwnerContext,
  row: Row,
  fireId: string,
  device: DeviceDestination | undefined,
): Promise<void> => {
  const current = readRow(ctx.db, row.schedule_id);
  if (!current) return;
  const run = runStateOf(current);
  if (run.kind !== "firing" || run.fireId !== fireId) return;
  const dueAt = row.waiting_since ?? row.next_run_at;
  let nextRunAt = ctx.now + WAIT_RECHECK_MS;
  try {
    const schedule = parseStored(current.schedule_json);
    if (schedule.kind !== "at") {
      nextRunAt = Math.min(nextRunAt, computeNextRunAt(schedule, ctx.now + 1_000, ownerZone(ctx.db)));
    }
  } catch {
  }
  const waited = transitionRun(ctx, row.schedule_id, run, { kind: "armed", retryFireId: null }, {
    waiting_since: dueAt,
    next_run_at: nextRunAt,
    last_error: null,
    last_error_at: null,
    failure_count: 0,
  });
  if (!waited || row.waiting_since !== null) return;
  const waiting: Row = { ...current, next_run_at: nextRunAt, waiting_since: dueAt };
  queueNotice(ctx, waiting, "waiting");
  const tokens = livePushTokens(ctx);
  const computer = device?.label?.trim() || "your computer";
  const body = `"${row.description}" is due, but ${computer} is off or asleep. It runs as soon as ${computer} is back.`;
  await sendPushMessages(
    ctx,
    tokens,
    tokens.map((token) => ({
      to: token.token,
      title: "Waiting for your computer",
      body,
      data: {
        kind: SCHEDULE_WAITING_PUSH_KIND,
        scheduleId: row.schedule_id,
        ...(row.conversation_id ? { conversationId: row.conversation_id } : {}),
      },
      sound: "default",
    })),
  ).catch(() => false);
};

const SCHEDULE_WAITING_PUSH_KIND = "schedule-waiting";

const computerBack = (ctx: OwnerContext, raw: unknown): { woke: number } => {
  const { deviceId } = object({ deviceId: string({ max: 256 }) })(raw);
  const rows = ctx.db.all<Row>(
    `SELECT * FROM schedules WHERE status = 'active' AND waiting_since IS NOT NULL
        AND run_state = 'armed' AND active_fire_id IS NULL AND (target_device_id = ? OR target_device_id IS NULL)`,
    deviceId,
  );
  for (const row of rows) {
    if (row.next_run_at <= ctx.now) continue;
    ctx.db.run("UPDATE schedules SET next_run_at = ?, updated_at = ? WHERE schedule_id = ?", ctx.now, ctx.now, row.schedule_id);
    arm(ctx, row.schedule_id);
  }
  return { woke: rows.length };
};

const lateNote = (dueAt: number, now: number): string =>
  now - dueAt > REMINDER_LATE_MS
    ? `\n\n(This was due at ${new Date(dueAt).toISOString()} and runs now instead, once, in place of any runs it missed.)`
    : "";

const spendRun = (ctx: OwnerContext, scheduleId: string, fireId: string): boolean => {
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
    finishFire(ctx, scheduleId, fireId, {
      error: `This run was skipped: today's ${budget.count} scheduled runs on the ${planLabel(budget.plan)} plan are used up.`,
      quiet: true,
    });
    return false;
  }
};

type StartOutcome =
  | { ok: true; tracked: boolean }
  | { ok: false; computerAway: boolean; outcome: { error: string; retry?: { sameFire: boolean } } };

const startRun = async (
  ctx: OwnerContext,
  row: Row,
  fireId: string,
  ownerGeneration: string,
  run: { prompt: string; agent?: { description: string } },
  placement: Placement,
): Promise<StartOutcome> => {
  const scheduleId = row.schedule_id;
  let conversationId = row.conversation_id ?? crypto.randomUUID();
  if (!row.conversation_id) {
    ctx.db.run("UPDATE schedules SET conversation_id = ? WHERE schedule_id = ?", conversationId, scheduleId);
  }
  const ownDeviceId = placement.computerOnly ? placement.device?.deviceId : row.target_device_id;
  const targetDeviceId = run.agent
    ? ownDeviceId
    : await whereStellaRuns(ctx, { conversationId, ownerGeneration, fallback: ownDeviceId ?? undefined, placement });
  const tracked = true;
  recordRun(ctx, row, fireId);
  const start = async (id: string): Promise<ScheduledTurnStarted> =>
    await ctx.host.startScheduledTurn({
      ownerGeneration,
      conversationId: id,
      clientMsgId: `schedule:${fireId}`,
      prompt: run.prompt,
      title: row.description,
      ...(targetDeviceId ? { targetDeviceId } : {}),
      ...(placement.computerOnly
        ? { computerOnly: { ownDevice: placement.ownDevice && targetDeviceId === placement.device?.deviceId } }
        : {}),
      ...(run.agent ? { agent: run.agent } : {}),
    });
  let started: ScheduledTurnStarted;
  try {
    try {
      started = await start(conversationId);
    } catch (error) {
      if (!(error instanceof ScheduledTurnError) || !error.conversationGone || !row.conversation_id) throw error;
      conversationId = crypto.randomUUID();
      started = await start(conversationId);
      const current = readRow(ctx.db, scheduleId);
      if (current && current.active_fire_id === fireId) {
        ctx.db.run("UPDATE schedules SET conversation_id = ? WHERE schedule_id = ?", conversationId, scheduleId);
      }
    }
  } catch (error) {
    runNotHandedOver(ctx, fireId);
    const message = error instanceof Error ? error.message : String(error);
    const definite = error instanceof ScheduledTurnError;
    return {
      ok: false,
      computerAway: definite && error.computerAway,
      outcome: {
        error: message,
        ...(!definite || error.retryable ? { retry: { sameFire: !definite } } : {}),
      },
    };
  }
  if (row.retry_of !== null) {
    ctx.db.run(
      "UPDATE schedules SET retry_of = NULL, retry_attempt = NULL WHERE schedule_id = ? AND retry_of = ?",
      scheduleId,
      row.retry_of,
    );
  }
  runHandedOver(ctx, fireId, started);
  return { ok: true, tracked };
};

const whereStellaRuns = async (
  ctx: OwnerContext,
  args: { conversationId: string; ownerGeneration: string; fallback: string | undefined; placement: Placement },
): Promise<string | undefined> => {
  const target = await ctx.host
    .agentReportTarget({ conversationId: args.conversationId, ownerGeneration: args.ownerGeneration })
    .catch((error: unknown) => {
      log("error", "schedule_brain_lookup_failed", {
        conversationId: args.conversationId,
        message: error instanceof Error ? error.message : String(error),
      });
      return null;
    });
  if (target?.kind === "device") return resolveCurrentDeviceId(ctx.db, target.deviceId);
  if (target?.kind === "cloud" && !args.placement.computerOnly) return undefined;
  return args.fallback;
};

type ThreadSend =
  | { kind: "delivered" }
  | { kind: "retry"; error: string }
  | { kind: "fallback"; note: string };

const sendToThread = async (
  ctx: OwnerContext,
  row: Row,
  fireId: string,
  ownerGeneration: string,
  fire: ScheduledThreadFire,
): Promise<ThreadSend> => {
  const threadId = row.target_thread_id!;
  try {
    const result = await deliverScheduledMessage(ctx, {
      scheduleId: row.schedule_id,
      name: row.description,
      fireId,
      ownerGeneration,
      threadId,
      text: scheduledThreadMessage({ scheduleId: row.schedule_id, name: row.description }, fire),
    });
    log("info", "schedule_thread_delivered", {
      scheduleId: row.schedule_id,
      fireId,
      threadId,
      outcome: result.outcome,
    });
    return { kind: "delivered" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log("info", "schedule_thread_undelivered", { scheduleId: row.schedule_id, fireId, threadId, message });
    if (error instanceof RpcError && error.retryable) return { kind: "retry", error: message.slice(0, MAX_ERROR_CHARS) };
    if (!(error instanceof RpcError)) return { kind: "retry", error: message.slice(0, MAX_ERROR_CHARS) };
    return {
      kind: "fallback",
      note: scheduledThreadFallbackNote(
        threadId,
        error.code === "NOT_FOUND" ? "no longer exists" : `could not take it (${message})`,
      ),
    };
  }
};

const watchFoundPrompt = (row: Row, found: string): string =>
  [
    `[Watch "${row.description}" found something] (${row.schedule_id})`,
    `What it found: ${found}`,
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
    if (current.script !== row.script) {
      finishFire(ctx, scheduleId, fireId, {});
      return;
    }
    if (run.ok) {
      ctx.db.run(
        `UPDATE schedules SET state_json = ?, last_check_at = ?, failing_since = NULL, repair_sent_at = NULL,
                pending_finding = ?,
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
      if (current.repair_sent_at !== null) {
        finishFire(ctx, scheduleId, fireId, { error: run.error, quiet: true });
        return;
      }
      failure = run.error;
    }
  }
  let spent = retrying;
  let fallback = "";
  if (row.target_thread_id) {
    if (!spent && !spendRun(ctx, scheduleId, fireId)) return;
    spent = true;
    const sent = await sendToThread(
      ctx,
      row,
      fireId,
      ownerGeneration,
      found
        ? { kind: "finding", found, instructions: row.prompt, once: row.once === 1 }
        : {
            kind: "failure",
            error: failure,
            instructions: row.prompt,
            repair: `It keeps trying on its schedule. Repair it: find out what changed, rewrite the check script and replace it with schedule_update({ jobId: "${scheduleId}", script }), which checks it once before saving. Tell the user only if it can't be fixed.`,
          },
    );
    if (sent.kind === "retry") {
      finishFire(ctx, scheduleId, fireId, { error: sent.error, retry: { sameFire: true } });
      return;
    }
    if (sent.kind === "fallback") fallback = `${sent.note}\n\n`;
  }
  let tracked = false;
  if (!row.target_thread_id || fallback) {
    const placement = await placementOf(ctx, row);
    if (placement.away) {
      await waitForComputer(ctx, row, fireId, placement.device);
      return;
    }
    if (!spent && !spendRun(ctx, scheduleId, fireId)) return;
    const toAgent = Boolean(found) && toRoute(row.route) === "agent" && !row.target_thread_id;
    const started = await startRun(
      ctx,
      row,
      fireId,
      ownerGeneration,
      found
        ? {
            prompt: `${fallback}${toAgent ? watchAgentPrompt(row, found) : watchFoundPrompt(row, found)}`,
            ...(toAgent ? { agent: { description: row.description } } : {}),
          }
        : { prompt: `${fallback}${watchFailedPrompt(row, failure)}` },
      placement,
    );
    if (!started.ok && started.computerAway) {
      await waitForComputer(ctx, row, fireId, placement.device);
      return;
    }
    if (!started.ok) {
      finishFire(ctx, scheduleId, fireId, started.outcome);
      return;
    }
    tracked = started.tracked;
  }
  if (found) {
    ctx.db.run("UPDATE schedules SET pending_finding = NULL WHERE schedule_id = ?", scheduleId);
  } else {
    ctx.db.run(
      "UPDATE schedules SET repair_sent_at = ? WHERE schedule_id = ? AND failing_since IS NOT NULL",
      ctx.now,
      scheduleId,
    );
  }
  finishFire(
    ctx,
    scheduleId,
    fireId,
    failure ? { error: failure, quiet: true } : { last: Boolean(found) && row.once === 1, tracked },
  );
};

const tellStellaArgs = object({
  conversationId: string({ max: 128, pattern: ID_PATTERN }),
  noteId: string({ max: 64, pattern: /^[A-Za-z0-9._:-]{8,64}$/u }),
  text: string({ max: 16_000 }),
});

const tellStella = async (
  ctx: OwnerContext,
  args: ScheduleCalls["schedules.tellStella"]["args"],
): Promise<{ queued: boolean }> => {
  const live = ctx.db.one<{ conversation_id: string }>(
    "SELECT conversation_id FROM conversations WHERE conversation_id = ? AND deleted_at IS NULL",
    args.conversationId,
  );
  if (!live) throw new RpcError("NOT_FOUND", "That conversation is gone.");
  const text = args.text.trim();
  if (!text) bad("A message for Stella needs text.");
  const snapshot = await ctx.host.snapshot();
  queueStellaNote(ctx, {
    noteId: args.noteId,
    conversationId: args.conversationId,
    ownerGeneration: snapshot.ownerGeneration,
    fromThreadId: `schedule:${args.noteId}`.slice(0, 128),
    text,
  });
  return { queued: true };
};

const createArgs = object({
  requestId: string({ max: 128 }),
  kind: optional(literal("reminder", "task", "watch")),
  prompt: string({ max: MAX_PROMPT_CHARS * 2 }),
  schedule: scheduleParser,
  description: optional(string({ max: 1_000 })),
  conversationId: optional(string({ max: 128 })),
  targetDeviceId: optional(string({ max: 256 })),
  route: optional(literal("orchestrator", "agent")),
  targetThreadId: optional(string({ max: 128, pattern: ID_PATTERN })),
  script: optional(string({ max: WATCH_SCRIPT_MAX_CHARS + 1_000 })),
  once: optional(boolean()),
  createdByThreadId: optional(string({ max: 128, pattern: ID_PATTERN })),
});

const updateArgs = object({
  requestId: string({ max: 128 }),
  scheduleId: string({ max: 128, pattern: ID_PATTERN }),
  prompt: optional(string({ max: MAX_PROMPT_CHARS * 2 })),
  schedule: optional(scheduleParser),
  description: optional(string({ max: 1_000 })),
  status: optional(literal("active", "paused")),
  route: optional(literal("orchestrator", "agent")),
  targetThreadId: optional(string({ max: 128, pattern: ID_PATTERN })),
  script: optional(string({ max: WATCH_SCRIPT_MAX_CHARS + 1_000 })),
  once: optional(boolean()),
});

const removeArgs = object({
  requestId: string({ max: 128 }),
  scheduleId: string({ max: 128, pattern: ID_PATTERN }),
});

export const schedulesDomain = {
  name: "schedules",
  migrations: [
    SCHEDULES_MIGRATION,
    SCHEDULES_KINDS_MIGRATION,
    SCHEDULES_WATCHES_MIGRATION,
    SCHEDULES_DUE_MIGRATION,
    SCHEDULES_ZONE_MIGRATION,
    SCHEDULES_ZONE_SOURCE_MIGRATION,
    SCHEDULES_WATCH_REPAIR_MIGRATION,
    SCHEDULES_WAITING_MIGRATION,
    SCHEDULES_RUN_STATE_MIGRATION,
    SCHEDULES_TARGET_THREAD_MIGRATION,
    SCHEDULES_RUNS_MIGRATION,
    SCHEDULES_CLOUD_RUNS_MIGRATION,
  ],
  views: {
    "schedules.list": {
      parse: empty(),
      read: (ctx) => listRows(ctx),
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
        (await createSchedule(ctx, args)).result,
    },
    "schedules.update": {
      scope: "owner",
      parse: updateArgs,
      handler: async (ctx: OwnerContext, args: ScheduleCalls["schedules.update"]["args"]) =>
        (await updateSchedule(ctx, args)).result,
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
    "schedules.reportZone": {
      scope: "owner",
      parse: zoneArgs,
      handler: (ctx: OwnerContext, args: ScheduleCalls["schedules.reportZone"]["args"]) => reportZone(ctx, args),
    },
    "schedules.tellStella": {
      scope: "owner",
      parse: tellStellaArgs,
      handler: async (ctx: OwnerContext, args: ScheduleCalls["schedules.tellStella"]["args"]) =>
        await tellStella(ctx, args),
    },
  },
  internal: {
    "schedules.tool": (ctx: OwnerContext, args: unknown) => scheduleTool(ctx, args),
    "schedules.computerBack": (ctx: OwnerContext, args: unknown) => computerBack(ctx, args),
    "schedules.runSettled": (ctx: OwnerContext, args: unknown) => runSettled(ctx, args),
  },
  jobs: {
    [SCHEDULE_FIRE_JOB]: {
      run: fire,
      maxAttempts: 10,
    },
    [REMINDER_RETURN_JOB]: {
      run: reminderReturn,
      maxAttempts: 6,
    },
    [SCHEDULE_NOTICE_JOB]: {
      run: postNotice,
      maxAttempts: 5,
    },
    [SCHEDULE_FAILED_JOB]: {
      run: tellFailed,
      maxAttempts: 8,
    },
    [SCHEDULE_SETTLE_JOB]: {
      run: settleQueued,
      maxAttempts: 8,
    },
    [SCHEDULE_CHECK_RUN_JOB]: {
      run: checkRun,
      maxAttempts: 8,
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
    ctx.db.run("DELETE FROM schedule_runs");
    ctx.db.run("DELETE FROM schedule_receipts");
    ctx.db.run("DELETE FROM reminder_fires");
    ctx.db.run("DELETE FROM schedule_zone");
    return { pending: false };
  },
} satisfies OwnerDomain;
