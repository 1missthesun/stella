import {
  agentStatusOf,
  isAgentAttemptOutcome,
  type AgentAttemptOutcome,
} from "@stella/contracts/agent-status";
import {
  AGENT_EVENTS_PAGE_MAX,
  type AgentEventKind,
  type AgentEventRecord,
} from "@stella/contracts/backend/agent-events";
import { json, number, object, optional, string } from "../args.js";
import type {
  OwnerDb,
  OwnerDbReader,
  OwnerDomain,
  SqlValue,
} from "../registry.js";

type Row = Record<string, SqlValue>;

type EventRow = {
  seq: number;
  event_key: string;
  kind: string;
  thread_id: string | null;
  conversation_id: string | null;
  turn_id: string | null;
  attempt_generation: number | null;
  brain_epoch: number | null;
  status: string | null;
  outcome: string | null;
  source: string;
  thread_patch: string | null;
  turn_patch: string | null;
  detail: string | null;
  created_at: number;
};

const THREAD_COLUMNS = [
  "thread_id",
  "conversation_id",
  "owner_generation",
  "parent_turn_id",
  "parent_thread_id",
  "executor_device_id",
  "requested_model",
  "harness",
  "origin_device_id",
  "origin_conversation_id",
  "origin_delivery_ack_at",
  "description",
  "placement",
  "agent_type",
  "execution_json",
  "attempt_generation",
  "status",
  "result_json",
  "error_message",
  "created_at",
  "updated_at",
];

const TURN_COLUMNS = [
  "turn_id",
  "thread_id",
  "conversation_id",
  "owner_generation",
  "attempt_generation",
  "status",
  "client_msg_id",
  "spawn_fingerprint",
  "dispatch_id",
  "created_at",
  "updated_at",
];

const jsonRow = (columns: readonly string[]): string =>
  `json_object(${columns.map((column) => `'${column}', ${column}`).join(", ")})`;

const VOCABULARY_STATUS_SQL =
  "CASE status WHEN 'resuming' THEN 'running' ELSE status END";

export const AGENT_EVENTS_MIGRATION = {
  id: "agent-events.1-init",
  statements: [
    `CREATE TABLE agent_events (
       seq INTEGER PRIMARY KEY AUTOINCREMENT,
       event_key TEXT NOT NULL UNIQUE,
       kind TEXT NOT NULL,
       thread_id TEXT,
       conversation_id TEXT,
       turn_id TEXT,
       attempt_generation INTEGER,
       brain_epoch INTEGER,
       status TEXT,
       outcome TEXT,
       source TEXT NOT NULL,
       thread_patch TEXT,
       turn_patch TEXT,
       detail TEXT,
       created_at INTEGER NOT NULL
     )`,
    "CREATE INDEX agent_events_thread ON agent_events (thread_id, seq) WHERE thread_id IS NOT NULL",
    "CREATE INDEX agent_events_conversation ON agent_events (conversation_id, seq) WHERE conversation_id IS NOT NULL",
    `INSERT INTO agent_events
       (event_key, kind, thread_id, conversation_id, attempt_generation, status, source, thread_patch, created_at)
     SELECT 'backfill:thread:' || thread_id, 'backfilled', thread_id, conversation_id, attempt_generation,
            ${VOCABULARY_STATUS_SQL}, 'migration', ${jsonRow(THREAD_COLUMNS)}, updated_at
       FROM agent_threads ORDER BY created_at, thread_id`,
    `INSERT INTO agent_events
       (event_key, kind, thread_id, conversation_id, turn_id, attempt_generation, source, turn_patch, created_at)
     SELECT 'backfill:turn:' || turn_id, 'backfilled', thread_id, conversation_id, turn_id, attempt_generation,
            'migration', ${jsonRow(TURN_COLUMNS)}, updated_at
       FROM agent_turns WHERE thread_id IS NOT NULL ORDER BY created_at, turn_id`,
  ],
};

export type AgentEventInput = {
  key: string;
  kind: AgentEventKind | (string & {});
  source: string;
  threadId?: string | null;
  conversationId?: string | null;
  turnId?: string | null;
  attemptGeneration?: number | null;
  brainEpoch?: number | null;
  status?: string | null;
  outcome?: AgentAttemptOutcome | null;
  threadPatch?: Row | null;
  turnPatch?: Row | null;
  detail?: Record<string, unknown> | null;
  createdAt: number;
};

const encode = (value: unknown): string | null =>
  value === null || value === undefined ? null : JSON.stringify(value);

