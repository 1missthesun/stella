/**
 * The owner's agent threads: cloud agents (each a `BuildSession`) and
 * desktop agents ("computer" placement), for Activity, the running pill,
 * reports and the originating desktop's delivery.
 *
 * Cloud threads are written from two directions. A desktop's spawn, continue
 * and cancel calls land here first and record the attempt before dispatching
 * it; the BuildSession's owner events (`turn.started`, `turn.event`,
 * `thread.spawned`, `thread.completed`) then confirm it. Every write is fenced
 * on the thread's `attempt_generation`, so a late event from an older attempt
 * never rewrites a newer one.
 *
 * A thread with an `executor_device_id` runs on one of the owner's paired
 * devices for someone else: a desktop, the cloud orchestrator or a cloud
 * agent. Its attempts go to that device through the gate's dispatch offer
 * instead of a BuildSession, and the gate reports each terminal dispatch
 * back here. A desktop requester receives the result through its own
 * `forDevice` delivery; a cloud requester is woken (see `settleDeviceAttempt`).
 */

import {
  CLAUDE_USAGE_LIMIT_RESUME_PROMPT,
  claudeUsageLimitOf,
  type ClaudeUsageLimit,
  type ClaudeUsageLimitCard,
} from "@stella/contracts/claude-usage-limit";
import { agentAttemptOutcomeOf, agentStatusOf, isLiveAgentStatus } from "@stella/contracts/agent-status";
import {
  AGENT_PAUSED_REASON,
  agentThreadTerminalStatus,
  newAgentThreadId,
  type AgentControlCommand,
  type AgentControlExecutor,
  type AgentControlOutcome,
  type AgentControlResult,
  type AgentThreadCalls,
  type AgentThreadControl,
  type AgentThreadLookup,
  type AgentThreadSummary,
  type ComputerThreadRecord,
  type DeviceAgentThread,
} from "@stella/contracts/backend/agent-threads";
import {
  AGENT_MESSAGE_MAX_CHARS,
  STELLA_MESSAGE_TARGET,
  formatAgentMessage,
  normalizeAgentDirectoryStatus,
  type AgentDirectoryAgentRow,
  type AgentDirectorySessionRow,
  type AgentMessageSender,
} from "@stella/contracts/agent-directory";
import {
  findDeviceDestination,
  SELECTED_DEVICE_NEEDS_CONSENT,
  type DeviceDestination,
} from "@stella/contracts/turn-plane/placement";
import {
  agentMessageDelivery,
  AGENT_PROMPT_MAX_CHARS,
  AGENT_THREAD_PAGE_MAX,
  RUNNING_AGENT_THREADS_LIMIT,
  CONVERSATION_AGENT_THREADS_MAX,
} from "@stella/contracts/backend/agent-threads";
import { CONVERSATION_TITLE_MAX } from "@stella/contracts/backend/conversations";
import { NOT_SLACK_SQL, readMainConversationId } from "./conversations.js";
import { agentReportId, agentReportReceipt } from "@stella/contracts/backend/agent-reports";
import { isPlacementThreadId, placementRemoteThreadAgentId } from "@stella/contracts/placement-thread-id";
import { OWNER_GENERATION_STALE } from "@stella/contracts/backend/protocol";
import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";
import type { CloudAgentLifecycleCard } from "@stella/contracts/cloud-agent-lifecycle";
import type {
  ThreadCompletedEvent,
  ThreadSpawnedEvent,
  TurnEventEvent,
  TurnStartedEvent,
} from "@stella/contracts/turn-plane/owner-events";
import {
  TURN_ATTACHMENTS_MAX,
  conversationRealm,
  isSlackConversationId,
} from "@stella/contracts/turn-plane/turn-start";
import { parseCloudExecutionSelection } from "../../turn-start-request.js";
import { normalizeDrivePath } from "./drive.js";
import { endedKind, recordAgentChange, startedKind } from "./agent-events.js";
import { queueStellaNote } from "./agent-reports.js";
import { resolveCurrentDeviceId } from "./devices.js";
import { array, literal, number, object, optional, string, type Parser } from "../args.js";
import { RpcError } from "../errors.js";
import { executionUnavailableMessage, snapshotAllowsExecution } from "../../owner-gate/support.js";
import { enforceOwnerRateLimit } from "../rate-limit.js";
import {
  DispatchError,
  type OwnerContext,
  type OwnerDb,
  type OwnerDbReader,
  type OwnerDomain,
  type OwnerJobs,
} from "../registry.js";

type ThreadRow = {
  thread_id: string;
  conversation_id: string;
  owner_generation: string | null;
  parent_turn_id: string | null;
  parent_thread_id: string | null;
  executor_device_id: string | null;
  requested_model: string | null;
  harness: string | null;
  origin_device_id: string | null;
  origin_conversation_id: string | null;
  origin_delivery_ack_at: number | null;
  description: string;
  placement: string;
  agent_type: string;
  execution_json: string | null;
  attempt_generation: number;
  status: string;
  result_json: string | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
};

type TurnRow = {
  turn_id: string;
  thread_id: string | null;
  conversation_id: string | null;
  owner_generation: string | null;
  attempt_generation: number | null;
  status: string;
  client_msg_id: string | null;
  spawn_fingerprint: string | null;
  dispatch_id: string | null;
  created_at: number;
  updated_at: number;
};

