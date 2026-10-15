import type { AgentActivityEntry } from "@stella/contracts/conversation-agent-activity";
import type { CloudAgentLifecycleCard } from "@stella/contracts/cloud-agent-lifecycle";
import type {
  MessageRole,
  TurnPhase,
} from "@stella/contracts/conversation-protocol";

export {
  BACKFILL_BATCH_RECORDS,
  CLOSE_BAD_REQUEST,
  CLOSE_DELETED,
  CLOSE_FORBIDDEN,
  CLOSE_FRAME_TOO_LARGE,
  CLOSE_NOT_FOUND,
  CLOSE_PROTOCOL_VERSION,
  CLOSE_RATE_LIMITED,
  CLOSE_TOO_MANY_SOCKETS,
  CLOSE_UNAUTHENTICATED,
  INITIAL_WINDOW_RECORDS,
  MAX_RESUME_RECORDS,
  PROTOCOL_VERSION,
  RATE_BACKFILL_PER_MIN,
  RE_AUTH_LEAD_MS,
  SOCKET_STALE_MS,
} from "@stella/contracts/conversation-protocol";
export type { MessageRole, TurnPhase };

export const JOURNAL_SCHEMA_VERSION = 12;

export const RESIDENT_CONTEXT_TOKENS = 1_000_000;
export const RESIDENT_ROLLOVER_TOKENS = 1_500_000;
export const HOT_MAX_BYTES = 48 * 1024 * 1024;
export const CUT_SCAN_PAGE_ROWS = 1_000;
export const CUT_SCAN_MAX_ROWS = 100_000;
export const DB_PRESSURE_AGGRESSIVE_BYTES = 64 * 1024 * 1024;
export const DB_PRESSURE_EMERGENCY_BYTES = 512 * 1024 * 1024;
export const DB_PRESSURE_AGGRESSIVE_ROWS = 500;
export const DB_PRESSURE_EMERGENCY_ROWS = 200;
/** Spill to R2 above this. The platform row cap is 2 MB; this leaves margin. */
export const MAX_ROW_BYTES = 1024 * 1024;
/** Platform allows 6 simultaneous outgoing connections; leave room for R2 retries. */
export const MAX_SEGMENTS_PER_READ = 4;

export const CONTEXT_SCAN_ROW_CAP = 4_000;
export const CONTEXT_MAX_SPILL_HYDRATIONS = 3;
export const REPAIR_SCAN_ROW_CAP = 400;

export { MAX_CATCHUP_RESUME_RECORDS as MAX_CATCH_UP_RECORDS } from "@stella/contracts/conversation-protocol";
export const AGENT_ACTIVITY_SCAN_ROWS = 1_000;
export const BACKFILL_BATCH_BYTES = 512 * 1024;
export const MAX_SOCKETS_PER_CONVERSATION = 16;
export const MAX_INCOMING_FRAME_BYTES = 64 * 1024;
export const AUTH_GRACE_MS = 30_000;
export const RATE_CANCEL_PER_MIN = 10;
export const RATE_AUTH_PER_MIN = 10;
export const RATE_TOTAL_PER_MIN = 60;

export const TOOL_ARGS_PREVIEW_MAX = 400;

export const APPEND_MAX_ROWS = 256;
export const APPEND_MAX_BYTES = 4 * 1024 * 1024;
export const INBOX_MAX_ROWS = 200;
export const INBOX_MAX_BYTES = 2 * 1024 * 1024;

export const APPEND_WINDOW_MS = 60_000;
export const APPEND_WINDOW_MAX_REQUESTS = 60;
export const APPEND_WINDOW_MAX_BYTES = 16 * 1024 * 1024;
export const CONVERSATION_MAX_STORED_BYTES = 4 * 1024 * 1024 * 1024;

export const PREVIEW_MAX_CHARS = 160;

export const JWKS_MIN_REFETCH_MS = 60_000;
export const CLOCK_SKEW_S = 60;

export const CLOSE_INTERNAL = 1011;

