/**
 * A cloud agent thread's side of its log in the owner's cloud
 * (`@stella/contracts/backend/agent-logs`): the same conversation the agent
 * had wherever it ran before.
 *
 * Before a turn, records another host wrote since the last import land in
 * this thread's own transcript, so an agent that moved here from a computer
 * continues with its whole conversation. After a turn, the rows the turn
 * produced go to the log, so a computer it moves to next catches up from
 * there. Both are deltas: the import keeps the newest seq it took, and the
 * owner's log keeps each record once by key.
 */
import {
  AGENT_LOG_MOVED_REASON,
  AGENT_LOG_RECORD_MAX_BYTES,
  type AgentLogCalls,
  type AgentLogRecordDraft,
} from "@stella/contracts/backend/agent-logs";
import type { RpcResponse } from "@stella/contracts/backend/protocol";
import { parseAuthoritativeAgentHistory } from "@stella/executor-cloud/agent-history";
import { ownerGateStub } from "../rpc-release.js";
import { appendThreadMessages, type ThreadMessageInput } from "../thread-transcript.js";
import { log } from "./shared/keys.js";
import type { TurnRequest } from "./shared/types.js";

const IMPORT_TABLE = `CREATE TABLE IF NOT EXISTS agent_log_import (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  imported_seq INTEGER NOT NULL
)`;

/** Turn ids the imported rows are stored under in this thread's transcript. */
const IMPORTED_TURN = "agent-log";
const IMPORTED_SUMMARY_TURN = "agent-log-summary";

/** Keys of the records this cloud writes, which it never imports back. */
const CLOUD_RECORD_PREFIX = "cloud:";

const APPEND_BATCH_BYTES = 768 * 1024;
const APPEND_BATCH_RECORDS = 200;
const IMPORT_MAX_PAGES = 50;

type Bridge = { ctx: DurableObjectState; env: Cloudflare.Env };

type Internal = (name: string, args: unknown) => Promise<unknown>;

const internalOf = (env: Cloudflare.Env, turn: TurnRequest): Internal => async (name, args) => {
  const response = (await ownerGateStub(env.OWNER_GATES, turn.ownerId).ownerInternal({
    name,
    args,
    ownerGeneration: turn.ownerGeneration,
  })) as RpcResponse;
  if (!response.ok) {
    const error = new Error(response.error.message) as Error & { reason?: unknown };
    error.reason = response.error.reason;
    throw error;
  }
  return response.value;
};

const importedSeq = (sql: SqlStorage): number | undefined => {
  sql.exec(IMPORT_TABLE);
  return sql.exec<{ imported_seq: number }>("SELECT imported_seq FROM agent_log_import WHERE singleton = 1").toArray()[0]
    ?.imported_seq;
};

const recordImported = (sql: SqlStorage, seq: number): void => {
  sql.exec(
    `INSERT INTO agent_log_import (singleton, imported_seq) VALUES (1, ?)
     ON CONFLICT (singleton) DO UPDATE SET imported_seq = MAX(imported_seq, excluded.imported_seq)`,
    seq,
  );
};

type Part = { type?: unknown; [key: string]: unknown };

const ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const STOP_REASONS = new Set(["stop", "length", "toolUse", "error", "aborted"]);

const textOf = (part: Part): string | undefined => (typeof part.text === "string" ? part.text : undefined);

/**
 * Another host's message in the shape this executor takes as history: the
 * fields it requires filled in, and parts it does not know turned into text,
 * so a message is never dropped (a dropped call would orphan its result).
 */
const historyPayload = (role: "user" | "assistant" | "toolResult", payloadJson: string): string | undefined => {
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(payloadJson) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (!message || typeof message !== "object" || message.role !== role) return undefined;
  const timestamp = typeof message.timestamp === "number" && Number.isFinite(message.timestamp) ? message.timestamp : Date.now();
  const parts = (value: unknown): Part[] => (Array.isArray(value) ? (value as Part[]).filter((part) => part && typeof part === "object") : []);
  const plain = (part: Part): Part | undefined => {
    const text = textOf(part);
    return text === undefined ? undefined : { type: "text", text };
  };
  let repaired: Record<string, unknown>;
  if (role === "user") {
    const content =
      typeof message.content === "string"
        ? message.content
        : parts(message.content).flatMap((part) =>
            part.type === "image" && typeof part.data === "string" && typeof part.mimeType === "string"
              ? [{ type: "image", data: part.data, mimeType: part.mimeType }]
              : (plain(part) ?? []),
          );
    repaired = { role, content, timestamp };
  } else if (role === "toolResult") {
    repaired = {
      role,
      toolCallId: String(message.toolCallId ?? ""),
      toolName: String(message.toolName ?? "tool"),
      isError: message.isError === true,
      content: parts(message.content).flatMap((part) =>
        part.type === "image" && typeof part.data === "string" && typeof part.mimeType === "string"
          ? [{ type: "image", data: part.data, mimeType: part.mimeType }]
          : (plain(part) ?? []),
      ),
      timestamp,
    };
  } else {
    const content = parts(message.content).flatMap((part): Part[] => {
      if (part.type === "toolCall" && typeof part.id === "string" && typeof part.name === "string") {
        const args = part.arguments && typeof part.arguments === "object" && !Array.isArray(part.arguments) ? part.arguments : {};
        return [{ type: "toolCall", id: part.id, name: part.name, arguments: args }];
      }
      if (part.type === "thinking") return [];
      return plain(part) ? [plain(part)!] : [];
    });
    const usage = message.usage as Record<string, unknown> | undefined;
    const complete =
      usage && typeof usage === "object" && usage.cost && typeof usage.cost === "object"
        ? { ...ZERO_USAGE, ...usage, cost: { ...ZERO_USAGE.cost, ...(usage.cost as object) } }
        : ZERO_USAGE;
    repaired = {
      role,
      content,
      api: typeof message.api === "string" ? message.api : "agent-log",
      provider: typeof message.provider === "string" ? message.provider : "agent-log",
      model: typeof message.model === "string" ? message.model : "agent-log",
      usage: complete,
      stopReason: typeof message.stopReason === "string" && STOP_REASONS.has(message.stopReason) ? message.stopReason : "stop",
      timestamp,
    };
  }
  const json = JSON.stringify(repaired);
  try {
    parseAuthoritativeAgentHistory([{ seq: 0, role, payloadJson: json, turnId: IMPORTED_TURN }]);
    return json;
  } catch {
    return undefined;
  }
};