export const AGENT_THREADS_MIGRATION = {
  id: "agent-threads.1-init",
  statements: [
    `CREATE TABLE agent_threads (
       thread_id TEXT PRIMARY KEY,
       conversation_id TEXT NOT NULL,
       owner_generation TEXT,
       parent_turn_id TEXT,
       parent_thread_id TEXT,
       workspace_fork_id TEXT,
       origin_device_id TEXT,
       origin_conversation_id TEXT,
       origin_delivery_ack_at INTEGER,
       description TEXT NOT NULL,
       placement TEXT NOT NULL,
       agent_type TEXT NOT NULL,
       execution_json TEXT,
       attempt_generation INTEGER NOT NULL DEFAULT 0,
       status TEXT NOT NULL,
       result_json TEXT,
       error_message TEXT,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
    "CREATE INDEX agent_threads_conversation ON agent_threads (conversation_id, updated_at DESC)",
    "CREATE INDEX agent_threads_updated ON agent_threads (updated_at DESC)",
    `CREATE INDEX agent_threads_device ON agent_threads (origin_device_id, owner_generation, updated_at DESC)
       WHERE origin_delivery_ack_at IS NULL`,
    // Agent attempts only: the spawn replay key, the running turn a cancel
    // targets, and the files a completed thread produced.
    `CREATE TABLE agent_turns (
       turn_id TEXT PRIMARY KEY,
       thread_id TEXT,
       conversation_id TEXT,
       owner_generation TEXT,
       attempt_generation INTEGER,
       status TEXT NOT NULL,
       client_msg_id TEXT,
       spawn_fingerprint TEXT,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
    "CREATE UNIQUE INDEX agent_turns_client_msg ON agent_turns (client_msg_id) WHERE client_msg_id IS NOT NULL",
    "CREATE INDEX agent_turns_thread ON agent_turns (thread_id, created_at DESC)",
    `CREATE TABLE agent_turn_files (
       turn_id TEXT NOT NULL,
       path TEXT NOT NULL,
       entry_json TEXT NOT NULL,
       updated_at INTEGER NOT NULL,
       PRIMARY KEY (turn_id, path)
     )`,
    `CREATE TABLE agent_cancel_receipts (
       cancel_request_id TEXT PRIMARY KEY,
       thread_id TEXT NOT NULL,
       result_json TEXT NOT NULL,
       created_at INTEGER NOT NULL
     )`,
  ],
};

const CLIENT_MSG_ID_PATTERN = /^[A-Za-z0-9._:-]{8,64}$/;
const CONTROL_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const OUTPUT_FILE_CARD_MAX = 20;
const DISPATCH_MAX_ATTEMPTS = 3;
const DISPATCH_RETRY_MS = 15_000;
const DEVICE_AVAILABILITY_RETRY_MS = 10_000;
const DEVICE_AVAILABILITY_WAIT_MS = 60 * 60_000;
/**
 * Blocked dispatches worth retrying rather than failing: the device may be
 * about to come back, finish starting up, or — for consent — have someone tap
 * allow on its screen. Waiting is what lets a spawn aimed at a computer that
 * has not agreed yet simply start once it does, instead of making the
 * requester notice the refusal and ask again.
 */
const DEVICE_AVAILABILITY_CODES = new Set<string>([
  "SELECTED_DEVICE_OFFLINE",
  "SELECTED_DEVICE_UNAVAILABLE",
  SELECTED_DEVICE_NEEDS_CONSENT,
]);
const COMMAND_JOB = "agentThreads.deviceMessage";
const COMMAND_RETRY_MS = 10_000;
const commandJobId = (commandId: string): string => `devmsg:${commandId}`;
/**
 * How long a held command waits for its computer: a message is stale after
 * an hour, while a pause holds until the computer is back, so an agent on a
 * laptop that slept over the weekend still stops when it wakes.
 */
const COMMAND_WAIT_MS: Record<AgentControlCommand["kind"], number> = {
  message: 60 * 60_000,
  resume: 60 * 60_000,
  pause: 7 * 24 * 60 * 60_000,
};
const COMMAND_TTL_MS = 8 * 24 * 60 * 60_000;
const TERMINAL_STATUSES = new Set(["completed", "failed", "canceled", "paused"]);
type TerminalStatus = "completed" | "failed" | "canceled" | "paused";
/** What a paused attempt's journal card says. */
const PAUSED_CARD_TEXT = "Paused.";
const ACTIVE_STATUSES = new Set(["running", "resuming"]);

/** Threads that run on one of the owner's devices for someone else. */
export const AGENT_THREADS_DEVICE_EXECUTOR_MIGRATION = {
  id: "agent-threads.4-device-executor",
  statements: [
    "ALTER TABLE agent_threads ADD COLUMN executor_device_id TEXT",
    "ALTER TABLE agent_turns ADD COLUMN dispatch_id TEXT",
    "CREATE INDEX agent_turns_dispatch ON agent_turns (dispatch_id) WHERE dispatch_id IS NOT NULL",
  ],
};

/** The model a device thread's requester asked for; the device runs it or fails. */
export const AGENT_THREADS_REQUESTED_MODEL_MIGRATION = {
  id: "agent-threads.5-requested-model",
  statements: ["ALTER TABLE agent_threads ADD COLUMN requested_model TEXT"],
};

/**
 * Agents a conversation's pi harness runs (`ThreadSpawnedEvent.harness`):
 * one row each, so every agent has one, while the harness keeps its attempts.
 */
export const AGENT_THREADS_HARNESS_MIGRATION = {
  id: "agent-threads.9-harness",
  statements: ["ALTER TABLE agent_threads ADD COLUMN harness TEXT"],
};

export const AGENT_COMMANDS_MIGRATION = {
  id: "agent-threads.10-command-outbox",
  statements: [
    `CREATE TABLE agent_commands (
       command_id TEXT PRIMARY KEY,
       thread_id TEXT NOT NULL,
       kind TEXT NOT NULL,
       executor TEXT NOT NULL,
       device_id TEXT,
       owner_generation TEXT NOT NULL,
       text TEXT NOT NULL,
       next_json TEXT,
       source TEXT NOT NULL,
       state TEXT NOT NULL,
       outcome TEXT,
       result_json TEXT,
       attempts INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL,
       delivered_at INTEGER
     )`,
    "CREATE INDEX agent_commands_pending ON agent_commands (created_at) WHERE state = 'pending'",
    "CREATE INDEX agent_commands_thread ON agent_commands (thread_id, kind) WHERE state = 'pending'",
    "CREATE INDEX agent_commands_created ON agent_commands (created_at)",
    `INSERT INTO agent_commands
       (command_id, thread_id, kind, executor, device_id, owner_generation, text, source,
        state, attempts, created_at, updated_at)
     SELECT message_id, thread_id, kind, 'local', device_id, owner_generation, text, 'migration',
            'pending', attempts, created_at, created_at
       FROM agent_device_messages WHERE delivered_at IS NULL`,
  ],
};

/** Agents no longer get isolated world forks. */
export const AGENT_THREADS_DROP_WORKSPACE_FORK_MIGRATION = {
  id: "agent-threads.3-drop-workspace-fork",
  statements: ["ALTER TABLE agent_threads DROP COLUMN workspace_fork_id"],
};

// ── Projections ───────────────────────────────────────────────────────────

const summary = (row: ThreadRow, ownerId: string): AgentThreadSummary => ({
  ownerId,
  threadId: row.thread_id,
  conversationId: row.conversation_id,
  ...(row.parent_turn_id !== null ? { parentTurnId: row.parent_turn_id } : {}),
  ...(row.parent_thread_id !== null ? { parentThreadId: row.parent_thread_id } : {}),
  ...(row.executor_device_id !== null ? { executorDeviceId: row.executor_device_id } : {}),
  description: row.description,
  placement: row.placement === "computer" ? "computer" : "cloud",
  agentType: row.agent_type,
  status: row.status,
  attemptGeneration: row.attempt_generation,
  ...(row.result_json !== null ? { resultJson: row.result_json } : {}),
  ...(row.error_message !== null ? { errorMessage: row.error_message } : {}),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const control = (row: ThreadRow): AgentThreadControl => ({
  threadId: row.thread_id,
  conversationId: row.conversation_id,
  attemptGeneration: row.attempt_generation,
  threadUpdatedAt: row.updated_at,
  status: row.status,
});

const readThread = (db: OwnerDbReader, threadId: string): ThreadRow | null =>
  db.one<ThreadRow>("SELECT * FROM agent_threads WHERE thread_id = ?", threadId);

const PLACEMENT_ALIAS_SCAN_MAX = 500;

const placementAliasThreadId = (
  db: OwnerDbReader,
  alias: string,
  conversationId?: string,
): string | null => {
  const queries = conversationId
    ? (["conversation_id", "origin_conversation_id"] as const).map((column) =>
        db.all<{ thread_id: string }>(
          `SELECT thread_id FROM agent_threads WHERE ${column} = ? AND executor_device_id IS NOT NULL`,
          conversationId,
        ),
      )
    : [
        db.all<{ thread_id: string }>(
          `SELECT thread_id FROM agent_threads WHERE executor_device_id IS NOT NULL
            ORDER BY updated_at DESC LIMIT ?`,
          PLACEMENT_ALIAS_SCAN_MAX,
        ),
      ];
  for (const rows of queries) {
    const match = rows.find((row) => placementRemoteThreadAgentId(row.thread_id) === alias);
    if (match) return match.thread_id;
  }
  return null;
};

const readConversationThread = (
  db: OwnerDbReader,
  conversationId: string,
  threadId: string,
): ThreadRow | null => {
  if (!isPlacementThreadId(threadId)) return readThread(db, threadId);
  const resolved = placementAliasThreadId(db, threadId, conversationId);
  return resolved ? readThread(db, resolved) : null;
};

/** Which side of the Slack boundary a thread sits on: its conversation's. */
const threadRealm = (row: ThreadRow): string =>
  isSlackConversationId(row.conversation_id)
    ? row.conversation_id
    : row.origin_conversation_id !== null && isSlackConversationId(row.origin_conversation_id)
      ? row.origin_conversation_id
      : conversationRealm(row.conversation_id);

/** A thread id's realm when it names a thread, else the id's as a conversation. */
const idRealm = (db: OwnerDbReader, id: string): string => {
  const row = readThread(db, id);
  return row ? threadRealm(row) : conversationRealm(id);
};

/** Nothing crosses the Slack boundary: a thread out of reach reads as no thread. */
const assertReachable = (senderRealm: string, targetRealm: string, threadId: string): void => {
  if (senderRealm === targetRealm) return;
  throw new RpcError(
    "NOT_FOUND",
    `No agent has the thread_id ${threadId}. agent_status without a thread_id lists who you can reach.`,
    { reason: "target_not_found" },
  );
};

const readTurn = (db: OwnerDbReader, turnId: string): TurnRow | null =>
  db.one<TurnRow>("SELECT * FROM agent_turns WHERE turn_id = ?", turnId);

const clip = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

const sha256Hex = async (text: string): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

// ── Journal records of agents no turn reports ─────────────────────────────

/** Report text a terminal card carries: enough to say what happened, not the report. */
const CARD_REPORT_MAX_CHARS = 2_000;

/**
 * The lifecycle card of one attempt of an agent the conversation's own turns
 * do not report: a computer's agent (`computerThreads.*`), or a cloud agent a
 * desktop started, whose report goes to that desktop rather than waking the
 * conversation. The conversation's running-agent list (what a phone's top bar
 * counts) is folded from its journal, so without these an agent that ended
 * without a wake prompt (paused, or canceled when Stella quit) read as running
 * for good.
 */
const agentLifecycleCard = (
  row: ThreadRow,
  outcome: { kind: "started" } | { kind: TerminalStatus; text?: string | null },
): { sourceTurnId: string; card: CloudAgentLifecycleCard } => {
  const identity = { agentId: row.thread_id, attemptGeneration: row.attempt_generation };
  const eventId = `thread:${row.thread_id}:${row.attempt_generation}:${outcome.kind === "started" ? "started" : "terminal"}`;
  const text =
    outcome.kind === "started"
      ? ""
      : outcome.kind === "paused"
        ? PAUSED_CARD_TEXT
        : clip(outcome.text?.trim() ?? "", CARD_REPORT_MAX_CHARS);
  return {
    sourceTurnId: `thread:${row.thread_id}:${row.attempt_generation}`,
    card: {
      type: "agent-lifecycle",
      eventId,
      event:
        outcome.kind === "started"
          ? {
              type: "agent-started",
              payload: { ...identity, description: row.description, agentType: row.agent_type },
            }
          : outcome.kind === "completed"
            ? { type: "agent-completed", payload: { ...identity, result: text, status: "completed" } }
            : {
                type: outcome.kind === "failed" ? "agent-failed" : "agent-canceled",
                payload: { ...identity, ...(text ? { error: text } : {}), status: outcome.kind },
              },
    },
  };
};

/** The cloud conversation whose journal shows a thread, or null for one kept on a computer. */
const journalConversationOf = (db: OwnerDbReader, row: ThreadRow): string | null => {
  const conversationId = row.origin_conversation_id ?? row.conversation_id;
  return db.one<{ conversation_id: string }>(
    "SELECT conversation_id FROM conversations WHERE conversation_id = ? AND deleted_at IS NULL",
    conversationId,
  )
    ? conversationId
    : null;
};

/**
 * Post one attempt's card to the conversation's journal. Best effort, as every
 * card is. A subagent's are not posted: the conversation counts the agents
 * Stella started, as its own turns list them.
 */
const postAgentLifecycleCard = async (
  ctx: OwnerContext,
  row: ThreadRow,
  outcome: Parameters<typeof agentLifecycleCard>[1],
): Promise<void> => {
  if (row.parent_thread_id !== null) return;
  const conversationId = journalConversationOf(ctx.db, row);
  if (!conversationId || !row.owner_generation) return;
  await ctx.host.postConversationCard({
    conversationId,
    ownerGeneration: row.owner_generation,
    ...agentLifecycleCard(row, outcome),
  });
};

// ── Fences ────────────────────────────────────────────────────────────────

const assertGeneration = async (ctx: OwnerContext, ownerGeneration: string): Promise<void> => {
  const snapshot = await ctx.host.snapshot();
  if (snapshot.ownerGeneration !== ownerGeneration) {
    throw new RpcError("CONFLICT", "This request started before the account data was reset.", {
      reason: OWNER_GENERATION_STALE,
    });
  }
  if (!snapshot.writable) {
    throw new RpcError("CONFLICT", "Account data is currently being reset or deleted.");
  }
};

const threadChanged = (threadId: string): RpcError =>
  new RpcError(
    "CONFLICT",
    `That cloud thread changed while this request was in flight. Refresh ${threadId} and try again.`,
    { reason: "thread_changed" },
  );

// ── Cloud dispatch from a desktop ─────────────────────────────────────────

type DispatchJob = {
  threadId: string;
  turnId: string;
  attemptGeneration: number;
  attempt: number;
  availabilityRetries?: number;
};

const failAttempt = (db: OwnerDb, job: DispatchJob, message: string, now: number): void => {
  recordAgentChange(
    db,
    { threadId: job.threadId, turnId: job.turnId, kind: endedKind, source: "owner:dispatch", now },
    () => {
      db.run(
        "UPDATE agent_turns SET status = 'failed', updated_at = ? WHERE turn_id = ? AND status IN ('running', 'resuming')",
        now,
        job.turnId,
      );
      db.run(
        `UPDATE agent_threads SET status = 'failed', error_message = ?, updated_at = ?
          WHERE thread_id = ? AND attempt_generation = ? AND status = 'running'`,
        clip(message, 2_000),
        now,
        job.threadId,
        job.attemptGeneration,
      );
    },
  );
};

const runDispatch = async (ctx: OwnerContext, job: DispatchJob): Promise<void> => {
  const thread = readThread(ctx.db, job.threadId);
  const turn = readTurn(ctx.db, job.turnId);
  if (
    !thread ||
    !turn ||
    thread.attempt_generation !== job.attemptGeneration ||
    thread.status !== "running" ||
    turn.status !== "running"
  ) {
    return;
  }
  const dispatchRow = ctx.db.one<{ prompt: string; attachments: string | null }>(
    "SELECT prompt, attachments FROM agent_dispatch_prompts WHERE turn_id = ?",
    turn.turn_id,
  );
  const prompt = dispatchRow?.prompt ?? thread.description;
  if (thread.executor_device_id) {
    await runDeviceDispatch(
      ctx,
      job,
      thread,
      turn,
      prompt,
      dispatchAttachments(dispatchRow?.attachments),
    );
    return;
  }
  const execution = thread.execution_json
    ? (JSON.parse(thread.execution_json) as CloudExecutionSelection)
    : (await ctx.host.snapshot()).execution;
  try {
    await ctx.host.dispatchAgentTurn({
      ownerGeneration: thread.owner_generation ?? "",
      conversationId: thread.conversation_id,
      threadId: thread.thread_id,
      turnId: turn.turn_id,
      attemptGeneration: thread.attempt_generation,
      clientMsgId: turn.client_msg_id ?? turn.turn_id,
      description: thread.description,
      prompt,
      execution,
      ...(thread.origin_device_id ? { originDeviceId: thread.origin_device_id } : {}),
      ...(thread.origin_conversation_id
        ? { originConversationId: thread.origin_conversation_id }
        : {}),
      ...(thread.parent_thread_id && !thread.origin_device_id
        ? { parentThreadId: thread.parent_thread_id }
        : {}),
    });
    ctx.db.run("DELETE FROM agent_dispatch_prompts WHERE turn_id = ?", turn.turn_id);
    recordAgentChange(
      ctx.db,
      {
        threadId: thread.thread_id,
        turnId: turn.turn_id,
        kind: "attempt_dispatched",
        key: `attempt_dispatched:${turn.turn_id}`,
        source: "owner:dispatch",
        detail: { executor: "cloud" },
        always: true,
        now: ctx.now,
      },
      () => undefined,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryable = !(error instanceof DispatchError) || error.retryable;
    if (retryable && job.attempt < DISPATCH_MAX_ATTEMPTS) {
      ctx.jobs.schedule(
        "agentThreads.dispatch",
        ctx.now + DISPATCH_RETRY_MS,
        { ...job, attempt: job.attempt + 1 },
        { id: `dispatch:${job.turnId}` },
      );
      return;
    }
    failAttempt(ctx.db, job, message, ctx.now);
    ctx.db.run("DELETE FROM agent_dispatch_prompts WHERE turn_id = ?", turn.turn_id);
  }
};

// ── Device threads ────────────────────────────────────────────────────────

const recordSteered = (
  ctx: OwnerContext,
  threadId: string,
  turnId: string | null,
  messageId: string,
  source: string,
  detail: Record<string, unknown>,
): void => {
  recordAgentChange(
    ctx.db,
    {
      threadId,
      turnId,
      kind: "steered",
      key: `steered:${threadId}:${messageId}`,
      source,
      detail: { messageId, ...detail },
      always: true,
      now: ctx.now,
    },
    () => undefined,
  );
};

/**
 * The device a spawn names, checked while the caller is still waiting so a
 * wrong id or an offline device comes back as the tool's error instead of a
 * failed report later. The gate checks again when it offers the attempt.
 */
const assertDeviceDestination = async (
  ctx: OwnerContext,
  targetDeviceId: string,
  requestingDeviceId?: string,
): Promise<{ deviceId: string; waiting: boolean }> => {
  const device = findDeviceDestination(await ctx.host.deviceDestinations(), targetDeviceId);
  if (!device) {
    throw new RpcError(
      "NOT_FOUND",
      `No connected device has the id or name ${targetDeviceId}. Use "cloud" or a device_id from the connected devices list.`,
      { reason: "device_not_found" },
    );
  }
  if (requestingDeviceId && device.deviceId === requestingDeviceId) {
    throw new RpcError(
      "BAD_REQUEST",
      "That is the device this agent is already running on. Leave destination empty to run the work here.",
      { reason: "device_is_requester" },
    );
  }
  const name = device.label || device.deviceId;
  // A device that has turned remote work down is a definite no, and failing
  // the spawn now says so while the caller is still there to hear it. One that
  // simply has not been asked is not a no: the gate raises the prompt on its
  // screen when the attempt goes out, so this waits for the tap instead.
  if (device.remoteExecution === "declined") {
    throw new RpcError("CONFLICT", `${name} is set not to accept work from other devices.`, {
      reason: "device_remote_execution_declined",
    });
  }
  return {
    deviceId: device.deviceId,
    waiting:
      !device.remoteExecutionEnabled ||
      !device.online ||
      Boolean(device.availability && !device.availability.ready),
  };
};

const waitForAvailableDevice = (
  ctx: OwnerContext,
  turn: TurnRow,
  availabilityRetries: number,
): boolean => {
  if (!turn.thread_id || turn.attempt_generation === null) return false;
  if (ctx.now - turn.created_at >= DEVICE_AVAILABILITY_WAIT_MS) return false;
  ctx.jobs.schedule(
    "agentThreads.dispatch",
    ctx.now + DEVICE_AVAILABILITY_RETRY_MS,
    {
      threadId: turn.thread_id,
      turnId: turn.turn_id,
      attemptGeneration: turn.attempt_generation,
      attempt: 1,
      availabilityRetries: availabilityRetries + 1,
    } satisfies DispatchJob,
    { id: `dispatch:${turn.turn_id}` },
  );
  return true;
};

const deviceWaitExpiredMessage = (message: string): string =>
  `${message} It did not become available within ${Math.round(DEVICE_AVAILABILITY_WAIT_MS / 60_000)} minutes, so this agent never started.`;

/** Offer one recorded attempt to the thread's device. */
/**
 * The stored attachment list, or none. A row written before this column
 * existed, or a value that no longer parses, degrades to an agent without
 * attachments rather than failing a dispatch that is otherwise fine.
 */
const dispatchAttachments = (raw: string | null | undefined): string[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      : [];
  } catch {
    return [];
  }
};

const runDeviceDispatch = async (
  ctx: OwnerContext,
  job: DispatchJob,
  thread: ThreadRow,
  turn: TurnRow,
  prompt: string,
  attachments: readonly string[],
): Promise<void> => {
  try {
    const { dispatchId } = await ctx.host.dispatchDeviceAgentTurn({
      ownerGeneration: thread.owner_generation ?? "",
      conversationId: thread.conversation_id,
      threadId: thread.thread_id,
      turnId: turn.turn_id,
      description: thread.description,
      prompt,
      targetDeviceId: thread.executor_device_id!,
      ...(thread.origin_device_id ? { requestingDeviceId: thread.origin_device_id } : {}),
      ...(thread.requested_model ? { model: thread.requested_model } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(job.availabilityRetries ? { requeue: job.availabilityRetries } : {}),
    });
    recordAgentChange(
      ctx.db,
      {
        threadId: thread.thread_id,
        turnId: turn.turn_id,
        kind: "attempt_dispatched",
        key: `attempt_dispatched:${turn.turn_id}:${dispatchId}`,
        source: "owner:dispatch",
        detail: {
          executor: "device",
          executorDeviceId: thread.executor_device_id,
          dispatchId,
          ...(job.availabilityRetries ? { requeue: job.availabilityRetries } : {}),
        },
        now: ctx.now,
      },
      () => ctx.db.run("UPDATE agent_turns SET dispatch_id = ? WHERE turn_id = ?", dispatchId, turn.turn_id),
    );
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    if (error instanceof DispatchError && DEVICE_AVAILABILITY_CODES.has(error.code ?? "")) {
      if (waitForAvailableDevice(ctx, turn, job.availabilityRetries ?? 0)) return;
      message = deviceWaitExpiredMessage(message);
    }
    const retryable = !(error instanceof DispatchError) || error.retryable;
    if (retryable && job.attempt < DISPATCH_MAX_ATTEMPTS) {
      ctx.jobs.schedule(
        "agentThreads.dispatch",
        ctx.now + DISPATCH_RETRY_MS,
        { ...job, attempt: job.attempt + 1 },
        { id: `dispatch:${job.turnId}` },
      );
      return;
    }
    ctx.db.run("DELETE FROM agent_dispatch_prompts WHERE turn_id = ?", turn.turn_id);
    await settleDeviceAttempt(ctx, turn.turn_id, "failed", { errorMessage: message }, "owner:dispatch");
  }
};

/**
 * Record the terminal outcome of one device attempt and, for a cloud
 * requester, deliver it. Only the attempt the thread is on moves the
 * thread; a late outcome for an older attempt updates just its turn row.
 */
const settleDeviceAttempt = async (
  ctx: OwnerContext,
  turnId: string,
  status: TerminalStatus,
  outcome: { resultJson?: string; errorMessage?: string },
  source: string,
): Promise<void> => {
  const turn = readTurn(ctx.db, turnId);
  if (!turn?.thread_id || TERMINAL_STATUSES.has(turn.status)) return;
  const errorMessage =
    status === "completed" || status === "paused"
      ? null
      : clip(outcome.errorMessage?.trim() || `The agent ${status === "canceled" ? "was stopped" : "failed"}.`, 2_000);
  recordAgentChange(
    ctx.db,
    { threadId: turn.thread_id, turnId, kind: endedKind, outcome: status, source, now: ctx.now },
    () => {
      ctx.db.run("UPDATE agent_turns SET status = ?, updated_at = ? WHERE turn_id = ?", status, ctx.now, turnId);
      ctx.db.run("DELETE FROM agent_dispatch_prompts WHERE turn_id = ?", turnId);
      const current = readThread(ctx.db, turn.thread_id!);
      if (
        !current ||
        !current.executor_device_id ||
        current.attempt_generation !== turn.attempt_generation ||
        !ACTIVE_STATUSES.has(current.status)
      ) {
        return null;
      }
      ctx.db.run(
        `UPDATE agent_threads SET status = ?, result_json = ?, error_message = ?,
           origin_delivery_ack_at = NULL, updated_at = ?
         WHERE thread_id = ?`,
        status,
        outcome.resultJson ?? null,
        errorMessage,
        ctx.now,
        current.thread_id,
      );
      return current;
    },
  );
};

/** The gate reports every terminal dispatch it ran for a device thread. */
const deviceSettled = async (ctx: OwnerContext, raw: unknown): Promise<{ settled: boolean }> => {
  const args = object({
    turnId: id(),
    requeue: optional(number({ int: true, min: 0, max: 100_000 })),
    state: literal("completed", "failed", "canceled", "blocked"),
    resultJson: optional(string({ max: 1_000_000 })),
    errorCode: optional(string({ max: 128 })),
    errorMessage: optional(string({ max: 4_000 })),
  })(raw);
  const turn = readTurn(ctx.db, args.turnId);
  if (!turn || TERMINAL_STATUSES.has(turn.status)) return { settled: false };
  const unavailable = args.state === "blocked" && DEVICE_AVAILABILITY_CODES.has(args.errorCode ?? "");
  if (unavailable && waitForAvailableDevice(ctx, turn, args.requeue ?? 0)) return { settled: false };
  const status: TerminalStatus =
    args.state === "blocked"
      ? "failed"
      : agentAttemptOutcomeOf({ status: args.state, reason: args.errorMessage, errorCode: args.errorCode });
  await settleDeviceAttempt(
    ctx,
    args.turnId,
    status,
    {
      ...(args.resultJson ? { resultJson: args.resultJson } : {}),
      ...(args.errorMessage
        ? { errorMessage: unavailable ? deviceWaitExpiredMessage(args.errorMessage) : args.errorMessage }
        : args.state === "blocked"
          ? { errorMessage: "The selected computer did not accept the request." }
          : {}),
    },
    "gate",
  );
  return { settled: true };
};

/** A device thread of a cloud requester's conversation, whoever started it, or not found. */
const readCloudDeviceThread = (
  ctx: OwnerContext,
  args: { threadId: string; conversationId: string; ownerGeneration: string },
): ThreadRow => {
  const thread = readConversationThread(ctx.db, args.conversationId, args.threadId);
  if (!thread || !thread.executor_device_id || !conversationControls(thread, args)) {
    throw new RpcError("NOT_FOUND", "That device agent no longer exists.");
  }
  return thread;
};

/**
 * Spawn an agent on one of the owner's devices for the cloud orchestrator
 * or a cloud agent. `clientMsgId` is the caller's tool-scoped id, so a
 * retried tool call returns the thread it already started.
 */
const spawnOnDeviceForCloud = async (ctx: OwnerContext, raw: unknown): Promise<AgentThreadControl> => {
  const args = object({
    ownerGeneration: generation,
    conversationId: id(),
    parentTurnId: id(),
    parentThreadId: optional(id()),
    clientMsgId: id(),
    targetDeviceId: id(256),
    description: string({ max: 2_000 }),
    prompt: string({ max: AGENT_PROMPT_MAX_CHARS }),
    model: optional(string({ max: 256 })),
    attachments: optional(
      array(string({ min: 1, max: 1_024 }), { max: TURN_ATTACHMENTS_MAX }),
    ),
  })(raw);
  assertPrompt(args.prompt, args.description);
  // Validated here, where the owner is known, so a path that is not a drive
  // path never reaches a device as something to resolve.
  const attachments = (args.attachments ?? []).map((path) =>
    normalizeDrivePath(path),
  );
  const fingerprint = await sha256Hex(
    JSON.stringify([
      "device-agent-intent/v1",
      args.model ?? null,
      args.conversationId,
      args.parentTurnId,
      args.parentThreadId ?? null,
      args.targetDeviceId,
      args.description,
      args.prompt,
      // In the fingerprint so a retry that would hand over a different set is
      // a different intent rather than a replay of the first one.
      attachments,
    ]),
  );
  const replay = replayAttempt(ctx.db, args.clientMsgId, fingerprint, args.ownerGeneration);
  if (replay) return replay;
  await assertGeneration(ctx, args.ownerGeneration);
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    "agentThreads.spawn",
    { count: 30, windowMs: 10 * 60_000 },
    "Too many agents started at once. Wait a moment and try again.",
  );
  const destination = await assertDeviceDestination(ctx, args.targetDeviceId);
  const raced = replayAttempt(ctx.db, args.clientMsgId, fingerprint, args.ownerGeneration);
  if (raced) return raced;
  const threadId = newAgentThreadId();
  const turnId = crypto.randomUUID();
  const thread = recordAgentChange(
    ctx.db,
    {
      threadId,
      turnId,
      kind: "spawned",
      key: `spawned:${threadId}`,
      source: `cloud:${args.conversationId}`,
      detail: { executor: "device", ...(destination.waiting ? { waitingForDevice: true } : {}) },
      now: ctx.now,
    },
    () => {
      ctx.db.run(
        `INSERT INTO agent_threads
           (thread_id, conversation_id, owner_generation, parent_turn_id, parent_thread_id,
            executor_device_id, requested_model, description, placement, agent_type,
            attempt_generation, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'computer', 'general', 1, 'running', ?, ?)`,
        threadId,
        args.conversationId,
        args.ownerGeneration,
        args.parentTurnId,
        args.parentThreadId ?? null,
        destination.deviceId,
        args.model?.trim() || null,
        clip(args.description.trim(), 1_000),
        ctx.now,
        ctx.now,
      );
      const inserted = readThread(ctx.db, threadId)!;
      startAttempt(ctx, {
        thread: inserted,
        turnId,
        clientMsgId: args.clientMsgId,
        fingerprint,
        prompt: args.prompt,
        ...(attachments.length > 0 ? { attachments } : {}),
      });
      return inserted;
    },
  );
  return { ...control(thread), ...(destination.waiting ? { waitingForDevice: true } : {}) };
};

/** A cloud requester's view of its device thread. */
const deviceThreadForCloud = (ctx: OwnerContext, raw: unknown): AgentThreadSummary => {
  const args = object({ ownerGeneration: generation, conversationId: id(), threadId: id() })(raw);
  return summary(readCloudDeviceThread(ctx, args), ctx.ownerId);
};

const devicePresence = async (ctx: OwnerContext): Promise<Map<string, DeviceDestination>> => {
  try {
    return new Map((await ctx.host.deviceDestinations()).map((device) => [device.deviceId, device]));
  } catch {
    return new Map();
  }
};

/** The owner's device names by id; empty when the gate can't list them. */
const deviceLabels = async (ctx: OwnerContext): Promise<Map<string, string>> => {
  const labels = new Map<string, string>();
  try {
    for (const device of await ctx.host.deviceDestinations()) {
      if (device.label) labels.set(device.deviceId, device.label);
    }
  } catch {
    labels.clear();
  }
  return labels;
};

const lookupConversationThread = async (
  ctx: OwnerContext,
  args: { conversationId: string; threadId: string; ownerGeneration?: string },
): Promise<AgentThreadLookup | null> => {
  const thread = readConversationThread(ctx.db, args.conversationId, args.threadId);
  if (
    !thread ||
    (thread.conversation_id !== args.conversationId &&
      thread.origin_conversation_id !== args.conversationId) ||
    (args.ownerGeneration !== undefined &&
      thread.owner_generation !== null &&
      thread.owner_generation !== args.ownerGeneration)
  ) {
    return null;
  }
  const labels =
    thread.executor_device_id || thread.origin_device_id
      ? await deviceLabels(ctx)
      : new Map<string, string>();
  const executorLabel = thread.executor_device_id ? labels.get(thread.executor_device_id) : undefined;
  const originLabel = thread.origin_device_id ? labels.get(thread.origin_device_id) : undefined;
  return {
    ...summary(thread, ctx.ownerId),
    ...(thread.origin_device_id ? { originDeviceId: thread.origin_device_id } : {}),
    ...(originLabel ? { originDeviceLabel: originLabel } : {}),
    ...(executorLabel ? { executorDeviceLabel: executorLabel } : {}),
  };
};

const conversationThreadForCloud = async (
  ctx: OwnerContext,
  raw: unknown,
): Promise<AgentThreadLookup | null> => {
  const args = object({ ownerGeneration: generation, conversationId: id(), threadId: id() })(raw);
  return await lookupConversationThread(ctx, args);
};

/** A cloud requester's follow-up to a device thread of its conversation: steered, or its next attempt. */
const continueDeviceForCloud = async (ctx: OwnerContext, raw: unknown): Promise<AgentThreadControl> => {
  const args = object({
    ownerGeneration: generation,
    conversationId: id(),
    threadId: id(),
    controlRequestId: id(),
    description: string({ max: 2_000 }),
    prompt: string({ max: AGENT_PROMPT_MAX_CHARS }),
  })(raw);
  assertPrompt(args.prompt, args.description);
  const fingerprint = await sha256Hex(
    JSON.stringify(["device-continue-intent/v1", args.threadId, args.description, args.prompt]),
  );
  const replay = replayAttempt(ctx.db, args.controlRequestId, fingerprint, args.ownerGeneration);
  if (replay) return replay;
  await assertGeneration(ctx, args.ownerGeneration);
  const thread = readCloudDeviceThread(ctx, args);
  const { result, waitingForDevice } = await controlAgent(ctx, {
    commandId: args.controlRequestId,
    kind: "message",
    thread,
    ownerGeneration: args.ownerGeneration,
    text: args.prompt,
    source: `cloud:${args.conversationId}`,
    detail: { requester: args.conversationId, controlRequestId: args.controlRequestId },
    next: { clientMsgId: args.controlRequestId, fingerprint },
  });
  return {
    ...control(readThread(ctx.db, thread.thread_id)!),
    ...(waitingForDevice ? { waitingForDevice: true } : {}),
    delivery: agentMessageDelivery(result),
  };
};

/** A cloud requester's pause of a device thread of its conversation. */
const cancelDeviceForCloud = async (
  ctx: OwnerContext,
  raw: unknown,
): Promise<{ canceled: boolean; control: AgentThreadControl }> => {
  const args = object({
    ownerGeneration: generation,
    conversationId: id(),
    threadId: id(),
    controlRequestId: id(),
  })(raw);
  await assertGeneration(ctx, args.ownerGeneration);
  const thread = readCloudDeviceThread(ctx, args);
  await controlAgent(ctx, {
    commandId: args.controlRequestId,
    kind: "pause",
    thread,
    ownerGeneration: args.ownerGeneration,
    text: "",
    source: `cloud:${args.conversationId}`,
    detail: { requester: args.conversationId, via: "agentThreads.cancelOnDevice" },
  });
  return { canceled: true, control: control(readThread(ctx.db, thread.thread_id)!) };
};

/**
 * Stop the device attempt a thread is on: withdraw its dispatch (or the
 * queued job that would send it) and mark it canceled now. The gate's own
 * terminal report then finds the turn already settled.
 */
const stopDeviceAttempt = async (
  ctx: OwnerContext,
  thread: ThreadRow,
  cancelRequestId: string,
  source: string,
): Promise<void> => {
  if (!ACTIVE_STATUSES.has(thread.status)) return;
  const turn = runningTurn(ctx.db, thread);
  if (!turn) return;
  // Settle first: the gate reports the withdrawn dispatch as canceled, and
  // that report must find this attempt already closed rather than report
  // anything for a pause the requester asked for.
  ctx.jobs.cancel(`dispatch:${turn.turn_id}`);
  ctx.db.run("DELETE FROM agent_dispatch_prompts WHERE turn_id = ?", turn.turn_id);
  recordAgentChange(
    ctx.db,
    {
      threadId: thread.thread_id,
      turnId: turn.turn_id,
      kind: endedKind,
      outcome: "paused",
      source,
      detail: { cancelRequestId },
      now: ctx.now,
    },
    () => {
      ctx.db.run(
        "UPDATE agent_turns SET status = 'paused', updated_at = ? WHERE turn_id = ?",
        ctx.now,
        turn.turn_id,
      );
      ctx.db.run(
        `UPDATE agent_threads SET status = 'paused', error_message = NULL, updated_at = ?
          WHERE thread_id = ? AND attempt_generation = ? AND status IN ('running', 'resuming')`,
        ctx.now,
        thread.thread_id,
        thread.attempt_generation,
      );
    },
  );
  if (turn.dispatch_id) {
    await ctx.host.cancelDeviceAgentTurn({
      dispatchId: turn.dispatch_id,
      cancelRequestId,
      reason: AGENT_PAUSED_REASON,
    });
  }
};

const recordPauseRequested = (
  ctx: OwnerContext,
  thread: ThreadRow,
  key: string,
  source: string,
  detail: Record<string, unknown>,
): void => {
  recordAgentChange(
    ctx.db,
    { threadId: thread.thread_id, kind: "pause_requested", key, source, detail, always: true, now: ctx.now },
    () => undefined,
  );
};

const beginNextAttempt = (
  ctx: OwnerContext,
  thread: ThreadRow,
  input: {
    clientMsgId: string;
    fingerprint: string;
    prompt: string;
    source: string;
    detail?: Record<string, unknown>;
    sql: string;
  },
): ThreadRow => {
  const turnId = crypto.randomUUID();
  return recordAgentChange(
    ctx.db,
    {
      threadId: thread.thread_id,
      turnId,
      kind: startedKind,
      source: input.source,
      ...(input.detail ? { detail: input.detail } : {}),
      now: ctx.now,
    },
    () => {
      ctx.db.run(input.sql, thread.attempt_generation + 1, ctx.now, thread.thread_id);
      const continued = readThread(ctx.db, thread.thread_id)!;
      startAttempt(ctx, {
        thread: continued,
        turnId,
        clientMsgId: input.clientMsgId,
        fingerprint: input.fingerprint,
        prompt: input.prompt,
      });
      return continued;
    },
  );
};

/** Record one attempt and queue its dispatch. */
const startAttempt = (
  ctx: OwnerContext,
  input: {
    thread: ThreadRow;
    turnId: string;
    clientMsgId: string;
    fingerprint: string;
    prompt: string;
    attachments?: readonly string[];
  },
): void => {
  ctx.db.run(
    `INSERT INTO agent_turns
       (turn_id, thread_id, conversation_id, owner_generation, attempt_generation,
        status, client_msg_id, spawn_fingerprint, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)`,
    input.turnId,
    input.thread.thread_id,
    input.thread.conversation_id,
    input.thread.owner_generation,
    input.thread.attempt_generation,
    input.clientMsgId,
    input.fingerprint,
    ctx.now,
    ctx.now,
  );
  ctx.db.run(
    "INSERT INTO agent_dispatch_prompts (turn_id, prompt, attachments) VALUES (?, ?, ?)",
    input.turnId,
    input.prompt,
    input.attachments?.length ? JSON.stringify([...input.attachments]) : null,
  );
  ctx.jobs.schedule(
    "agentThreads.dispatch",
    ctx.now,
    {
      threadId: input.thread.thread_id,
      turnId: input.turnId,
      attemptGeneration: input.thread.attempt_generation,
      attempt: 1,
    } satisfies DispatchJob,
    { id: `dispatch:${input.turnId}` },
  );
};

/** A retried request with the same id: return the attempt it already started. */
const replayAttempt = (
  db: OwnerDbReader,
  clientMsgId: string,
  fingerprint: string,
  ownerGeneration: string,
): AgentThreadControl | null => {
  const turn = db.one<TurnRow>("SELECT * FROM agent_turns WHERE client_msg_id = ?", clientMsgId);
  if (!turn) return null;
  if (
    turn.spawn_fingerprint !== fingerprint ||
    turn.owner_generation !== ownerGeneration ||
    !turn.thread_id
  ) {
    throw new RpcError("CONFLICT", "That request id was already used for a different agent request.");
  }
  const thread = readThread(db, turn.thread_id);
  if (!thread || thread.owner_generation !== ownerGeneration) {
    throw new RpcError("CONFLICT", "That request id was already used for a different agent request.");
  }
  return {
    threadId: thread.thread_id,
    conversationId: thread.conversation_id,
    attemptGeneration: turn.attempt_generation ?? thread.attempt_generation,
    threadUpdatedAt: turn.created_at,
    status: "running",
  };
};

const executionParser: Parser<CloudExecutionSelection> = (value, path = "") => {
  const parsed = parseCloudExecutionSelection(value);
  if (!parsed) throw new RpcError("BAD_REQUEST", `${path || "execution"} is invalid.`);
  return parsed;
};

const assertExecutionAvailable = async (
  ctx: OwnerContext,
  execution: CloudExecutionSelection,
): Promise<void> => {
  if (execution.engine === "stella") return;
  const snapshot = await ctx.host.snapshot();
  if (!snapshotAllowsExecution(snapshot, execution)) {
    throw new RpcError("CONFLICT", executionUnavailableMessage(execution));
  }
};

const assertPrompt = (prompt: string, description: string): void => {
  if (!prompt.trim() || prompt.length > AGENT_PROMPT_MAX_CHARS) {
    throw new RpcError("BAD_REQUEST", `The agent prompt must be 1 to ${AGENT_PROMPT_MAX_CHARS} characters.`);
  }
  if (!description.trim()) throw new RpcError("BAD_REQUEST", "The agent needs a description.");
};

type SpawnArgs = AgentThreadCalls["agentThreads.spawnFromDesktop"]["args"];

const spawnFromDesktop = async (ctx: OwnerContext, args: SpawnArgs): Promise<AgentThreadControl> => {
  if (!CLIENT_MSG_ID_PATTERN.test(args.clientMsgId)) {
    throw new RpcError("BAD_REQUEST", "That agent request could not be sent. Try again.");
  }
  assertPrompt(args.prompt, args.description);
  const fingerprint = await sha256Hex(
    JSON.stringify([
      "spawn-agent-intent/v3",
      args.conversationId ?? null,
      args.description,
      args.prompt,
      args.execution ?? null,
      args.originDeviceId,
      args.originConversationId,
      args.targetDeviceId ?? null,
      args.model ?? null,
      ...(args.parentThreadId ? [args.parentThreadId] : []),
    ]),
  );
  const replay = replayAttempt(ctx.db, args.clientMsgId, fingerprint, args.ownerGeneration);
  if (replay) return replay;
  await assertGeneration(ctx, args.ownerGeneration);
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    "agentThreads.spawn",
    { count: 30, windowMs: 10 * 60_000 },
    "Too many cloud agents started at once. Wait a moment and try again.",
  );
  const destination = args.targetDeviceId?.trim()
    ? await assertDeviceDestination(ctx, args.targetDeviceId.trim(), args.originDeviceId)
    : null;
  const targetDeviceId = destination?.deviceId ?? null;
  const lookupConversationId = args.conversationId ?? readMainConversationId(ctx.db);
  const conversation = lookupConversationId
    ? ctx.db.one<{ conversation_id: string; execution_json: string | null }>(
        "SELECT conversation_id, execution_json FROM conversations WHERE conversation_id = ? AND deleted_at IS NULL",
        lookupConversationId,
      )
    : null;
  if (args.conversationId && !conversation) {
    throw new RpcError("NOT_FOUND", "Conversation not found.", { reason: "conversation_not_found" });
  }
  const snapshot = await ctx.host.snapshot();
  const execution =
    args.execution ??
    (conversation?.execution_json
      ? (JSON.parse(conversation.execution_json) as CloudExecutionSelection)
      : snapshot.execution);
  // A device runs the agent on its own models.
  if (!targetDeviceId) await assertExecutionAvailable(ctx, execution);
  // A replay may have landed during the awaits above.
  const raced = replayAttempt(ctx.db, args.clientMsgId, fingerprint, args.ownerGeneration);
  if (raced) return raced;

  let conversationId = conversation?.conversation_id;
  if (!conversationId) {
    conversationId = crypto.randomUUID();
    ctx.db.run(
      `INSERT INTO conversations (conversation_id, title, created_at, updated_at, execution_json)
       VALUES (?, ?, ?, ?, ?)`,
      conversationId,
      clip(args.description.trim(), CONVERSATION_TITLE_MAX),
      ctx.now,
      ctx.now,
      JSON.stringify(execution),
    );
  } else {
    ctx.db.run(
      "UPDATE conversations SET updated_at = MAX(updated_at, ?), allow_empty = 0 WHERE conversation_id = ?",
      ctx.now,
      conversationId,
    );
  }
  const threadId = newAgentThreadId();
  const turnId = crypto.randomUUID();
  const createdConversationId = conversationId;
  const thread = recordAgentChange(
    ctx.db,
    {
      threadId,
      turnId,
      kind: "spawned",
      key: `spawned:${threadId}`,
      source: `device:${args.originDeviceId}`,
      detail: {
        executor: targetDeviceId ? "device" : "cloud",
        ...(destination?.waiting ? { waitingForDevice: true } : {}),
      },
      now: ctx.now,
    },
    () => {
      ctx.db.run(
        `INSERT INTO agent_threads
           (thread_id, conversation_id, owner_generation, parent_thread_id, origin_device_id, origin_conversation_id,
            executor_device_id, requested_model, description, placement, agent_type, execution_json,
            attempt_generation, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'general', ?, 1, 'running', ?, ?)`,
        threadId,
        createdConversationId,
        args.ownerGeneration,
        args.parentThreadId ?? null,
        args.originDeviceId,
        args.originConversationId,
        targetDeviceId,
        targetDeviceId ? (args.model?.trim() || null) : null,
        clip(args.description.trim(), 1_000),
        targetDeviceId ? "computer" : "cloud",
        JSON.stringify(execution),
        ctx.now,
        ctx.now,
      );
      const inserted = readThread(ctx.db, threadId)!;
      startAttempt(ctx, {
        thread: inserted,
        turnId,
        clientMsgId: args.clientMsgId,
        fingerprint,
        prompt: args.prompt,
      });
      return inserted;
    },
  );
  return { ...control(thread), ...(destination?.waiting ? { waitingForDevice: true } : {}) };
};

type ContinueArgs = AgentThreadCalls["agentThreads.continueFromDesktop"]["args"];

const continueFromDesktop = async (
  ctx: OwnerContext,
  args: ContinueArgs,
): Promise<AgentThreadControl> => {
  if (!CONTROL_REQUEST_ID_PATTERN.test(args.controlRequestId)) {
    throw new RpcError("BAD_REQUEST", "That follow-up could not be sent. Try again.");
  }
  assertPrompt(args.prompt, args.description);
  const fingerprint = await sha256Hex(
    JSON.stringify([
      "continue-agent-intent/v1",
      args.threadId,
      args.expectedAttemptGeneration,
      args.expectedTerminalUpdatedAt,
      args.description,
      args.prompt,
      args.originDeviceId,
      args.originConversationId,
    ]),
  );
  const replay = replayAttempt(ctx.db, args.controlRequestId, fingerprint, args.ownerGeneration);
  if (replay) return replay;
  await assertGeneration(ctx, args.ownerGeneration);
  const thread = readThread(ctx.db, args.threadId);
  if (
    !thread ||
    !conversationControls(thread, { ownerGeneration: args.ownerGeneration, conversationId: args.originConversationId })
  ) {
    throw new RpcError("NOT_FOUND", "That cloud thread no longer exists.");
  }
  if (ACTIVE_STATUSES.has(thread.status)) {
    if (thread.attempt_generation !== args.expectedAttemptGeneration) {
      throw threadChanged(thread.thread_id);
    }
  } else if (
    thread.attempt_generation !== args.expectedAttemptGeneration ||
    thread.updated_at !== args.expectedTerminalUpdatedAt
  ) {
    throw threadChanged(thread.thread_id);
  }
  await controlAgent(ctx, {
    commandId: `continue:${args.controlRequestId}`,
    kind: "message",
    thread,
    ownerGeneration: args.ownerGeneration,
    text: args.prompt,
    source: `device:${args.originDeviceId}`,
    detail: { requester: args.originConversationId, controlRequestId: args.controlRequestId },
    next: { clientMsgId: args.controlRequestId, fingerprint },
  });
  return control(readThread(ctx.db, thread.thread_id)!);
};

// ── Agent directory and messages ──────────────────────────────────────────

const DIRECTORY_AGENTS_RECENT = 50;
const DIRECTORY_SESSIONS_RECENT = 20;
const LIVE_STATUSES_SQL = "('running', 'resuming', 'waiting_for_user')";
const AGENT_MESSAGE_RECEIPT_TTL_MS = 24 * 60 * 60_000;

/**
 * Where a thread's attempts run, which is where every control for it goes:
 * its BuildSession or pi agent in the cloud, the device a dispatch offered
 * it to, or the desktop whose own Stella started it there. Messages and
 * pauses both route by this, whoever sends them and wherever the
 * conversation runs now.
 */
type ThreadExecutor =
  | { kind: "cloud" }
  | { kind: "harness" }
  | { kind: "dispatch"; deviceId: string }
  | { kind: "local"; deviceId: string | null };

const threadExecutor = (row: ThreadRow): ThreadExecutor =>
  row.executor_device_id
    ? { kind: "dispatch", deviceId: row.executor_device_id }
    : row.placement === "computer"
      ? { kind: "local", deviceId: row.origin_device_id }
      : row.harness !== null
        ? { kind: "harness" }
        : { kind: "cloud" };

/** The device a thread runs on, or null for the cloud. */
const threadDeviceId = (row: ThreadRow): string | null => {
  const executor = threadExecutor(row);
  return executor.kind === "cloud" || executor.kind === "harness" ? null : executor.deviceId;
};

type DirectoryResult = AgentThreadCalls["agentThreads.directory"]["result"];

/**
 * One conversation's agents from every placement, matched by the cloud
 * conversation or the desktop conversation that started them, and the
 * owner's other cloud conversations. Every live agent is kept; the rest are
 * the newest few.
 */
const agentDirectory = async (
  ctx: OwnerContext,
  args: { conversationId: string },
): Promise<DirectoryResult> => {
  const rows = new Map<string, ThreadRow>();
  for (const column of ["conversation_id", "origin_conversation_id"] as const) {
    for (const row of [
      ...ctx.db.all<ThreadRow>(
        `SELECT * FROM agent_threads WHERE ${column} = ? AND status IN ${LIVE_STATUSES_SQL}`,
        args.conversationId,
      ),
      ...ctx.db.all<ThreadRow>(
        `SELECT * FROM agent_threads WHERE ${column} = ?
          ORDER BY updated_at DESC, thread_id DESC LIMIT ?`,
        args.conversationId,
        DIRECTORY_AGENTS_RECENT,
      ),
    ]) {
      rows.set(row.thread_id, row);
    }
  }
  const devices = [...rows.values()].some((row) => threadDeviceId(row) !== null)
    ? await devicePresence(ctx)
    : new Map<string, DeviceDestination>();
  const agents = [...rows.values()].map((row): AgentDirectoryAgentRow => {
    const deviceId = threadDeviceId(row);
    const device = deviceId ? devices.get(resolveCurrentDeviceId(ctx.db, deviceId)) : undefined;
    const status = normalizeAgentDirectoryStatus(row.status);
    const live = isLiveAgentStatus(status);
    return {
      threadId: row.thread_id,
      conversationId: args.conversationId,
      ...(row.parent_thread_id !== null ? { parentThreadId: row.parent_thread_id } : {}),
      description: row.description,
      status,
      where: deviceId ? (device?.label?.trim() || "another computer") : "cloud",
      updatedAt: row.updated_at,
      ...(live && deviceId && devices.size > 0 && !device?.online
        ? { offline: device?.lastSeenAt !== undefined ? { lastSeenAt: device.lastSeenAt } : {} }
        : {}),
    };
  });
  const sessions = (isSlackConversationId(args.conversationId)
    ? []
    : ctx.db.all<{ conversation_id: string; title: string; updated_at: number; activity: string | null }>(
        `SELECT conversation_id, title, updated_at, activity FROM conversations
          WHERE deleted_at IS NULL AND ${NOT_SLACK_SQL} ORDER BY updated_at DESC, conversation_id DESC LIMIT ?`,
        DIRECTORY_SESSIONS_RECENT + 1,
      ))
    .filter((row) => row.conversation_id !== args.conversationId)
    .slice(0, DIRECTORY_SESSIONS_RECENT)
    .map(
      (row): AgentDirectorySessionRow => ({
        conversationId: row.conversation_id,
        title: row.title,
        active: row.activity === "running",
        where: "cloud",
        updatedAt: row.updated_at,
      }),
    );
  return { agents, sessions };
};

type MessageArgs = AgentThreadCalls["agentThreads.message"]["args"];
type MessageDelivery = AgentThreadCalls["agentThreads.message"]["result"];

/**
 * `send_message` through the owner's agent threads, from any host. A cloud
 * conversation id queues a hidden wake turn on that conversation's Stella;
 * an agent takes it through {@link controlAgent}: a running one reads it
 * before its next model call, an idle one resumes with it as its next
 * attempt, under the same parent, so its report still goes where it always
 * did. It always names its sender: from whoever started the agent it is
 * marked as theirs and is an instruction, from anyone else it is a note.
 * `"stella"` from an agent is its conversation. Idempotent per `messageId`.
 */
const messageAgent = async (ctx: OwnerContext, args: MessageArgs): Promise<MessageDelivery> => {
  if (!CONTROL_REQUEST_ID_PATTERN.test(args.messageId)) {
    throw new RpcError("BAD_REQUEST", "That message could not be sent. Try again.");
  }
  const text = args.text.trim();
  if (!text || text.length > AGENT_MESSAGE_MAX_CHARS) {
    throw new RpcError("BAD_REQUEST", `A message must be 1 to ${AGENT_MESSAGE_MAX_CHARS} characters.`);
  }
  const to = senderStella(ctx, args.to.trim(), args.from);
  if (to === args.from.threadId) {
    throw new RpcError("BAD_REQUEST", "That thread_id is the sender's own.");
  }
  const fingerprint = await sha256Hex(
    JSON.stringify(["agent-message/v1", to, text, args.from.threadId, args.from.label]),
  );
  const receipt = ctx.db.one<{ fingerprint: string; result_json: string }>(
    "SELECT fingerprint, result_json FROM agent_message_receipts WHERE message_id = ?",
    args.messageId,
  );
  if (receipt) {
    if (receipt.fingerprint !== fingerprint) {
      throw new RpcError("CONFLICT", "That message id was already used for a different message.");
    }
    return JSON.parse(receipt.result_json) as MessageDelivery;
  }
  await assertGeneration(ctx, args.ownerGeneration);
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    "agentThreads.message",
    { count: 120, windowMs: 10 * 60_000 },
    "Too many agent messages at once. Wait a moment and try again.",
  );
  const delivery = messageDelivery(
    await deliverAgentMessage(ctx, {
      ownerGeneration: args.ownerGeneration,
      commandId: args.messageId,
      to,
      text,
      from: args.from,
      kind: "message",
      source: `${ctx.caller ? "client" : "cloud"}:${args.from.threadId}`,
    }),
  );
  ctx.db.run(
    "DELETE FROM agent_message_receipts WHERE created_at < ?",
    ctx.now - AGENT_MESSAGE_RECEIPT_TTL_MS,
  );
  ctx.db.run(
    `INSERT INTO agent_message_receipts (message_id, fingerprint, result_json, created_at)
     VALUES (?, ?, ?, ?) ON CONFLICT (message_id) DO NOTHING`,
    args.messageId,
    fingerprint,
    JSON.stringify(delivery),
    ctx.now,
  );
  return delivery;
};

const messageDelivery = (result: AgentControlResult): MessageDelivery => agentMessageDelivery(result);

/**
 * Whether the sender is the one that started the thread: its conversation's
 * Stella, or the agent that spawned it. Their message is an instruction to
 * it, wherever the conversation runs now; anyone else's is a note.
 */
const sentByStarter = (thread: ThreadRow, from: AgentMessageSender): boolean =>
  thread.parent_thread_id !== null
    ? from.threadId === thread.parent_thread_id
    : from.threadId === thread.conversation_id || from.threadId === thread.origin_conversation_id;

/**
 * `"stella"` from an agent: the conversation it works in (its thread's, or
 * the caller's `conversationId`), whose Stella it reaches as a note. Any
 * other target is returned as it is.
 */
const senderStella = (
  ctx: OwnerContext,
  to: string,
  from: AgentMessageSender,
  callerConversationId?: string,
): string => {
  if (to.toLowerCase() !== STELLA_MESSAGE_TARGET) return to;
  const sender = isPlacementThreadId(from.threadId)
    ? (placementAliasThreadId(ctx.db, from.threadId, callerConversationId) ?? from.threadId)
    : from.threadId;
  const conversationId =
    readThread(ctx.db, sender)?.conversation_id ??
    (callerConversationId !== from.threadId ? callerConversationId : undefined);
  if (!conversationId) {
    throw new RpcError(
      "BAD_REQUEST",
      `"${STELLA_MESSAGE_TARGET}" reaches the Stella an agent works for; from Stella, message an agent by its thread_id.`,
    );
  }
  return conversationId;
};

const RESUME_TEXT = "Continue where you left off.";

const deliverAgentMessage = async (
  ctx: OwnerContext,
  args: {
    ownerGeneration: string;
    commandId: string;
    to: string;
    text: string;
    from: AgentMessageSender;
    kind: "message" | "resume";
    source: string;
    senderRealm?: string;
  },
): Promise<AgentControlResult> => {
  const to = isPlacementThreadId(args.to) ? (placementAliasThreadId(ctx.db, args.to) ?? args.to) : args.to;
  assertReachable(args.senderRealm ?? idRealm(ctx.db, args.from.threadId), idRealm(ctx.db, to), args.to);
  const conversation = ctx.db.one<{ conversation_id: string }>(
    "SELECT conversation_id FROM conversations WHERE conversation_id = ? AND deleted_at IS NULL",
    to,
  );
  if (conversation) {
    queueStellaNote(ctx, {
      noteId: `msg:${(await sha256Hex(args.commandId)).slice(0, 48)}`,
      conversationId: to,
      ownerGeneration: args.ownerGeneration,
      fromThreadId: args.from.threadId,
      text: formatAgentMessage(args.from, args.text),
    });
    return { threadId: to, command: args.kind, outcome: "queued" };
  }
  const thread = readThread(ctx.db, to);
  if (
    !thread ||
    (thread.owner_generation !== null && thread.owner_generation !== args.ownerGeneration)
  ) {
    throw new RpcError(
      "NOT_FOUND",
      `No agent or Stella session has the thread_id ${to}. agent_status without a thread_id lists who you can reach.`,
      { reason: "message_target_not_found" },
    );
  }
  return (
    await controlAgent(ctx, {
      commandId: args.commandId,
      kind: args.kind,
      thread,
      ownerGeneration: args.ownerGeneration,
      text: formatAgentMessage(args.from, args.text, { starter: sentByStarter(thread, args.from) }),
      source: args.source,
      detail: { from: args.from.threadId },
      next: { clientMsgId: args.commandId, fingerprint: "agent-message" },
    })
  ).result;
};

type ControlKind = AgentControlCommand["kind"];

type CommandRow = {
  command_id: string;
  thread_id: string;
  kind: ControlKind;
  executor: AgentControlExecutor;
  device_id: string | null;
  owner_generation: string;
  text: string;
  next_json: string | null;
  source: string;
  state: "pending" | "delivered" | "failed" | "dropped" | "superseded";
  outcome: string | null;
  result_json: string | null;
  attempts: number;
  created_at: number;
  updated_at: number;
  delivered_at: number | null;
};

type NextAttempt = { clientMsgId: string; fingerprint: string };

type ControlInput = {
  commandId: string;
  kind: ControlKind;
  thread: ThreadRow;
  ownerGeneration: string;
  text: string;
  source: string;
  detail?: Record<string, unknown>;
  next?: NextAttempt;
};

type Routed =
  | { outcome: AgentControlOutcome; note?: string; waitingForDevice?: true }
  | { hold: "unreachable" | "timeout" };

const controlAgent = async (
  ctx: OwnerContext,
  input: ControlInput,
): Promise<{ result: AgentControlResult; waitingForDevice: boolean }> => {
  const prior = readCommand(ctx.db, input.commandId);
  if (prior?.result_json && prior.state !== "failed") {
    return { result: JSON.parse(prior.result_json) as AgentControlResult, waitingForDevice: false };
  }
  const executor = threadExecutor(input.thread);
  const deviceId = executorDevice(ctx, executor);
  if (prior) {
    ctx.db.run(
      "UPDATE agent_commands SET state = 'pending', attempts = attempts + 1, updated_at = ? WHERE command_id = ?",
      ctx.now,
      input.commandId,
    );
  } else {
    recordCommand(ctx, input, executor.kind, deviceId);
  }
  if (input.kind === "pause") {
    recordPauseRequested(ctx, input.thread, `pause_requested:${input.commandId}`, input.source, {
      controlRequestId: input.commandId,
      executor: executor.kind,
      ...(deviceId ? { deviceId } : {}),
    });
  } else {
    supersedeHeldPauses(ctx, input.thread.thread_id, input.commandId);
  }
  let routed: Routed;
  try {
    routed = await routeCommand(ctx, input, executor, deviceId);
  } catch (error) {
    settleCommand(ctx, input.commandId, "failed", errorReason(error));
    logCommand(ctx, input.thread.thread_id, "command_routed", `command_routed:${input.commandId}:${prior ? prior.attempts + 1 : 0}`, input.source, {
      commandId: input.commandId,
      command: input.kind,
      executor: executor.kind,
      ...(deviceId ? { deviceId } : {}),
      outcome: "failed",
      reason: errorReason(error),
    });
    throw error;
  }
  const result = await commandResult(ctx, input, executor, deviceId, routed);
  if ("hold" in routed) {
    holdCommand(ctx, input, deviceId!, routed.hold);
  }
  ctx.db.run(
    `UPDATE agent_commands SET state = ?, outcome = ?, result_json = ?, updated_at = ?,
       delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END
     WHERE command_id = ?`,
    "hold" in routed ? "pending" : "delivered",
    result.outcome,
    JSON.stringify(result),
    ctx.now,
    "hold" in routed ? "pending" : "delivered",
    ctx.now,
    input.commandId,
  );
  logCommand(ctx, input.thread.thread_id, "command_routed", `command_routed:${input.commandId}:${prior ? prior.attempts + 1 : 0}`, input.source, {
    commandId: input.commandId,
    command: input.kind,
    executor: executor.kind,
    ...(deviceId ? { deviceId } : {}),
    outcome: result.outcome,
    ...("hold" in routed ? { held: routed.hold } : {}),
  });
  return {
    result,
    waitingForDevice: !("hold" in routed) && routed.waitingForDevice === true,
  };
};

export const deliverReportToAgent = async (
  ctx: OwnerContext,
  args: { reportId: string; parentThreadId: string; ownerGeneration: string; text: string; fromThreadId: string },
): Promise<void> => {
  const thread = readThread(ctx.db, args.parentThreadId);
  if (!thread) throw new RpcError("NOT_FOUND", `No agent has the thread_id ${args.parentThreadId}.`);
  await controlAgent(ctx, {
    commandId: args.reportId,
    kind: "message",
    thread,
    ownerGeneration: args.ownerGeneration,
    text: args.text,
    source: "owner:report-outbox",
    detail: { from: args.fromThreadId, reportId: args.reportId },
    next: { clientMsgId: agentReportReceipt(args.reportId), fingerprint: "agent-report" },
  });
};

const readCommand = (db: OwnerDbReader, commandId: string): CommandRow | null =>
  db.one<CommandRow>("SELECT * FROM agent_commands WHERE command_id = ?", commandId);

const executorDevice = (ctx: OwnerContext, executor: ThreadExecutor): string | null =>
  (executor.kind === "dispatch" || executor.kind === "local") && executor.deviceId
    ? resolveCurrentDeviceId(ctx.db, executor.deviceId)
    : null;

const recordCommand = (
  ctx: OwnerContext,
  input: ControlInput,
  executor: AgentControlExecutor,
  deviceId: string | null,
): void => {
  ctx.db.run("DELETE FROM agent_commands WHERE created_at < ? AND state <> 'pending'", ctx.now - COMMAND_TTL_MS);
  ctx.db.run(
    `INSERT INTO agent_commands
       (command_id, thread_id, kind, executor, device_id, owner_generation, text, next_json, source,
        state, attempts, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?) ON CONFLICT (command_id) DO NOTHING`,
    input.commandId,
    input.thread.thread_id,
    input.kind,
    executor,
    deviceId,
    input.ownerGeneration,
    input.text,
    input.next ? JSON.stringify(input.next) : null,
    input.source,
    ctx.now,
    ctx.now,
  );
  logCommand(ctx, input.thread.thread_id, "command_received", `command_received:${input.commandId}`, input.source, {
    commandId: input.commandId,
    command: input.kind,
    executor,
    ...(deviceId ? { deviceId } : {}),
    ...input.detail,
  });
};

const logCommand = (
  ctx: OwnerContext,
  threadId: string,
  kind: "command_received" | "command_routed" | "command_delivered" | "command_dropped",
  key: string,
  source: string,
  detail: Record<string, unknown>,
): void => {
  recordAgentChange(
    ctx.db,
    { threadId, kind, key, source, detail, always: true, now: ctx.now },
    () => undefined,
  );
};

const settleCommand = (
  ctx: OwnerContext,
  commandId: string,
  state: Exclude<CommandRow["state"], "pending">,
  outcome: string,
): void => {
  ctx.db.run(
    `UPDATE agent_commands SET state = ?, outcome = ?, updated_at = ?,
       delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END
     WHERE command_id = ?`,
    state,
    outcome,
    ctx.now,
    state,
    ctx.now,
    commandId,
  );
};

const errorReason = (error: unknown): string =>
  error instanceof RpcError
    ? (error.reason ?? error.code)
    : error instanceof Error
      ? error.message.slice(0, 200)
      : String(error).slice(0, 200);

const holdCommand = (
  ctx: OwnerContext,
  input: ControlInput,
  deviceId: string,
  reason: "unreachable" | "timeout",
): void => {
  ctx.jobs.schedule(
    COMMAND_JOB,
    ctx.now + COMMAND_RETRY_MS,
    { messageId: input.commandId },
    { id: commandJobId(input.commandId) },
  );
  if (input.kind === "pause") {
    recordAgentChange(
      ctx.db,
      {
        threadId: input.thread.thread_id,
        kind: "pause_held",
        key: `pause_held:${input.commandId}`,
        source: input.source,
        detail: { commandId: input.commandId, deviceId, reason },
        always: true,
        now: ctx.now,
      },
      () => undefined,
    );
  } else {
    recordMessageLanded(ctx, input.thread.thread_id, input.commandId, "held", input.source, deviceId);
  }
};

const supersedeHeldPauses = (ctx: OwnerContext, threadId: string, commandId: string): void => {
  for (const held of ctx.db.all<{ command_id: string }>(
    "SELECT command_id FROM agent_commands WHERE thread_id = ? AND kind = 'pause' AND state = 'pending'",
    threadId,
  )) {
    ctx.jobs.cancel(commandJobId(held.command_id));
    settleCommand(ctx, held.command_id, "superseded", "superseded");
    logCommand(ctx, threadId, "command_dropped", `command_dropped:${held.command_id}`, "owner:command-outbox", {
      commandId: held.command_id,
      command: "pause",
      reason: "superseded",
      by: commandId,
    });
  }
};

const routeCommand = async (
  ctx: OwnerContext,
  input: ControlInput,
  executor: ThreadExecutor,
  deviceId: string | null,
): Promise<Routed> => {
  const { thread } = input;
  if (input.kind === "pause") return await routePause(ctx, input, executor, deviceId);
  if (input.kind === "resume" && ACTIVE_STATUSES.has(thread.status)) {
    return { outcome: "running", note: "It is already running; nothing to resume." };
  }
  switch (executor.kind) {
    case "harness": {
      const { outcome } = await ctx.host.controlHarnessAgent({
        conversationId: thread.conversation_id,
        ownerGeneration: input.ownerGeneration,
        threadId: thread.thread_id,
        commandId: input.commandId,
        kind: "message",
        text: input.text,
      });
      if (outcome !== "steered" && outcome !== "resumed") throw harnessAgentGone(thread.thread_id);
      recordSteered(ctx, thread.thread_id, null, input.commandId, input.source, {
        executor: "harness",
        delivered: outcome,
      });
      return { outcome };
    }
    case "local": {
      if (!deviceId) throw noComputer(thread.thread_id);
      const sent = await ctx.host.messageLocalAgent({
        deviceId,
        threadId: thread.thread_id,
        ownerGeneration: input.ownerGeneration,
        messageId: input.commandId,
        text: input.text,
      });
      switch (sent.outcome) {
        case "steered":
        case "resumed":
          recordMessageLanded(ctx, thread.thread_id, input.commandId, sent.outcome, input.source, deviceId);
          return { outcome: sent.outcome };
        case "queued":
          recordMessageLanded(ctx, thread.thread_id, input.commandId, "queued", input.source, deviceId);
          return {
            outcome: "queued",
            note: `The computer running ${thread.thread_id} holds it for the agent's next step.`,
          };
        case "not_found":
          throw new RpcError(
            "NOT_FOUND",
            `${thread.thread_id} is no longer on ${await deviceName(ctx, deviceId)}. agent_status without a thread_id lists who you can reach.`,
            { reason: "message_target_not_found" },
          );
        case "refused":
          throw new RpcError(
            "CONFLICT",
            `${await deviceName(ctx, deviceId)} did not accept the message for ${thread.thread_id}.`,
            { reason: "message_refused" },
          );
        default:
          return { hold: sent.outcome };
      }
    }
    case "dispatch": {
      if (ACTIVE_STATUSES.has(thread.status)) {
        const turn = runningTurn(ctx.db, thread);
        const steered = turn?.dispatch_id
          ? await ctx.host.steerDeviceAgentTurn({
              dispatchId: turn.dispatch_id,
              messageId: input.commandId,
              text: input.text,
            })
          : { delivered: false as const, reason: "not_running" as const };
        if (steered.delivered) {
          recordSteered(ctx, thread.thread_id, turn?.turn_id ?? null, input.commandId, input.source, {
            executor: "dispatch",
          });
          return { outcome: "steered" };
        }
        if (steered.reason === "unreachable") return { hold: "unreachable" };
        throw new RpcError(
          "CONFLICT",
          `${thread.thread_id} is between runs on its device (starting up or just finishing). Check agent_status, then send_message again.`,
          { reason: "thread_changed", retryable: true },
        );
      }
      const destination = await assertDeviceDestination(ctx, executor.deviceId);
      nextAttempt(ctx, input);
      return destination.waiting ? { outcome: "resumed", waitingForDevice: true } : { outcome: "resumed" };
    }
    case "cloud": {
      if (ACTIVE_STATUSES.has(thread.status)) {
        const steered = await ctx.host.steerAgentTurn({
          threadId: thread.thread_id,
          conversationId: thread.conversation_id,
          ownerGeneration: input.ownerGeneration,
          messageId: input.commandId,
          text: input.text,
        });
        if (steered) {
          recordSteered(ctx, thread.thread_id, runningTurn(ctx.db, thread)?.turn_id ?? null, input.commandId, input.source, {
            executor: "cloud",
            ...input.detail,
          });
          return { outcome: "steered" };
        }
        const queued = ctx.db.one<{ turn_id: string }>(
          `SELECT t.turn_id FROM agent_turns t JOIN agent_dispatch_prompts p ON p.turn_id = t.turn_id
            WHERE t.thread_id = ? AND t.attempt_generation = ? LIMIT 1`,
          thread.thread_id,
          thread.attempt_generation,
        );
        if (queued) {
          throw new RpcError("CONFLICT", `${thread.thread_id} is starting up. Send the message again in a moment.`, {
            retryable: true,
            reason: "thread_starting",
          });
        }
      }
      nextAttempt(ctx, input);
      return { outcome: "resumed" };
    }
  }
};

const nextAttempt = (ctx: OwnerContext, input: ControlInput): void => {
  const current = readThread(ctx.db, input.thread.thread_id);
  if (!current || current.attempt_generation !== input.thread.attempt_generation) {
    throw threadChanged(input.thread.thread_id);
  }
  const next = input.next ?? { clientMsgId: input.commandId, fingerprint: "agent-message" };
  beginNextAttempt(ctx, current, {
    clientMsgId: next.clientMsgId,
    fingerprint: next.fingerprint,
    prompt: input.text,
    source: input.source,
    detail: { messageId: input.commandId, ...input.detail },
    sql: `UPDATE agent_threads SET
       status = 'running', attempt_generation = ?, origin_delivery_ack_at = NULL,
       result_json = NULL, error_message = NULL, updated_at = ?
     WHERE thread_id = ?`,
  });
};

const routePause = async (
  ctx: OwnerContext,
  input: ControlInput,
  executor: ThreadExecutor,
  deviceId: string | null,
): Promise<Routed> => {
  const { thread } = input;
  if (!ACTIVE_STATUSES.has(thread.status)) {
    return {
      outcome: "not_running",
      note:
        thread.status === "paused"
          ? "It was already paused."
          : `It had already ${thread.status === "canceled" ? "stopped" : thread.status}; nothing was running.`,
    };
  }
  switch (executor.kind) {
    case "cloud":
      await pauseCloudAttempt(ctx, thread, input.ownerGeneration, input.commandId, input.source);
      return { outcome: "paused" };
    case "harness": {
      const { outcome } = await ctx.host.controlHarnessAgent({
        conversationId: thread.conversation_id,
        ownerGeneration: input.ownerGeneration,
        threadId: thread.thread_id,
        commandId: input.commandId,
        kind: "pause",
      });
      if (outcome === "paused") return { outcome: "paused" };
      if (outcome === "not_running") {
        return { outcome: "not_running", note: "Its conversation's Stella reports it is not running now." };
      }
      throw harnessAgentGone(thread.thread_id);
    }
    case "dispatch":
      await stopDeviceAttempt(ctx, thread, input.commandId, input.source);
      return { outcome: "paused" };
    case "local": {
      if (!deviceId) throw noComputer(thread.thread_id);
      const sent = await ctx.host.pauseLocalAgent({
        deviceId,
        threadId: thread.thread_id,
        ownerGeneration: input.ownerGeneration,
        commandId: input.commandId,
      });
      switch (sent.outcome) {
        case "paused":
          await markLocalThreadPaused(ctx, thread, input.source, input.commandId);
          return { outcome: "paused" };
        case "not_running":
        case "not_found":
          return {
            outcome: "not_running",
            note: `${await deviceName(ctx, deviceId)} reports it is not running there now.`,
          };
        case "refused":
          throw new RpcError(
            "CONFLICT",
            `${await deviceName(ctx, deviceId)} did not accept the pause for ${thread.thread_id}.`,
            { reason: "pause_refused" },
          );
        default:
          return { hold: sent.outcome };
      }
    }
  }
};

const commandResult = async (
  ctx: OwnerContext,
  input: ControlInput,
  executor: ThreadExecutor,
  deviceId: string | null,
  routed: Routed,
): Promise<AgentControlResult> => {
  const threadId = input.thread.thread_id;
  const device = deviceId ? await deviceStanding(ctx, deviceId) : null;
  const where = device ? `on ${device.name}` : "in Stella's cloud";
  const current = readThread(ctx.db, threadId) ?? input.thread;
  let outcome: AgentControlOutcome;
  let note: string | undefined;
  const offlineName = device
    ? `${device.name}${device.lastSeenAt !== undefined ? ` (last seen ${new Date(device.lastSeenAt).toISOString()})` : ""}`
    : "that computer";
  if ("hold" in routed) {
    const name = device?.name ?? "that computer";
    outcome = "held";
    note =
      input.kind === "pause"
        ? routed.hold === "unreachable"
          ? `${name} is offline right now, so it could not stop yet. The pause is held and applied the moment ${name} reconnects, unless you message the agent first.`
          : `${name} did not answer in time. The pause is offered again until ${name} answers.`
        : routed.hold === "unreachable"
          ? `${offlineName} is offline. The message waits and is delivered to ${threadId} when ${name} reconnects, if that is within an hour.`
          : `${name} did not answer in time. The message is offered to ${threadId} again until ${name} answers, for up to an hour.`;
  } else if (input.kind !== "pause" && routed.outcome === "resumed" && routed.waitingForDevice && device && !device.online) {
    outcome = "held";
    note = `${offlineName} is offline. The message is held, and ${threadId}'s next run starts with it when ${device.name} reconnects.`;
  } else {
    outcome = routed.outcome;
    note = routed.note;
    if (executor.kind === "dispatch" && input.kind === "pause" && outcome === "paused" && device && !device.online) {
      note = `${device.name} is offline right now. The agent is recorded as paused, and it stops there the moment ${device.name} reconnects.`;
    }
  }
  return {
    threadId,
    command: input.kind,
    outcome,
    status: current.status,
    attemptGeneration: current.attempt_generation,
    executor: executor.kind,
    where,
    ...(note ? { note } : {}),
  };
};

const harnessAgentGone = (threadId: string): RpcError =>
  new RpcError(
    "NOT_FOUND",
    `${threadId} is no longer held by its conversation's Stella in the cloud. agent_status without a thread_id lists who you can reach.`,
    { reason: "message_target_not_found" },
  );

const noComputer = (threadId: string): RpcError =>
  new RpcError("CONFLICT", `${threadId} has no computer to deliver the control to.`, {
    reason: "thread_local_to_device",
  });

const deviceName = async (ctx: OwnerContext, deviceId: string): Promise<string> =>
  (await deviceLabels(ctx)).get(deviceId) || "that computer";

const recordMessageLanded = (
  ctx: OwnerContext,
  threadId: string,
  messageId: string,
  delivered: "steered" | "resumed" | "queued" | "held",
  source: string,
  deviceId: string,
): void => {
  const kind = delivered === "steered" ? "steered" : delivered === "resumed" ? "resume_requested" : "input_queued";
  recordAgentChange(
    ctx.db,
    {
      threadId,
      kind,
      key: `${kind}:${threadId}:${messageId}${kind === "input_queued" ? `:${delivered}` : ""}`,
      source,
      detail: {
        messageId,
        deviceId,
        ...(kind === "input_queued" ? { heldBy: delivered === "held" ? "owner" : "device" } : {}),
      },
      always: true,
      now: ctx.now,
    },
    () => undefined,
  );
};

const RETRY_REASONS = new Set(["thread_changed", "thread_starting", "thread_busy", "device_unreachable"]);

/** One more offer of a held command, rescheduled until its executor takes it. */
const runCommand = async (ctx: OwnerContext, payload: { messageId?: unknown }): Promise<void> => {
  if (typeof payload?.messageId !== "string") return;
  const row = ctx.db.one<CommandRow>(
    "SELECT * FROM agent_commands WHERE command_id = ? AND state = 'pending'",
    payload.messageId,
  );
  if (!row) return;
  if (ctx.now - row.created_at >= COMMAND_WAIT_MS[row.kind]) {
    dropCommand(ctx, row, "expired");
    return;
  }
  const thread = readThread(ctx.db, row.thread_id);
  if (!thread || (thread.owner_generation !== null && thread.owner_generation !== row.owner_generation)) {
    dropCommand(ctx, row, "not_found");
    return;
  }
  const executor = threadExecutor(thread);
  const deviceId = executorDevice(ctx, executor);
  ctx.db.run(
    "UPDATE agent_commands SET attempts = attempts + 1, updated_at = ? WHERE command_id = ?",
    ctx.now,
    row.command_id,
  );
  const input: ControlInput = {
    commandId: row.command_id,
    kind: row.kind,
    thread,
    ownerGeneration: row.owner_generation,
    text: row.text,
    source: "owner:command-outbox",
    ...(row.next_json ? { next: JSON.parse(row.next_json) as NextAttempt } : {}),
  };
  let routed: Routed;
  try {
    routed = await routeCommand(ctx, input, executor, deviceId);
  } catch (error) {
    const reason = errorReason(error);
    if (RETRY_REASONS.has(reason) || (error instanceof RpcError && error.code === "UNAVAILABLE")) {
      ctx.jobs.schedule(COMMAND_JOB, ctx.now + COMMAND_RETRY_MS, { messageId: row.command_id }, { id: commandJobId(row.command_id) });
      return;
    }
    dropCommand(ctx, { ...row, attempts: row.attempts + 1 }, reason);
    return;
  }
  if ("hold" in routed) {
    ctx.jobs.schedule(COMMAND_JOB, ctx.now + COMMAND_RETRY_MS, { messageId: row.command_id }, { id: commandJobId(row.command_id) });
    return;
  }
  settleCommand(ctx, row.command_id, "delivered", routed.outcome);
  logCommand(ctx, row.thread_id, "command_delivered", `command_delivered:${row.command_id}`, "owner:command-outbox", {
    commandId: row.command_id,
    command: row.kind,
    executor: executor.kind,
    ...(deviceId ? { deviceId } : {}),
    outcome: routed.outcome,
    attempts: row.attempts + 1,
  });
};

const dropCommand = (ctx: OwnerContext, row: CommandRow, reason: string): void => {
  settleCommand(ctx, row.command_id, "dropped", reason);
  logCommand(ctx, row.thread_id, "command_dropped", `command_dropped:${row.command_id}`, "owner:command-outbox", {
    commandId: row.command_id,
    command: row.kind,
    reason,
    attempts: row.attempts,
  });
};

/** A device just proved its presence: offer it every command held for it, oldest first. */
const flushDeviceCommands = (ctx: OwnerContext, raw: unknown): { scheduled: number } => {
  const { deviceId } = object({ deviceId: id(256) })(raw);
  let scheduled = 0;
  for (const row of ctx.db.all<{ command_id: string; device_id: string | null; thread_id: string }>(
    "SELECT command_id, device_id, thread_id FROM agent_commands WHERE state = 'pending' ORDER BY created_at ASC",
  )) {
    const thread = readThread(ctx.db, row.thread_id);
    const current = thread ? executorDevice(ctx, threadExecutor(thread)) : null;
    const held = row.device_id ? resolveCurrentDeviceId(ctx.db, row.device_id) : null;
    if (current !== deviceId && held !== deviceId) continue;
    ctx.jobs.schedule(COMMAND_JOB, ctx.now + scheduled, { messageId: row.command_id }, { id: commandJobId(row.command_id) });
    scheduled += 1;
  }
  return { scheduled };
};

type ControlArgs = AgentThreadCalls["agentThreads.control"]["args"];

const controlRequest = async (ctx: OwnerContext, args: ControlArgs): Promise<AgentControlResult> => {
  if (!CONTROL_REQUEST_ID_PATTERN.test(args.commandId)) {
    throw new RpcError("BAD_REQUEST", "That request could not be sent. Try again.");
  }
  const { command } = args;
  const requested = args.threadId.trim();
  const commandId = command.kind === "pause" ? `pause:${args.commandId}` : args.commandId;
  const prior = readCommand(ctx.db, commandId);
  if (prior?.result_json && prior.state !== "failed") return JSON.parse(prior.result_json) as AgentControlResult;
  if (command.kind === "pause") {
    const paused = await pauseAgent(ctx, {
      ownerGeneration: args.ownerGeneration,
      conversationId: args.conversationId,
      threadId: requested,
      controlRequestId: args.commandId,
    });
    const recorded = readCommand(ctx.db, commandId);
    if (recorded?.result_json) return JSON.parse(recorded.result_json) as AgentControlResult;
    return {
      threadId: paused.threadId,
      command: "pause",
      outcome: paused.outcome,
      status: paused.status,
      attemptGeneration: paused.attemptGeneration,
      where: paused.where,
      ...(paused.note ? { note: paused.note } : {}),
    };
  }
  const text = (command.kind === "resume" ? command.text?.trim() || RESUME_TEXT : command.text.trim());
  if (!text || text.length > AGENT_MESSAGE_MAX_CHARS) {
    throw new RpcError("BAD_REQUEST", `A message must be 1 to ${AGENT_MESSAGE_MAX_CHARS} characters.`);
  }
  const target = senderStella(ctx, requested, command.from, args.conversationId);
  if (target === command.from.threadId) {
    throw new RpcError("BAD_REQUEST", "That thread_id is the sender's own.");
  }
  await assertGeneration(ctx, args.ownerGeneration);
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    "agentThreads.message",
    { count: 120, windowMs: 10 * 60_000 },
    "Too many agent messages at once. Wait a moment and try again.",
  );
  const resolved = readConversationThread(ctx.db, args.conversationId, target)?.thread_id ?? target;
  return await deliverAgentMessage(ctx, {
    ownerGeneration: args.ownerGeneration,
    commandId,
    to: resolved,
    text,
    from: command.from,
    kind: command.kind,
    source: `${ctx.caller ? "client" : "cloud"}:${args.conversationId}`,
    senderRealm: conversationRealm(args.conversationId),
  });
};