export type ConversationCard =
  | CloudAgentLifecycleCard
  | import("@stella/contracts/claude-usage-limit").ClaudeUsageLimitCard
  | import("@stella/contracts/reminders").ReminderCard
  | import("@stella/contracts/schedule-notice").ScheduleNoticeCard
  | { type: "build"; buildId: string; appId?: string }
  | { type: "operation"; operation: string; args?: unknown; result?: unknown }
  | {
      type: "files";
      files: Array<{
        path: string;
        name: string;
        sizeBytes: number;
        contentType?: string;
        stored?: boolean;
      }>;
    };

export type JournalMessageRecord = {
  seq: number;
  kind: "message";
  turnId: string;
  createdAtMs: number;
  role: MessageRole;
  hidden: boolean;
  /** Ties this committed row to the advisory deltas that preceded it. */
  streamId?: string;
  clientMsgId?: string;
  payload: unknown;
};

export type JournalTurnRecord = {
  seq: number;
  kind: "turn";
  turnId: string;
  createdAtMs: number;
  phase: TurnPhase;
  lane?: string;
  source?: string;
  notice?: string;
  promptSeq?: number;
  wallClockMs?: number;
};

export type JournalCardRecord = {
  seq: number;
  kind: "card";
  turnId: string;
  createdAtMs: number;
  card: ConversationCard;
};

export type JournalRecord =
  | JournalMessageRecord
  | JournalTurnRecord
  | JournalCardRecord;

export type JournalHead = {
  headSeq: number;
  windowStartSeq: number;
  floorSeq: number;
  epoch: number;
  title: string;
  deleted: boolean;
  activity: "idle" | "running";
};

export type JournalRange = {
  records: JournalRecord[];
  complete: boolean;
  missingBelowSeq?: number;
};

export type LiveTurnSnapshot = {
  turnId: string;
  streamId: string | null;
  /**
   * Always empty. Assistant text is delivered whole on the committed record,
   * so a turn in flight has no partial reply to hand a mid-turn joiner. The
   * field stays on the wire while clients still read it; it is retired with
   * their delta handling.
   */
  partialText: string;
  tools: Array<{
    toolCallId: string;
    name: string;
    label?: string;
    phase: "start" | "end";
    isError?: boolean;
  }>;
};

export type ConversationOwnerRecord = {
  ownerId: string;
  ownerGeneration: string;
  createdAt: number;
  title: string;
};

export interface JournalReader {
  head(): JournalHead;
  ownerId(): string;
  bindOwner(record: ConversationOwnerRecord): void;
  readRange(
    fromSeq: number,
    toSeq: number,
    limit: number,
  ): Promise<JournalRange>;
  newest(limit: number): JournalRecord[];
  liveTurn(): LiveTurnSnapshot | null;
  runningAgents(limit: number): AgentActivityEntry[];
}

export type SocketIdentity = {
  ownerId: string;
  subject: string;
  sessionId?: string;
  authExpiresAtMs: number;
};

export const HEADER_OWNER = "x-stella-owner";
export const HEADER_SUBJECT = "x-stella-subject";
export const HEADER_SESSION = "x-stella-session";
export const HEADER_TOKEN_EXP = "x-stella-token-exp";
export const HEADER_IDENTITY_LEVEL = "x-stella-identity-level";
export const HEADER_TOKEN_IAT = "x-stella-token-iat";
/**
 * The pinned backend origin the worker verified against. It rides along so the
 * DO can verify a mid-life `auth` frame without needing its own copy of the
 * issuer configuration — the worker's isolate globals are not the DO's.
 */
export const HEADER_ISSUER = "x-stella-auth-issuer";
export const STELLA_HEADER_PREFIX = "x-stella-";

export const parseSocketIdentity = (
  request: Request,
): SocketIdentity | null => {
  const ownerId = request.headers.get(HEADER_OWNER)?.trim() ?? "";
  const subject = request.headers.get(HEADER_SUBJECT)?.trim() ?? "";
  const expires = Number(request.headers.get(HEADER_TOKEN_EXP) ?? "");
  if (!ownerId || !subject || !Number.isFinite(expires)) return null;
  return {
    ownerId,
    subject,
    sessionId: request.headers.get(HEADER_SESSION)?.trim() || undefined,
    authExpiresAtMs: expires,
  };
};

