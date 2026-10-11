import type { CloudExecutionSelection } from "../agent-engine.js";
import type {
  AgentDirectoryAgentRow,
  AgentDirectorySessionRow,
  AgentMessageSender,
} from "../agent-directory.js";

/**
 * How a `send_message` landed: `steered` into a running agent, `resumed` an
 * idle one as its next attempt, or `queued` as a Stella session's next turn.
 */
export type AgentMessageDelivery = {
  delivered: "steered" | "resumed" | "queued";
  threadId: string;
  /** Why the message waits, when it was queued for a computer that is offline. */
  note?: string;
};

/**
 * Why an attempt that someone paused ended, as every runtime reports it with
 * a `canceled` outcome. The owner's records keep such an attempt as
 * `paused`, never as canceled or failed.
 */
export const AGENT_PAUSED_REASON = "Paused by orchestrator.";

/** The dispatch error code a device reports with a `canceled` agent attempt it paused. */
export const AGENT_PAUSED_ERROR_CODE = "AGENT_PAUSED";

/**
 * The status an attempt ends in, from the outcome its runtime reported: a
 * cancel for a pause is `paused`.
 */
export const agentThreadTerminalStatus = (
  status: "completed" | "failed" | "canceled",
  reason?: string | null,
): "completed" | "failed" | "canceled" | "paused" =>
  status === "canceled" && reason?.trim() === AGENT_PAUSED_REASON ? "paused" : status;

/**
 * How a `pause_agent` landed, from any of the owner's hosts:
 * - `paused`: it stopped, or is marked paused and stops the moment its
 *   computer next connects (`note` says so).
 * - `held`: it runs on a computer that is offline; the pause is kept and
 *   applied as soon as that computer reconnects.
 * - `not_running`: nothing was running.
 */
export type AgentPauseResult = {
  threadId: string;
  outcome: "paused" | "held" | "not_running";
  status: string;
  attemptGeneration: number;
  /** Where it runs: "in Stella's cloud", "on omarchy". */
  where: string;
  note?: string;
};

/** What `pause_agent` tells the model about a pause the owner's agent threads made. */
export const agentPauseText = (result: AgentPauseResult): string => {
  const head =
    result.outcome === "paused"
      ? `Paused ${result.threadId}, which runs ${result.where}.`
      : result.outcome === "held"
        ? `The pause for ${result.threadId}, which runs ${result.where}, is recorded.`
        : `${result.threadId}, which runs ${result.where}, was not running.`;
  return [head, result.note, result.outcome === "not_running" ? "" : "Resume it later with send_message."]
    .filter(Boolean)
    .join(" ");
};

/**
 * Agent threads: every background agent the owner has, cloud or desktop,
 * indexed in the owner's object for Activity, the running pill, reports and
 * the originating desktop's delivery.
 */

export type AgentThreadPlacement = "cloud" | "computer";

export type AgentThreadSummary = {
  /** The account this row belongs to; clients drop rows for any other. */
  ownerId: string;
  threadId: string;
  conversationId: string;
  parentTurnId?: string;
  parentThreadId?: string;
  /** The paired device running this thread for someone else, if any. */
  executorDeviceId?: string;
  description: string;
  placement: AgentThreadPlacement;
  agentType: string;
  status: string;
  attemptGeneration: number;
  resultJson?: string;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
};

export type AgentThreadLookup = AgentThreadSummary & {
  originDeviceId?: string;
  originDeviceLabel?: string;
  executorDeviceLabel?: string;
};

/** A thread the originating desktop has yet to persist locally. */
export type DeviceAgentThread = AgentThreadSummary & {
  originDeviceId: string;
  originConversationId: string;
  ownerGeneration: string;
};

/**
 * The exact state a desktop holds for a cloud thread it dispatched. Every
 * follow-up names it, so a request built from a stale view fails instead of
 * acting on a newer attempt.
 */
export type AgentThreadControl = {
  threadId: string;
  conversationId: string;
  attemptGeneration: number;
  threadUpdatedAt: number;
  status: string;
  waitingForDevice?: boolean;
};

type Origin = { originDeviceId: string; originConversationId: string };