// ── Pause, from any of the owner's hosts ──────────────────────────────────

type PauseArgs = AgentThreadCalls["agentThreads.pause"]["args"];
type PauseResult = AgentThreadCalls["agentThreads.pause"]["result"];

/** The running turn of a thread's current attempt. */
const runningTurn = (db: OwnerDbReader, thread: ThreadRow): TurnRow | null =>
  db.one<TurnRow>(
    `SELECT * FROM agent_turns WHERE thread_id = ? AND attempt_generation = ?
       AND status IN ('running', 'resuming') ORDER BY created_at DESC LIMIT 1`,
    thread.thread_id,
    thread.attempt_generation,
  );

/**
 * Stop the attempt a cloud thread is on, wherever its runtime is (its pi
 * agent or its BuildSession), and record it paused.
 */
const pauseCloudAttempt = async (
  ctx: OwnerContext,
  thread: ThreadRow,
  ownerGeneration: string,
  cancelRequestId: string,
  source: string,
): Promise<void> => {
  const turn = runningTurn(ctx.db, thread);
  if (!turn) throw threadChanged(thread.thread_id);
  const outcome = await ctx.host.cancelAgentTurn({
    threadId: thread.thread_id,
    conversationId: thread.conversation_id,
    turnId: turn.turn_id,
    attemptGeneration: thread.attempt_generation,
    ownerGeneration,
    cancelRequestId,
  });
  if (outcome === "changed") throw threadChanged(thread.thread_id);
  const now = Date.now();
  recordAgentChange(
    ctx.db,
    {
      threadId: thread.thread_id,
      turnId: turn.turn_id,
      kind: endedKind,
      outcome: "paused",
      source,
      detail: { cancelRequestId },
      now,
    },
    () => {
      ctx.db.run(
        "UPDATE agent_turns SET status = 'paused', updated_at = ? WHERE turn_id = ?",
        now,
        turn.turn_id,
      );
      ctx.db.run(
        `UPDATE agent_threads SET status = 'paused', error_message = NULL, updated_at = ?
          WHERE thread_id = ? AND attempt_generation = ? AND status IN ('running', 'resuming')`,
        now,
        thread.thread_id,
        thread.attempt_generation,
      );
    },
  );
  ctx.jobs.cancel(`dispatch:${turn.turn_id}`);
};

