/**
 * Every agent's conversation in the owner's cloud
 * (`@stella/contracts/backend/agent-logs`): append-only records per thread,
 * written step by step by the host that holds the agent and read back, after
 * a seq, only by a host that takes it over. The holder is the one writer:
 * `agentThreads.handoff` names the next one (`setAgentLogHolder`), and an
 * append from any other host is refused, so a host that lost the agent can
 * never write into it again.
 */

import {
  AGENT_LOG_APPEND_MAX_BODY_BYTES,
  AGENT_LOG_CLOUD_HOLDER,
  AGENT_LOG_MOVED_REASON,
  AGENT_LOG_READ_MAX_RECORDS,
  AGENT_LOG_RECORD_MAX_BYTES,
  type AgentLogCalls,
  type AgentLogCheckpointPayload,
  type AgentLogRecord,
} from "@stella/contracts/backend/agent-logs";
import { array, literal, number, object, optional, string } from "../args.js";
import { RpcError } from "../errors.js";
import { enforceOwnerRateLimit } from "../rate-limit.js";
import type { OwnerContext, OwnerDb, OwnerDbReader, OwnerDomain, OwnerJobs } from "../registry.js";
import { sha256Hex } from "../../hash.js";

export const AGENT_LOGS_MIGRATION = {
  id: "agent-logs.1-init",
  statements: [
    `CREATE TABLE agent_log_records (
       thread_id TEXT NOT NULL,
       seq INTEGER NOT NULL,
       record_key TEXT NOT NULL,
       conversation_id TEXT NOT NULL,
       role TEXT NOT NULL,
       payload_json TEXT NOT NULL,
       holder TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       PRIMARY KEY (thread_id, seq)
     )`,
    "CREATE UNIQUE INDEX agent_log_records_key ON agent_log_records (thread_id, record_key)",
    "CREATE INDEX agent_log_records_checkpoint ON agent_log_records (thread_id, seq) WHERE role = 'checkpoint'",
    "CREATE INDEX agent_log_records_conversation ON agent_log_records (conversation_id)",
    `CREATE TABLE agent_log_holders (
       thread_id TEXT PRIMARY KEY,
       conversation_id TEXT NOT NULL,
       holder TEXT NOT NULL,
       cwd TEXT,
       updated_at INTEGER NOT NULL
     )`,
    "CREATE INDEX agent_log_holders_conversation ON agent_log_holders (conversation_id)",
  ],
};

export const AGENT_LOGS_COLD_MIGRATION = {
  id: "agent-logs.2-cold-segments",
  statements: [
    "ALTER TABLE agent_log_records ADD COLUMN segment TEXT",
    `CREATE INDEX agent_log_records_inline_created ON agent_log_records (created_at)
       WHERE segment IS NULL AND role <> 'checkpoint'`,
  ],
};

/**
 * Every record wrote one more index row for its conversation, read only when
 * a conversation is deleted. That delete now finds the conversation's agents
 * in `agent_log_holders` and removes their records by thread.
 */
export const AGENT_LOGS_LEAN_INDEX_MIGRATION = {
  id: "agent-logs.3-drop-conversation-index",
  statements: ["DROP INDEX IF EXISTS agent_log_records_conversation"],
};

export const AGENT_LOG_ARCHIVE_JOB = "agentLogs.archive";
export const AGENT_LOG_SEGMENT_DELETE_JOB = "agentLogs.deleteSegments";
const AGENT_LOG_ARCHIVE_JOB_ID = "agent-logs:archive";
const AGENT_LOG_INLINE_MS = 3 * 24 * 60 * 60_000;
const AGENT_LOG_ARCHIVE_EVERY_MS = 6 * 60 * 60_000;
const AGENT_LOG_ARCHIVE_CONTINUE_MS = 30_000;
const SEGMENT_MAX_RECORDS = 200;
const SEGMENT_MAX_BYTES = 2 * 1024 * 1024;
const SEGMENTS_PER_PASS = 10;
const SEGMENT_DELETE_BATCH = 500;

type SegmentBody = { threadId: string; records: Array<[number, string]> };

const agentLogsPrefix = async (ownerId: string): Promise<string> =>
  `conversations/${await sha256Hex(ownerId)}/agent-logs/v1/`;

