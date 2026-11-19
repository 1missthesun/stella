import { isAgentStopReason, type AgentAttemptOutcome } from "./agent-status.js";
import { resultWaitingFor } from "./agent-waiting.js";
import { parseAgentReportId } from "./backend/agent-reports.js";

/**
 * The rules every host applies to a task, in one place: what state it is in,
 * what an input to it does, and where its report goes. The cloud's owner store
 * calls them for the tasks it records, and the desktop calls the same ones for
 * its own tasks, those of local and signed-out chats included, so the two can
 * no longer decide differently.
 */

// ── State ──────────────────────────────────────────────────────────────────

/**
 * Where a task stands: working on a turn, waiting on something it named,
 * stopped on purpose (until someone resumes it), or ended with an outcome.
 */
export type AgentStanding =
  | { state: "running" }
  | { state: "waiting"; waitingFor: string }
  | { state: "stopped" }
  | { state: "ended"; outcome: AgentAttemptOutcome };

export type AgentState = AgentStanding["state"];

/** What a host knows about a task, whichever way it keeps it. */
export type AgentStateFacts = {
  /** A turn of it is under way, or one is set to start. */
  running: boolean;
  /** Stopped or paused on purpose, and not resumed since. */
  stopped: boolean;
  /** Its last turn ended waiting on this. */
  waitingFor?: string | undefined;
  /** Its last turn ended this way (a turn that ended waiting completed). */
  outcome?: AgentAttemptOutcome;
};

/** One order for every host: running, then stopped, then waiting, then ended. */
export const agentStanding = (facts: AgentStateFacts): AgentStanding =>
  facts.running
    ? { state: "running" }
    : facts.stopped
      ? { state: "stopped" }
      : facts.waitingFor !== undefined
        ? { state: "waiting", waitingFor: facts.waitingFor }
        : { state: "ended", outcome: facts.outcome ?? "completed" };

/** The facts of a task the cloud records (`agent_threads`). */
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

/** A task's standing as a desktop shows it (`agent_status`, the activity list). */
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

// ── Inputs ─────────────────────────────────────────────────────────────────

/**
 * Who an input to a task comes from, as far as the rules care: the user, the
 * one that started the task (Stella for a task she started, its lead for a
 * helper), or anything else (a helper's report or message, another task, a
 * schedule's fire, a wake from its own background work, a note Stella's
 * platform writes). Only the first two resume a stopped task.
 */
export type AgentInputSender = "user" | "starter" | "other";

/**
 * Ids of inputs no one sends on purpose, whoever delivers them. A report id is
 * `report:<thread>:<attempt>` (long ids become `report:<hash>:<length>`, which
 * still parses as one).
 */
const AUTOMATIC_INPUT_ID =
  /^(?:schedule|schedule-gone|schedule-failed|background-exit|restart-shells|claude-code-wake|wake-check|waiting-reply|nothing-can-wake|device-offline|note):/u;

/** Ids of the automatic inputs that come from the task's own work or schedules, not from another task. */
const OWN_WAKE_ID = /^(?:schedule|schedule-gone|background-exit|restart-shells|claude-code-wake|wake-check):/u;

/**
 * A note: what a task sends a task it didn't start. A computer passes it on to
 * a task placed elsewhere as `pi:<chat>:message:note:<n>` (under the chat's
 * id, as it does its tasks' messages to their own helpers, which are
 * `pi:<chat>:message:message:<n>`), so the id is what tells the two apart.
 */
const NOTE_ID = /^pi:[^:]+:message:note:/u;

export const isAutomaticInputId = (id: string): boolean => {
  const trimmed = id.trim();
  return AUTOMATIC_INPUT_ID.test(trimmed) || NOTE_ID.test(trimmed) || parseAgentReportId(trimmed) !== null;
};

/** A wake from the task's own background work or schedules (it waits for the turn to end rather than steering it). */
export const isOwnWakeId = (id: string): boolean => OWN_WAKE_ID.test(id.trim());

/**
 * Whether an input came from the one that started the task, or from the chat
 * the task belongs to, which stands above every task in it (Stella herself,
 * and computers send their tasks' messages to helpers placed elsewhere under
 * the chat's id).
 */
export const sentByStarter = (
  task: { parentThreadId?: string | null; conversationIds: readonly (string | null | undefined)[] },
  from: string,
): boolean =>
  (task.parentThreadId ? from === task.parentThreadId : false) || task.conversationIds.some((id) => id && id === from);

export const agentInputSender = (input: {
  /** The input's id: a message id, a report id, a schedule fire's id. */
  id: string;
  fromUser?: boolean;
  /** Sent by the one that started the task. */
  byStarter?: boolean;
}): AgentInputSender =>
  isAutomaticInputId(input.id) ? "other" : input.fromUser ? "user" : input.byStarter ? "starter" : "other";

/** What an input does: steers a turn under way, starts the next turn, or is held. */
export type AgentInputAction = "steer" | "start" | "hold";

/**
 * The delivery rule. A stopped task holds what its user or starter didn't send
 * (so a helper's report, a note or a schedule's fire can't start it again);
 * the next input from either starts it, and everything it held is then
 * delivered to it, in order. Otherwise a turn under way takes the input at its next step and a
 * task between turns starts its next one.
 */
export const agentInputAction = (state: AgentState, sender: AgentInputSender): AgentInputAction =>
  state === "stopped" ? (sender === "other" ? "hold" : "start") : state === "running" ? "steer" : "start";

// ── Reports ────────────────────────────────────────────────────────────────

export type AgentReportRecipient = { kind: "agent"; threadId: string } | { kind: "conversation"; conversationId: string };

/** A task's report goes to the task that started it, or to Stella's chat when nothing did. */
export const agentReportRecipient = (task: {
  threadId: string;
  parentThreadId?: string | null;
  conversationId: string;
}): AgentReportRecipient =>
  task.parentThreadId && task.parentThreadId !== task.threadId
    ? { kind: "agent", threadId: task.parentThreadId }
    : { kind: "conversation", conversationId: task.conversationId };