/** A local thread its computer stopped for a pause: recorded, with its journal card. */
const markLocalThreadPaused = async (
  ctx: OwnerContext,
  thread: ThreadRow,
  source: string,
  commandId: string,
): Promise<void> => {
  recordAgentChange(
    ctx.db,
    {
      threadId: thread.thread_id,
      kind: endedKind,
      outcome: "paused",
      source,
      detail: { commandId, executor: "local" },
      now: ctx.now,
    },
    () =>
      ctx.db.run(
        `UPDATE agent_threads SET status = 'paused', error_message = NULL, updated_at = ?
          WHERE thread_id = ? AND attempt_generation = ? AND status IN ('running', 'resuming')`,
        ctx.now,
        thread.thread_id,
        thread.attempt_generation,
      ),
  );
  const paused = readThread(ctx.db, thread.thread_id);
  if (paused?.status === "paused" && paused.attempt_generation === thread.attempt_generation) {
    await postAgentLifecycleCard(ctx, paused, { kind: "paused" });
  }
};

/** A device's name and whether it is connected now; unknown reads as offline. */
const deviceStanding = async (
  ctx: OwnerContext,
  deviceId: string,
): Promise<{ name: string; online: boolean; lastSeenAt?: number }> => {
  try {
    const current = resolveCurrentDeviceId(ctx.db, deviceId);
    const device = (await ctx.host.deviceDestinations()).find((candidate) => candidate.deviceId === current);
    return {
      name: device?.label?.trim() || "that computer",
      online: device?.online === true,
      ...(device?.lastSeenAt !== undefined ? { lastSeenAt: device.lastSeenAt } : {}),
    };
  } catch {
    return { name: "that computer", online: false };
  }
};

