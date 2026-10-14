import {
  parseCloudAgentLifecycleCard,
  type CloudAgentLifecycleCard,
} from "./cloud-agent-lifecycle.js";
import {
  parseClaudeUsageLimitCard,
  type ClaudeUsageLimitCard,
} from "./claude-usage-limit.js";
import {
  parseReminderCard,
  REMINDER_CARD_TYPE,
  type ReminderCard,
} from "./reminders.js";
import {
  parseAgentActivityEntry,
  type AgentActivityEntry,
} from "./conversation-agent-activity.js";
import {
  parsePiBrainRecord,
  type PiBrainRecord,
} from "./turn-plane/pi-brain.js";

export const PROTOCOL_VERSION = 1;

export const INITIAL_WINDOW_RECORDS = 100;
export const MAX_RESUME_RECORDS = 2_000;
export const MAX_CATCHUP_RESUME_RECORDS = 300;
export const BACKFILL_BATCH_RECORDS = 200;
export const SOCKET_STALE_MS = 90_000;
/**
 * How far ahead of expiry the token is refreshed. Mirrors the server constant,
 * but the CLIENT timer is the primary one: the server's `auth.expiring` rides
 * on the send path, so an idle socket is never warned and would lapse silently,
 * making the next wake or scheduled reply cost a reconnect.
 */
export const RE_AUTH_LEAD_MS = 60_000;
export const RATE_BACKFILL_PER_MIN = 20;

export const MAX_CLIENT_RECORDS = 3_000;

export const MAX_BUFFERED_AHEAD = 512;

/**
 * Close codes the hub sends. The close *reason* is capped at 123 bytes by the
 * protocol, so it carries the code only; human text rides a preceding `error`
 * frame.
 */
export const CLOSE_BAD_REQUEST = 4400;
export const CLOSE_UNAUTHENTICATED = 4401;
export const CLOSE_FORBIDDEN = 4403;
export const CLOSE_NOT_FOUND = 4404;
export const CLOSE_PROTOCOL_VERSION = 4409;
export const CLOSE_DELETED = 4410;
export const CLOSE_FRAME_TOO_LARGE = 4413;
export const CLOSE_RATE_LIMITED = 4429;
export const CLOSE_TOO_MANY_SOCKETS = 4503;

export const TERMINAL_CLOSE_CODES: ReadonlySet<number> = new Set([
  CLOSE_BAD_REQUEST,
  CLOSE_FORBIDDEN,
  CLOSE_NOT_FOUND,
  CLOSE_PROTOCOL_VERSION,
  CLOSE_DELETED,
  CLOSE_FRAME_TOO_LARGE,
]);

export type MessageRole = "user" | "assistant" | "toolResult";

export type TurnPhase =
  | "started"
  | "completed"
  | "failed"
  | "canceled"
  | "timeout";

export type JournalFile = {
  path: string;
  name: string;
  sizeBytes: number;
  contentType: string;
  stored?: boolean;
};

export type JournalCard =
  | CloudAgentLifecycleCard
  | { type: "build"; buildId: string; appId?: string }
  | {
      type: "operation";
      operation: string;
      args?: Record<string, unknown>;
      result?: Record<string, unknown> | null;
    }
  | { type: "files"; files: JournalFile[] }
  | ClaudeUsageLimitCard
  | ReminderCard;

type JournalRecordBase = {
  seq: number;
  turnId: string;
  createdAtMs: number;
};

export type JournalMessageRecord = JournalRecordBase & {
  kind: "message";
  role: MessageRole;
  hidden: boolean;
  clientMsgId?: string;
  payload: Record<string, unknown>;
};

export type JournalTurnRecord = JournalRecordBase & {
  kind: "turn";
  phase: TurnPhase;
  lane?: string;
  source?: string;
  notice?: string;
  wallClockMs?: number;
};

export type JournalCardRecord = JournalRecordBase & {
  kind: "card";
  card: JournalCard;
};

export type KnownJournalRecord =
  | JournalMessageRecord
  | JournalTurnRecord
  | JournalCardRecord;

export type SkippedJournalRecord = JournalRecordBase & {
  kind: "skipped";
  originalKind?: string;
};

export type JournalRecord = KnownJournalRecord | SkippedJournalRecord;

export type LiveTurnSnapshot = {
  turnId: string;
  tools: Array<{
    toolCallId: string;
    name: string;
    label?: string;
    phase: "start" | "end";
    isError?: boolean;
  }>;
};

export type ReadyFrame = {
  type: "ready";
  protocol: number;
  conversationId: string;
  epoch: number;
  headSeq: number;
  windowStartSeq: number;
  floorSeq: number;
  title: string;
  activity: string;
  authExpiresAtMs: number;
  serverTimeMs: number;
  live: LiveTurnSnapshot | null;
  agents: AgentActivityEntry[];
};

export type AgentsFrame = {
  type: "agents";
  agents: AgentActivityEntry[];
  atMs: number;
};