export type ToolInput = {
  turnId: string;
  toolCallId: string;
  name: string;
  label?: string;
  phase: "start" | "end";
  argsPreview?: string;
  isError?: boolean;
};

export interface ConversationHub {
  upgrade(request: Request, identity: SocketIdentity): Promise<Response>;
  onMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void>;
  onClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ): Promise<void>;
  onError(ws: WebSocket, error: unknown): Promise<void>;
  broadcastRecord(record: JournalRecord): void;
  broadcastTool(tool: ToolInput): void;
  agentsChanged(): void;
  broadcastPi(events: readonly unknown[]): void;
  broadcastBrain(record: import("@stella/contracts/turn-plane/pi-brain").PiBrainRecord | null): void;
  piSocketCount(): number;
  endTurn(turnId: string): void;
  closeAll(code: number): void;
}

export type ConversationLogger = (
  level: "info" | "error",
  event: string,
  fields?: Record<string, unknown>,
) => void;

export interface ConversationHubDeps {
  ctx: DurableObjectState;
  reader: JournalReader;
  /**
   * Resolves the conversation's owner for a verified connector. The session
   * is the owner authority: a bound conversation answers from its journal
   * (null when the connector is not its owner), and an unbound one adopts
   * the verified connector — conversation ids are client-minted UUIDs, so
   * the first authenticated caller is by construction the client that
   * minted the id. Null means the hub must close 4404.
   */
  lookupOwner: (
    identity: SocketIdentity,
  ) => Promise<ConversationOwnerRecord | null>;
  cancelTurn: (turnId: string) => Promise<void>;
  /** Storage flushes a lagging owner index row on first connect. */
  onConnect: () => void;
  conversationId: () => string;
  log: ConversationLogger;
  verifyToken: (token: string) => Promise<import("./auth-jwt.js").VerifyResult>;
  pi?: PiSocketSource;
}

export interface PiSocketSource {
  enabled(): Promise<boolean>;
  attach(): Promise<{ snapshot: unknown; hasOlder: boolean }>;
  older(beforeEntryId: number): Promise<{ entries: unknown[]; hasOlder: boolean }>;
  detach(): void;
}

export type ConversationHubFactory = (
  deps: ConversationHubDeps,
) => ConversationHub;

/**
 * A hub that accepts nothing. It is what runs before the socket half of this
 * migration lands, and what runs if that half is ever reverted: the DO keeps
 * its transcript and its turn lifecycle either way, and clients fall back to
 * the owner event projection. Deliberately not an error — a missing socket
 * layer must degrade, never break turns.
 */
export class NullConversationHub implements ConversationHub {
  async upgrade(): Promise<Response> {
    return Response.json(
      {
        error: "Live conversation streaming isn't available yet.",
        code: "socket_unavailable",
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  async onMessage(): Promise<void> {}
  async onClose(): Promise<void> {}
  async onError(): Promise<void> {}
  broadcastRecord(): void {}
  broadcastTool(): void {}
  agentsChanged(): void {}
  broadcastPi(): void {}
  broadcastBrain(): void {}
  piSocketCount(): number {
    return 0;
  }
  endTurn(): void {}
  closeAll(): void {}
}

let hubFactory: ConversationHubFactory | null = null;

/**
 * The one wiring point between the two halves. The socket module registers
 * itself at import time; `index.ts` importing that module is what turns the
 * hub on. Registration rather than a direct import so each half can land,
 * typecheck and deploy on its own.
 */
export const registerConversationHubFactory = (
  factory: ConversationHubFactory,
): void => {
  hubFactory = factory;
};

export const createConversationHub = (
  deps: ConversationHubDeps,
): ConversationHub =>
  hubFactory ? hubFactory(deps) : new NullConversationHub();

export const utf8Length = (value: string): number => {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
};

export type SpillStub = {
  $spill: true;
  role: string;
  bytes: number;
  content?: Array<{ type: "text"; text: string }>;
  timestamp?: number;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
};

export const isSpillStub = (value: unknown): value is SpillStub =>
  typeof value === "object" &&
  value !== null &&
  (value as { $spill?: unknown }).$spill === true;