/**
 * `pause_agent` for any agent the owner has, from any host: authorized by
 * the owner, not by which device started the agent, and routed to where
 * the agent runs through {@link controlAgent}. A computer that is offline
 * gets the pause when it reconnects; the result says which happened.
 */
const pauseAgent = async (ctx: OwnerContext, args: PauseArgs): Promise<PauseResult> => {
  if (!CONTROL_REQUEST_ID_PATTERN.test(args.controlRequestId)) {
    throw new RpcError("BAD_REQUEST", "That pause request could not be sent. Try again.");
  }
  const commandId = `pause:${args.controlRequestId}`;
  const replay = pauseReplay(ctx.db, commandId);
  if (replay) return replay;
  const requested = args.threadId.trim();
  await assertGeneration(ctx, args.ownerGeneration);
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    "agentThreads.pause",
    { count: 60, windowMs: 10 * 60_000 },
    "Too many pause requests. Wait a moment and try again.",
  );
  const thread = readConversationThread(ctx.db, args.conversationId, requested);
  if (
    !thread ||
    (thread.owner_generation !== null && thread.owner_generation !== args.ownerGeneration) ||
    threadRealm(thread) !== conversationRealm(args.conversationId)
  ) {
    throw new RpcError(
      "NOT_FOUND",
      `No agent has the thread_id ${requested}. agent_status without a thread_id lists who you can reach.`,
      { reason: "pause_target_not_found" },
    );
  }
  const { result } = await controlAgent(ctx, {
    commandId,
    kind: "pause",
    thread,
    ownerGeneration: args.ownerGeneration,
    text: "",
    source: `${ctx.caller ? "client" : "cloud"}:${args.conversationId}`,
    detail: { requester: args.conversationId },
  });
  return pauseResult(result);
};