export type ServerFrame =
  | ReadyFrame
  | AgentsFrame
  | ({ type: "record" } & JournalRecord)
  | {
      type: "backfill";
      requestId: string;
      fromSeq: number;
      toSeq: number;
      complete: boolean;
      records: JournalRecord[];
    }
  | { type: "gap"; fromSeq: number; toSeq: number; reason: string }
  | { type: "reset"; reason: "epoch" | "window" }
  | {
      type: "tool";
      turnId: string;
      toolCallId: string;
      name: string;
      label?: string;
      phase: "start" | "end";
      argsPreview?: string;
      isError?: boolean;
    }
  | { type: "auth.expiring"; atMs: number }
  | { type: "brain"; record: PiBrainRecord | null }
  | {
      type: "error";
      code: string;
      message: string;
      retryable: boolean;
      ref?: string;
    };

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

const str = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const seqNum = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;

const MESSAGE_ROLES: ReadonlySet<string> = new Set([
  "user",
  "assistant",
  "toolResult",
]);

const TURN_PHASES: ReadonlySet<string> = new Set([
  "started",
  "completed",
  "failed",
  "canceled",
  "timeout",
]);

export const decodeRecord = (value: unknown): KnownJournalRecord | null => {
  const raw = asRecord(value);
  if (!raw) return null;
  const seq = seqNum(raw.seq);
  const turnId = str(raw.turnId);
  const kind = str(raw.kind);
  if (seq === undefined || turnId === undefined || !kind) return null;
  const createdAtMs = num(raw.createdAtMs) ?? 0;
  if (kind === "message") {
    const role = str(raw.role);
    const payload = asRecord(raw.payload);
    if (!role || !MESSAGE_ROLES.has(role) || !payload) return null;
    return {
      kind: "message",
      seq,
      turnId,
      createdAtMs,
      role: role as MessageRole,
      hidden: raw.hidden === true,
      ...(str(raw.clientMsgId)
        ? { clientMsgId: str(raw.clientMsgId) as string }
        : {}),
      payload,
    };
  }
  if (kind === "turn") {
    const phase = str(raw.phase);
    if (!phase || !TURN_PHASES.has(phase)) return null;
    return {
      kind: "turn",
      seq,
      turnId,
      createdAtMs,
      phase: phase as TurnPhase,
      ...(str(raw.lane) ? { lane: str(raw.lane) as string } : {}),
      ...(str(raw.source) ? { source: str(raw.source) as string } : {}),
      ...(str(raw.notice) ? { notice: str(raw.notice) as string } : {}),
      ...(num(raw.wallClockMs) !== undefined
        ? { wallClockMs: num(raw.wallClockMs) as number }
        : {}),
    };
  }
  if (kind === "card") {
    const card = decodeCard(raw.card);
    if (!card) return null;
    return { kind: "card", seq, turnId, createdAtMs, card };
  }
  return null;
};

export const decodeSequencedJournalEntry = (
  value: unknown,
): JournalRecord | null => {
  const raw = asRecord(value);
  const seq = seqNum(raw?.seq);
  if (!raw || seq === undefined) return null;
  const decoded = decodeRecord(raw);
  if (decoded) return decoded;
  const originalKind = str(raw.kind);
  return {
    kind: "skipped",
    seq,
    turnId: str(raw.turnId) ?? "",
    createdAtMs: num(raw.createdAtMs) ?? 0,
    ...(originalKind ? { originalKind } : {}),
  };
};

const decodeCard = (value: unknown): JournalCard | null => {
  const raw = asRecord(value);
  const type = str(raw?.type);
  if (!raw || !type) return null;
  if (type === "agent-lifecycle") return parseCloudAgentLifecycleCard(raw);
  if (type === "usage-limit") return parseClaudeUsageLimitCard(raw);
  if (type === REMINDER_CARD_TYPE) return parseReminderCard(raw);
  if (type === "build") {
    const buildId = str(raw.buildId);
    if (!buildId) return null;
    return {
      type: "build",
      buildId,
      ...(str(raw.appId) ? { appId: str(raw.appId) as string } : {}),
    };
  }
  if (type === "operation") {
    const operation = str(raw.operation);
    if (!operation) return null;
    return {
      type: "operation",
      operation,
      ...(asRecord(raw.args)
        ? { args: asRecord(raw.args) as Record<string, unknown> }
        : {}),
      ...(asRecord(raw.result)
        ? { result: asRecord(raw.result) as Record<string, unknown> }
        : {}),
    };
  }
  if (type === "files") {
    if (!Array.isArray(raw.files)) return null;
    const files: JournalFile[] = [];
    for (const entry of raw.files) {
      const file = asRecord(entry);
      const path = str(file?.path);
      if (!file || !path) continue;
      files.push({
        path,
        name: str(file.name) ?? path.split("/").pop() ?? path,
        sizeBytes: num(file.sizeBytes) ?? 0,
        contentType: str(file.contentType) ?? "application/octet-stream",
        ...(file.stored === false ? { stored: false } : {}),
      });
    }
    if (!files.length) return null;
    return { type: "files", files };
  }
  return null;
};