export const appendAgentEvent = (
  db: OwnerDb,
  input: AgentEventInput,
): boolean => {
  const logged = db.one<{ seq: number; kind: string }>(
    "SELECT seq, kind FROM agent_events WHERE event_key = ?",
    input.key,
  );
  if (logged) {
    if (input.threadPatch || input.turnPatch) {
      console.error(
        JSON.stringify({
          event: "agent_event_key_reused",
          key: input.key,
          kind: input.kind,
          loggedKind: logged.kind,
          threadId: input.threadId ?? null,
        }),
      );
    }
    return false;
  }
  const status =
    input.status === undefined || input.status === null
      ? null
      : (agentStatusOf(input.status) ?? input.status);
  db.run(
    `INSERT INTO agent_events
       (event_key, kind, thread_id, conversation_id, turn_id, attempt_generation, brain_epoch,
        status, outcome, source, thread_patch, turn_patch, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (event_key) DO NOTHING`,
    input.key,
    input.kind,
    input.threadId ?? null,
    input.conversationId ?? null,
    input.turnId ?? null,
    input.attemptGeneration ?? null,
    input.brainEpoch ?? null,
    status,
    input.outcome ?? null,
    input.source,
    encode(input.threadPatch),
    encode(input.turnPatch),
    encode(input.detail),
    input.createdAt,
  );
  return true;
};

const readRow = (
  db: OwnerDbReader,
  table: "agent_threads" | "agent_turns",
  id: string | null | undefined,
): Row | null =>
  id
    ? db.one<Row>(
        `SELECT * FROM ${table} WHERE ${table === "agent_threads" ? "thread_id" : "turn_id"} = ?`,
        id,
      )
    : null;

const rowPatch = (before: Row | null, after: Row | null): Row | null => {
  if (!after) return null;
  if (!before) return { ...after };
  const patch: Row = {};
  for (const [column, value] of Object.entries(after)) {
    if (before[column] !== value) patch[column] = value;
  }
  return Object.keys(patch).length > 0 ? patch : null;
};

export type AgentChangeApplied = {
  threadBefore: Row | null;
  thread: Row | null;
  turn: Row | null;
  threadPatch: Row | null;
  turnPatch: Row | null;
};

export type AgentChange = {
  threadId: string;
  turnId?: string | null;
  kind: AgentEventKind | ((applied: AgentChangeApplied) => AgentEventKind);
  key?:
    | string
    | ((kind: AgentEventKind, applied: AgentChangeApplied) => string);
  source: string;
  outcome?: AgentAttemptOutcome | null;
  detail?: Record<string, unknown>;
  always?: boolean;
  now: number;
};

const ENDED_KINDS = new Set<string>([
  "completed",
  "failed",
  "canceled",
  "paused",
]);

const generationOf = (applied: AgentChangeApplied): number | null => {
  const value =
    applied.turn?.attempt_generation ??
    applied.thread?.attempt_generation ??
    null;
  return typeof value === "number" ? value : null;
};

export const endedKind = (applied: AgentChangeApplied): AgentEventKind => {
  const status = applied.threadPatch?.status;
  return typeof status === "string" && ENDED_KINDS.has(status)
    ? (status as AgentEventKind)
    : "attempt_ended";
};

export const startedKind = (applied: AgentChangeApplied): AgentEventKind =>
  applied.threadBefore?.status === "canceled" || applied.threadBefore?.status === "paused" ? "resumed" : "attempt_started";

export const agentChangeHooks: Array<
  (db: OwnerDb, threadId: string, now: number) => void
> = [];

export const recordAgentChange = <T>(
  db: OwnerDb,
  change: AgentChange,
  write: () => T,
): T =>
  db.transaction
    ? db.transaction(() => applyAgentChange(db, change, write))
    : applyAgentChange(db, change, write);

const applyAgentChange = <T>(
  db: OwnerDb,
  change: AgentChange,
  write: () => T,
): T => {
  const threadBefore = readRow(db, "agent_threads", change.threadId);
  const turnBefore = readRow(db, "agent_turns", change.turnId);
  const value = write();
  const thread = readRow(db, "agent_threads", change.threadId);
  const turn = readRow(db, "agent_turns", change.turnId);
  const applied: AgentChangeApplied = {
    threadBefore,
    thread,
    turn,
    threadPatch: rowPatch(threadBefore, thread),
    turnPatch: rowPatch(turnBefore, turn),
  };
  if (!change.always && !applied.threadPatch && !applied.turnPatch)
    return value;
  const kind =
    typeof change.kind === "function" ? change.kind(applied) : change.kind;
  const generation = generationOf(applied);
  const key =
    typeof change.key === "function"
      ? change.key(kind, applied)
      : (change.key ??
        (kind === "attempt_ended" && change.turnId
          ? `attempt_ended:turn:${change.turnId}`
          : `${kind}:${change.threadId}:${generation ?? 0}`));
  const settled =
    kind === "attempt_ended" ? applied.turn?.status : applied.thread?.status;
  const outcome =
    change.outcome ??
    ((ENDED_KINDS.has(kind) || kind === "attempt_ended") &&
    isAgentAttemptOutcome(settled)
      ? settled
      : null);
  appendAgentEvent(db, {
    key,
    kind,
    source: change.source,
    threadId: change.threadId,
    conversationId: (thread?.conversation_id ??
      threadBefore?.conversation_id ??
      turn?.conversation_id ??
      null) as string | null,
    turnId: change.turnId ?? null,
    attemptGeneration: generation,
    status: typeof thread?.status === "string" ? thread.status : null,
    outcome,
    threadPatch: applied.threadPatch,
    turnPatch: applied.turnPatch,
    ...(change.detail ? { detail: change.detail } : {}),
    createdAt: change.now,
  });
  for (const hook of agentChangeHooks) hook(db, change.threadId, change.now);
  return value;
};