const pauseResult = (result: AgentControlResult): PauseResult => ({
  threadId: result.threadId,
  outcome: result.outcome === "held" || result.outcome === "not_running" ? result.outcome : "paused",
  status: result.status ?? "unknown",
  attemptGeneration: result.attemptGeneration ?? 0,
  where: result.where ?? "in Stella's cloud",
  ...(result.note ? { note: result.note } : {}),
});

const pauseReplay = (db: OwnerDbReader, commandId: string): PauseResult | null => {
  const command = readCommand(db, commandId);
  if (command?.result_json && command.state !== "failed") {
    return pauseResult(JSON.parse(command.result_json) as AgentControlResult);
  }
  const receipt = db.one<{ result_json: string }>(
    "SELECT result_json FROM agent_cancel_receipts WHERE cancel_request_id = ?",
    commandId,
  );
  return receipt ? (JSON.parse(receipt.result_json) as PauseResult) : null;
};

const conversationControls = (
  thread: ThreadRow,
  args: { ownerGeneration: string; conversationId: string },
): boolean =>
  thread.owner_generation === args.ownerGeneration &&
  (thread.conversation_id === args.conversationId || thread.origin_conversation_id === args.conversationId);

type CancelArgs = AgentThreadCalls["agentThreads.cancel"]["args"];
type CancelResult = AgentThreadCalls["agentThreads.cancel"]["result"];

const cancelThread = async (ctx: OwnerContext, args: CancelArgs): Promise<CancelResult> => {
  if (!CONTROL_REQUEST_ID_PATTERN.test(args.controlRequestId)) {
    throw new RpcError("BAD_REQUEST", "That stop request could not be sent. Try again.");
  }
  const commandId = `cancel:${args.controlRequestId}`;
  const command = readCommand(ctx.db, commandId);
  const receipt =
    command?.result_json && command.state !== "failed"
      ? { thread_id: command.thread_id, result_json: null }
      : ctx.db.one<{ thread_id: string; result_json: string }>(
          "SELECT thread_id, result_json FROM agent_cancel_receipts WHERE cancel_request_id = ?",
          args.controlRequestId,
        );
  if (receipt) {
    if (receipt.thread_id !== args.threadId) {
      throw new RpcError("CONFLICT", "That request id was already used for a different thread.");
    }
    if (receipt.result_json) return JSON.parse(receipt.result_json) as CancelResult;
    return { canceled: true, control: control(readThread(ctx.db, args.threadId)!) };
  }
  await assertGeneration(ctx, args.ownerGeneration);
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    "agentThreads.cancel",
    { count: 30, windowMs: 10 * 60_000 },
    "Too many stop requests. Wait a moment and try again.",
  );
  const thread = readThread(ctx.db, args.threadId);
  if (
    !thread ||
    !conversationControls(thread, { ownerGeneration: args.ownerGeneration, conversationId: args.originConversationId })
  ) {
    throw new RpcError("NOT_FOUND", "That cloud thread no longer exists.");
  }
  if (!ACTIVE_STATUSES.has(thread.status)) {
    return { canceled: true, control: control(thread) };
  }
  if (
    thread.attempt_generation !== args.expectedAttemptGeneration ||
    thread.updated_at !== args.expectedThreadUpdatedAt
  ) {
    throw threadChanged(thread.thread_id);
  }
  if (threadExecutor(thread).kind === "cloud" && !runningTurn(ctx.db, thread)) {
    throw threadChanged(thread.thread_id);
  }
  await controlAgent(ctx, {
    commandId,
    kind: "pause",
    thread,
    ownerGeneration: args.ownerGeneration,
    text: "",
    source: `device:${args.originDeviceId}`,
    detail: { requester: args.originConversationId, via: "agentThreads.cancel" },
  });
  return { canceled: true, control: control(readThread(ctx.db, thread.thread_id)!) };
};

const acknowledgeDelivery = (
  ctx: OwnerContext,
  args: AgentThreadCalls["agentThreads.acknowledgeDelivery"]["args"],
): AgentThreadCalls["agentThreads.acknowledgeDelivery"]["result"] => {
  const thread = readThread(ctx.db, args.threadId);
  if (
    !thread ||
    thread.origin_device_id !== args.originDeviceId ||
    thread.owner_generation !== args.ownerGeneration
  ) {
    throw new RpcError("NOT_FOUND", "That thread is not waiting for this device.");
  }
  if (
    thread.attempt_generation !== args.attemptGeneration ||
    thread.updated_at !== args.terminalUpdatedAt
  ) {
    return { acknowledged: false, superseded: true };
  }
  if (!TERMINAL_STATUSES.has(thread.status) && thread.status !== "waiting_for_user") {
    throw new RpcError("CONFLICT", "That thread is still running.");
  }
  if (thread.origin_delivery_ack_at !== null) return { acknowledged: false, superseded: false };
  recordAgentChange(
    ctx.db,
    {
      threadId: thread.thread_id,
      kind: "delivery_acknowledged",
      source: `device:${args.originDeviceId}`,
      now: ctx.now,
    },
    () =>
      ctx.db.run(
        "UPDATE agent_threads SET origin_delivery_ack_at = ? WHERE thread_id = ?",
        ctx.now,
        thread.thread_id,
      ),
  );
  // A build that still reads this path took the report, so the report
  // outbox must not hand the same report to Stella again.
  const reportId = agentReportId(thread.thread_id, thread.attempt_generation);
  ctx.db.run(
    `UPDATE agent_report_outbox SET state = 'delivered', delivered_via = ?, updated_at = ?, delivered_at = ?
      WHERE report_id = ? AND state IN ('pending', 'offered')`,
    `device-ack:${args.originDeviceId}`,
    ctx.now,
    ctx.now,
    reportId,
  );
  ctx.jobs.cancel(`agent-report:${reportId}`);
  return { acknowledged: true, superseded: false };
};

// ── Desktop ("computer") threads ──────────────────────────────────────────

const rejectStart = (reason: string, message: string): RpcError =>
  new RpcError("CONFLICT", message, { reason });

const startComputerThread = async (
  ctx: OwnerContext,
  args: AgentThreadCalls["computerThreads.start"]["args"],
): Promise<{ threadId: string }> => {
  await assertGeneration(ctx, args.ownerGeneration);
  const conversation = ctx.db.one<{ conversation_id: string }>(
    "SELECT conversation_id FROM conversations WHERE conversation_id = ? AND deleted_at IS NULL",
    args.conversationId,
  );
  if (!conversation) throw rejectStart("conversation_not_found", "That conversation no longer exists.");
  const existing = readThread(ctx.db, args.threadId);
  if (existing) {
    if (
      existing.placement !== "computer" ||
      existing.executor_device_id !== null ||
      existing.conversation_id !== args.conversationId ||
      existing.origin_device_id !== args.originDeviceId ||
      existing.owner_generation !== args.ownerGeneration
    ) {
      throw rejectStart("thread_identity_conflict", "That agent id belongs to a different agent.");
    }
    if (args.attemptGeneration === existing.attempt_generation) {
      if (existing.description !== args.description || existing.agent_type !== args.agentType) {
        throw rejectStart("attempt_replay_conflict", "That agent attempt was already started differently.");
      }
      return { threadId: existing.thread_id };
    }
    // Fencing is monotonic, not dense: the desktop advances its generation
    // both when it invalidates an unwinding attempt and when the next one
    // starts, so a follow-up can skip numbers.
    if (args.attemptGeneration < existing.attempt_generation) {
      throw rejectStart("attempt_stale", "A newer attempt of this agent already started.");
    }
    recordAgentChange(
      ctx.db,
      {
        threadId: existing.thread_id,
        kind: startedKind,
        source: `device:${args.originDeviceId}`,
        detail: { executor: "local" },
        now: ctx.now,
      },
      () =>
        ctx.db.run(
          `UPDATE agent_threads SET status = 'running', attempt_generation = ?, description = ?, agent_type = ?,
             origin_delivery_ack_at = NULL, result_json = NULL, error_message = NULL, updated_at = ?
           WHERE thread_id = ?`,
          args.attemptGeneration,
          args.description,
          args.agentType,
          ctx.now,
          existing.thread_id,
        ),
    );
    await postAgentLifecycleCard(ctx, readThread(ctx.db, existing.thread_id)!, { kind: "started" });
    return { threadId: existing.thread_id };
  }
  if (args.attemptGeneration !== 1) {
    throw rejectStart("initial_attempt_invalid", "A new agent starts at attempt 1.");
  }
  recordAgentChange(
    ctx.db,
    {
      threadId: args.threadId,
      kind: "spawned",
      key: `spawned:${args.threadId}`,
      source: `device:${args.originDeviceId}`,
      detail: { executor: "local" },
      now: ctx.now,
    },
    () =>
      ctx.db.run(
        `INSERT INTO agent_threads
           (thread_id, conversation_id, owner_generation, parent_thread_id, origin_device_id, origin_conversation_id,
            description, placement, agent_type, attempt_generation, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'computer', ?, 1, 'running', ?, ?)`,
        args.threadId,
        args.conversationId,
        args.ownerGeneration,
        args.parentThreadId ?? null,
        args.originDeviceId,
        args.conversationId,
        args.description,
        args.agentType,
        ctx.now,
        ctx.now,
      ),
  );
  await postAgentLifecycleCard(ctx, readThread(ctx.db, args.threadId)!, { kind: "started" });
  return { threadId: args.threadId };
};

const readComputerThread = (
  db: OwnerDbReader,
  args: { threadId: string; originDeviceId: string; ownerGeneration: string },
): ThreadRow | null => {
  const row = readThread(db, args.threadId);
  return row &&
    row.placement === "computer" &&
    row.executor_device_id === null &&
    row.origin_device_id === args.originDeviceId &&
    row.owner_generation === args.ownerGeneration
    ? row
    : null;
};

const completeComputerThread = async (
  ctx: OwnerContext,
  args: AgentThreadCalls["computerThreads.complete"]["args"],
): Promise<AgentThreadCalls["computerThreads.complete"]["result"]> => {
  await assertGeneration(ctx, args.ownerGeneration);
  const row = readComputerThread(ctx.db, args);
  if (!row) throw new RpcError("NOT_FOUND", "That agent no longer exists.");
  if (row.attempt_generation !== args.attemptGeneration || row.status !== "running") {
    return { updated: false, status: row.status };
  }
  const status = agentThreadTerminalStatus(args.status, args.error);
  recordAgentChange(
    ctx.db,
    { threadId: row.thread_id, kind: endedKind, outcome: status, source: `device:${args.originDeviceId}`, now: ctx.now },
    () =>
      ctx.db.run(
        `UPDATE agent_threads SET status = ?, result_json = ?, error_message = ?, updated_at = ?
          WHERE thread_id = ?`,
        status,
        args.result !== undefined ? JSON.stringify({ finalText: args.result }) : null,
        status === "paused" ? null : (args.error ?? null),
        ctx.now,
        row.thread_id,
      ),
  );
  await postAgentLifecycleCard(ctx, row, {
    kind: status,
    text: status === "completed" ? args.result : args.error,
  });
  return { updated: true, status };
};

const cancelComputerThread = async (
  ctx: OwnerContext,
  args: AgentThreadCalls["computerThreads.cancel"]["args"],
): Promise<AgentThreadCalls["computerThreads.cancel"]["result"]> => {
  await assertGeneration(ctx, args.ownerGeneration);
  const row = readComputerThread(ctx.db, args);
  if (!row) throw new RpcError("NOT_FOUND", "That agent no longer exists.");
  if (row.attempt_generation !== args.attemptGeneration) return { canceled: false, status: row.status };
  if (row.status !== "running") return { canceled: true, status: row.status };
  const reason = args.reason?.trim() || "Canceled on this computer.";
  const status = agentThreadTerminalStatus("canceled", reason);
  recordAgentChange(
    ctx.db,
    { threadId: row.thread_id, kind: endedKind, outcome: status, source: `device:${args.originDeviceId}`, now: ctx.now },
    () =>
      ctx.db.run(
        "UPDATE agent_threads SET status = ?, error_message = ?, updated_at = ? WHERE thread_id = ?",
        status,
        status === "paused" ? null : reason,
        ctx.now,
        row.thread_id,
      ),
  );
  await postAgentLifecycleCard(ctx, row, { kind: status, text: reason });
  return { canceled: true, status };
};