const summaryRow = (summary: string): string =>
  JSON.stringify({
    role: "user",
    content: [{ type: "text", text: `[Summary of your conversation before this point]\n\n${summary}` }],
    timestamp: Date.now(),
  });

/**
 * Take what other hosts wrote to this agent's log since the last import.
 * An agent that never ran anywhere else has nothing there; a log this
 * thread cannot read now leaves the turn on what it has.
 */
export const importAgentLogIntoThread = async (
  bridge: Bridge,
  turn: TurnRequest,
  signal?: AbortSignal,
): Promise<number> => {
  if (turn.kind !== "agent" || !turn.threadId || turn.agentRole === "orchestrator") return 0;
  const sql = bridge.ctx.storage.sql;
  const internal = internalOf(bridge.env, turn);
  let after = importedSeq(sql) ?? -1;
  let imported = 0;
  try {
    for (let page = 0; page < IMPORT_MAX_PAGES; page += 1) {
      signal?.throwIfAborted();
      const read = (await internal("agentLogs.cloudRead", {
        threadId: turn.threadId,
        afterSeq: after,
      })) as AgentLogCalls["agentLogs.read"]["result"];
      const messages: ThreadMessageInput[] = [];
      if (after < 0 && read.checkpoint) {
        appendThreadMessages(sql, {
          turnId: IMPORTED_SUMMARY_TURN,
          attemptGeneration: 1,
          messages: [{ ordinal: Math.max(0, read.checkpoint.throughSeq), role: "user", payloadJson: summaryRow(read.checkpoint.summary) }],
          now: Date.now(),
        });
      }
      for (const record of read.records) {
        after = Math.max(after, record.seq);
        if (record.key.startsWith(CLOUD_RECORD_PREFIX) || record.role === "checkpoint") continue;
        const payloadJson = historyPayload(record.role, record.payloadJson);
        if (!payloadJson) continue;
        messages.push({ ordinal: record.seq, role: record.role, payloadJson });
      }
      if (messages.length > 0) {
        appendThreadMessages(sql, { turnId: IMPORTED_TURN, attemptGeneration: 1, messages, now: Date.now() });
        imported += messages.length;
      }
      if (read.records.length > 0) recordImported(sql, after);
      if (read.complete || read.records.length === 0) break;
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    log("error", "agent_log_import_failed", {
      threadId: turn.threadId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (imported > 0) log("info", "agent_log_imported", { threadId: turn.threadId, records: imported, throughSeq: after });
  return imported;
};

/**
 * The rows a turn produced, into the agent's log. The agent moving away
 * since refuses them (the new holder writes it now), which is no failure.
 */
export const writeThreadToAgentLog = async (
  bridge: Pick<Bridge, "env">,
  turn: TurnRequest,
  messages: readonly ThreadMessageInput[],
): Promise<void> => {
  if (turn.kind !== "agent" || !turn.threadId || turn.agentRole === "orchestrator" || messages.length === 0) return;
  const conversationId = turn.conversationId ?? turn.originConversationId;
  if (!conversationId) return;
  const internal = internalOf(bridge.env, turn);
  const generation = turn.attemptGeneration ?? 1;
  const drafts: AgentLogRecordDraft[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant" && message.role !== "toolResult") continue;
    if (message.payloadJson.length > AGENT_LOG_RECORD_MAX_BYTES) continue;
    drafts.push({
      key: `${CLOUD_RECORD_PREFIX}${turn.turnId}:${generation}:${message.ordinal}`,
      role: message.role,
      payloadJson: message.payloadJson,
    });
  }
  const started = Date.now();
  let bytes = 0;
  try {
    let batch: AgentLogRecordDraft[] = [];
    let batchBytes = 0;
    const send = async () => {
      if (batch.length === 0) return;
      await internal("agentLogs.cloudAppend", { threadId: turn.threadId, conversationId, records: batch });
      bytes += batchBytes;
      batch = [];
      batchBytes = 0;
    };
    for (const draft of drafts) {
      if (batch.length >= APPEND_BATCH_RECORDS || batchBytes + draft.payloadJson.length > APPEND_BATCH_BYTES) await send();
      batch.push(draft);
      batchBytes += draft.payloadJson.length;
    }
    await send();
    log("info", "agent_log_appended", { threadId: turn.threadId, records: drafts.length, bytes, ms: Date.now() - started });
  } catch (error) {
    const reason = (error as { reason?: unknown }).reason;
    if (reason === AGENT_LOG_MOVED_REASON) return;
    log("error", "agent_log_append_failed", {
      threadId: turn.threadId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
