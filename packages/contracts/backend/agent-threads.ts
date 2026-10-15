import type { CloudExecutionSelection } from "../agent-engine.js";
import type { AgentWorkspaceSize } from "../turn-plane/turn-start.js";
import type {
  AgentDirectoryAgentRow,
  AgentDirectorySessionRow,
  AgentMessageSender,
} from "../agent-directory.js";
import { agentAttemptOutcomeOf, type AgentAttemptOutcome, type AgentStatus } from "../agent-status.js";

export type AgentMessageDelivery = {
  outcome: "steered" | "resumed" | "queued" | "held";
  threadId: string;
  note?: string;
};

export const readAgentMessageDelivery = (
  value: AgentMessageDelivery | (Omit<AgentMessageDelivery, "outcome"> & { delivered: AgentMessageDelivery["outcome"] }),
): AgentMessageDelivery => {
  if ("outcome" in value) return value;
  const { delivered, ...rest } = value;
  return { ...rest, outcome: delivered };
};

export const agentThreadTerminalStatus = (status: string): AgentAttemptOutcome => agentAttemptOutcomeOf({ status });

export type AgentStopResult = {
  threadId: string;
  outcome: "stopped" | "held" | "not_running";
  where: string;
  note?: string;
  descendants?: Array<{ threadId: string; outcome: "stopped" | "held" | "not_running"; where: string }>;
};

export const readAgentStopResult = (result: AgentStopResult | (Omit<AgentStopResult, "outcome"> & { outcome: string })): AgentStopResult => ({
  ...result,
  outcome: result.outcome === "held" || result.outcome === "not_running" ? result.outcome : "stopped",
});

export const agentStopText = (raw: AgentStopResult): string => {
  const result = readAgentStopResult(raw);
  const head =
    result.outcome === "stopped"
      ? `Stopped ${result.threadId}, which runs ${result.where}.`
      : result.outcome === "held"
        ? `The stop for ${result.threadId}, which runs ${result.where}, is recorded.`
        : `${result.threadId}, which runs ${result.where}, was not running.`;
  const below = (result.descendants ?? []).filter((agent) => agent.outcome !== "not_running");
  return [
    head,
    result.note,
    below.length ? `Stopped with it: ${below.map((agent) => `${agent.threadId} (${agent.where}${agent.outcome === "held" ? ", once it reconnects" : ""})`).join(", ")}.` : "",
    "Each keeps its history; send_message resumes it.",
  ]
    .filter(Boolean)
    .join(" ");
};

export type AgentControlCommand =
  | { kind: "message"; text: string; from: AgentMessageSender }
  | { kind: "resume"; text?: string; from: AgentMessageSender }
  | { kind: "stop" };

export type AgentControlExecutor = "cloud" | "harness" | "dispatch" | "local";

export type AgentControlOutcome =
  | "steered"
  | "resumed"
  | "queued"
  | "held"
  | "stopped"
  | "not_running"
  | "running";

export type AgentControlResult = {
  threadId: string;
  command: AgentControlCommand["kind"];
  outcome: AgentControlOutcome;
  status?: string;
  attemptGeneration?: number;
  executor?: AgentControlExecutor;
  where?: string;
  note?: string;
};

export const agentMessageDelivery = (result: AgentControlResult): AgentMessageDelivery => ({
  outcome:
    result.outcome === "resumed" || result.outcome === "held"
      ? result.outcome
      : result.outcome === "queued" && result.executor === undefined
        ? "queued"
        : "steered",
  threadId: result.threadId,
  ...(result.note ? { note: result.note } : {}),
});

export type AgentThreadPlacement = "cloud" | "computer";