const parsePatch = (text: string | null): Record<string, unknown> | null => {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const record = (row: EventRow): AgentEventRecord => ({
  seq: row.seq,
  key: row.event_key,
  kind: row.kind,
  threadId: row.thread_id,
  conversationId: row.conversation_id,
  turnId: row.turn_id,
  attemptGeneration: row.attempt_generation,
  brainEpoch: row.brain_epoch,
  status: row.status,
  outcome: isAgentAttemptOutcome(row.outcome) ? row.outcome : null,
  source: row.source,
  threadPatch: parsePatch(row.thread_patch),
  turnPatch: parsePatch(row.turn_patch),
  detail: parsePatch(row.detail),
  createdAt: row.created_at,
});

const pageLimit = (limit: number | undefined, fallback: number): number =>
  Math.min(Math.max(limit ?? fallback, 1), AGENT_EVENTS_PAGE_MAX);

export const threadEvents = (
  db: OwnerDbReader,
  args: { threadId: string; after?: number; limit?: number },
): { events: AgentEventRecord[]; hasMore: boolean } => {
  const limit = pageLimit(args.limit, AGENT_EVENTS_PAGE_MAX);
  const rows = db.all<EventRow>(
    "SELECT * FROM agent_events WHERE thread_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?",
    args.threadId,
    args.after ?? 0,
    limit + 1,
  );
  return {
    events: rows.slice(0, limit).map(record),
    hasMore: rows.length > limit,
  };
};

export const recentEvents = (
  db: OwnerDbReader,
  args: { before?: number; limit?: number },
): { events: AgentEventRecord[]; hasMore: boolean } => {
  const limit = pageLimit(args.limit, 50);
  const rows =
    args.before !== undefined
      ? db.all<EventRow>(
          "SELECT * FROM agent_events WHERE seq < ? ORDER BY seq DESC LIMIT ?",
          args.before,
          limit + 1,
        )
      : db.all<EventRow>(
          "SELECT * FROM agent_events ORDER BY seq DESC LIMIT ?",
          limit + 1,
        );
  return {
    events: rows.slice(0, limit).map(record),
    hasMore: rows.length > limit,
  };
};

export const deleteConversationAgentEvents = (
  db: OwnerDb,
  conversationId: string,
): void => {
  db.run(
    `DELETE FROM agent_events WHERE conversation_id = ?
        OR thread_id IN (SELECT thread_id FROM agent_threads WHERE conversation_id = ?)`,
    conversationId,
    conversationId,
  );
};

const id = (max = 256) => string({ min: 1, max });
const seq = number({ int: true, min: 0 });
const forThreadParser = object({
  threadId: id(),
  after: optional(seq),
  limit: optional(number({ int: true, min: 1, max: AGENT_EVENTS_PAGE_MAX })),
});
const recentParser = object({
  before: optional(seq),
  limit: optional(number({ int: true, min: 1, max: AGENT_EVENTS_PAGE_MAX })),
});
const appendParser = object({
  key: id(512),
  kind: id(64),
  source: id(512),
  threadId: optional(id()),
  conversationId: optional(id()),
  turnId: optional(id()),
  attemptGeneration: optional(number({ int: true, min: 0 })),
  brainEpoch: optional(number({ int: true, min: 0 })),
  status: optional(id(64)),
  detail: optional(json({ maxBytes: 16 * 1024 })),
});

export const agentEventsDomain = {
  name: "agent-events",
  migrations: [AGENT_EVENTS_MIGRATION],
  views: {
    "agentEvents.forThread": {
      parse: forThreadParser,
      read: (ctx, args) => threadEvents(ctx.db, args),
    },
    "agentEvents.recent": {
      parse: recentParser,
      read: (ctx, args) => recentEvents(ctx.db, args),
    },
  },
  internal: {
    "agentEvents.forThread": (ctx, raw) =>
      threadEvents(ctx.db, forThreadParser(raw)),
    "agentEvents.recent": (ctx, raw) => recentEvents(ctx.db, recentParser(raw)),
    "agentEvents.append": (ctx, raw) => {
      const args = appendParser(raw);
      const detail = args.detail;
      return {
        appended: appendAgentEvent(ctx.db, {
          key: args.key,
          kind: args.kind,
          source: args.source,
          threadId: args.threadId ?? null,
          conversationId: args.conversationId ?? null,
          turnId: args.turnId ?? null,
          attemptGeneration: args.attemptGeneration ?? null,
          brainEpoch: args.brainEpoch ?? null,
          status: args.status ?? null,
          detail:
            detail && typeof detail === "object" && !Array.isArray(detail)
              ? (detail as Record<string, unknown>)
              : null,
          createdAt: ctx.now,
        }),
      };
    },
  },
} satisfies OwnerDomain;