const gzip = async (text: string): Promise<ArrayBuffer> =>
  await new Response(
    new Blob([text]).stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();

const gunzip = async (body: ReadableStream): Promise<string> =>
  await new Response(body.pipeThrough(new DecompressionStream("gzip"))).text();

const inlineMs = (ctx: OwnerContext): number => {
  const override = Number((ctx.env as { AGENT_LOG_INLINE_MS?: string }).AGENT_LOG_INLINE_MS);
  return Number.isFinite(override) && override > 0 ? override : AGENT_LOG_INLINE_MS;
};

const scheduleArchive = (ctx: OwnerContext, at: number): void => {
  if (ctx.db.one("SELECT 1 AS queued FROM owner_jobs WHERE id = ?", AGENT_LOG_ARCHIVE_JOB_ID)) return;
  ctx.jobs.schedule(AGENT_LOG_ARCHIVE_JOB, at, {}, { id: AGENT_LOG_ARCHIVE_JOB_ID });
};

const archiveColdRecords = async (ctx: OwnerContext): Promise<void> => {
  const bucket = ctx.env.CONVERSATION_ARCHIVE;
  if (!bucket) return;
  const cutoff = ctx.now - inlineMs(ctx);
  const prefix = await agentLogsPrefix(ctx.ownerId);
  for (let pass = 0; pass < SEGMENTS_PER_PASS; pass += 1) {
    const oldest = ctx.db.one<{ thread_id: string }>(
      `SELECT thread_id FROM agent_log_records
        WHERE segment IS NULL AND role <> 'checkpoint' AND created_at < ?
        ORDER BY created_at LIMIT 1`,
      cutoff,
    );
    if (!oldest) return;
    const rows = ctx.db.all<{ seq: number; payload_json: string }>(
      `SELECT seq, payload_json FROM agent_log_records
        WHERE thread_id = ? AND segment IS NULL AND role <> 'checkpoint' AND created_at < ?
        ORDER BY seq LIMIT ?`,
      oldest.thread_id,
      cutoff,
      SEGMENT_MAX_RECORDS,
    );
    const records: Array<[number, string]> = [];
    let bytes = 0;
    for (const row of rows) {
      if (records.length > 0 && bytes + row.payload_json.length > SEGMENT_MAX_BYTES) break;
      records.push([row.seq, row.payload_json]);
      bytes += row.payload_json.length;
    }
    const first = records[0]![0];
    const last = records[records.length - 1]![0];
    const key = `${prefix}${await sha256Hex(oldest.thread_id)}/${first}-${last}-${crypto.randomUUID().slice(0, 8)}.json.gz`;
    await bucket.put(
      key,
      await gzip(JSON.stringify({ threadId: oldest.thread_id, records } satisfies SegmentBody)),
    );
    const placeholders = records.map(() => "?").join(", ");
    ctx.db.run(
      `UPDATE agent_log_records SET payload_json = '', segment = ?
        WHERE thread_id = ? AND segment IS NULL AND seq IN (${placeholders})`,
      key,
      oldest.thread_id,
      ...records.map(([seq]) => seq),
    );
  }
  ctx.jobs.schedule(AGENT_LOG_ARCHIVE_JOB, ctx.now + AGENT_LOG_ARCHIVE_CONTINUE_MS, {}, {
    id: AGENT_LOG_ARCHIVE_JOB_ID,
  });
};

const archivedPayloads = async (
  ctx: OwnerContext,
  threadId: string,
  rows: Array<{ seq: number; segment: string | null }>,
): Promise<Map<number, string>> => {
  const payloads = new Map<number, string>();
  const segments = [...new Set(rows.flatMap((row) => (row.segment ? [row.segment] : [])))];
  if (segments.length === 0) return payloads;
  const bucket = ctx.env.CONVERSATION_ARCHIVE;
  if (!bucket) throw new RpcError("UNAVAILABLE", "This agent's older history isn't available right now.");
  for (const key of segments) {
    const object = await bucket.get(key);
    if (!object) throw new RpcError("INTERNAL", "Part of this agent's history is missing.");
    const body = JSON.parse(await gunzip(object.body)) as SegmentBody;
    if (body.threadId !== threadId) throw new RpcError("INTERNAL", "Part of this agent's history is missing.");
    for (const [seq, payload] of body.records) payloads.set(seq, payload);
  }
  return payloads;
};

/** Response pages stay well under what one RPC answer carries. */
const READ_PAGE_MAX_BYTES = 2 * 1024 * 1024;

type RecordRow = {
  seq: number;
  record_key: string;
  role: string;
  payload_json: string;
  created_at: number;
  segment: string | null;
};

type HolderRow = { holder: string; cwd: string | null };

const readHolder = (db: OwnerDbReader, threadId: string): HolderRow | null =>
  db.one<HolderRow>("SELECT holder, cwd FROM agent_log_holders WHERE thread_id = ?", threadId);

/** From now on only `holder` writes the agent's records (a move, or the agent's first holder). */
export const setAgentLogHolder = (
  db: OwnerDb,
  args: { threadId: string; conversationId: string; holder: string; cwd?: string | null; now: number },
): void => {
  db.run(
    `INSERT INTO agent_log_holders (thread_id, conversation_id, holder, cwd, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (thread_id) DO UPDATE SET holder = excluded.holder,
       cwd = COALESCE(excluded.cwd, agent_log_holders.cwd), updated_at = excluded.updated_at`,
    args.threadId,
    args.conversationId,
    args.holder,
    args.cwd ?? null,
    args.now,
  );
};

/** Who holds an agent now, when anyone has written it. */
export const agentLogHolder = (db: OwnerDbReader, threadId: string): string | null =>
  readHolder(db, threadId)?.holder ?? null;

const lastSeq = (db: OwnerDbReader, threadId: string): number =>
  db.one<{ seq: number | null }>("SELECT MAX(seq) AS seq FROM agent_log_records WHERE thread_id = ?", threadId)?.seq ?? -1;

const seqOfKey = (db: OwnerDbReader, threadId: string, key: string): number | undefined =>
  db.one<{ seq: number }>("SELECT seq FROM agent_log_records WHERE thread_id = ? AND record_key = ?", threadId, key)?.seq;

/** A checkpoint names the first message it kept by seq, as every reader resolves it. */
const normalizedCheckpoint = (
  db: OwnerDbReader,
  threadId: string,
  record: { key: string; seq: number; payloadJson: string },
): string => {
  const payloadJson = record.payloadJson;
  let payload: AgentLogCheckpointPayload;
  try {
    payload = JSON.parse(payloadJson) as AgentLogCheckpointPayload;
  } catch {
    throw new RpcError("BAD_REQUEST", "A checkpoint must be JSON.");
  }
  if (typeof payload?.summary !== "string" || !payload.summary.trim()) {
    throw new RpcError("BAD_REQUEST", "A checkpoint needs its summary.");
  }
  const firstKeptSeq =
    typeof payload.firstKeptSeq === "number"
      ? payload.firstKeptSeq
      : payload.firstKeptKey === record.key
        ? record.seq + 1
        : payload.firstKeptKey
          ? seqOfKey(db, threadId, payload.firstKeptKey)
          : undefined;
  return JSON.stringify({ summary: payload.summary, ...(firstKeptSeq !== undefined ? { firstKeptSeq } : {}) });
};

type AppendArgs = AgentLogCalls["agentLogs.append"]["args"];

const append = (ctx: OwnerContext, args: AppendArgs): AgentLogCalls["agentLogs.append"]["result"] => {
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    "agentLogs.append",
    { count: 1_200, windowMs: 60_000 },
    "Agent sync is going too fast. It will retry shortly.",
  );
  const write = (): AgentLogCalls["agentLogs.append"]["result"] => {
    const held = readHolder(ctx.db, args.threadId);
    if (held && held.holder !== args.holder) {
      throw new RpcError("CONFLICT", "This agent runs somewhere else now, so this host no longer writes it.", {
        reason: AGENT_LOG_MOVED_REASON,
      });
    }
    if (!held) setAgentLogHolder(ctx.db, { threadId: args.threadId, conversationId: args.conversationId, holder: args.holder, now: ctx.now });
    let seq = lastSeq(ctx.db, args.threadId);
    const seqs: number[] = [];
    for (const record of args.records) {
      if (record.payloadJson.length > AGENT_LOG_RECORD_MAX_BYTES) {
        throw new RpcError("BAD_REQUEST", "A record is over the size limit.");
      }
      const known = seqOfKey(ctx.db, args.threadId, record.key);
      if (known !== undefined) {
        seqs.push(known);
        continue;
      }
      seq += 1;
      ctx.db.run(
        `INSERT INTO agent_log_records (thread_id, seq, record_key, conversation_id, role, payload_json, holder, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args.threadId,
        seq,
        record.key,
        args.conversationId,
        record.role,
        record.role === "checkpoint"
          ? normalizedCheckpoint(ctx.db, args.threadId, { key: record.key, seq, payloadJson: record.payloadJson })
          : record.payloadJson,
        args.holder,
        ctx.now,
      );
      seqs.push(seq);
    }
    return { seqs, throughSeq: seq };
  };
  const result = ctx.db.transaction ? ctx.db.transaction(write) : write();
  scheduleArchive(ctx, ctx.now + Math.min(AGENT_LOG_ARCHIVE_EVERY_MS, inlineMs(ctx) + AGENT_LOG_ARCHIVE_CONTINUE_MS));
  return result;
};

const asRecord = (row: RecordRow): AgentLogRecord => ({
  seq: row.seq,
  key: row.record_key,
  role: row.role as AgentLogRecord["role"],
  payloadJson: row.payload_json,
  createdAt: row.created_at,
});

type ReadArgs = AgentLogCalls["agentLogs.read"]["args"];

const read = async (ctx: OwnerContext, args: ReadArgs): Promise<AgentLogCalls["agentLogs.read"]["result"]> => {
  const held = readHolder(ctx.db, args.threadId);
  let after = args.afterSeq;
  let checkpoint: AgentLogCalls["agentLogs.read"]["result"]["checkpoint"];
  if (after < 0) {
    const newest = ctx.db.one<{ payload_json: string }>(
      "SELECT payload_json FROM agent_log_records WHERE thread_id = ? AND role = 'checkpoint' ORDER BY seq DESC LIMIT 1",
      args.threadId,
    );
    const payload = newest ? (JSON.parse(newest.payload_json) as AgentLogCheckpointPayload) : undefined;
    if (payload?.firstKeptSeq !== undefined) {
      after = payload.firstKeptSeq - 1;
      checkpoint = { summary: payload.summary, throughSeq: after };
    }
  }
  const limit = Math.min(args.limit ?? AGENT_LOG_READ_MAX_RECORDS, AGENT_LOG_READ_MAX_RECORDS);
  const rows = ctx.db.all<RecordRow>(
    `SELECT seq, record_key, role, payload_json, created_at, segment FROM agent_log_records
      WHERE thread_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
    args.threadId,
    after,
    limit + 1,
  );
  const page = rows.slice(0, limit);
  const archived = await archivedPayloads(ctx, args.threadId, page);
  for (const row of page) {
    if (row.segment === null) continue;
    const payload = archived.get(row.seq);
    if (payload === undefined) throw new RpcError("INTERNAL", "Part of this agent's history is missing.");
    row.payload_json = payload;
  }
  const records: AgentLogRecord[] = [];
  let bytes = 0;
  for (const row of page) {
    bytes += row.payload_json.length;
    if (records.length > 0 && bytes > READ_PAGE_MAX_BYTES) break;
    records.push(asRecord(row));
  }
  return {
    records,
    complete: records.length === rows.length,
    ...(checkpoint ? { checkpoint } : {}),
    ...(held ? { holder: held.holder } : {}),
    ...(held?.cwd ? { cwd: held.cwd } : {}),
  };
};

/** Delete one conversation's agent records, with its agents. */
export const deleteConversationAgentLogs = (db: OwnerDb, jobs: OwnerJobs, conversationId: string): void => {
  // Every append records its agent's holder first, so the holders list every
  // thread with records in this conversation.
  const threads = db
    .all<{ thread_id: string }>("SELECT thread_id FROM agent_log_holders WHERE conversation_id = ?", conversationId)
    .map((row) => row.thread_id);
  const segments: string[] = [];
  for (const threadId of threads) {
    for (const row of db.all<{ segment: string }>(
      "SELECT DISTINCT segment FROM agent_log_records WHERE thread_id = ? AND segment IS NOT NULL",
      threadId,
    )) {
      segments.push(row.segment);
    }
  }
  for (let index = 0; index < segments.length; index += SEGMENT_DELETE_BATCH) {
    jobs.schedule(AGENT_LOG_SEGMENT_DELETE_JOB, 0, { keys: segments.slice(index, index + SEGMENT_DELETE_BATCH) });
  }
  for (const threadId of threads) {
    db.run("DELETE FROM agent_log_records WHERE thread_id = ? AND conversation_id = ?", threadId, conversationId);
  }
  db.run("DELETE FROM agent_log_holders WHERE conversation_id = ?", conversationId);
};

const threadIdArg = string({ min: 1, max: 256 });

const recordsArg = array(
  object({
    key: string({ min: 1, max: 512 }),
    role: literal("user", "assistant", "toolResult", "checkpoint"),
    payloadJson: string({ min: 2, max: AGENT_LOG_RECORD_MAX_BYTES }),
  }),
  { max: 200 },
);

const cloudAppendParser = object({
  threadId: threadIdArg,
  conversationId: string({ min: 1, max: 512 }),
  records: recordsArg,
});

const readParser = object({
  threadId: threadIdArg,
  afterSeq: number({ int: true, min: -1 }),
  limit: optional(number({ int: true, min: 1, max: AGENT_LOG_READ_MAX_RECORDS })),
});

/**
 * The cloud's own writes, for the agents it runs: refused like any other
 * holder's once the agent moved away, so a late write from a cloud turn
 * never lands in a log another host holds now.
 */
const cloudAppend = (ctx: OwnerContext, raw: unknown) => {
  const args = cloudAppendParser(raw);
  return append(ctx, { ...args, holder: AGENT_LOG_CLOUD_HOLDER });
};

export const agentLogsDomain = {
  name: "agent-logs",
  migrations: [AGENT_LOGS_MIGRATION, AGENT_LOGS_COLD_MIGRATION, AGENT_LOGS_LEAN_INDEX_MIGRATION],
  jobs: {
    [AGENT_LOG_ARCHIVE_JOB]: { run: (ctx) => archiveColdRecords(ctx), maxAttempts: 10 },
    [AGENT_LOG_SEGMENT_DELETE_JOB]: {
      run: async (ctx, payload) => {
        const keys = (payload as { keys?: unknown } | null)?.keys;
        const bucket = ctx.env.CONVERSATION_ARCHIVE;
        if (!bucket || !Array.isArray(keys)) return;
        const owned = await agentLogsPrefix(ctx.ownerId);
        const mine = keys.filter((key): key is string => typeof key === "string" && key.startsWith(owned));
        if (mine.length > 0) await bucket.delete(mine);
      },
    },
  },
  calls: {
    "agentLogs.append": {
      scope: "owner",
      maxBodyBytes: AGENT_LOG_APPEND_MAX_BODY_BYTES,
      parse: object({
        threadId: threadIdArg,
        conversationId: string({ min: 1, max: 512 }),
        holder: string({ min: 1, max: 600 }),
        records: recordsArg,
      }),
      handler: (ctx, args) => {
        if (!args.holder.startsWith("device:")) throw new RpcError("BAD_REQUEST", "Only a computer writes an agent's log here.");
        return append(ctx, args);
      },
    },
    "agentLogs.read": {
      scope: "owner",
      parse: readParser,
      handler: read,
    },
  },
  internal: {
    "agentLogs.cloudAppend": cloudAppend,
    "agentLogs.cloudRead": (ctx, raw) => read(ctx, readParser(raw)),
  },
  purge: async (ctx) => {
    ctx.db.run("DELETE FROM agent_log_records");
    ctx.db.run("DELETE FROM agent_log_holders");
    const bucket = ctx.env.CONVERSATION_ARCHIVE;
    if (!bucket) return { pending: false };
    const listed = await bucket.list({ prefix: await agentLogsPrefix(ctx.ownerId), limit: 1_000 });
    if (listed.objects.length > 0) await bucket.delete(listed.objects.map((entry) => entry.key));
    return { pending: listed.truncated };
  },
} satisfies OwnerDomain;