export const messageText = (payload: Record<string, unknown>): string => {
  const content = payload.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const entry of content) {
    const block = asRecord(entry);
    if (block?.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.join("\n").trim();
};

export const hasToolCalls = (payload: Record<string, unknown>): boolean =>
  Array.isArray(payload.content) &&
  payload.content.some((entry) => asRecord(entry)?.type === "toolCall");

export const decodeServerFrame = (data: string): ServerFrame | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  const raw = asRecord(parsed);
  const type = str(raw?.type);
  if (!raw || !type) return null;
  switch (type) {
    case "ready": {
      const conversationId = str(raw.conversationId);
      if (!conversationId) return null;
      return {
        type: "ready",
        protocol: num(raw.protocol) ?? PROTOCOL_VERSION,
        conversationId,
        epoch: num(raw.epoch) ?? 0,
        headSeq: num(raw.headSeq) ?? -1,
        windowStartSeq: num(raw.windowStartSeq) ?? 0,
        floorSeq: num(raw.floorSeq) ?? 0,
        title: str(raw.title) ?? "",
        activity: str(raw.activity) ?? "idle",
        authExpiresAtMs: num(raw.authExpiresAtMs) ?? 0,
        serverTimeMs: num(raw.serverTimeMs) ?? Date.now(),
        live: decodeLive(raw.live),
        agents: decodeAgents(raw.agents),
      };
    }
    case "agents":
      return {
        type: "agents",
        agents: decodeAgents(raw.agents),
        atMs: num(raw.atMs) ?? Date.now(),
      };
    case "record": {
      const record = decodeSequencedJournalEntry(raw);
      return record ? { type: "record", ...record } : null;
    }
    case "backfill": {
      const requestId = str(raw.requestId);
      if (!requestId || !Array.isArray(raw.records)) return null;
      const records: JournalRecord[] = [];
      for (const entry of raw.records) {
        const record = decodeSequencedJournalEntry(entry);
        if (record) records.push(record);
      }
      return {
        type: "backfill",
        requestId,
        fromSeq: num(raw.fromSeq) ?? 0,
        toSeq: num(raw.toSeq) ?? 0,
        complete: raw.complete !== false,
        records,
      };
    }
    case "gap":
      return {
        type: "gap",
        fromSeq: num(raw.fromSeq) ?? 0,
        toSeq: num(raw.toSeq) ?? 0,
        reason: str(raw.reason) ?? "compacted",
      };
    case "reset":
      return {
        type: "reset",
        reason: raw.reason === "epoch" ? "epoch" : "window",
      };
    case "tool": {
      const turnId = str(raw.turnId);
      const toolCallId = str(raw.toolCallId);
      const name = str(raw.name);
      if (!turnId || !toolCallId || !name) return null;
      return {
        type: "tool",
        turnId,
        toolCallId,
        name,
        ...(str(raw.label) ? { label: str(raw.label) as string } : {}),
        phase: raw.phase === "end" ? "end" : "start",
        ...(str(raw.argsPreview)
          ? { argsPreview: str(raw.argsPreview) as string }
          : {}),
        ...(raw.isError === true ? { isError: true } : {}),
      };
    }
    case "auth.expiring":
      return { type: "auth.expiring", atMs: num(raw.atMs) ?? 0 };
    case "brain":
      if (raw.record !== null && parsePiBrainRecord(raw.record) === null) {
        return null;
      }
      return { type: "brain", record: parsePiBrainRecord(raw.record) };
    case "error":
      return {
        type: "error",
        code: str(raw.code) ?? "unknown",
        message: str(raw.message) ?? "Something went wrong.",
        retryable: raw.retryable !== false,
        ...(str(raw.ref) ? { ref: str(raw.ref) as string } : {}),
      };
    default:
      return null;
  }
};

const decodeAgents = (value: unknown): AgentActivityEntry[] => {
  if (!Array.isArray(value)) return [];
  const agents: AgentActivityEntry[] = [];
  for (const entry of value) {
    const agent = parseAgentActivityEntry(entry);
    if (agent) agents.push(agent);
  }
  return agents;
};

const decodeLive = (value: unknown): LiveTurnSnapshot | null => {
  const raw = asRecord(value);
  const turnId = str(raw?.turnId);
  if (!raw || !turnId) return null;
  const tools: LiveTurnSnapshot["tools"] = [];
  if (Array.isArray(raw.tools)) {
    for (const entry of raw.tools) {
      const tool = asRecord(entry);
      const toolCallId = str(tool?.toolCallId);
      const name = str(tool?.name);
      if (!tool || !toolCallId || !name) continue;
      tools.push({
        toolCallId,
        name,
        ...(str(tool.label) ? { label: str(tool.label) as string } : {}),
        phase: tool.phase === "end" ? "end" : "start",
        ...(tool.isError === true ? { isError: true } : {}),
      });
    }
  }
  return { turnId, tools };
};

/**
 * RFC 6455 subprotocol values must be RFC 7230 tokens. A backend JWT is
 * base64url with `.` separators, all of which are legal — but a token that
 * somehow is not would throw a `SyntaxError` out of the `WebSocket`
 * constructor, which is a crash rather than a readable failure.
 */
const TOKEN_CHARSET = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/;

export const isSubprotocolSafe = (token: string): boolean =>
  token.length > 0 && TOKEN_CHARSET.test(token);