export type AgentThreadSummary = {
  ownerId: string;
  threadId: string;
  conversationId: string;
  parentTurnId?: string;
  parentThreadId?: string;
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

export type DeviceAgentThread = AgentThreadSummary & {
  originDeviceId: string;
  originConversationId: string;
  ownerGeneration: string;
};

export type AgentThreadControl = {
  threadId: string;
  conversationId: string;
  attemptGeneration: number;
  threadUpdatedAt: number;
  status: string;
  waitingForDevice?: boolean;
  delivery?: AgentMessageDelivery;
};

type Origin = { originDeviceId: string; originConversationId: string };

export type AgentThreadCalls = {
  "agentThreads.spawnFromDesktop": {
    args: Origin & {
      ownerGeneration: string;
      clientMsgId: string;
      description: string;
      prompt: string;
      conversationId?: string;
      execution?: CloudExecutionSelection;
      targetDeviceId?: string;
      model?: string;
      parentThreadId?: string;
      workspace?: AgentWorkspaceSize;
    };
    result: AgentThreadControl;
  };
  "agentThreads.directory": {
    args: { conversationId: string; threadIds?: string[] };
    result: {
      agents: AgentDirectoryAgentRow[];
      sessions: AgentDirectorySessionRow[];
    };
  };
  "agentThreads.message": {
    args: {
      ownerGeneration: string;
      messageId: string;
      to: string;
      text: string;
      from: AgentMessageSender;
      framed?: boolean;
    };
    result: AgentMessageDelivery;
  };
  "agentThreads.stop": {
    args: {
      ownerGeneration: string;
      conversationId: string;
      threadId: string;
      controlRequestId: string;
      requesterThreadId?: string;
    };
    result: AgentStopResult;
  };
  "agentThreads.pause": {
    args: {
      ownerGeneration: string;
      conversationId: string;
      threadId: string;
      controlRequestId: string;
    };
    result: Omit<AgentStopResult, "outcome"> & { outcome: "paused" | "held" | "not_running" };
  };
  "agentThreads.control": {
    args: {
      ownerGeneration: string;
      conversationId: string;
      threadId: string;
      commandId: string;
      command: AgentControlCommand;
    };
    result: AgentControlResult;
  };
  "agentThreads.handoff": {
    args: {
      ownerGeneration: string;
      handoffId: string;
      threadId: string;
      conversationId: string;
      fromDeviceId: string;
      targetDeviceId: string;
      prompt: string;
      model?: string;
      cwd?: string;
      execution?: CloudExecutionSelection;
    };
    result: AgentThreadControl & { where: string };
  };
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
  "computerThreads.start": {
    args: {
      threadId: string;
      ownerGeneration: string;
      conversationId: string;
      originDeviceId: string;
      description: string;
      agentType: string;
      attemptGeneration: number;
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
      status: AgentAttemptOutcome | "paused";
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
  "computerThreads.running": {
    args: { originDeviceId: string; ownerGeneration: string };
    result: Array<{ threadId: string; conversationId: string; attemptGeneration: number }>;
  };
  /**
   * A computer records that a usage limit paused (`held`) or released
   * (`resumed`) its reply (no threadId) or one of its tasks in a chat. The
   * chat's journal gets the card every device shows; `holdId` makes repeats
   * of one event land once.
   */
  "usageLimits.note": {
    args: {
      conversationId: string;
      ownerGeneration: string;
      originDeviceId: string;
      holdId: string;
      state: "held" | "resumed";
      threadId?: string;
      until?: number;
      monthly?: boolean;
    };
    result: { posted: boolean };
  };
  /**
   * Resume pressed on a chat's usage-limit card: work the cloud holds for it
   * continues now, and a Resume card tells every computer to continue what it
   * holds. Runs on whatever account and engine are selected now.
   */
  "usageLimits.resume": {
    args: { conversationId: string; requestId: string };
    result: { cloud: number };
  };
};

export type ComputerThreadRecord = {
  threadId: string;
  status: "running" | "completed" | "error" | "canceled";
  agentStatus?: AgentStatus;
  description: string;
  attemptGeneration: number;
  startedAt: number;
  completedAt: number | null;
  result: string | null;
  error: string | null;
};

export type AgentThreadViews = {
  "agentThreads.running": {
    args: { conversationId: string };
    result: AgentThreadSummary[];
  };
  "agentThreads.forConversation": {
    args: { conversationId: string; limit?: number };
    result: { threads: AgentThreadSummary[]; hasMore: boolean };
  };
  "agentThreads.get": {
    args: { conversationId: string; threadId: string };
    result: AgentThreadSummary | null;
  };
  "agentThreads.forDevice": {
    args: { originDeviceId: string; ownerGeneration: string; limit?: number };
    result: DeviceAgentThread[];
  };
};

export const RUNNING_AGENT_THREADS_LIMIT = 64;
export const CONVERSATION_AGENT_THREADS_MAX = 500;
export const AGENT_PROMPT_MAX_CHARS = 8_000;

export const newAgentThreadId = (): string =>
  `thr-${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