const computerRecord = (row: ThreadRow): ComputerThreadRecord => {
  let result: string | null = null;
  if (row.result_json) {
    try {
      const parsed = JSON.parse(row.result_json) as { finalText?: unknown };
      result = typeof parsed.finalText === "string" ? parsed.finalText : null;
    } catch {
      result = null;
    }
  }
  return {
    threadId: row.thread_id,
    status:
      row.status === "failed"
        ? "error"
        : row.status === "paused"
          ? "canceled"
          : row.status === "completed" || row.status === "canceled"
            ? row.status
            : "running",
    description: row.description,
    attemptGeneration: row.attempt_generation,
    startedAt: row.created_at,
    completedAt: row.status === "running" ? null : row.updated_at,
    result,
    error: row.status === "paused" ? AGENT_PAUSED_REASON : row.error_message,
    ...(agentStatusOf(row.status) ? { agentStatus: agentStatusOf(row.status)! } : {}),
  };
};

// ── Owner events from BuildSessions and the orchestrator ──────────────────

export type AgentThreadEvent =
  | TurnStartedEvent
  | TurnEventEvent
  | ThreadSpawnedEvent
  | ThreadCompletedEvent;

// ── Claude usage limit holds ──────────────────────────────────────────────

export const USAGE_LIMIT_AGENT_JOB = "agentThreads.usageLimitResume";
export const USAGE_LIMIT_CONVERSATION_JOB = "agentThreads.usageLimitResumeConversation";
/** How long a hold lasts when the CLI named no reset time: then the work tries again. */
const USAGE_LIMIT_UNKNOWN_RESET_HOLD_MS = 30 * 60_000;
/** Margin past the named reset, so the resumed work is not refused again. */
const USAGE_LIMIT_RESET_MARGIN_MS = 30_000;
const USAGE_LIMIT_HOLD_PREFIX = "Waiting for the Claude usage limit to reset";

const usageLimitResumeAt = (limit: ClaudeUsageLimit, now: number): number =>
  limit.resetsAt !== undefined
    ? Math.max(now, limit.resetsAt) + USAGE_LIMIT_RESET_MARGIN_MS
    : now + USAGE_LIMIT_UNKNOWN_RESET_HOLD_MS;

const usageLimitHoldMessage = (limit: ClaudeUsageLimit): string =>
  limit.resetsAt !== undefined
    ? `${USAGE_LIMIT_HOLD_PREFIX} at ${new Date(limit.resetsAt).toISOString()}; it continues automatically then.`
    : `${USAGE_LIMIT_HOLD_PREFIX}; it continues automatically once it does.`;

/**
 * A cloud agent's attempt ended on the Claude usage limit: the thread waits
 * (not failed, so no failure is reported) and an owner job, the durable
 * timer, resumes it once the limit resets. Its conversation shows the hold.
 */
const holdAgentForUsageLimit = (
  db: OwnerDb,
  jobs: OwnerJobs,
  effects: AgentThreadEffects,
  thread: ThreadRow,
  limit: ClaudeUsageLimit,
  now: number,
): void => {
  jobs.schedule(
    USAGE_LIMIT_AGENT_JOB,
    usageLimitResumeAt(limit, now),
    { threadId: thread.thread_id, attemptGeneration: thread.attempt_generation },
    { id: `usage-limit:agent:${thread.thread_id}` },
  );
  const conversationId = thread.parent_thread_id === null ? journalConversationOf(db, thread) : null;
  if (!conversationId || !thread.owner_generation) return;
  effects.cards.push({
    conversationId,
    ownerGeneration: thread.owner_generation,
    sourceTurnId: `usage-limit:${thread.thread_id}:${thread.attempt_generation}`,
    card: {
      type: "usage-limit",
      state: "held",
      threadId: thread.thread_id,
      ...(limit.resetsAt !== undefined ? { until: limit.resetsAt } : {}),
    } satisfies ClaudeUsageLimitCard,
  });
};

const postUsageLimitResumed = async (
  ctx: OwnerContext,
  args: { conversationId: string; ownerGeneration: string; key: string; threadId?: string },
): Promise<void> => {
  await ctx.host.postConversationCard({
    conversationId: args.conversationId,
    ownerGeneration: args.ownerGeneration,
    sourceTurnId: `usage-limit-resumed:${args.key}`,
    card: {
      type: "usage-limit",
      state: "resumed",
      ...(args.threadId ? { threadId: args.threadId } : {}),
    } satisfies ClaudeUsageLimitCard,
  });
};

/** The limit reset: the held agent's next attempt continues its work. */
const resumeAgentAfterUsageLimit = async (ctx: OwnerContext, raw: unknown): Promise<void> => {
  const payload = raw as { threadId?: unknown; attemptGeneration?: unknown } | null;
  if (typeof payload?.threadId !== "string" || typeof payload.attemptGeneration !== "number") return;
  const thread = readThread(ctx.db, payload.threadId);
  if (
    !thread ||
    thread.status !== "waiting_for_user" ||
    thread.attempt_generation !== payload.attemptGeneration ||
    !thread.error_message?.startsWith(USAGE_LIMIT_HOLD_PREFIX) ||
    !thread.owner_generation
  ) {
    return;
  }
  const commandId = `ulr-${(await sha256Hex(`${thread.thread_id}:${thread.attempt_generation}`)).slice(0, 40)}`;
  await controlAgent(ctx, {
    commandId,
    kind: "resume",
    thread,
    ownerGeneration: thread.owner_generation,
    text: CLAUDE_USAGE_LIMIT_RESUME_PROMPT,
    source: "owner:usage-limit",
    detail: { reason: "claude_usage_limit_reset" },
    next: { clientMsgId: commandId, fingerprint: "usage-limit-resume" },
  });
  const conversationId = thread.parent_thread_id === null ? journalConversationOf(ctx.db, thread) : null;
  if (conversationId) {
    await postUsageLimitResumed(ctx, {
      conversationId,
      ownerGeneration: thread.owner_generation,
      key: `${thread.thread_id}:${thread.attempt_generation}`,
      threadId: thread.thread_id,
    });
  }
};

/**
 * Stella's own Claude Code turn in a cloud conversation ended on the Claude
 * usage limit: hold it with an owner job, the durable timer, that starts its
 * continuation once the limit resets. One hold per conversation; a later one
 * replaces it.
 */
const holdConversationForUsageLimit = (ctx: OwnerContext, raw: unknown): { resumeAt: number } => {
  const args = object({ conversationId: string(), ownerGeneration: string(), resetsAt: optional(number()) })(raw);
  const resumeAt = usageLimitResumeAt(args.resetsAt !== undefined ? { resetsAt: args.resetsAt } : {}, ctx.now);
  ctx.jobs.schedule(
    USAGE_LIMIT_CONVERSATION_JOB,
    resumeAt,
    { conversationId: args.conversationId, ownerGeneration: args.ownerGeneration, resumeAt },
    { id: `usage-limit:conversation:${args.conversationId}` },
  );
  return { resumeAt };
};

/** The limit reset: Stella's held turn continues as a wake turn. */
const resumeConversationAfterUsageLimit = async (ctx: OwnerContext, raw: unknown): Promise<void> => {
  const payload = raw as { conversationId?: unknown; ownerGeneration?: unknown; resumeAt?: unknown } | null;
  if (typeof payload?.conversationId !== "string" || typeof payload.ownerGeneration !== "string") return;
  const exists = ctx.db.one<{ conversation_id: string }>(
    "SELECT conversation_id FROM conversations WHERE conversation_id = ? AND deleted_at IS NULL",
    payload.conversationId,
  );
  if (!exists) return;
  const key = `${typeof payload.resumeAt === "number" ? payload.resumeAt : ctx.now}`;
  await ctx.host.startAgentMessageTurn({
    ownerGeneration: payload.ownerGeneration,
    conversationId: payload.conversationId,
    clientMsgId: `ulr-${key}`,
    prompt: CLAUDE_USAGE_LIMIT_RESUME_PROMPT,
  });
  await postUsageLimitResumed(ctx, {
    conversationId: payload.conversationId,
    ownerGeneration: payload.ownerGeneration,
    key,
  });
};

export type AgentThreadEffects = {
  /** Cards to post once the events are applied. */
  cards: Array<{ conversationId: string; ownerGeneration: string; sourceTurnId: string; card: unknown }>;
};

/** The newest entry per path across the thread's last three attempts. */
const threadOutputFiles = (db: OwnerDbReader, threadId: string): unknown[] => {
  const turns = db.all<{ turn_id: string }>(
    "SELECT turn_id FROM agent_turns WHERE thread_id = ? ORDER BY created_at DESC LIMIT 3",
    threadId,
  );
  const byPath = new Map<string, unknown>();
  for (const { turn_id } of turns.reverse()) {
    for (const file of db.all<{ path: string; entry_json: string }>(
      "SELECT path, entry_json FROM agent_turn_files WHERE turn_id = ? ORDER BY updated_at",
      turn_id,
    )) {
      byPath.set(file.path, JSON.parse(file.entry_json));
    }
  }
  return [...byPath.values()].slice(0, OUTPUT_FILE_CARD_MAX);
};

const ownerEventKey = (event: AgentThreadEvent): string => `owner-event:${event.kind}:${event.key}`;

/** Apply one event. Safe to replay; late events from older attempts are dropped. */
export const applyAgentThreadEvent = (
  db: OwnerDb,
  event: AgentThreadEvent,
  effects: AgentThreadEffects,
  jobs?: OwnerJobs,
): void => {
  switch (event.kind) {
    case "turn.started": {
      if (event.turnKind !== "agent" || readTurn(db, event.turnId)) return;
      const insert = () =>
        db.run(
          `INSERT INTO agent_turns
             (turn_id, thread_id, conversation_id, owner_generation, attempt_generation,
              status, client_msg_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?)
           ON CONFLICT DO NOTHING`,
          event.turnId,
          event.threadId ?? null,
          event.conversationId,
          event.ownerGeneration,
          event.attemptGeneration ?? null,
          event.clientMsgId ?? null,
          event.createdAt,
          event.createdAt,
        );
      if (!event.threadId) {
        insert();
        return;
      }
      recordAgentChange(
        db,
        {
          threadId: event.threadId,
          turnId: event.turnId,
          kind: "turn_recorded",
          key: ownerEventKey(event),
          source: `cloud:${event.conversationId}`,
          now: event.createdAt,
        },
        insert,
      );
      return;
    }
    case "turn.event": {
      const turn = readTurn(db, event.turnId);
      if (!turn || !turn.thread_id) return;
      if (
        event.attemptGeneration !== undefined &&
        turn.attempt_generation !== null &&
        event.attemptGeneration !== turn.attempt_generation
      ) {
        return;
      }
      if (event.eventKind === "output_files") {
        const files = (event.payload as { files?: unknown } | null)?.files;
        if (!Array.isArray(files)) return;
        for (const entry of files) {
          const path = (entry as { path?: unknown } | null)?.path;
          if (typeof path !== "string" || !path) continue;
          db.run(
            `INSERT INTO agent_turn_files (turn_id, path, entry_json, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT (turn_id, path) DO UPDATE SET entry_json = excluded.entry_json, updated_at = excluded.updated_at`,
            turn.turn_id,
            path,
            JSON.stringify(entry),
            event.createdAt,
          );
        }
        return;
      }
      if (event.terminal) {
        recordAgentChange(
          db,
          {
            threadId: turn.thread_id,
            turnId: turn.turn_id,
            kind: "attempt_ended",
            key: ownerEventKey(event),
            source: `cloud:${turn.conversation_id ?? ""}`,
            now: event.createdAt,
          },
          () =>
            db.run(
              "UPDATE agent_turns SET status = ?, updated_at = ? WHERE turn_id = ? AND status IN ('running', 'resuming', 'waiting_for_user')",
              event.terminalStatus ?? "failed",
              event.createdAt,
              turn.turn_id,
            ),
        );
      }
      return;
    }
    case "thread.spawned": {
      const thread = readThread(db, event.threadId);
      const change = {
        threadId: event.threadId,
        key: ownerEventKey(event),
        source: `${event.harness ?? "cloud"}:${event.conversationId}`,
        now: event.createdAt,
      };
      if (!thread) {
        recordAgentChange(db, { ...change, kind: "spawned" }, () =>
          db.run(
            `INSERT INTO agent_threads
               (thread_id, conversation_id, owner_generation, parent_turn_id, parent_thread_id,
                origin_device_id, origin_conversation_id, description, placement,
                agent_type, execution_json, harness, attempt_generation, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'cloud', 'general', ?, ?, ?, 'running', ?, ?)`,
            event.threadId,
            event.conversationId,
            event.ownerGeneration,
            event.parentTurnId,
            event.parentThreadId ?? null,
            event.originDeviceId ?? null,
            event.originConversationId ?? null,
            clip(event.description, 1_000),
            JSON.stringify(event.execution),
            event.harness ?? null,
            event.attemptGeneration,
            event.createdAt,
            event.createdAt,
          ),
        );
        return;
      }
      // A pi harness's older agent ids are unique only within its
      // conversation: another agent's row with the same id is not this one.
      if (
        event.harness !== undefined &&
        (thread.harness !== event.harness || thread.conversation_id !== event.conversationId)
      ) {
        return;
      }
      // An attempt this object already recorded (a desktop spawn) or an
      // older one arriving late.
      if (event.attemptGeneration <= thread.attempt_generation) {
        if (event.attemptGeneration === thread.attempt_generation && thread.parent_turn_id === null) {
          recordAgentChange(db, { ...change, kind: "parent_linked" }, () =>
            db.run(
              "UPDATE agent_threads SET parent_turn_id = ? WHERE thread_id = ?",
              event.parentTurnId,
              thread.thread_id,
            ),
          );
        }
        return;
      }
      recordAgentChange(db, { ...change, kind: startedKind }, () =>
        db.run(
          `UPDATE agent_threads SET
             status = 'running', attempt_generation = ?, execution_json = ?,
             origin_delivery_ack_at = NULL, result_json = NULL, error_message = NULL,
             updated_at = MAX(updated_at, ?)
           WHERE thread_id = ?`,
          event.attemptGeneration,
          JSON.stringify(event.execution),
          event.createdAt,
          thread.thread_id,
        ),
      );
      return;
    }
    case "thread.completed": {
      const thread = readThread(db, event.threadId);
      if (!thread) return;
      if (event.conversationId !== undefined && thread.conversation_id !== event.conversationId) return;
      if (thread.owner_generation !== null && thread.owner_generation !== event.ownerGeneration) return;
      if (event.attemptGeneration < thread.attempt_generation) return;
      if (
        event.attemptGeneration === thread.attempt_generation &&
        !ACTIVE_STATUSES.has(thread.status) &&
        thread.status !== "waiting_for_user"
      ) {
        return;
      }
      const ended =
        event.status === "waiting_for_user"
          ? event.status
          : agentThreadTerminalStatus(event.status, event.errorMessage);
      const limit =
        ended === "failed" && jobs && threadExecutor(thread).kind === "cloud"
          ? claudeUsageLimitOf(event.errorMessage ?? "")
          : null;
      const status = limit ? "waiting_for_user" : ended;
      const errorMessage = limit ? usageLimitHoldMessage(limit) : event.errorMessage;
      if (limit && jobs) {
        holdAgentForUsageLimit(db, jobs, effects, { ...thread, attempt_generation: event.attemptGeneration }, limit, event.completedAt);
      }
      recordAgentChange(
        db,
        {
          threadId: thread.thread_id,
          kind: status === "waiting_for_user" ? "waiting_for_user" : endedKind,
          key: ownerEventKey(event),
          source: `${thread.harness ?? "cloud"}:${thread.conversation_id}`,
          ...(status !== "waiting_for_user" ? { outcome: status } : {}),
          detail: { turnId: event.turnId, ...(limit ? { claudeUsageLimit: limit.resetsAt ?? null } : {}) },
          now: event.completedAt,
        },
        () =>
          db.run(
            `UPDATE agent_threads SET status = ?, attempt_generation = ?, result_json = ?, error_message = ?,
               updated_at = MAX(updated_at + 1, ?)
             WHERE thread_id = ?`,
            status,
            event.attemptGeneration,
            event.resultJson ?? null,
            status === "paused" ? null : (errorMessage ?? null),
            event.completedAt,
            thread.thread_id,
          ),
      );
      // A desktop-dispatched thread reports through that desktop, which may
      // be asleep: its conversation's journal still learns it ended.
      const journalConversation =
        thread.origin_device_id !== null && thread.parent_thread_id === null && status !== "waiting_for_user"
          ? journalConversationOf(db, thread)
          : null;
      if (journalConversation && thread.owner_generation && status !== "waiting_for_user") {
        effects.cards.push({
          conversationId: journalConversation,
          ownerGeneration: thread.owner_generation,
          ...agentLifecycleCard(
            { ...thread, attempt_generation: event.attemptGeneration },
            { kind: status, text: status === "completed" ? null : errorMessage },
          ),
        });
      }
      // A desktop-dispatched thread delivers through that desktop; any
      // other completed thread files its outputs under the turn that
      // started it, where both clients attribute them.
      if (event.status === "completed" && thread.origin_device_id === null) {
        const files = threadOutputFiles(db, thread.thread_id);
        if (files.length > 0) {
          effects.cards.push({
            conversationId: thread.conversation_id,
            ownerGeneration: event.ownerGeneration,
            sourceTurnId: thread.parent_turn_id ?? event.turnId,
            card: { type: "files", files },
          });
        }
      }
      return;
    }
  }
};

// ── Views ─────────────────────────────────────────────────────────────────

const recentThreads = (db: OwnerDbReader, ownerId: string, limit: number): AgentThreadSummary[] =>
  db
    .all<ThreadRow>(
      `SELECT * FROM agent_threads
        WHERE conversation_id NOT LIKE 'slack-%' AND COALESCE(origin_conversation_id, '') NOT LIKE 'slack-%'
        ORDER BY updated_at DESC, thread_id DESC LIMIT ?`,
      limit,
    )
    .map((row) => summary(row, ownerId));

/**
 * A conversation's agents for its clients: the ones it holds and the ones it
 * started whose rows sit in another cloud conversation (a desktop's cloud
 * agents), so each client reads one list.
 */
const conversationThreadRows = (
  db: OwnerDbReader,
  conversationId: string,
  filter: string,
  limit: number,
): ThreadRow[] => {
  const rows = new Map<string, ThreadRow>();
  for (const column of ["conversation_id", "origin_conversation_id"] as const) {
    for (const row of db.all<ThreadRow>(
      `SELECT * FROM agent_threads WHERE ${column} = ?${filter}
        ORDER BY updated_at DESC, thread_id DESC LIMIT ?`,
      conversationId,
      limit,
    )) {
      rows.set(row.thread_id, row);
    }
  }
  return [...rows.values()]
    .sort((a, b) =>
      b.updated_at - a.updated_at || (a.thread_id < b.thread_id ? 1 : a.thread_id > b.thread_id ? -1 : 0),
    )
    .slice(0, limit);
};