export type AgentThreadCalls = {
  "agentThreads.page": {
    args: {
      conversationId: string;
      before?: { updatedAt: number; threadId: string };
      limit?: number;
    };
    result: { threads: AgentThreadSummary[]; hasMore: boolean };
  };
  /**
   * Start a remote agent for a desktop: in the cloud, or on another of the
   * owner's devices when `targetDeviceId` names one. `clientMsgId` makes a
   * retried request return the original thread. Without `conversationId` the
   * agent reports into the owner's newest conversation.
   */
  "agentThreads.spawnFromDesktop": {
    args: Origin & {
      ownerGeneration: string;
      clientMsgId: string;
      description: string;
      prompt: string;
      conversationId?: string;
      execution?: CloudExecutionSelection;
      targetDeviceId?: string;
      /** Device target: the `spawn_agent` model that device runs the agent on. */
      model?: string;
    };
    result: AgentThreadControl;
  };
  "agentThreads.lookup": {
    args: { conversationId: string; threadId: string };
    result: AgentThreadLookup | null;
  };
  /**
   * What `agent_status` without a thread_id lists from the owner's index:
   * this conversation's agents (every placement) and the other conversations.
   */
  "agentThreads.directory": {
    args: { conversationId: string };
    result: {
      agents: AgentDirectoryAgentRow[];
      sessions: AgentDirectorySessionRow[];
    };
  };
  /**
   * `send_message` to a thread this caller cannot reach itself: a running
   * agent takes it before its next model call, an idle one resumes with it,
   * and a conversation id queues it as that Stella's next turn. Idempotent
   * per `messageId`.
   */
  "agentThreads.message": {
    args: {
      ownerGeneration: string;
      messageId: string;
      to: string;
      text: string;
      from: AgentMessageSender;
    };
    result: AgentMessageDelivery;
  };
  /**
   * `pause_agent` for any of the owner's agents, from any of the owner's
   * hosts: it reaches the agent wherever it runs, and is held for a
   * computer that is offline. Idempotent per `controlRequestId`.
   */
  "agentThreads.pause": {
    args: {
      ownerGeneration: string;
      conversationId: string;
      threadId: string;
      controlRequestId: string;
    };
    result: AgentPauseResult;
  };
  /** Send a follow-up to a finished desktop-dispatched cloud thread. */
  "agentThreads.continueFromDesktop": {
    args: Origin & {
      ownerGeneration: string;
      threadId: string;
      expectedAttemptGeneration: number;
      expectedTerminalUpdatedAt: number;
      description: string;
      prompt: string;
      controlRequestId: string;
    };
    result: AgentThreadControl;
  };
  /** Stop a running desktop-dispatched cloud thread. Idempotent per request id. */
  "agentThreads.cancel": {
    args: Origin & {
      ownerGeneration: string;
      threadId: string;
      expectedAttemptGeneration: number;
      expectedThreadUpdatedAt: number;
      controlRequestId: string;
    };
    result: { canceled: boolean; control: AgentThreadControl };
  };
  /** The desktop has durably stored this terminal result. */
  "agentThreads.acknowledgeDelivery": {
    args: {
      threadId: string;
      originDeviceId: string;
      ownerGeneration: string;
      attemptGeneration: number;
      terminalUpdatedAt: number;
    };
    result: { acknowledged: boolean; superseded: boolean };
  };
  /** A desktop agent ("computer" placement) started or resumed. */
  "computerThreads.start": {
    args: {
      threadId: string;
      ownerGeneration: string;
      conversationId: string;
      originDeviceId: string;
      description: string;
      agentType: string;
      attemptGeneration: number;
      /** The agent that started it, for a subagent; its conversation counts only its own agents. */
      parentThreadId?: string;
    };
    result: { threadId: string };
  };
  "computerThreads.complete": {
    args: {
      threadId: string;
      ownerGeneration: string;
      originDeviceId: string;
      attemptGeneration: number;
      status: "completed" | "failed" | "canceled";
      result?: string;
      error?: string;
    };
    result: { updated: boolean; status: string };
  };
  "computerThreads.cancel": {
    args: {
      threadId: string;
      ownerGeneration: string;
      originDeviceId: string;
      attemptGeneration: number;
      reason?: string;
    };
    result: { canceled: boolean; status: string };
  };
  "computerThreads.get": {
    args: { threadId: string; originDeviceId: string; ownerGeneration: string };
    result: ComputerThreadRecord | null;
  };
  /**
   * The agents the owner's records say are running on this computer, for it
   * to settle the ones it no longer runs (after a crash, or a pause that
   * never reached the cloud).
   */
  "computerThreads.running": {
    args: { originDeviceId: string; ownerGeneration: string };
    result: Array<{ threadId: string; conversationId: string; attemptGeneration: number }>;
  };
};

export type ComputerThreadRecord = {
  threadId: string;
  status: "running" | "completed" | "error" | "canceled";
  description: string;
  attemptGeneration: number;
  startedAt: number;
  completedAt: number | null;
  result: string | null;
  error: string | null;
};

/** Why `computerThreads.start` refused, in `BackendError.reason`. */
export type ComputerThreadStartRejection =
  | "conversation_not_found"
  | "thread_identity_conflict"
  | "attempt_replay_conflict"
  | "attempt_stale"
  | "attempt_not_next"
  | "initial_attempt_invalid";

export type AgentThreadViews = {
  "agentThreads.recent": { args: { limit?: number }; result: AgentThreadSummary[] };
  "agentThreads.running": {
    args: { conversationId: string };
    result: AgentThreadSummary[];
  };
  /** One conversation's newest threads; raise `limit` to reach older ones. */
  "agentThreads.forConversation": {
    args: { conversationId: string; limit?: number };
    result: { threads: AgentThreadSummary[]; hasMore: boolean };
  };
  "agentThreads.get": {
    args: { conversationId: string; threadId: string };
    result: AgentThreadSummary | null;
  };
  /** Threads this desktop dispatched or ran that it hasn't acknowledged yet. */
  "agentThreads.forDevice": {
    args: { originDeviceId: string; ownerGeneration: string; limit?: number };
    result: DeviceAgentThread[];
  };
};

export const RUNNING_AGENT_THREADS_LIMIT = 64;
export const AGENT_THREAD_PAGE_MAX = 50;
export const CONVERSATION_AGENT_THREADS_MAX = 500;
export const AGENT_PROMPT_MAX_CHARS = 8_000;
