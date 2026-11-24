import { isAgentStopReason, type AgentAttemptOutcome } from "./agent-status.js";
import { resultWaitingFor } from "./agent-waiting.js";
import { parseAgentReportId } from "./backend/agent-reports.js";

export type AgentStanding =
  | { state: "running" }
  | { state: "waiting"; waitingFor: string }
  | { state: "stopped" }
  | { state: "ended"; outcome: AgentAttemptOutcome };

export type AgentState = AgentStanding["state"];

export type AgentStateFacts = {
  running: boolean;
  stopped: boolean;
  waitingFor?: string | undefined;
  outcome?: AgentAttemptOutcome;
};

export const agentStanding = (facts: AgentStateFacts): AgentStanding =>
  facts.running
    ? { state: "running" }
    : facts.stopped
      ? { state: "stopped" }
      : facts.waitingFor !== undefined
        ? { state: "waiting", waitingFor: facts.waitingFor }
        : { state: "ended", outcome: facts.outcome ?? "completed" };

export const recordedAgentFacts = (row: {
  status: string;
  errorMessage?: string | null;
  resultJson?: string | null;
}): AgentStateFacts => {
  if (row.status === "running" || row.status === "waiting_for_user" || row.status === "resuming") {
    return { running: true, stopped: false };
  }
  if (row.status === "canceled" || row.status === "paused") {
    return { running: false, stopped: row.status === "paused" || isAgentStopReason(row.errorMessage), outcome: "canceled" };
  }
  if (row.status === "failed") return { running: false, stopped: false, outcome: "failed" };
  return { running: false, stopped: false, waitingFor: resultWaitingFor(row.resultJson), outcome: "completed" };
};

export const deviceAgentStatus = (
  standing: AgentStanding,
): {
  status: "running" | "waiting" | "completed" | "error";
  agentStatus: "running" | "waiting" | "completed" | "failed" | "canceled";
  stopped?: true;
  waitingFor?: string;
} => {
  switch (standing.state) {
    case "running":
      return { status: "running", agentStatus: "running" };
    case "waiting":
      return { status: "waiting", agentStatus: "waiting", waitingFor: standing.waitingFor };
    case "stopped":
      return { status: "completed", agentStatus: "canceled", stopped: true };
    case "ended":
      return standing.outcome === "failed"
        ? { status: "error", agentStatus: "failed" }
        : standing.outcome === "canceled"
          ? { status: "completed", agentStatus: "canceled", stopped: true }
          : { status: "completed", agentStatus: "completed" };
  }
};

export type AgentInputSender = "user" | "starter" | "other";

const AUTOMATIC_INPUT_ID =
  /^(?:schedule|schedule-gone|schedule-failed|background-exit|restart-shells|claude-code-wake|wake-check|waiting-reply|nothing-can-wake|device-offline|note):/u;

const OWN_WAKE_ID = /^(?:schedule|schedule-gone|background-exit|restart-shells|claude-code-wake|wake-check):/u;

const NOTE_ID = /^pi:[^:]+:message:note:/u;

export const isAutomaticInputId = (id: string): boolean => {
  const trimmed = id.trim();
  return AUTOMATIC_INPUT_ID.test(trimmed) || NOTE_ID.test(trimmed) || parseAgentReportId(trimmed) !== null;
};

export const isOwnWakeId = (id: string): boolean => OWN_WAKE_ID.test(id.trim());

export const sentByStarter = (
  task: { parentThreadId?: string | null; conversationIds: readonly (string | null | undefined)[] },
  from: string,
): boolean =>
  (task.parentThreadId ? from === task.parentThreadId : false) || task.conversationIds.some((id) => id && id === from);

export const agentInputSender = (input: {
  id: string;
  fromUser?: boolean;
  byStarter?: boolean;
}): AgentInputSender =>
  isAutomaticInputId(input.id) ? "other" : input.fromUser ? "user" : input.byStarter ? "starter" : "other";

export type AgentInputAction = "steer" | "start" | "hold";

export const agentInputAction = (state: AgentState, sender: AgentInputSender): AgentInputAction =>
  state === "stopped" ? (sender === "other" ? "hold" : "start") : state === "running" ? "steer" : "start";

export type AgentReportRecipient = { kind: "agent"; threadId: string } | { kind: "conversation"; conversationId: string };

export const agentReportRecipient = (task: {
  threadId: string;
  parentThreadId?: string | null;
  conversationId: string;
}): AgentReportRecipient =>
  task.parentThreadId && task.parentThreadId !== task.threadId
    ? { kind: "agent", threadId: task.parentThreadId }
    : { kind: "conversation", conversationId: task.conversationId };