const runningThreads = (db: OwnerDbReader, ownerId: string, conversationId: string): AgentThreadSummary[] =>
  conversationThreadRows(
    db,
    conversationId,
    ` AND status IN ${LIVE_STATUSES_SQL}`,
    RUNNING_AGENT_THREADS_LIMIT,
  ).map((row) => summary(row, ownerId));

const deviceThreads = (
  db: OwnerDbReader,
  ownerId: string,
  args: { originDeviceId: string; ownerGeneration: string; limit?: number },
): DeviceAgentThread[] =>
  db
    .all<ThreadRow>(
      `SELECT * FROM agent_threads
        WHERE origin_device_id = ? AND owner_generation = ? AND origin_delivery_ack_at IS NULL
        ORDER BY updated_at DESC LIMIT ?`,
      args.originDeviceId,
      args.ownerGeneration,
      Math.min(Math.max(args.limit ?? 100, 1), 100),
    )
    .map((row) => ({
      ...summary(row, ownerId),
      originDeviceId: row.origin_device_id!,
      originConversationId: row.origin_conversation_id ?? row.conversation_id,
      ownerGeneration: row.owner_generation!,
    }));

const threadPage = (
  db: OwnerDbReader,
  ownerId: string,
  args: AgentThreadCalls["agentThreads.page"]["args"],
): AgentThreadCalls["agentThreads.page"]["result"] => {
  const limit = Math.min(Math.max(args.limit ?? 30, 1), AGENT_THREAD_PAGE_MAX);
  const rows = args.before
    ? db.all<ThreadRow>(
        `SELECT * FROM agent_threads WHERE conversation_id = ?
           AND (updated_at < ? OR (updated_at = ? AND thread_id < ?))
         ORDER BY updated_at DESC, thread_id DESC LIMIT ?`,
        args.conversationId,
        args.before.updatedAt,
        args.before.updatedAt,
        args.before.threadId,
        limit + 1,
      )
    : db.all<ThreadRow>(
        `SELECT * FROM agent_threads WHERE conversation_id = ?
         ORDER BY updated_at DESC, thread_id DESC LIMIT ?`,
        args.conversationId,
        limit + 1,
      );
  return { threads: rows.slice(0, limit).map((row) => summary(row, ownerId)), hasMore: rows.length > limit };
};

// ── Registration ──────────────────────────────────────────────────────────

const id = (max = 128) => string({ min: 1, max });
const generation = id(512);
const origin = { originDeviceId: id(256), originConversationId: id(256) };
const senderParser = object({ threadId: id(256), label: string({ max: 2_000 }) });
const messageParser = object({
  ownerGeneration: generation,
  messageId: id(),
  to: id(256),
  text: string({ max: AGENT_MESSAGE_MAX_CHARS * 2 }),
  from: senderParser,
});
const pauseParser = object({
  ownerGeneration: generation,
  conversationId: id(256),
  threadId: id(256),
  controlRequestId: id(),
});

const controlParser: Parser<ControlArgs> = (value, path = "") => {
  const base = object({
    ownerGeneration: generation,
    conversationId: id(256),
    threadId: id(256),
    commandId: id(),
    command: object({
      kind: literal("message", "resume", "pause"),
      text: optional(string({ max: AGENT_MESSAGE_MAX_CHARS * 2 })),
      from: optional(senderParser),
    }),
  })(value, path);
  const { kind, text, from } = base.command;
  if (kind === "pause") return { ...base, command: { kind } };
  if (!from) throw new RpcError("BAD_REQUEST", `${path || "args"}.command.from is required.`);
  if (kind === "message") {
    if (text === undefined) throw new RpcError("BAD_REQUEST", `${path || "args"}.command.text is required.`);
    return { ...base, command: { kind, text, from } };
  }
  return { ...base, command: { kind, from, ...(text !== undefined ? { text } : {}) } };
};

export const agentThreadsDomain = {
  name: "agent-threads",
  migrations: [
    AGENT_THREADS_MIGRATION,
    {
      id: "agent-threads.2-dispatch-prompts",
      statements: [
        "CREATE TABLE agent_dispatch_prompts (turn_id TEXT PRIMARY KEY, prompt TEXT NOT NULL)",
      ],
    },
    AGENT_THREADS_DROP_WORKSPACE_FORK_MIGRATION,
    AGENT_THREADS_DEVICE_EXECUTOR_MIGRATION,
    AGENT_THREADS_REQUESTED_MODEL_MIGRATION,
    {
      // Alongside the prompt, with the same lifecycle: both are what the
      // dispatch job still needs after the spawn call returned, and both are
      // dropped once the attempt is dispatched or settled.
      id: "agent-threads.3-dispatch-attachments",
      statements: [
        "ALTER TABLE agent_dispatch_prompts ADD COLUMN attachments TEXT",
      ],
    },
    {
      id: "agent-threads.6-agent-messages",
      statements: [
        `CREATE INDEX agent_threads_origin_conversation
           ON agent_threads (origin_conversation_id, updated_at DESC)
           WHERE origin_conversation_id IS NOT NULL`,
        `CREATE TABLE agent_message_receipts (
           message_id TEXT PRIMARY KEY,
           fingerprint TEXT NOT NULL,
           result_json TEXT NOT NULL,
           created_at INTEGER NOT NULL
         )`,
        "CREATE INDEX agent_message_receipts_created ON agent_message_receipts (created_at)",
      ],
    },
    {
      // `send_message` for an agent a desktop runs locally while that
      // desktop is offline, kept until it reconnects or an hour passes.
      id: "agent-threads.7-device-messages",
      statements: [
        `CREATE TABLE agent_device_messages (
           message_id TEXT PRIMARY KEY,
           device_id TEXT NOT NULL,
           thread_id TEXT NOT NULL,
           owner_generation TEXT NOT NULL,
           text TEXT NOT NULL,
           created_at INTEGER NOT NULL,
           attempts INTEGER NOT NULL DEFAULT 0,
           delivered_at INTEGER,
           outcome TEXT
         )`,
        "CREATE INDEX agent_device_messages_created ON agent_device_messages (created_at)",
      ],
    },
    {
      // The same outbox carries a `pause_agent` for an offline computer.
      id: "agent-threads.8-device-commands",
      statements: [
        "ALTER TABLE agent_device_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'message'",
        "CREATE INDEX agent_device_messages_thread ON agent_device_messages (thread_id, kind) WHERE delivered_at IS NULL",
      ],
    },
    AGENT_THREADS_HARNESS_MIGRATION,
    AGENT_COMMANDS_MIGRATION,
    {
      id: "agent-threads.11-live-indexes",
      statements: [
        `CREATE INDEX agent_threads_live_conversation
           ON agent_threads (conversation_id, updated_at DESC)
           WHERE status IN ${LIVE_STATUSES_SQL}`,
        `CREATE INDEX agent_threads_live_origin_conversation
           ON agent_threads (origin_conversation_id, updated_at DESC)
           WHERE status IN ${LIVE_STATUSES_SQL}`,
        `CREATE INDEX agent_threads_executor_conversation
           ON agent_threads (conversation_id) WHERE executor_device_id IS NOT NULL`,
        `CREATE INDEX agent_threads_executor_origin_conversation
           ON agent_threads (origin_conversation_id) WHERE executor_device_id IS NOT NULL`,
        `CREATE INDEX agent_threads_executor_updated
           ON agent_threads (updated_at DESC) WHERE executor_device_id IS NOT NULL`,
      ],
    },
  ],
  calls: {
    "agentThreads.page": {
      scope: "owner",
      parse: object({
        conversationId: id(),
        before: optional(object({ updatedAt: number({ int: true, min: 0 }), threadId: id() })),
        limit: optional(number({ int: true, min: 1, max: AGENT_THREAD_PAGE_MAX })),
      }),
      handler: (ctx, args) => threadPage(ctx.db, ctx.ownerId, args),
    },
    "agentThreads.lookup": {
      scope: "owner",
      parse: object({ conversationId: id(256), threadId: id(256) }),
      handler: (ctx, args) => lookupConversationThread(ctx, args),
    },
    "agentThreads.directory": {
      scope: "owner",
      parse: object({ conversationId: id(256) }),
      handler: agentDirectory,
    },
    "agentThreads.message": {
      scope: "owner",
      requireAccount: true,
      parse: messageParser,
      handler: messageAgent,
    },
    "agentThreads.pause": {
      scope: "owner",
      requireAccount: true,
      parse: pauseParser,
      handler: pauseAgent,
    },
    "agentThreads.control": {
      scope: "owner",
      requireAccount: true,
      parse: controlParser,
      handler: controlRequest,
    },
    "agentThreads.spawnFromDesktop": {
      scope: "owner",
      requireAccount: true,
      parse: object({
        ...origin,
        ownerGeneration: generation,
        clientMsgId: id(64),
        description: string({ max: 2_000 }),
        prompt: string({ max: AGENT_PROMPT_MAX_CHARS }),
        conversationId: optional(id()),
        execution: optional(executionParser),
        targetDeviceId: optional(id(256)),
        model: optional(string({ max: 256 })),
        parentThreadId: optional(id()),
      }),
      handler: spawnFromDesktop,
    },
    "agentThreads.continueFromDesktop": {
      scope: "owner",
      requireAccount: true,
      parse: object({
        ...origin,
        ownerGeneration: generation,
        threadId: id(),
        expectedAttemptGeneration: number({ int: true, min: 1 }),
        expectedTerminalUpdatedAt: number({ int: true, min: 0 }),
        description: string({ max: 2_000 }),
        prompt: string({ max: AGENT_PROMPT_MAX_CHARS }),
        controlRequestId: id(),
      }),
      handler: continueFromDesktop,
    },
    "agentThreads.cancel": {
      scope: "owner",
      requireAccount: true,
      parse: object({
        ...origin,
        ownerGeneration: generation,
        threadId: id(),
        expectedAttemptGeneration: number({ int: true, min: 1 }),
        expectedThreadUpdatedAt: number({ int: true, min: 0 }),
        controlRequestId: id(),
      }),
      handler: cancelThread,
    },
    "agentThreads.acknowledgeDelivery": {
      scope: "owner",
      parse: object({
        threadId: id(),
        originDeviceId: id(256),
        ownerGeneration: generation,
        attemptGeneration: number({ int: true, min: 1 }),
        terminalUpdatedAt: number({ int: true, min: 0 }),
      }),
      handler: acknowledgeDelivery,
    },
    "computerThreads.start": {
      scope: "owner",
      parse: object({
        threadId: id(),
        ownerGeneration: generation,
        conversationId: id(),
        originDeviceId: id(256),
        description: string({ max: 1_000 }),
        agentType: string({ min: 1, max: 100 }),
        attemptGeneration: number({ int: true, min: 1 }),
        parentThreadId: optional(id()),
      }),
      handler: startComputerThread,
    },
    "computerThreads.complete": {
      scope: "owner",
      parse: object({
        threadId: id(),
        ownerGeneration: generation,
        originDeviceId: id(256),
        attemptGeneration: number({ int: true, min: 1 }),
        status: literal("completed", "failed", "canceled", "paused"),
        result: optional(string({ max: 30_000 })),
        error: optional(string({ max: 10_000 })),
      }),
      handler: completeComputerThread,
    },
    "computerThreads.cancel": {
      scope: "owner",
      parse: object({
        threadId: id(),
        ownerGeneration: generation,
        originDeviceId: id(256),
        attemptGeneration: number({ int: true, min: 1 }),
        reason: optional(string({ max: 2_000 })),
      }),
      handler: cancelComputerThread,
    },
    "computerThreads.get": {
      scope: "owner",
      parse: object({ threadId: id(), originDeviceId: id(256), ownerGeneration: generation }),
      handler: async (ctx, args) => {
        await assertGeneration(ctx, args.ownerGeneration);
        const row = readComputerThread(ctx.db, args);
        return row ? computerRecord(row) : null;
      },
    },
    "computerThreads.running": {
      scope: "owner",
      parse: object({ originDeviceId: id(256), ownerGeneration: generation }),
      handler: async (ctx, args) => {
        await assertGeneration(ctx, args.ownerGeneration);
        return ctx.db
          .all<Pick<ThreadRow, "thread_id" | "conversation_id" | "attempt_generation">>(
            `SELECT thread_id, conversation_id, attempt_generation FROM agent_threads
              WHERE placement = 'computer' AND executor_device_id IS NULL AND origin_device_id = ?
                AND owner_generation = ? AND status = 'running'
              ORDER BY updated_at DESC LIMIT ?`,
            args.originDeviceId,
            args.ownerGeneration,
            RUNNING_AGENT_THREADS_LIMIT,
          )
          .map((row) => ({
            threadId: row.thread_id,
            conversationId: row.conversation_id,
            attemptGeneration: row.attempt_generation,
          }));
      },
    },
  },
  views: {
    "agentThreads.recent": {
      parse: object({ limit: optional(number({ int: true, min: 1, max: 100 })) }),
      read: (ctx, args) => recentThreads(ctx.db, ctx.ownerId, args.limit ?? 30),
    },
    "agentThreads.running": {
      parse: object({ conversationId: id() }),
      read: (ctx, args) => runningThreads(ctx.db, ctx.ownerId, args.conversationId),
    },
    "agentThreads.forConversation": {
      parse: object({
        conversationId: id(),
        limit: optional(number({ int: true, min: 1, max: CONVERSATION_AGENT_THREADS_MAX })),
      }),
      read: (ctx, args) => {
        const limit = args.limit ?? 30;
        const rows = conversationThreadRows(ctx.db, args.conversationId, "", limit + 1);
        return {
          threads: rows.slice(0, limit).map((row) => summary(row, ctx.ownerId)),
          hasMore: rows.length > limit,
        };
      },
    },
    "agentThreads.get": {
      parse: object({ conversationId: id(), threadId: id() }),
      read: (ctx, args) => {
        const row = readConversationThread(ctx.db, args.conversationId, args.threadId);
        return row &&
          (row.conversation_id === args.conversationId || row.origin_conversation_id === args.conversationId)
          ? summary(row, ctx.ownerId)
          : null;
      },
    },
    "agentThreads.forDevice": {
      parse: object({
        originDeviceId: id(256),
        ownerGeneration: generation,
        limit: optional(number({ int: true, min: 1, max: 100 })),
      }),
      read: (ctx, args) => deviceThreads(ctx.db, ctx.ownerId, args),
    },
  },
  internal: {
    "agentThreads.holdForUsageLimit": holdConversationForUsageLimit,
    "agentThreads.spawnOnDevice": spawnOnDeviceForCloud,
    "agentThreads.deviceThread": deviceThreadForCloud,
    "agentThreads.conversationThread": conversationThreadForCloud,
    "agentThreads.continueOnDevice": continueDeviceForCloud,
    "agentThreads.cancelOnDevice": cancelDeviceForCloud,
    "agentThreads.deviceSettled": deviceSettled,
    "agentThreads.directory": async (ctx, raw) =>
      await agentDirectory(ctx, object({ ownerGeneration: generation, conversationId: id(256) })(raw)),
    "agentThreads.message": async (ctx, raw) => await messageAgent(ctx, messageParser(raw)),
    "agentThreads.pause": async (ctx, raw) => await pauseAgent(ctx, pauseParser(raw)),
    "agentThreads.flushDeviceMessages": flushDeviceCommands,
    "agentThreads.control": async (ctx, raw) => await controlRequest(ctx, controlParser(raw)),
    /**
     * Where each of a conversation's agents stands in these records, for the
     * conversation to settle the ones its journal still shows as running
     * that already ended. Threads it does not know are left out.
     */
    "agentThreads.statuses": async (ctx, raw) => {
      const args = object({
        ownerGeneration: generation,
        threadIds: array(id(256), { max: RUNNING_AGENT_THREADS_LIMIT }),
      })(raw);
      await assertGeneration(ctx, args.ownerGeneration);
      return args.threadIds.flatMap((threadId) => {
        const row = readThread(ctx.db, threadId);
        return row
          ? [
              {
                threadId,
                status: row.status,
                attemptGeneration: row.attempt_generation,
                ...(row.error_message !== null ? { errorMessage: row.error_message } : {}),
              },
            ]
          : [];
      });
    },
    /**
     * The threads a conversation lists as running: the ones whose cards it
     * would show (`postAgentLifecycleCard`), read here rather than folded
     * from the cards, which a lost post leaves running for good.
     */
    "agentThreads.runningIn": async (ctx, raw) => {
      const args = object({ ownerGeneration: generation, conversationId: id(256) })(raw);
      await assertGeneration(ctx, args.ownerGeneration);
      return ctx.db
        .all<ThreadRow>(
          `SELECT * FROM agent_threads
            WHERE (origin_conversation_id = ? OR (origin_conversation_id IS NULL AND conversation_id = ?))
              AND parent_thread_id IS NULL AND harness IS NULL AND status IN ${LIVE_STATUSES_SQL}
            ORDER BY created_at ASC LIMIT ?`,
          args.conversationId,
          args.conversationId,
          RUNNING_AGENT_THREADS_LIMIT,
        )
        .map((row) => ({
          threadId: row.thread_id,
          description: row.description,
          agentType: row.agent_type,
          attemptGeneration: row.attempt_generation,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));
    },
  },
  jobs: {
    "agentThreads.dispatch": {
      // Retries are scheduled by the job itself so the last failure can mark
      // the attempt failed; the store-level backoff is only for crashes.
      maxAttempts: 3,
      run: async (ctx, payload) => await runDispatch(ctx, payload as DispatchJob),
    },
    [COMMAND_JOB]: {
      maxAttempts: 3,
      run: async (ctx, payload) => await runCommand(ctx, payload as { messageId?: unknown }),
    },
    [USAGE_LIMIT_AGENT_JOB]: {
      maxAttempts: 10,
      run: async (ctx, payload) => await resumeAgentAfterUsageLimit(ctx, payload),
    },
    [USAGE_LIMIT_CONVERSATION_JOB]: {
      maxAttempts: 10,
      run: async (ctx, payload) => await resumeConversationAfterUsageLimit(ctx, payload),
    },
  },
} satisfies OwnerDomain;
