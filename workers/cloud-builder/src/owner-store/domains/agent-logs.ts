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
import type { OwnerContext, OwnerDb, OwnerDbReader, OwnerDomain } from "../registry.js";

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

/** Response pages stay well under what one RPC answer carries. */
const READ_PAGE_MAX_BYTES = 2 * 1024 * 1024;

type RecordRow = {
  seq: number;
  record_key: string;
  role: string;
  payload_json: string;
  created_at: number;
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
  return ctx.db.transaction ? ctx.db.transaction(write) : write();
};

const asRecord = (row: RecordRow): AgentLogRecord => ({
  seq: row.seq,
  key: row.record_key,
  role: row.role as AgentLogRecord["role"],
  payloadJson: row.payload_json,
  createdAt: row.created_at,
});

type ReadArgs = AgentLogCalls["agentLogs.read"]["args"];

const read = (ctx: OwnerContext, args: ReadArgs): AgentLogCalls["agentLogs.read"]["result"] => {
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
    `SELECT seq, record_key, role, payload_json, created_at FROM agent_log_records
      WHERE thread_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
    args.threadId,
    after,
    limit + 1,
  );
  const records: AgentLogRecord[] = [];
  let bytes = 0;
  for (const row of rows.slice(0, limit)) {
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
export const deleteConversationAgentLogs = (db: OwnerDb, conversationId: string): void => {
  db.run("DELETE FROM agent_log_records WHERE conversation_id = ?", conversationId);
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
  migrations: [AGENT_LOGS_MIGRATION],
  calls: {
    "agentLogs.append": {
      scope: "owner",
      requireAccount: true,
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
      requireAccount: true,
      parse: readParser,
      handler: read,
    },
  },
  internal: {
    "agentLogs.cloudAppend": cloudAppend,
    "agentLogs.cloudRead": (ctx, raw) => read(ctx, readParser(raw)),
  },
  purge: (ctx) => {
    ctx.db.run("DELETE FROM agent_log_records");
    ctx.db.run("DELETE FROM agent_log_holders");
    return { pending: false };
  },
} satisfies OwnerDomain;
