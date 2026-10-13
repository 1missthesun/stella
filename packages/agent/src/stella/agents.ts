/**
 * Stella's orchestrator → agent → agent hierarchy on pi-durable.
 *
 * Each agent is a conversation owned by a background **anchor** task in the
 * conversation that started it, so the starter's Stop and idle never wait on
 * it (pi-durable's example 23). Every message to an agent, the first prompt
 * included, is carried by a background **reporter** task in the starter: it
 * submits the message to the agent, waits for the agent's answer, and reports
 * it one level up. When the starter is the orchestrator, the report becomes
 * the orchestrator's next input (`[Agent completed] ...`); when the starter is
 * itself an agent, the report is a new message to that agent, carried by a
 * reporter in *its* starter, so a nested result climbs the chain one hop at a
 * time. Request ids derived from task ids make every hop exactly-once across
 * restarts.
 *
 * The tools are Stella's own descriptors: `spawn_agent`, `send_message`,
 * `agent_status`, `stop_agent`, and, for Stella in a conversation whose
 * brain can move, `switch_destination` (`StellaAgentsHost.execution`). An
 * agent placed on another computer or in the cloud runs there as a whole
 * (`StellaAgentsHost.remote`); nothing here runs another host's tools.
 */
import type { Context } from "@earendil-works/chord";
import { Type, type AssistantMessage, type ModelThinkingLevel, type TextContent } from "@earendil-works/pi-ai";
import {
  AgentDoc,
  AssistantEntry,
  configure,
  defineDoc,
  defineExtension,
  defineTask,
  defineTool,
  GenerationTask,
  hook,
  LiveDoc,
  type Conversation,
  type ConversationHandle,
  type ConversationId,
  type EntryId,
  type Harness,
  type Tx,
  type ModelRef,
  type TaskRuntime,
  type ToolExecutionApi,
} from "@earendil-works/pi-durable";
import {
  AGENT_MESSAGE_MAX_CHARS,
  agentDirectoryEntry,
  buildAgentDirectoryResult,
  formatAgentMessage,
  isFramedAgentMessage,
  AGENT_MESSAGE_STARTER_RELATION,
  sessionDirectoryEntry,
  STELLA_MESSAGE_TARGET,
  type AgentDirectoryAgentRow,
  type AgentDirectorySessionRow,
  type AgentMessageSender,
} from "@stella/contracts/agent-directory";
import { agentStopText, type AgentMessageDelivery, type AgentStopResult } from "@stella/contracts/backend/agent-threads";
import {
  AGENT_STOPPED_REASON,
  isLiveAgentStatus,
  reportStatusOf,
  type AgentAttemptOutcome,
  type AgentStatus,
} from "@stella/contracts/agent-status";
import { isPlacementThreadId, placementRemoteThreadAgentId } from "@stella/contracts/placement-thread-id";
import { parseAgentReportId } from "@stella/contracts/backend/agent-reports";
import { CLAUDE_CODE_PROVIDER_ID, engineExtensionChange, onClaudeCode } from "../engine/selection.ts";
import { parseStellaModelId, stellaModelId, STELLA_PROVIDER_ID } from "../provider/stella.ts";
import { MAX_AGENT_DEPTH, StellaAgentDoc, type StellaAgentRole, type StellaPendingNote } from "./agent-doc.ts";
import type { AgentLineage } from "@stella/contracts/agent-depth";
import { AGENT_MOVE_CLOUD, switchDestinationTool, type AgentSwitch, type DeviceStanding, type StellaExecutionHost } from "./execution.ts";
import { agentToolSelection } from "./host-tools.ts";
import {
  describePlacement,
  parseSpawnDestination,
  placementOf,
  samePlacement,
  type SpawnDestination,
  type StellaPlacement,
} from "./placement.ts";

export const STELLA_AGENTS_EXTENSION = "stella-agents";

type AgentRecord = {
  /** Its conversation here; -1 for an agent that runs somewhere else. */
  conversationId: number;
  description: string;
  placement: { kind: "local" | "cloud" | "device"; deviceId?: string };
  /** Answers already reported, so two messages answered by one run report once. */
  reported: number[];
  /** It runs on another host as a whole (`StellaAgentsHost.remote`). */
  remote?: true;
  /** It runs as a whole on another engine on this host (`StellaAgentsHost.engine`), by that engine's id. */
  engine?: string;
  /** When a remote agent was started; a local one dates from its first entry. */
  startedAt?: number;
  /**
   * The reports that came back from a remote agent, by request id: one per
   * message it was given (`noteRemoteReport`), so it runs while it has fewer.
   */
  answered?: string[];
  /** How its latest reported run ended. */
  outcome?: AgentAttemptOutcome;
  /** Its latest report was a failure (written before `outcome`). */
  failed?: true;
  /** It was started here for another host's orchestrator, which gets its reports. */
  origin?: AgentOrigin;
  /** Messages its starter gave it that never reached it (refused, or withdrawn by a stop); they go with its next one. */
  held?: string[];
  /** `stop_agent` stopped it; its next message clears this. */
  stopped?: true;
  /** `stopped`, as builds before `stop_agent` wrote it. */
  paused?: true;
  steers?: Array<{ key: string; message: string }>;
  carried?: { runKey: string; messages: string[]; settled?: true };
  /**
   * It moved itself to another host (`switch_destination`): it is reached
   * through the owner's agent threads from then on, wherever it runs, while
   * its conversation here stays for when it comes back.
   */
  moved?: true;
  /** It moved away and does not run here now. */
  away?: true;
  /** It came back here as an agent another host placed, under this key (`runPlacedAgent`). */
  placedAs?: string;
  /** It moved here: its next run first takes what it did elsewhere from its log. */
  catchUp?: true;
};

/**
 * Who gets the reports of an agent started here for another host rather
 * than for this orchestrator: the owner's agent threads (one attempt of a
 * thread they track, which they hand on).
 */
export type AgentOrigin = { agentThread: true };

/** One of the orchestrator's agents as the app lists it. */
export type StellaAgentRecord = {
  threadId: string;
  description: string;
  placement: AgentRecord["placement"];
  status: "running" | "completed" | "error";
  startedAt: number;
  updatedAt: number;
  /** Its latest prose, oldest first. */
  assistantMessages: string[];
  error?: string;
  /** It was stopped, or its latest run stopped before it answered. */
  stopped?: true;
  /** Its status in the shared vocabulary, which `status` and `stopped` fold. */
  agentStatus: AgentStatus;
};

/** The agents a conversation started, by thread id. */
export const StellaAgentsDoc = defineDoc<{
  agents: Record<string, AgentRecord>;
  /** Tool task id → what that call did, so a rerun of the call does it once. */
  calls: Record<string, { threadId: string; reporter: number }>;
}>({
  kind: "stella.agents",
  version: 1,
  scope: "conversation",
  history: "latest",
  // A fork does not inherit the agents of the conversation it forked from.
  fork: "initial",
  initial: () => ({ agents: {}, calls: {} }),
});

/** The call that started an agent another host placed here (`runPlacedAgent`). */
const PLACED_CALL_PREFIX = "placed:";

/**
 * Whether an agent in this conversation is another host's: placed here by it,
 * or started here for its orchestrator. That host's records track it, so this
 * computer does not report it as its own.
 */
export const isAnotherHostsAgent = (
  state: { agents: Record<string, AgentRecord>; calls: Record<string, { threadId: string }> } | undefined,
  threadId: string,
): boolean =>
  state?.agents[threadId]?.origin !== undefined ||
  Object.entries(state?.calls ?? {}).some(([key, call]) => call.threadId === threadId && key.startsWith(PLACED_CALL_PREFIX));

/** A message on its way to an agent. */
export type AgentRun = {
  threadId: string;
  agentConversationId: ConversationId;
  /** The conversation that started the agent; the reporter lives there. */
  parentConversationId: ConversationId;
  /** Unique per message: `agent-run:<reporter task id>`. */
  runId: string;
  /** The agent that started it; absent when Stella did. */
  parentThreadId?: string;
  /** Its depth among Stella's agents: 1 for hers, one more for each level below. */
  depth: number;
  /** Which of the messages its starter gave it this run answers, from 1: its attempt in the owner's records. */
  attempt: number;
  description: string;
};

/** How an agent's run ended, for the host that ran it. */
export type AgentRunEnd = {
  /** The answer's text, when the run answered. */
  answer?: string;
  /** Stopped before it answered. */
  aborted?: true;
  /** Why it failed: the host refused the run, it ended without an answer, or its answer is an error. */
  error?: string;
  /**
   * It answered while agents it started still run, so it is not done: its
   * attempt stays open and nothing reports its end.
   */
  waiting?: true;
};

/** How a run ended, for the owner's records; undefined when it did not settle (its host is closing). */
export const agentRunOutcome = (
  end: AgentRunEnd | undefined,
): { outcome: AgentAttemptOutcome; text?: string } | undefined =>
  end?.error !== undefined
    ? { outcome: "failed", text: end.error }
    : end?.aborted
      ? { outcome: "canceled", text: AGENT_STOPPED_REASON }
      : end?.answer !== undefined
        ? { outcome: "completed", text: end.answer }
        : undefined;

/** The attempt one reporter's message is: the messages given before it and its own. */
const attemptOf = (
  state: { calls: Record<string, { threadId: string; reporter: number }> } | undefined,
  threadId: string,
  reporter: number,
): number =>
  Math.max(
    1,
    Object.values(state?.calls ?? {}).filter((call) => call.threadId === threadId && call.reporter >= 0 && call.reporter <= reporter)
      .length,
  );

/** The model an agent runs on, and at what thinking level. */
export type RunsOn = { model?: ModelRef; thinkingLevel?: ModelThinkingLevel };

/**
 * What an agent its caller named a model for runs on: a model this host
 * runs, another engine that runs it as a whole (`StellaAgentsHost.engine`),
 * or, for an agent placed elsewhere as a whole, the host there on that model.
 */
export type AgentModelChoice = { runsOn: RunsOn } | { engine: string } | { there: true };

/** An agent's report, arriving at the orchestrator. */
export type AgentReport = {
  rootConversationId: ConversationId;
  threadId: string;
  text: string;
  /**
   * How the run it reports ended. Set on every report with text; readers use
   * it, never the text's heading.
   */
  status?: AgentAttemptOutcome;
  /** Exactly-once key for the delivery. */
  requestId: string;
  /** The agent was started here for another host's orchestrator: the report is for it. */
  origin?: AgentOrigin;
  /**
   * For an agent started for another host: one of its messages was answered
   * within another report, or its run was stopped. No text; that host counts
   * one report per message it sent.
   */
  settled?: true;
  ledger?: true;
};

/** A note an agent sent its Stella (`send_message` to "stella"), arriving at the orchestrator. */
export type AgentNote = {
  rootConversationId: ConversationId;
  /** The sending agent. */
  threadId: string;
  /** The framed `<agent-message>` Stella reads, which no reader shows. */
  text: string;
  /** Exactly-once key for the delivery. */
  requestId: string;
};

/**
 * A report of a remote agent came back to the conversation that started it
 * (`StellaAgentsHost.remote`), or one of its messages was settled without
 * one. Once per `requestId`. False when the conversation never started that
 * agent: the report is not for it.
 */
export const noteRemoteReport = async (
  tx: Pick<Tx, "doc">,
  conversationId: ConversationId,
  report: { threadId: string; requestId: string; text?: string; status?: AgentAttemptOutcome },
): Promise<boolean> => {
  const agent = (await tx.doc(StellaAgentsDoc, conversationId)).agents[report.threadId];
  if (!agent?.remote) return false;
  if (agent.answered?.includes(report.requestId)) return true;
  agent.answered = [...(agent.answered ?? []), report.requestId];
  if (report.text === undefined) {
    if (report.status === "canceled") agent.outcome = "canceled";
    return true;
  }
  agent.outcome = reportStatusOf(report);
  delete agent.failed;
  return true;
};

/** How a remote agent's latest reported run ended, from its record. */
const remoteOutcome = (agent: AgentRecord): AgentAttemptOutcome => agent.outcome ?? (agent.failed ? "failed" : "completed");

/** The abort reason of a placed run `stop_agent` stopped, rather than one its host withdrew. */
export const PLACED_AGENT_STOPPED = "placed-agent-stopped";

/** How a placed run its host ended: stopped by `stop_agent`, or canceled. */
const stoppedPlacedRun = (threadId: string, signal: AbortSignal): PlacedAgentResult =>
  signal.reason === PLACED_AGENT_STOPPED
    ? { threadId, status: "canceled", error: AGENT_STOPPED_REASON, stopped: true }
    : { threadId, status: "canceled", error: "Canceled." };

/** An agent another host placed here, and one run of it (`runPlacedAgent`). */
export type PlacedAgentRun = {
  /** Where it sits among Stella's agents; absent, it is one of Stella's own. */
  lineage?: AgentLineage;
  /** The agent's identity at the host that placed it, the same for each of its runs. */
  agentKey: string;
  /** This run (a continued agent runs again under the same `agentKey`). */
  runKey: string;
  /** Its thread id at the host that placed it, which names it everywhere else. */
  threadId?: string;
  description: string;
  prompt: string;
  /** The model it runs on, when the host that placed it named one; otherwise the orchestrator's. */
  runsOn?: RunsOn;
  /** The host that placed it canceled it: it stops, or never starts. */
  signal?: AbortSignal;
};

export type PlacedAgentResult = { threadId: string } & (
  | { status: "ok"; finalText: string }
  /** It moved itself to another host, which runs it from now on. */
  | { status: "moved"; where: string }
  | { status: "error"; error: string }
  /**
   * Stopped before it answered: by `stop_agent` (`stopped`, which reports to
   * no one), or because the host that placed it canceled it.
   */
  | { status: "canceled"; error: string; stopped?: true }
);

/**
 * An agent that runs on another host as a whole, so it keeps working while
 * this one sleeps: the host starts it there and carries messages to it, and
 * its report reaches its starter the way that host's reports do (a wake
 * turn in the cloud, the conversation's journal on a computer, or a message
 * to the agent that started it, through the owner's agent threads).
 */
export type RemoteAgentHost = {
  /**
   * Start it there. Its thread id there names it everywhere. Once per `key`.
   * `model` is the one its caller asked for, which the host there runs it on.
   * `parentThreadId`: the agent that starts it, when Stella does not; its
   * reports go back to that agent wherever it runs.
   */
  start(
    args: { key: string; description: string; prompt: string; model?: string; parentThreadId?: string },
    context: Context,
  ): Promise<{ threadId: string; waiting?: boolean }>;
  /**
   * Another message for it: steers it there, starts its next run, or is held
   * for its offline computer. Once per `key`. `framed`: `message` is already
   * framed as the agent reads it (`formatAgentMessage`), so the host there
   * delivers it as it is.
   */
  message(
    args: { key: string; threadId: string; message: string; framed?: boolean },
    context: Context,
  ): Promise<AgentMessageDelivery | void>;
  /** Stop it there, and every agent it started, at any depth. */
  stop?(threadId: string, context: Context): Promise<AgentStopResult | void>;
};

export type StellaAgentsHost = {
  /** Where an agent runs, given what the caller asked for and where the caller runs. */
  place(destination: SpawnDestination, caller: StellaPlacement): StellaPlacement | { error: string };
  /** The host that runs agents placed there, when they run somewhere else as a whole. */
  remote?(placement: StellaPlacement): RemoteAgentHost | undefined;
  /**
   * What an agent whose caller named `requested` runs on: a model this host
   * runs (a Stella alias, a model on the user's own key or plan), the id of
   * another engine that runs it as a whole (`engine`), or, with `placement`
   * (it runs elsewhere as a whole), the host there. Throws when nothing runs
   * it, so it never runs on something else. Absent, only Stella's aliases
   * run here, for a caller on Stella's models, and a host elsewhere takes the
   * model as it is.
   */
  agentModel?(
    requested: string,
    caller: RunsOn,
    placement: StellaPlacement | undefined,
    context: Context,
  ): Promise<AgentModelChoice>;
  /**
   * The model an agent runs on when its caller names none, where the
   * caller's own cannot run an agent here; absent, it runs on the caller's.
   */
  defaultAgentModel?(caller: RunsOn): string | undefined;
  /** Another engine on this host that runs whole agents (Claude Code on a computer), by its id. */
  engine?(id: string): RemoteAgentHost | undefined;
  /** Where the orchestrator itself runs. */
  rootPlacement: StellaPlacement;
  /**
   * Before a message goes to an agent, and after the agent's run settles:
   * the cloud admits the run and binds its model capability here.
   */
  beginAgentRun?(run: AgentRun, context: Context): Promise<void>;
  /**
   * A model an agent is started on that its caller's may not be (another
   * Stella alias): the host registers it so the agent can resolve it.
   */
  ensureModel?(model: ModelRef, context: Context): Promise<void>;
  endAgentRun?(run: AgentRun, context: Context, end?: AgentRunEnd): Promise<void>;
  /**
   * A report for the orchestrator. Default: a follow-up input to the root
   * conversation. The cloud sends it through its turn plane instead.
   */
  deliverReport?(report: AgentReport, context: Context): Promise<void>;
  /**
   * A note for the orchestrator. Default: a hidden follow-up input to the
   * root conversation. The cloud sends it through its turn plane instead.
   */
  deliverNote?(note: AgentNote, context: Context): Promise<void>;
  reportsFromLedger?(): boolean;
  /** An agent's report reached the orchestrator: the desktop tells the user. */
  agentReported?(agent: {
    threadId: string;
    description: string;
    /** How the run it reports ended. */
    status: AgentAttemptOutcome;
    /** `status === "failed"`, for hosts that read only that. */
    failed: boolean;
    report: string;
  }): void;
  /**
   * One of the orchestrator's agents was stopped before it answered and is
   * not running again, so no report goes up and the orchestrator is not
   * woken: the host records that it stopped, where the conversation's other
   * devices read what is running.
   */
  agentStopped?(agent: { threadId: string; description: string }, context: Context): Promise<void>;
  /** Who an agent can reach beyond this conversation's own agents. */
  directory?: AgentDirectoryHost;
  /**
   * Where a new agent whose tools run on this host starts working, when its
   * caller named no directory: a fresh folder of its own rather than the
   * user's home. Absent, it starts in the environment's default directory.
   */
  agentDirectory?(threadId: string): string;
  /**
   * Why an agent can't start in `directory` on this host (it is missing, or
   * not a folder); undefined when it can. Absent, the directory is not checked.
   */
  directoryProblem?(directory: string): Promise<string | undefined>;
  /**
   * Where Stella can move herself (`switch_destination`), and how the
   * owner's computers stand, for agents that run on one of them.
   */
  execution?: StellaExecutionHost;
  /**
   * Every agent's conversation in the cloud (`agent-log-sync`): a sync after
   * the agent's run here, and the import that brings an agent's transcript
   * here up to its log before it runs here. Answers the folder it worked in
   * where it ran last.
   */
  agentLog?: {
    kick(conversationId: ConversationId): void;
    importInto(agentConversationId: ConversationId, threadId: string, context: Context): Promise<{ cwd?: string }>;
  };
};

/**
 * What `agent_status` lists and `send_message` reaches beyond the agents this
 * harness holds: the user's other Stella sessions, and this conversation's
 * agents that run elsewhere (the owner's agent threads).
 */
export type AgentDirectoryHost = {
  /** The conversation this harness is Stella for, as the other hosts name it. */
  conversationId(context: Context): Promise<string>;
  /** Rows the harness does not hold; `unavailable` says what could not be read. */
  list(context: Context): Promise<{ agents: AgentDirectoryAgentRow[]; sessions: AgentDirectorySessionRow[]; unavailable?: string }>;
  /**
   * A note for a thread this harness does not hold, once per `key`: a
   * session's Stella, or an agent elsewhere. With `remoteStella`, `to` is
   * this conversation and the note is for its Stella on another host.
   * Undefined when no one has that thread id.
   */
  message(
    args: { key: string; to: string; text: string; from: AgentMessageSender; remoteStella?: true },
    context: Context,
  ): Promise<AgentMessageDelivery | undefined>;
  /**
   * Stop an agent this harness does not hold or reach itself, and every
   * agent it started, wherever each runs and whichever host started it, once
   * per `key`. `requesterThreadId`: the agent asking, which may stop only
   * agents it started, at any depth.
   */
  stop?(args: { key: string; threadId: string; requesterThreadId?: string }, context: Context): Promise<AgentStopResult>;
};

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "agent";

const AGENT_ID_TAIL_LENGTH = 6;

const agentIdTail = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(AGENT_ID_TAIL_LENGTH)), (byte) => (byte % 36).toString(36)).join("");

const mintAgentId = (description: string, taken: Readonly<Record<string, unknown>>): string => {
  for (;;) {
    const candidate = `${slug(description)}-${agentIdTail()}`;
    if (!(candidate in taken)) return candidate;
  }
};

const textOf = (message: AssistantMessage | undefined): string =>
  (message?.content ?? []).map((part) => (part.type === "text" ? part.text : "")).join("").trim();

/**
 * Whether an agent's newest work stopped before an answer: a run stopped
 * mid-request or mid-tool ends on an aborted request, a tool call or
 * its result, where a finished run ends on its answer. Entries newest first.
 */
const stoppedShort = (entries: readonly { kind: string; model?: readonly unknown[] }[]): boolean => {
  const newest = entries.find((entry) => entry.kind === "pi.assistant" || entry.kind === "pi.tool-result");
  if (!newest) return false;
  if (newest.kind !== "pi.assistant") return true;
  const stop = (newest.model?.[0] as AssistantMessage | undefined)?.stopReason;
  return stop === "aborted" || stop === "toolUse";
};

/** Mark one of the agents a conversation started stopped (`AgentRecord.stopped`). */
const markStopped = async (
  store: Pick<ToolExecutionApi, "commit">,
  starter: ConversationId,
  threadId: string,
  context: Context,
): Promise<void> => {
  await store.commit(async (tx) => {
    const agent = (await tx.doc(StellaAgentsDoc, starter)).agents[threadId];
    if (agent) agent.stopped = true;
    return undefined;
  }, context);
};

/** Whether `stop_agent` stopped it since its last message. */
const wasStopped = (agent: AgentRecord): boolean => agent.stopped === true || agent.paused === true;

/** Any message's text: a user message's content may be a plain string. */
const messageText = (message: { content?: unknown } | undefined): string =>
  typeof message?.content === "string"
    ? message.content
    : Array.isArray(message?.content)
      ? (message.content as Array<{ type?: string; text?: string }>).map((part) => (part.type === "text" ? (part.text ?? "") : "")).join("")
      : "";

/** `agent_status` on a running agent the caller started: its report needs no waiting. */
const RUNNING_STATUS_NOTE =
  "Still running. Its report arrives on its own in [Agent completed]: end your turn now instead of waiting or checking again.";

/** How much of an agent's latest message `agent_status` shows. */
const LATEST_PREVIEW_CHARS = 300;

const MAX_REPORT_CHARS = 30_000;
const bounded = (text: string): string =>
  text.length <= MAX_REPORT_CHARS ? text : `${text.slice(0, MAX_REPORT_CHARS)}\n[truncated ${text.length - MAX_REPORT_CHARS} chars]`;

export const completedReport = (args: {
  threadId: string;
  description: string;
  result: string;
  toParentAgent: boolean;
  /** What the user wrote to the agent in its thread, when this answers it. */
  userMessage?: string;
}): string =>
  [
    "[Agent completed]",
    `description: ${args.description}`,
    `thread_id: ${args.threadId}`,
    "status: completed",
    ...(args.userMessage === undefined
      ? []
      : [`user_message: the user wrote to this agent in its thread: ${JSON.stringify(bounded(args.userMessage))}`]),
    `result: ${bounded(args.result || "(no reply)")}`,
    ...(args.toParentAgent
      ? ["routing: your subagent's report has returned. It reaches only you, not the user; continue your own task with it."]
      : []),
  ].join("\n");

export const failedReport = (args: { threadId: string; description: string; error: string }): string =>
  ["[Task failed]", `description: ${args.description}`, `thread_id: ${args.threadId}`, "status: failed", `error: ${bounded(args.error)}`].join("\n");

const roleOf = async (
  reader: Pick<TaskRuntime<unknown, { phase: string }, unknown, object>, "snapshot">,
  conversationId: ConversationId,
  context: Context,
): Promise<StellaAgentRole> => (await reader.snapshot(StellaAgentDoc, conversationId, context)) ?? { agentType: "orchestrator", depth: 0 };

/** Owns one agent conversation. Completes at once; background, so its owner's Stop and idle stop here. */
const Anchor = defineTask<null, { phase: "done" }, null>({
  name: "stella.agent-anchor",
  version: 1,
  initial: () => ({ phase: "done" }),
  phases: {
    done: (_anchor, runtime, context) =>
      runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context),
  },
  abort: (_anchor, runtime, context) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
});

type ReporterInput = {
  threadId: string;
  conversationId: number;
  message: string;
  /** The user wrote the message in the agent's thread, not the parent. */
  fromUser?: true;
  /** The report of an agent it started: it wakes it, stopped or not. */
  report?: true;
  /** A note from an agent that did not start it, which wakes it like a report. */
  note?: true;
};
type ReporterState =
  | {
      phase: "deliver";
      carried?: string[];
    }
  | {
      phase: "report";
      report?: string;
      /** How the run ended; absent on a checkpoint written before it was recorded. */
      status?: AgentAttemptOutcome;
      /** It was stopped before it answered: nothing reports. */
      stopped?: true;
      /** Written as `stopped` by builds before `stop_agent`. */
      paused?: true;
      /** It answered while agents it started still run: not done, so nothing reports. */
      waiting?: true;
      /** Its notes to Stella that go out before the report (`settleNotes`). */
      notes?: StellaPendingNote[];
    };

const REPORTER_TASK = "stella.agent-reporter";
const LIVE_TASK_STATUSES = ["pending", "running", "waiting", "completing"] as const;

/** What `agentsBusy` reads, from whichever handle the caller holds. */
type BusyReader = {
  agents(conversationId: ConversationId): Promise<Readonly<{ agents: Readonly<Record<string, AgentRecord>> }> | undefined>;
  running(conversationId: ConversationId): Promise<boolean>;
  reporters(conversationId: ConversationId): Promise<ReadonlyArray<{ id: number; input: ReporterInput }>>;
};

/** Reporters still carrying a message in a conversation (one per message to one of its agents). */
const liveReporters = async (
  tx: Pick<Tx, "scanTasks">,
  conversationId: ConversationId,
): Promise<Array<{ id: number; input: ReporterInput }>> => {
  const found: Array<{ id: number; input: ReporterInput }> = [];
  for (const status of LIVE_TASK_STATUSES) {
    let cursor: Parameters<Tx["scanTasks"]>[2];
    do {
      const page = await tx.scanTasks({ conversationId, kind: REPORTER_TASK, status }, 100, cursor);
      for (const task of page.items) found.push({ id: Number(task.id), input: task.input as unknown as ReporterInput });
      cursor = page.next;
    } while (cursor !== undefined);
  }
  return found;
};

/**
 * Whether any agent a conversation started is still at work: running, its
 * answer still on its way back, or waiting on agents of its own.
 */
const agentsBusy = async (read: BusyReader, conversationId: ConversationId, depth = 0): Promise<boolean> => {
  const own = Object.entries((await read.agents(conversationId))?.agents ?? {}).filter(
    ([, agent]) => !agent.remote && agent.conversationId >= 0,
  );
  if (own.length === 0) return false;
  const carrying = new Set((await read.reporters(conversationId)).map((reporter) => reporter.input.threadId));
  for (const [threadId, agent] of own) {
    if (carrying.has(threadId)) return true;
    const id = agent.conversationId as ConversationId;
    if (await read.running(id)) return true;
    if (depth + 1 < MAX_AGENT_DEPTH && (await agentsBusy(read, id, depth + 1))) return true;
  }
  return false;
};

/** `agentsBusy` through a handle that commits and returns (a tool call's api, the harness). */
const busyReader = (
  store: Pick<ToolExecutionApi, "snapshot"> & { commit<T>(change: (tx: Tx) => Promise<T>, context: Context): Promise<T> },
  context: Context,
): BusyReader => ({
  agents: (id) => store.snapshot(StellaAgentsDoc, id, context),
  running: async (id) => (await store.snapshot(LiveDoc, id, context))?.run !== undefined,
  reporters: (id) => store.commit((tx) => liveReporters(tx, id), context),
});

/** An agent somewhere under the orchestrator, and the conversation that started it. */
type TreeAgent = {
  threadId: string;
  record: AgentRecord;
  parentConversationId: ConversationId;
  /** The agent that started it; absent when Stella did. */
  parentThreadId?: string;
  /** The messages its starter gave it. */
  given: number;
  /** Its answers are reported to its starter (not run for another host, which reads them itself). */
  reports: boolean;
};

const assertMessageSize = (message: string): void => {
  if (!message.trim()) throw new Error("The message is empty.");
  if (message.trim().length > AGENT_MESSAGE_MAX_CHARS) {
    throw new Error(`The message is over ${AGENT_MESSAGE_MAX_CHARS} characters. Send the essentials, or write the rest to a file and point to it.`);
  }
};

/** Who a note is from: an agent by its description, or Stella by the conversation's thread id. */
const senderOf = (self: StellaAgentRole, stellaThreadId: string): AgentMessageSender =>
  self.agentType === "orchestrator" || !self.threadId
    ? { threadId: stellaThreadId, label: "Stella" }
    : { threadId: self.threadId, label: self.description ?? "An agent" };

const deliveredResult = (delivery: { threadId: string; outcome?: AgentMessageDelivery["outcome"]; note?: string }) => ({
  content: [
    {
      type: "text" as const,
      text: `Delivered to ${delivery.threadId}. ${
        delivery.outcome === "steered"
          ? "It is working and reads your message before its next step."
          : delivery.outcome === "resumed"
            ? "It was idle, so your message started its next run; its report goes to whoever started it."
            : delivery.outcome === "queued"
              ? "That Stella reads it as its next turn."
              : delivery.outcome === "held"
                ? "Its computer is offline, so the message is held and reaches it once that computer reconnects; its report goes to whoever started it."
                : "It reads your message before its next step; its report goes to whoever started it."
      }${delivery.note ? ` ${delivery.note}` : ""}`,
    },
  ],
});

const statusResult = (view: Record<string, unknown>) => ({
  content: [{ type: "text" as const, text: JSON.stringify(view) }],
});

/** What an agent is to the caller of `agent_status`. */
const relationOf = (row: { threadId: string; parentThreadId?: string }, self: { threadId?: string }, parentThreadId?: string) =>
  (self.threadId ? row.parentThreadId === self.threadId : !row.parentThreadId)
    ? "you started it"
    : row.threadId === parentThreadId
      ? AGENT_MESSAGE_STARTER_RELATION
      : "teammate";

export function stellaAgents(host: StellaAgentsHost) {
  const execution = host.execution;
  const agentsMove = execution?.moveAgent !== undefined && execution.agentTarget !== undefined;
  const switchDestination =
    execution && (execution.moveBrain || agentsMove)
      ? switchDestinationTool(execution, host.rootPlacement, agentsMove ? (args, api, context) => agentSwitch(args, api, context) : undefined)
      : undefined;
  const Reporter = defineTask<ReporterInput, ReporterState, null>({
    name: "stella.agent-reporter",
    version: 1,
    initial: () => ({ phase: "deliver" }),
    phases: {
      deliver: async (reporter, runtime, context) => {
        const { threadId, message } = reporter.input;
        const agentConversationId = reporter.input.conversationId as ConversationId;
        const carried = reporter.state.checkpoint.carried;
        if (carried === undefined) {
          await runtime.commit(async (tx) => {
            const agent = (await tx.doc(StellaAgentsDoc, runtime.conversationId)).agents[threadId];
            const held = [...(agent?.held ?? [])];
            if (agent) {
              delete agent.held;
              delete agent.stopped;
              delete agent.paused;
            }
            return { status: "running", checkpoint: { phase: "deliver", carried: held } };
          }, context);
          return;
        }
        // It moved itself away: the message goes where it runs now.
        const current = (await runtime.snapshot(StellaAgentsDoc, runtime.conversationId, context))?.agents[threadId];
        if (current?.moved) {
          const remote = remoteHostOf(current);
          const text = [...carried, message].join("\n\n");
          if (remote) await remote.message({ key: `moved:${reporter.id}`, threadId, message: text, framed: true }, context);
          else await host.directory?.message({ key: `moved:${reporter.id}`, to: threadId, text, from: { threadId: STELLA_MESSAGE_TARGET, label: "Stella" } }, context);
          await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context);
          return;
        }
        const self = await roleOf(runtime, runtime.conversationId, context);
        const siblings = await runtime.snapshot(StellaAgentsDoc, runtime.conversationId, context);
        const run: AgentRun = {
          threadId,
          agentConversationId,
          parentConversationId: runtime.conversationId,
          runId: `agent-run:${reporter.id}`,
          ...(self.agentType !== "orchestrator" && self.parentConversationId !== undefined && self.threadId
            ? { parentThreadId: self.threadId }
            : {}),
          depth: self.depth + 1,
          attempt: attemptOf(siblings, threadId, Number(reporter.id)),
          description: siblings?.agents[threadId]?.description ?? threadId,
        };
        let settled: Awaited<ReturnType<Awaited<ReturnType<NonNullable<Awaited<ReturnType<typeof runtime.conversation>>>["submit"]>>["wait"]>> | undefined;
        // A run the host refuses (admission, credentials) is reported as failed.
        let refused: string | undefined;
        // How the run ended, for the host once its report is settled.
        let end: AgentRunEnd = {};
        let submitted = false;
        try {
          try {
            await host.beginAgentRun?.(run, context);
            const agent = await runtime.conversation(agentConversationId, context);
            if (!agent) throw new Error(`Agent ${threadId} no longer exists.`);
            // Its model may be one nothing registered since a restart (another Stella alias).
            const model = host.ensureModel ? (await runtime.snapshot(AgentDoc, agentConversationId, context))?.model : undefined;
            if (model) await host.ensureModel?.(model, context);
            if ((await runtime.snapshot(StellaAgentsDoc, runtime.conversationId, context))?.agents[threadId]?.catchUp) {
              await catchUpFromLog(agentConversationId, threadId, context);
              await runtime.commit(async (tx) => {
                const current = (await tx.doc(StellaAgentsDoc, runtime.conversationId)).agents[threadId];
                if (current) delete current.catchUp;
                return undefined;
              }, context);
            }
            const submission = await agent.submit(
              {
                type: "input",
                content: [...carried, message].join("\n\n"),
                whenBusy: "steer",
                requestId: `agent-msg:${reporter.id}`,
              },
              context,
            );
            submitted = true;
            settled = await submission.wait(context);
          } catch (error) {
            if (context.abortSignal?.aborted) throw error;
            refused = error instanceof Error ? error.message : String(error);
          }
          const withdrawn = settled?.status === "unanswered" && settled.reason === "aborted" && settled.entry === undefined;
          if (settled?.status === "unanswered" && settled.reason === "aborted") end = { aborted: true };
          else if (refused !== undefined || settled === undefined) end = { error: refused ?? "The agent did not run." };
          else if (settled.status === "unanswered") end = { error: settled.reason };
          // Whether it answered with agents of its own still at work, or with
          // more of their reports and notes still on their way to it: then it
          // is not done.
          let busy = false;
          if (settled?.status === "done" && settled.type === "input" && !siblings?.agents[threadId]?.origin) {
            const read: BusyReader = {
              agents: (id) => runtime.snapshot(StellaAgentsDoc, id, context),
              running: async (id) => (await runtime.snapshot(LiveDoc, id, context))?.run !== undefined,
              reporters: async (id) => {
                let found: Array<{ id: number; input: ReporterInput }> = [];
                await runtime.commit(async (tx) => {
                  found = await liveReporters(tx, id);
                  return undefined;
                }, context);
                return found;
              },
            };
            busy = await (async () => {
              if (await agentsBusy(read, agentConversationId)) return true;
              const others = (await read.reporters(runtime.conversationId)).filter(
                (other) =>
                  other.id !== Number(reporter.id) &&
                  other.input.threadId === threadId &&
                  (other.input.report === true || other.input.note === true),
              );
              for (const other of others) {
                let pending = true;
                await runtime.commit(async (tx) => {
                  const submission = await tx.submissionByRequest(agentConversationId, `agent-msg:${other.id}`);
                  pending = submission === undefined || submission.status === "queued" || submission.status === "placed";
                  return undefined;
                }, context);
                if (pending) return true;
              }
              return false;
            })().catch(() => false);
          }
          if (settled?.status === "unanswered" && settled.reason === "aborted") await dropMove(runtime, agentConversationId, context);
          // It asked to move: now that this run ended it goes, and reports from there.
          const move =
            settled?.status === "done" && settled.type === "input" ? await takeMove(runtime, agentConversationId, context) : undefined;
          if (move && settled?.status === "done" && settled.type === "input") {
            const answered = settled.answer;
            // Its notes to Stella go out now; it reports from where it moves.
            for (const note of (await runtime.snapshot(StellaAgentDoc, agentConversationId, context))?.notes ?? []) {
              await deliverNote(runtime.conversationId, note, context, (id) => runtime.conversation(id, context)).catch(() => false);
            }
            await runtime.commit(async (tx) => {
              await settleNotes(tx, agentConversationId, undefined);
              const state = await tx.doc(StellaAgentsDoc, runtime.conversationId);
              const agent = state.agents[threadId];
              if (agent && !agent.reported.includes(answered)) agent.reported.push(answered);
              if (agent && "moved" in move) {
                // What it was given so far is settled here; what it is given from now on is answered there.
                const given = Object.entries(state.calls).filter(([, call]) => call.threadId === threadId).map(([key]) => `moved:${key}`);
                agent.remote = true;
                agent.moved = true;
                agent.away = true;
                agent.placement = move.deviceId === AGENT_MOVE_CLOUD ? { kind: "cloud" } : { kind: "device", deviceId: move.deviceId };
                agent.startedAt ??= Date.now();
                agent.answered = [...new Set([...(agent.answered ?? []), ...given.slice(0, -1)])];
              }
              if ("failed" in move) {
                await tx.createTask(
                  Reporter,
                  { threadId, conversationId: reporter.input.conversationId, message: moveFailedText(move.failed) },
                  { ownership: { kind: "conversation" }, background: true, conversationId: runtime.conversationId },
                );
              }
              return { status: "terminal", outcome: { status: "completed", result: null } };
            }, context);
            return;
          }
          await runtime.commit(async (tx) => {
            // Its notes to Stella: sent in its last step before it finished,
            // they are part of its report; otherwise they go out before it.
            const finished =
              settled?.status === "done" && settled.type === "input" && !busy ? settled.answer : undefined;
            const notes = await settleNotes(tx, agentConversationId, finished);
            const send = (closing: boolean) => [...notes.send, ...(closing ? [] : notes.closing)];
            const next = (report?: string, status?: AgentAttemptOutcome, closing = false): { status: "running"; checkpoint: ReporterState } => ({
              status: "running",
              checkpoint: {
                phase: "report",
                ...(report === undefined ? {} : { report, ...(status ? { status } : {}) }),
                ...(send(closing).length ? { notes: send(closing) } : {}),
              },
            });
            const state = await tx.doc(StellaAgentsDoc, runtime.conversationId);
            const agent = state.agents[threadId];
            const description = agent?.description ?? threadId;
            // A report or note a stop withdrew before it landed wakes the
            // agent once the stop is done, with what else was withdrawn.
            if (agent && withdrawn && (reporter.input.report || reporter.input.note)) {
              await tx.createTask(
                Reporter,
                { ...reporter.input, message: [...carried, message].join("\n\n") },
                { ownership: { kind: "conversation" }, background: true, conversationId: runtime.conversationId },
              );
            } else if (agent && (withdrawn || (!submitted && carried.length > 0))) {
              agent.held = [...carried, ...(withdrawn ? [message] : []), ...(agent.held ?? [])];
            }
            if (refused !== undefined || settled === undefined) {
              return next(failedReport({ threadId, description, error: refused ?? "The agent did not run." }), "failed");
            }
            if (settled.status === "unanswered") {
              // Stopped: nothing to report, but it is no longer running.
              if (settled.reason === "aborted") {
                return { status: "running", checkpoint: { phase: "report", status: "canceled", stopped: true, ...(send(false).length ? { notes: send(false) } : {}) } };
              }
              return next(failedReport({ threadId, description, error: settled.reason }), "failed");
            }
            if (settled.type !== "input" || !agent) return next();
            const answer = (await tx.entry(AssistantEntry, settled.answer))?.model?.[0] as AssistantMessage | undefined;
            const failed = answer?.stopReason === "error";
            const result = failed ? textOf(answer) : withClosingNotes(notes.closing.map((note) => note.message), textOf(answer));
            end = {
              answer: result,
              ...(failed ? { error: answer?.errorMessage ?? "The agent failed." } : {}),
            };
            if (agent.reported.includes(settled.answer)) return next();
            agent.reported.push(settled.answer);
            if (busy && !failed) {
              end = { ...end, waiting: true };
              return { status: "running", checkpoint: { phase: "report", status: "completed", waiting: true, ...(send(false).length ? { notes: send(false) } : {}) } };
            }
            return next(
              completedReport({
                threadId,
                description,
                result,
                toParentAgent: self.agentType !== "orchestrator",
                ...(reporter.input.fromUser ? { userMessage: message } : {}),
              }),
              "completed",
              !failed,
            );
          }, context);
        } finally {
          host.agentLog?.kick(agentConversationId);
          await host.endAgentRun?.(run, context, end);
        }
      },
      report: async (reporter, runtime, context) => {
        const { report, waiting, notes } = reporter.state.checkpoint;
        const stopped = reporter.state.checkpoint.stopped === true || reporter.state.checkpoint.paused === true;
        for (const note of notes ?? []) {
          await deliverNote(runtime.conversationId, note, context, (id) => runtime.conversation(id, context));
        }
        // Not done while agents it started still work: nothing reports its end.
        if (waiting) {
          await runtime.commit(() => ({ status: "terminal", outcome: { status: "completed", result: null } }), context);
          return;
        }
        const status: AgentAttemptOutcome | undefined = stopped
          ? "canceled"
          : report === undefined
            ? undefined
            : reportStatusOf({ status: reporter.state.checkpoint.status, text: report });
        const self = await roleOf(runtime, runtime.conversationId, context);
        // A stop the orchestrator's own agent took, unless a message since
        // has it running again.
        if (stopped && host.agentStopped && (self.agentType === "orchestrator" || self.parentConversationId === undefined)) {
          const live = await runtime.snapshot(LiveDoc, reporter.input.conversationId as ConversationId, context);
          if (live?.run === undefined) {
            const agent = (await runtime.snapshot(StellaAgentsDoc, runtime.conversationId, context))?.agents[reporter.input.threadId];
            await host.agentStopped(
              { threadId: reporter.input.threadId, description: agent?.description ?? reporter.input.threadId },
              context,
            );
          }
        }
        const origin =
          self.agentType === "orchestrator" || self.parentConversationId === undefined
            ? (await runtime.snapshot(StellaAgentsDoc, runtime.conversationId, context))?.agents[reporter.input.threadId]?.origin
            : undefined;
        if (report === undefined && origin && host.deliverReport) {
          await host.deliverReport(
            {
              rootConversationId: runtime.conversationId,
              threadId: reporter.input.threadId,
              text: "",
              requestId: `agent-report:${reporter.id}`,
              origin,
              settled: true,
              ...(stopped ? { status: "canceled" as const } : {}),
            },
            context,
          );
        }
        const fromLedger = report !== undefined && host.reportsFromLedger?.() === true;
        if (report !== undefined && (self.agentType === "orchestrator" || self.parentConversationId === undefined)) {
          const delivery: AgentReport = {
            rootConversationId: runtime.conversationId,
            threadId: reporter.input.threadId,
            text: report,
            status: status ?? "completed",
            requestId: `agent-report:${reporter.id}`,
            ...(origin ? { origin } : {}),
          };
          if (fromLedger) {
            await host.deliverReport?.({ ...delivery, ledger: true }, context);
          } else if (host.deliverReport) {
            await host.deliverReport(delivery, context);
          } else {
            const root = await runtime.conversation(runtime.conversationId, context);
            await root?.submit({ type: "input", content: report, whenBusy: "followUp", requestId: delivery.requestId }, context);
          }
          if (host.agentReported && !origin) {
            const agent = (await runtime.snapshot(StellaAgentsDoc, runtime.conversationId, context))?.agents[reporter.input.threadId];
            host.agentReported({
              threadId: reporter.input.threadId,
              description: agent?.description ?? reporter.input.threadId,
              status: delivery.status ?? "completed",
              failed: delivery.status === "failed",
              report,
            });
          }
        }
        await runtime.commit(async (tx) => {
          // A report to an agent is the next message to that agent, carried
          // by a reporter in the conversation that started it.
          if (!fromLedger && report !== undefined && self.agentType !== "orchestrator" && self.parentConversationId !== undefined && self.threadId) {
            await tx.createTask(
              Reporter,
              { threadId: self.threadId, conversationId: runtime.conversationId, message: report, report: true },
              {
                ownership: { kind: "conversation" },
                background: true,
                conversationId: self.parentConversationId as ConversationId,
              },
            );
          }
          return { status: "terminal", outcome: { status: "completed", result: null } };
        }, context);
      },
    },
    abort: (_reporter, runtime, context) => runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context),
  });

  /**
   * What an agent runs on, from its caller: Stella's alias as a general
   * agent, or else the caller's own model, at the caller's thinking level
   * either way (a ChatGPT plan turn is admitted for one reasoning effort).
   */
  const childRun = (caller: RunsOn): RunsOn => {
    const parent = caller.model;
    const thinking = caller.thinkingLevel ? { thinkingLevel: caller.thinkingLevel } : {};
    if (parent?.provider !== STELLA_PROVIDER_ID) {
      return { model: parent, ...thinking };
    }
    const parsed = parseStellaModelId(parent.modelId);
    return {
      model: parsed ? { provider: STELLA_PROVIDER_ID, modelId: stellaModelId("general", parsed.alias) } : parent,
      ...thinking,
    };
  };

  /**
   * The model an agent placed elsewhere (another computer, or the cloud from
   * a computer) runs on when its caller names none: Claude Code, with the
   * caller's model and effort, when the caller runs on it; otherwise the
   * default there.
   */
  const sameEngine = (caller: RunsOn): string | undefined => {
    if (!onClaudeCode(caller.model)) return undefined;
    const modelId = caller.model?.modelId.trim();
    const effort = caller.thinkingLevel && caller.thinkingLevel !== "off" && caller.thinkingLevel !== "minimal" ? `:${caller.thinkingLevel}` : "";
    return `${CLAUDE_CODE_PROVIDER_ID}${modelId && modelId !== "default" ? `/${modelId}` : ""}${effort}`;
  };

  /**
   * What an agent its caller named `requested` for runs on, checked by the
   * host. Without a host check, another Stella alias runs for a caller on
   * Stella's models (a turn on the user's own model or plan is admitted for
   * that model alone); anything else fails rather than running on another model.
   */
  const chooseAgentModel = async (
    requested: string,
    caller: RunsOn,
    placement: StellaPlacement | undefined,
    context: Context,
  ): Promise<AgentModelChoice> => {
    if (host.agentModel) return await host.agentModel(requested, caller, placement, context);
    if (placement) return { there: true };
    if (requested.startsWith("stella/") && caller.model?.provider === STELLA_PROVIDER_ID) {
      return { runsOn: { model: { provider: STELLA_PROVIDER_ID, modelId: stellaModelId("general", requested) } } };
    }
    throw new Error(
      caller.model?.provider === STELLA_PROVIDER_ID
        ? `Agents here run on Stella's models, so "${requested}" can't run here. Pick a "stella/..." model, or omit model to use the configured one.`
        : `Agents here run on this conversation's own model, so "${requested}" can't run here. Omit model to use it.`,
    );
  };

  /**
   * An agent that moved away runs here again, in the conversation it kept
   * here: it is no longer remote (its history reads, its subtree is walked)
   * and it is placed where this orchestrator runs. Every host's return path
   * goes through here (`createAgent` adopting it, `markCatchUp`).
   */
  const runsHereAgain = (record: AgentRecord): void => {
    delete record.remote;
    const placement = host.rootPlacement;
    record.placement = { kind: placement.kind, ...(placement.kind === "device" ? { deviceId: placement.deviceId } : {}) };
  };

  /**
   * Create an agent under `parentConversationId` and its first reporter,
   * once per `callKey`: an agent conversation owned by a background anchor,
   * its role, placement and tools, and its entry in the parent's agents.
   */
  const createAgent = async (
    tx: Tx,
    args: {
      parentConversationId: ConversationId;
      callKey: string;
      depth: number;
      description: string;
      prompt: string;
      runsOn: RunsOn;
      placement: StellaPlacement;
      /** Its caller runs it and reads its answer itself; nothing reports here. */
      detached?: boolean;
      /** The thread id another host chose for it, instead of one made here. */
      threadId?: string;
      /** Started here for another host's orchestrator. */
      origin?: AgentOrigin;
      /** The absolute directory its caller asked it to start in. */
      cwd?: string;
      /** The agent or Stella that started it. */
      startedBy?: AgentMessageSender;
      /**
       * Placed here under `threadId`, which may be an agent this harness
       * already has a conversation for (one that moved away and back): that
       * conversation is the agent's, under the placing host's key.
       */
      adoptAs?: string;
    },
  ): Promise<{ threadId: string; existing: boolean }> => {
    const { parentConversationId, depth, description, runsOn, placement } = args;
    const state = await tx.doc(StellaAgentsDoc, parentConversationId);
    const prior = state.calls[args.callKey];
    if (prior) return { threadId: prior.threadId, existing: true };
    const known = args.adoptAs && args.threadId ? state.agents[args.threadId] : undefined;
    if (known && known.conversationId >= 0 && args.adoptAs) {
      known.placedAs = args.adoptAs;
      // It moved away and came back: it runs here again, in its conversation
      // here. It stays `moved`: the owner's agent threads placed it here and
      // still reach it (`away` clears once it took what it did elsewhere).
      runsHereAgain(known);
      return { threadId: args.threadId!, existing: true };
    }
    const anchor = await tx.createTask(Anchor, null, {
      ownership: { kind: "conversation" },
      background: true,
      conversationId: parentConversationId,
    });
    const child = await tx.createConversation({ ownership: { kind: "task", taskId: anchor } });
    const arriving = known && args.adoptAs ? known : undefined;
    const threadId =
      arriving || (args.threadId && !state.agents[args.threadId]) ? args.threadId! : mintAgentId(description, state.agents);
    // It starts there, not confined there: its tools still take any path.
    const cwd = args.cwd ?? (placement.kind === "local" ? host.agentDirectory?.(threadId) : undefined);
    await configure(tx, child.id, {
      ...(cwd ? { cwd } : {}),
      ...(runsOn.model ? { model: runsOn.model } : {}),
      ...(runsOn.thinkingLevel ? { thinkingLevel: runsOn.thinkingLevel } : {}),
      // An agent has file, shell and agent tools, not the orchestrator's
      // (it copied the starter's selection); one at the depth limit cannot
      // start agents.
      extensions: { ...agentToolSelection, ...engineExtensionChange(runsOn.model) },
      tools: {
        // Only Stella's own agents move themselves; theirs run where they run.
        remove: [
          ...(depth >= MAX_AGENT_DEPTH ? [spawnAgent, stopAgent] : []),
          ...(switchDestination && !agentsMove ? [switchDestination] : []),
        ],
      },
    });
    const role = await tx.doc(StellaAgentDoc, child.id);
    role.agentType = "general";
    role.depth = depth;
    role.description = description;
    role.threadId = threadId;
    role.parentConversationId = parentConversationId;
    if (args.startedBy) role.startedBy = { threadId: args.startedBy.threadId, label: args.startedBy.label };
    if (arriving) {
      arriving.conversationId = child.id;
      arriving.placedAs = args.adoptAs!;
      arriving.moved = true;
      delete arriving.engine;
      runsHereAgain(arriving);
      state.calls[args.callKey] = { threadId, reporter: -1 };
      return { threadId, existing: false };
    }
    state.agents[threadId] = {
      conversationId: child.id,
      description,
      placement: { kind: placement.kind, ...(placement.kind === "device" ? { deviceId: placement.deviceId } : {}) },
      reported: [],
      ...(args.origin ? { origin: args.origin } : {}),
    };
    if (args.detached) {
      state.calls[args.callKey] = { threadId, reporter: -1 };
      return { threadId, existing: false };
    }
    const reporter = await tx.createTask(
      Reporter,
      { threadId, conversationId: child.id, message: args.prompt },
      { ownership: { kind: "conversation" }, background: true, conversationId: parentConversationId },
    );
    state.calls[args.callKey] = { threadId, reporter };
    return { threadId, existing: false };
  };

  /** POSIX or Windows absolute. */
  const isAbsolutePath = (value: string) => value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");

  const spawnAgent = defineTool({
    name: "spawn_agent",
    description:
      "Start a background agent for work that needs its own owner. Continue related work with an existing agent through send_message, even when it is busy. Agents can delegate independent parts to subagents. The immediate result means work has started; completion arrives in [Agent completed].",
    parameters: Type.Object({
      description: Type.String({
        description: "A short name for the project or area of work. It becomes the thread's name; put distinguishing words first.",
      }),
      prompt: Type.String({
        description:
          "The request and any necessary context the agent does not have. Keep simple requests short; preserve explicit constraints and leave the approach to the agent.",
      }),
      model: Type.Optional(
        Type.String({
          description:
            "Optional model for the agent: a Stella model such as `stella/default`, a model on the user's own key or plan as `<provider>/<model>` (such as `codex/gpt-6.1-sol`), or Claude Code as `claude-code` or `claude-code/<model>`. Add `:low`, `:medium`, `:high`, `:xhigh` or `:max` to set its reasoning. Omit to use the configured model.",
        }),
      ),
      destination: Type.Optional(
        Type.String({
          description:
            'Where the agent runs: "cloud", or a device_id from the connected devices list. Omit to run it where you run. The agent runs entirely there, on that computer\'s own Stella with its own files, browser, apps and sign-ins (Claude Code there too), and waits up to an hour for a computer that is offline. Its reports come back to you wherever you run.',
        }),
      ),
      directory: Type.Optional(
        Type.String({
          description:
            "Absolute path of the directory the agent starts in, such as the project the work is about, on the computer you run on (so not with destination). Its AGENTS.md, when there is one, is added to the agent's context. The agent can still work anywhere. Omit it to start the agent in a fresh folder of its own.",
        }),
      ),
    }),
    // A rerun finds this call's spawn in `calls` and does nothing again.
    replay: "safe",
    execute: async (args, api, context) => {
      const caller = await roleOf(api, api.conversationId, context);
      const depth = caller.depth + 1;
      if (depth > MAX_AGENT_DEPTH) throw new Error("This agent is at the nesting limit and cannot start agents of its own.");
      const orchestrator = caller.agentType === "orchestrator";
      const destination = parseSpawnDestination(args.destination);
      const directory = args.directory?.trim() || undefined;
      if (directory && !isAbsolutePath(directory)) {
        throw new Error(`directory must be an absolute path; got "${directory}".`);
      }
      const placed = host.place(destination, host.rootPlacement);
      if ("error" in placed) throw new Error(placed.error);
      const placement: StellaPlacement = placed;
      const here = samePlacement(placement, host.rootPlacement);
      if (directory && !here) {
        throw new Error(
          "directory works only for an agent that runs where you are. Leave it out, and name the directory in the prompt instead.",
        );
      }
      const problem = directory ? await host.directoryProblem?.(directory) : undefined;
      if (problem) throw new Error(problem);
      const callerAgent = await api.agent(context);
      const placedRemote = here ? undefined : host.remote?.(placement);
      if (!here && !placedRemote) throw new Error(`Agents can't start on ${describePlacement(placement)} from here.`);
      const named = args.model?.trim();
      const explicit = named && named !== "default" ? named : undefined;
      // Elsewhere it runs on Stella's engine, as it would here: Claude Code when she runs on it.
      const requested = explicit ?? (placedRemote ? sameEngine(callerAgent) : undefined) ?? host.defaultAgentModel?.(callerAgent);
      const description = args.description.trim() || "agent";
      const choice = requested
        ? await chooseAgentModel(requested, callerAgent, placedRemote ? placement : undefined, context)
        : undefined;
      if (placedRemote && choice && "runsOn" in choice) {
        throw new Error(`"${requested}" runs only where you are, not ${describePlacement(placement)}.`);
      }
      const runsOn = choice && "runsOn" in choice ? choice.runsOn : childRun(callerAgent);
      // A model other than the caller's is registered before the agent runs on it.
      if (choice && runsOn.model) await host.ensureModel?.(runsOn.model, context);
      const engine = choice && "engine" in choice ? choice.engine : undefined;
      const engineHost = engine ? host.engine?.(engine) : undefined;
      if (engine && !engineHost) throw new Error(`"${requested}" runs on ${engine}, which this host cannot start agents on.`);
      // Only Stella starts an agent on another engine; an agent's agent elsewhere answers to it.
      if (engineHost && !orchestrator) {
        throw new Error(`Only Stella can start an agent on "${requested}". Omit model to run this agent on yours.`);
      }
      const remote = engineHost ?? placedRemote;
      if (remote) {
        const callKey = String(api.taskId);
        const prior = (await api.snapshot(StellaAgentsDoc, api.conversationId, context))?.calls[callKey];
        const started = prior
          ? { threadId: prior.threadId }
          : await remote.start(
              {
                key: `spawn:${callKey}`,
                description,
                prompt: args.prompt,
                ...(requested ? { model: requested } : {}),
                ...(!orchestrator && caller.threadId ? { parentThreadId: caller.threadId } : {}),
              },
              context,
            );
        const threadId = started.threadId;
        await api.commit(async (tx) => {
          const state = await tx.doc(StellaAgentsDoc, api.conversationId);
          if (state.calls[callKey]) return;
          state.agents[threadId] = {
            conversationId: -1,
            description,
            placement: { kind: placement.kind, ...(placement.kind === "device" ? { deviceId: placement.deviceId } : {}) },
            reported: [],
            remote: true,
            ...(engine ? { engine } : {}),
            startedAt: Date.now(),
          };
          state.calls[callKey] = { threadId, reporter: -1 };
        }, context);
        await api.details({ thread_id: threadId }, context);
        const standing =
          placement.kind === "device"
            ? await host.execution?.standing?.(placement.deviceId, context).catch(() => undefined)
            : undefined;
        const where = standing ? { ...placement, label: standing.name } : placement;
        const waitingFor =
          standing?.online && standing.remoteExecution && standing.remoteExecution !== "enabled"
            ? `${describePlacement(where)} is asking the user on its screen to allow work from other devices, so it starts once they allow it there, waiting up to an hour. Tell the user to answer that prompt on ${describePlacement(where)}.`
            : `${describePlacement(where)} can't take it yet (offline, not ready, or waiting for the user to allow work from other devices there), so it starts once it can, waiting up to an hour. Tell the user.`;
        return {
          content: [
            {
              type: "text",
              text: [
                `${prior ? "Already started" : "Started"} ${threadId} (${describePlacement(where)}).`,
                "waiting" in started && started.waiting
                  ? waitingFor
                  : "",
              ]
                .filter(Boolean)
                .join("\n"),
            },
          ],
          details: { thread_id: threadId },
        };
      }
      const startedBy = senderOf(
        caller,
        (await host.directory?.conversationId(context).catch(() => undefined)) ?? STELLA_MESSAGE_TARGET,
      );
      const { threadId, existing } = await api.commit(
        (tx) =>
          createAgent(tx, {
            parentConversationId: api.conversationId,
            callKey: String(api.taskId),
            depth,
            description,
            prompt: args.prompt,
            runsOn,
            placement,
            ...(directory ? { cwd: directory } : {}),
            startedBy,
          }),
        context,
      );
      await api.details({ thread_id: threadId }, context);
      return {
        content: [
          {
            type: "text",
            text: `${existing ? "Already started" : "Started"} ${threadId} (${describePlacement(placement)}).`,
          },
        ],
        details: { thread_id: threadId },
      };
    },
  });

  /**
   * `send_message` to "stella": a note for the orchestrator an agent works
   * for, found up its chain of starters. It goes where the agent's reports
   * go: to this conversation's Stella when they reach it, otherwise to the
   * Stella on the host that started the agent (an agent started here for
   * another host, or placed here by one); once per call, by the call's task id.
   */
  const messageStella = async (api: ToolExecutionApi, message: string, context: Context) => {
    const { self, root, top } = await chainOf(api, context);
    if (self.agentType === "orchestrator" || !self.threadId) {
      throw new Error(`"${STELLA_MESSAGE_TARGET}" is you. Message an agent by its thread_id.`);
    }
    assertMessageSize(message);
    const state = root === undefined ? undefined : await api.snapshot(StellaAgentsDoc, root, context);
    const record = top.threadId ? state?.agents[top.threadId] : undefined;
    const reportsHere =
      record !== undefined &&
      !record.origin &&
      Object.values(state?.calls ?? {}).some((call) => call.threadId === top.threadId && call.reporter >= 0);
    const from = senderOf(self, STELLA_MESSAGE_TARGET);
    const remote = root !== undefined && record !== undefined && !reportsHere && host.directory !== undefined;
    if (root === undefined || (!reportsHere && !remote)) {
      throw new Error(
        "The Stella you work for runs on another host, which send_message cannot reach from here. Put what it needs in your final report.",
      );
    }
    // Stella's own agent: its report goes to the same Stella, so the note
    // waits for its next step, and one sent as its last step is part of its
    // report instead (`settleNotes`): a run reaches Stella once.
    if (self.depth === 1) {
      const note: StellaPendingNote = { callId: api.callId, key: String(api.taskId), message, from, ...(remote ? { remote: true as const } : {}) };
      await api.commit(async (tx) => {
        const role = await tx.doc(StellaAgentDoc, api.conversationId);
        if (!role.notes?.some((known) => known.key === note.key)) role.notes = [...(role.notes ?? []), note];
        return undefined;
      }, context);
      return {
        content: [
          {
            type: "text" as const,
            text: "Queued for Stella: it goes out once you take your next step, or as part of your final report if you finish now, so don't repeat it there.",
          },
        ],
      };
    }
    const sent = await deliverNote(root, { callId: api.callId, key: String(api.taskId), message, from, ...(remote ? { remote: true as const } : {}) }, context, (id) =>
      api.conversation(id, context),
    );
    if (!sent) {
      throw new Error(
        remote
          ? "The Stella you work for runs on another host, which send_message cannot reach from here. Put what it needs in your final report."
          : "Stella is not reachable from here.",
      );
    }
    if (typeof sent === "object") return deliveredResult(sent);
    return {
      content: [
        {
          type: "text" as const,
          text: "Delivered to Stella, which reads it as its next turn. Your final report still goes back on its own.",
        },
      ],
    };
  };

  /**
   * A note to Stella, once per key: to this conversation's Stella (`root`),
   * or, `remote`, to the Stella on the host that started the agent. False
   * when it could not go (nothing reaches that Stella from here).
   */
  const deliverNote = async (
    root: ConversationId,
    note: StellaPendingNote,
    context: Context,
    open?: (id: ConversationId) => Promise<Pick<ConversationHandle, "submit"> | undefined>,
  ): Promise<boolean | AgentMessageDelivery> => {
    if (note.remote) {
      if (!host.directory) return false;
      const delivery = await host.directory.message(
        { key: note.key, to: await host.directory.conversationId(context), text: note.message, from: note.from, remoteStella: true },
        context,
      );
      return delivery ?? false;
    }
    const agentNote: AgentNote = {
      rootConversationId: root,
      threadId: note.from.threadId,
      text: formatAgentMessage(note.from, note.message),
      requestId: `agent-note:${note.key}`,
    };
    if (host.deliverNote) {
      await host.deliverNote(agentNote, context);
      return true;
    }
    const stella = await open?.(root);
    if (!stella) return false;
    // Read by the model, never shown: the user did not write it.
    const hidden: TextContent & { stella: { hidden: true } } = { type: "text", text: agentNote.text, stella: { hidden: true } };
    await stella.submit({ type: "input", content: [hidden], whenBusy: "followUp", requestId: agentNote.requestId }, context);
    return true;
  };

  /** Notes this process already sent on an agent's next step; a repeat is harmless (once per key), only wasted. */
  const notesSent = new Set<string>();

  /**
   * Once an agent's model answers with more tool calls, it went on after its
   * notes to Stella: they go out now.
   */
  const notesHook = hook(GenerationTask, {
    afterResponse: async (message, api, context) => {
      if (message.stopReason !== "toolUse" || !message.content.some((part) => part.type === "toolCall")) return;
      const role = await api.snapshot(StellaAgentDoc, api.conversationId, context);
      if (!role?.notes?.length || role.parentConversationId === undefined) return;
      for (const note of role.notes) {
        if (notesSent.has(note.key)) continue;
        // Without a host delivery here, its run's end sends it.
        if (!note.remote && !host.deliverNote) continue;
        try {
          if (await deliverNote(role.parentConversationId as ConversationId, note, context)) notesSent.add(note.key);
        } catch {
          // Its run's end sends it again.
        }
      }
    },
  });

  /**
   * An agent's run ended: its notes to Stella settle. With `answer` (it
   * finished, and its report goes up now), the ones it sent in its last step
   * are part of that report (`closing`); the rest go out now, once per key.
   * Clears them in `tx`.
   */
  const settleNotes = async (
    tx: Tx,
    agentConversationId: ConversationId,
    answer: EntryId | undefined,
  ): Promise<{ closing: StellaPendingNote[]; send: StellaPendingNote[] }> => {
    const role = await tx.doc(StellaAgentDoc, agentConversationId);
    const notes = (role.notes ?? []).map((note) => ({ ...note, from: { ...note.from } }));
    if (notes.length === 0) return { closing: [], send: [] };
    delete role.notes;
    for (const note of notes) notesSent.delete(note.key);
    const last = answer === undefined ? new Set<string>() : await lastStepCalls(tx, agentConversationId, answer);
    return {
      closing: notes.filter((note) => last.has(note.callId)),
      send: notes.filter((note) => !last.has(note.callId)),
    };
  };

  /** The tool calls of the last step before an answer. */
  const lastStepCalls = async (tx: Tx, conversationId: ConversationId, answer: EntryId): Promise<Set<string>> => {
    let cursor: Parameters<Tx["scanEntries"]>[2];
    for (let pages = 0; pages < 20; pages += 1) {
      const page = await tx.scanEntries({ conversationId, maxEntryId: answer, order: "descending" }, 50, cursor);
      for (const entry of page.items) {
        if (entry.id === answer || entry.kind !== "pi.assistant") continue;
        const calls = ((entry.model?.[0] as AssistantMessage | undefined)?.content ?? []).flatMap((part) =>
          part.type === "toolCall" ? [part.id] : [],
        );
        if (calls.length > 0) return new Set(calls);
      }
      cursor = page.next;
      if (cursor === undefined) break;
    }
    return new Set();
  };

  /** The answer of a run that finished, with what it sent Stella as its last step first. */
  const withClosingNotes = (closing: string[], answer: string): string => [...closing, answer].filter((part) => part.trim()).join("\n\n");

  const sendMessage = defineTool({
    name: "send_message",
    description:
      'Message an agent or Stella session by thread_id, including while it is busy; it reads the message before its next step. To an agent you started, the message is an instruction: steer it, correct it, stop it, or resume it on the same thread after it finished or was stopped. To anyone else (Stella, the agent that started you, teammates, other sessions) it arrives as a note from you, which they weigh against their own work and can answer with send_message. Every message reaches them as from you, with your thread_id, so they can answer. "stella" reaches the Stella you work for, for what cannot wait for your report; your result goes in your final report, not here. A successful result means the message was delivered, not that any work finished; completion still arrives in [Agent completed]. agent_status without a thread_id lists who you can reach.',
    parameters: Type.Object({
      thread_id: Type.String({ description: 'Who to message: a thread_id from agent_status, or "stella".' }),
      message: Type.String({ description: "The message. To your own agent, send only what is new or changed." }),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
      const threadId = args.thread_id.trim();
      const conversation = await host.directory?.conversationId(context).catch(() => undefined);
      if (threadId.toLowerCase() === STELLA_MESSAGE_TARGET || threadId === conversation) {
        return await messageStella(api, args.message, context);
      }
      const known = (await api.snapshot(StellaAgentsDoc, api.conversationId, context))?.agents[threadId];
      if (!known) return await messageOther(api, threadId, args.message, conversation, context);
      const remote = known?.remote ? remoteHostOf(known) : undefined;
      const framed = formatAgentMessage(
        senderOf(await roleOf(api, api.conversationId, context), conversation ?? STELLA_MESSAGE_TARGET),
        args.message,
        { starter: true },
      );
      if (known?.remote) {
        if (!remote) return await messageThroughLedger(api, threadId, args.message, conversation, context);
        const delivery = await remote.message({ key: `message:${api.taskId}`, threadId, message: framed, framed: true }, context);
        await expectRemoteReport(api, api.conversationId, String(api.taskId), threadId, context);
        return deliveredResult(delivery ?? { threadId });
      }
      const running = (await api.snapshot(LiveDoc, known.conversationId as ConversationId, context))?.run !== undefined;
      await api.commit(async (tx) => {
        const state = await tx.doc(StellaAgentsDoc, api.conversationId);
        if (state.calls[String(api.taskId)]) return;
        const agent = state.agents[threadId];
        if (!agent) throw new Error(`No agent ${threadId} here. agent_status lists the ones you started.`);
        const reporter = await tx.createTask(
          Reporter,
          { threadId, conversationId: agent.conversationId, message: framed },
          { ownership: { kind: "conversation" }, background: true },
        );
        state.calls[String(api.taskId)] = { threadId, reporter };
      }, context);
      return deliveredResult({ threadId, outcome: running ? "steered" : "resumed" });
    },
  });

  /** A message given to a remote agent is answered by a report like its start, so it counts until one comes back. */
  const expectRemoteReport = (
    on: { commit: Harness["commit"] },
    conversationId: ConversationId,
    callKey: string,
    threadId: string,
    context: Context,
  ) =>
    on.commit(async (tx) => {
      const state = await tx.doc(StellaAgentsDoc, conversationId);
      state.calls[callKey] ??= { threadId, reporter: -1 };
    }, context);

  /** The host a remote agent runs on as a whole: on a device, that device's own Stella. */
  const remoteHostOf = (agent: AgentRecord): RemoteAgentHost | undefined => {
    if (agent.engine) return host.engine?.(agent.engine);
    const placement = placementOf(agent.placement);
    if (!placement) return undefined;
    return host.remote?.(placement);
  };

  /**
   * The owner's computer a remote agent runs on, as the device list has it
   * now. `seen` keeps one lookup per computer within a call.
   */
  const computerOf = async (
    agent: AgentRecord,
    context: Context,
    seen = new Map<string, Promise<DeviceStanding | undefined>>(),
  ): Promise<DeviceStanding | undefined> => {
    const deviceId = agent.placement.kind === "device" ? agent.placement.deviceId : undefined;
    if (!deviceId || !host.execution?.standing) return undefined;
    let standing = seen.get(deviceId);
    if (!standing) {
      standing = host.execution.standing(deviceId, context).catch(() => undefined);
      seen.set(deviceId, standing);
    }
    return await standing;
  };

  const agentDetails = async (
    api: ToolExecutionApi,
    threadId: string,
    agent: AgentRecord,
    context: Context,
  ): Promise<Record<string, unknown>> => {
    if (agent.remote) return {};
    const conversationId = agent.conversationId as ConversationId;
    const live = await api.snapshot(LiveDoc, conversationId, context);
    const running = live?.tools?.filter((tool) => tool.status === "running").map((tool) => tool.name) ?? [];
    const recent = await api.commit(
      async (tx) => (await tx.scanEntries({ conversationId, order: "descending" }, 20)).items,
      context,
    );
    const message = recent.find((entry) => entry.kind === "pi.assistant")?.model?.[0] as AssistantMessage | undefined;
    const text = textOf(message);
    const call = message?.content.find((part) => part.type === "toolCall");
    return {
      ...(running.length ? { running_tools: running } : {}),
      // A glance at what it is doing, never its result: that comes in its report.
      ...(text ? { latest_message_preview: text.length > LATEST_PREVIEW_CHARS ? `${text.slice(0, LATEST_PREVIEW_CHARS)}…` : text } : {}),
      ...(call && call.type === "toolCall" ? { latest_tool_call: call.name } : {}),
      ...(agent.held?.length ? { held_messages: agent.held.length } : {}),
    };
  };

  /**
   * The caller's role, the orchestrator conversation above it, the agent
   * under the orchestrator its chain goes through (whose record says where
   * reports go), and the agent that started the caller, if one did.
   */
  const chainOf = async (api: Pick<ToolExecutionApi, "snapshot" | "conversationId">, context: Context) => {
    const self = await roleOf(api, api.conversationId, context);
    if (self.agentType === "orchestrator") return { self, root: api.conversationId as ConversationId | undefined, top: self };
    let top = self;
    let parentThreadId: string | undefined;
    let root = self.parentConversationId as ConversationId | undefined;
    while (root !== undefined) {
      const parent = await roleOf(api, root, context);
      if (parent.agentType === "orchestrator") break;
      if (top === self) parentThreadId = parent.threadId;
      top = parent;
      root = parent.parentConversationId as ConversationId | undefined;
    }
    // Run here for an agent on another host (placed here, or moved here): that agent started it.
    if (parentThreadId === undefined && self.depth > 1) parentThreadId = self.startedBy?.threadId;
    return { self, root, top, ...(parentThreadId ? { parentThreadId } : {}) };
  };

  /** Every agent under the orchestrator, with the conversation that started it. */
  const agentTree = async (reader: Pick<ToolExecutionApi, "snapshot">, root: ConversationId, context: Context): Promise<TreeAgent[]> => {
    const found: TreeAgent[] = [];
    const visit = async (conversationId: ConversationId, parentThreadId: string | undefined, depth: number) => {
      const state = await reader.snapshot(StellaAgentsDoc, conversationId, context);
      const calls = Object.values(state?.calls ?? {});
      for (const [threadId, record] of Object.entries(state?.agents ?? {})) {
        const given = calls.filter((call) => call.threadId === threadId);
        found.push({
          threadId,
          record,
          parentConversationId: conversationId,
          ...(parentThreadId ? { parentThreadId } : {}),
          given: given.length,
          reports: given.some((call) => call.reporter >= 0),
        });
        if (!record.remote && depth < MAX_AGENT_DEPTH) await visit(record.conversationId as ConversationId, threadId, depth + 1);
      }
    };
    await visit(root, undefined, 1);
    return found;
  };

  /**
   * An agent under the orchestrator as `agent_status` lists it. A whole agent
   * elsewhere is listed as the owner's agent threads (`ledger`) know it, the
   * place it runs on and whether that is online; one here says so.
   */
  const directoryRow = async (
    api: ToolExecutionApi,
    agent: TreeAgent,
    conversationId: string,
    context: Context,
    ledger?: readonly AgentDirectoryAgentRow[],
    seen?: Map<string, Promise<DeviceStanding | undefined>>,
  ): Promise<AgentDirectoryAgentRow> => {
    const { record } = agent;
    const placed = describePlacement(placementOf(record.placement) ?? host.rootPlacement);
    const row = {
      threadId: agent.threadId,
      conversationId,
      ...(agent.parentThreadId ? { parentThreadId: agent.parentThreadId } : {}),
      description: record.description,
    };
    if (record.remote) {
      const there = ledger?.find((entry) => entry.threadId === agent.threadId);
      if (there) {
        return {
          ...row,
          status: there.status,
          where: there.where,
          updatedAt: there.updatedAt,
          ...(there.offline ? { offline: there.offline } : {}),
          ...(there.awaitingConsent ? { awaitingConsent: true as const } : {}),
        };
      }
      const computer = await computerOf(record, context, seen);
      const done = (record.answered?.length ?? 0) >= agent.given;
      const status = done ? remoteOutcome(record) : "running";
      return {
        ...row,
        status,
        where: computer?.name ?? placed,
        updatedAt: record.startedAt ?? Date.now(),
        ...(computer && !computer.online && isLiveAgentStatus(status)
          ? { offline: computer.lastSeenAt !== undefined ? { lastSeenAt: computer.lastSeenAt } : {} }
          : {}),
        ...(computer?.online && computer.remoteExecution && computer.remoteExecution !== "enabled" && isLiveAgentStatus(status)
          ? { awaitingConsent: true as const }
          : {}),
      };
    }
    const located = { ...row, where: describePlacement(host.rootPlacement) };
    const id = record.conversationId as ConversationId;
    const live = await api.snapshot(LiveDoc, id, context);
    const recent = await api.commit(async (tx) => (await tx.scanEntries({ conversationId: id, order: "descending" }, 10)).items, context);
    const latest = recent.find((entry) => entry.kind === "pi.assistant")?.model?.[0] as AssistantMessage | undefined;
    const at = (recent[0]?.model?.[0] as { timestamp?: number } | undefined)?.timestamp;
    const stopped = live?.run === undefined && (wasStopped(record) || stoppedShort(recent));
    // Idle while agents it started still work: it is not done.
    const waiting = live?.run === undefined && !stopped && (await agentsBusy(busyReader(api, context), id).catch(() => false));
    return {
      ...located,
      status:
        live?.run !== undefined || waiting
          ? "running"
          : stopped
            ? "canceled"
            : latest?.stopReason === "error"
              ? "failed"
              : "completed",
      updatedAt: at ?? latest?.timestamp ?? Date.now(),
    };
  };

  /** `agent_status` without a thread_id: everyone the caller can reach. */
  const directoryStatus = async (api: ToolExecutionApi, context: Context) => {
    const { self, root, parentThreadId } = await chainOf(api, context);
    const conversationId = (await host.directory?.conversationId(context).catch(() => undefined)) ?? STELLA_MESSAGE_TARGET;
    const elsewhere = await host.directory?.list(context).catch((error: unknown) => ({
      agents: [],
      sessions: [],
      unavailable: `Agents and sessions elsewhere could not be listed right now (${error instanceof Error ? error.message : String(error)}).`,
    }));
    const rows: AgentDirectoryAgentRow[] = [];
    const seen = new Map<string, Promise<DeviceStanding | undefined>>();
    for (const agent of root === undefined ? [] : await agentTree(api, root, context)) {
      rows.push(await directoryRow(api, agent, conversationId, context, elsewhere?.agents, seen));
    }
    const known = new Set(rows.map((row) => row.threadId));
    const listing = buildAgentDirectoryResult({
      caller: {
        conversationId,
        ...(self.threadId ? { threadId: self.threadId } : {}),
        ...(parentThreadId ? { parentThreadId } : {}),
      },
      // An agent this harness holds is listed as it knows it.
      agents: [...rows, ...(elsewhere?.agents ?? []).filter((row) => !known.has(row.threadId)).map((row) => ({ ...row, conversationId }))],
      sessions: elsewhere?.sessions ?? [],
      ...(elsewhere?.unavailable ? { unavailable: elsewhere.unavailable } : {}),
    });
    return { content: [{ type: "text" as const, text: listing }] };
  };

  /**
   * `send_message` to anyone the caller did not start: a note it weighs and
   * can answer, never an instruction. An agent under this orchestrator takes
   * it the way its starter's messages arrive (a reporter in the starter's
   * conversation carries it), so it steers a running agent or resumes an
   * idle one, and its report still goes to whoever started it. Anyone else
   * (another session, an agent this harness does not hold, or one that
   * answers another host) is the host's to reach. Once per call.
   */
  const messageOther = async (
    api: ToolExecutionApi,
    threadId: string,
    message: string,
    conversation: string | undefined,
    context: Context,
  ) => {
    assertMessageSize(message);
    const { self, root } = await chainOf(api, context);
    if (
      threadId === self.threadId ||
      (self.threadId && isPlacementThreadId(threadId) && placementRemoteThreadAgentId(self.threadId) === threadId)
    ) {
      throw new Error("That thread_id is you. Message another agent or session.");
    }
    const from = senderOf(self, conversation ?? STELLA_MESSAGE_TARGET);
    const target = root === undefined ? undefined : (await agentTree(api, root, context)).find((agent) => agent.threadId === threadId);
    if (target && !target.record.origin && (target.reports || target.record.remote)) {
      const text = formatAgentMessage(from, message);
      const key = `note:${api.taskId}`;
      if (target.record.remote) {
        const remote = remoteHostOf(target.record);
        if (!remote) return await messageThroughLedger(api, threadId, message, conversation, context);
        const delivery = await remote.message({ key, threadId, message: text, framed: true }, context);
        await expectRemoteReport(api, target.parentConversationId, key, threadId, context);
        return deliveredResult(delivery ?? { threadId });
      }
      const agentConversationId = target.record.conversationId as ConversationId;
      const running = (await api.snapshot(LiveDoc, agentConversationId, context))?.run !== undefined;
      await api.commit(async (tx) => {
        const state = await tx.doc(StellaAgentsDoc, target.parentConversationId);
        if (state.calls[key]) return;
        const reporter = await tx.createTask(
          Reporter,
          {
            threadId,
            conversationId: agentConversationId,
            message: text,
            note: true,
          },
          { ownership: { kind: "conversation" }, background: true, conversationId: target.parentConversationId },
        );
        state.calls[key] = { threadId, reporter };
      }, context);
      return deliveredResult({
        threadId,
        outcome: running ? "steered" : "resumed",
      });
    }
    const delivery = await host.directory?.message({ key: String(api.taskId), to: threadId, text: message, from }, context);
    if (delivery) return deliveredResult(delivery);
    throw new Error(`No agent or Stella session has thread_id ${threadId}. agent_status without a thread_id lists who you can reach.`);
  };

  const messageThroughLedger = async (
    api: ToolExecutionApi,
    threadId: string,
    message: string,
    conversation: string | undefined,
    context: Context,
  ) => {
    assertMessageSize(message);
    const { self } = await chainOf(api, context);
    const from = senderOf(self, conversation ?? STELLA_MESSAGE_TARGET);
    const delivery = await host.directory?.message({ key: String(api.taskId), to: threadId, text: message, from }, context);
    if (delivery) return deliveredResult(delivery);
    throw new Error(`${threadId} runs where this conversation cannot reach it now.`);
  };

  const agentStatus = defineTool({
    name: "agent_status",
    description:
      "Without thread_id: list who you can reach, one line each (thread_id · status · where, when not this computer · last active — description): subagents you started, your teammates (Stella and the other agents in this conversation), other Stella sessions on this computer, and the user's cloud sessions. With thread_id: that agent's status, where it runs, who started it, its relation to you, a short preview of its latest message (not its result), and its latest tool call. Never call it repeatedly to wait for an agent: its full report arrives on its own in [Agent completed]. send_message reaches anyone listed: to an agent you started it is an instruction that steers it while it runs or resumes it once stopped, and its report comes back to you; to anyone else it is a note they weigh, and a report still goes to whoever started them. stop_agent stops an agent and every agent it started, wherever they run; a later message resumes it. reachable: false means neither reaches that agent from here. Read-only: it never interrupts or messages anyone.",
    parameters: Type.Object({
      thread_id: Type.Optional(Type.String({ description: "The agent to inspect. Omit it to list everyone you can reach." })),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
      const threadId = args.thread_id?.trim();
      if (!threadId) return await directoryStatus(api, context);
      const { self, root, parentThreadId } = await chainOf(api, context);
      const conversation = await host.directory?.conversationId(context).catch(() => undefined);
      const conversationId = conversation ?? STELLA_MESSAGE_TARGET;
      if (root !== undefined && (threadId.toLowerCase() === STELLA_MESSAGE_TARGET || threadId === conversation)) {
        const running = (await api.snapshot(LiveDoc, root, context))?.run !== undefined;
        return statusResult({
          thread_id: conversationId,
          description: "Stella for this conversation",
          status: running ? "running" : "idle",
          relation: "stella",
        });
      }
      const ownState = await api.snapshot(StellaAgentsDoc, api.conversationId, context);
      const tree = root === undefined ? [] : await agentTree(api, root, context);
      const own = ownState?.agents[threadId];
      const found: TreeAgent | undefined =
        tree.find((agent) => agent.threadId === threadId) ??
        (own
          ? {
              threadId,
              record: own,
              parentConversationId: api.conversationId,
              ...(self.threadId ? { parentThreadId: self.threadId } : {}),
              given: Object.values(ownState?.calls ?? {}).filter((call) => call.threadId === threadId).length,
              reports: true,
            }
          : undefined);
      if (found) {
        const ledger = found.record.remote ? (await host.directory?.list(context).catch(() => undefined))?.agents : undefined;
        const row = await directoryRow(api, found, conversationId, context, ledger);
        const reachable = !found.record.remote || remoteHostOf(found.record) !== undefined || host.directory !== undefined;
        const entry = agentDirectoryEntry(row);
        const mine = found.parentConversationId === api.conversationId;
        return statusResult({
          ...entry,
          relation: mine ? "you started it" : relationOf(row, self, parentThreadId),
          // Models waited in place (a sleep, then this again); say plainly that
          // its report comes on its own.
          ...(mine && entry.status === "running" ? { note: RUNNING_STATUS_NOTE } : {}),
          ...(reachable ? {} : { reachable: false }),
          ...(await agentDetails(api, threadId, found.record, context)),
        });
      }
      const elsewhere = await host.directory?.list(context).catch(() => undefined);
      const session = elsewhere?.sessions.find((row) => row.conversationId === threadId);
      if (session) {
        return statusResult(sessionDirectoryEntry(session));
      }
      const agent = elsewhere?.agents.find((row) => row.threadId === threadId);
      if (agent) {
        return statusResult({
          ...agentDirectoryEntry(agent),
          relation: relationOf(agent, self, parentThreadId),
        });
      }
      throw new Error(`Thread not found: ${threadId}. agent_status without a thread_id lists who you can reach.`);
    },
  });

  /**
   * Stop an agent this harness holds and every agent below it, deepest
   * first so none of them reports to one already stopped: each local run is
   * aborted and recorded stopped, and each agent that runs elsewhere is
   * stopped where it runs (which stops its own agents there). Nothing is
   * deleted; a message resumes each.
   */
  const stopSubtree = async (
    store: Pick<ToolExecutionApi, "snapshot" | "conversation"> & { commit<T>(change: (tx: Tx) => Promise<T>, context: Context): Promise<T> },
    target: TreeAgent,
    rootConversationId: ConversationId,
    context: Context,
  ): Promise<{ local: string[]; elsewhere: AgentStopResult[] }> => {
    const below = target.record.remote ? [] : await agentTree(store, target.record.conversationId as ConversationId, context);
    const local: string[] = [];
    const elsewhere: AgentStopResult[] = [];
    for (const agent of [...below.reverse(), target]) {
      const { record } = agent;
      if (record.remote) {
        const stop = remoteHostOf(record)?.stop;
        const result = stop
          ? await stop(agent.threadId, context).catch(() => undefined)
          : await host.directory?.stop?.({ key: `stop:${agent.threadId}:${Date.now()}`, threadId: agent.threadId }, context).catch(() => undefined);
        if (result) elsewhere.push(result);
        continue;
      }
      const id = record.conversationId as ConversationId;
      const waiting =
        (await store.snapshot(LiveDoc, id, context))?.run === undefined &&
        (await agentsBusy(busyReader(store, context), id).catch(() => false));
      await markStopped(store, agent.parentConversationId, agent.threadId, context);
      await (await store.conversation(id, context))?.abort(context);
      local.push(agent.threadId);
      // Idle while agents it started worked, its attempt was still open: it ends stopped.
      if (waiting && agent.parentConversationId === rootConversationId) {
        await host.agentStopped?.({ threadId: agent.threadId, description: record.description }, context);
      }
    }
    return { local, elsewhere };
  };

  const stopAgent = defineTool({
    name: "stop_agent",
    description:
      "Stop an agent by thread_id: its current run and the runs of every agent it started, at any depth, end at once, wherever they run (this computer, another computer, or the cloud). Nothing is deleted: each keeps its history, and a later send_message resumes it. This is for an agent that is stuck or does not respond. To have an agent stop normally, send_message it: it reads the message before its next step, stops itself, and tells the agents it started.",
    parameters: Type.Object({
      thread_id: Type.String({ description: "Thread id of the agent to stop." }),
    }),
    replay: "safe",
    execute: async (args, api, context) => {
      const threadId = args.thread_id.trim();
      const { self, root } = await chainOf(api, context);
      const stella = self.agentType === "orchestrator" || self.parentConversationId === undefined;
      if (!stella && threadId === self.threadId) throw new Error("That thread_id is you. To stop, end your turn.");
      // Stella reaches every agent in her conversation; an agent only those it started, at any depth.
      const scope = stella ? root : (api.conversationId as ConversationId);
      const target = scope === undefined ? undefined : (await agentTree(api, scope, context)).find((agent) => agent.threadId === threadId);
      if (target) {
        const { elsewhere } = await stopSubtree(api, target, root ?? (api.conversationId as ConversationId), context);
        const there = elsewhere.find((result) => result.threadId === threadId);
        if (there) return { content: [{ type: "text", text: agentStopText(there) }] };
        const others = elsewhere.flatMap((result) => [result, ...(result.descendants ?? [])]).filter((result) => result.outcome !== "not_running");
        return {
          content: [
            {
              type: "text",
              text: `Stopped ${threadId}${others.length ? ` and, elsewhere, ${others.map((result) => `${result.threadId} (${result.where})`).join(", ")}` : ""}. Each keeps its history; send_message resumes it.`,
            },
          ],
        };
      }
      // Started by another host, or out of this one's reach: the owner's
      // agent threads stop it, and its agents, where they run.
      const stopped = await host.directory?.stop?.(
        { key: String(api.taskId), threadId, ...(stella || !self.threadId ? {} : { requesterThreadId: self.threadId }) },
        context,
      );
      if (stopped) return { content: [{ type: "text", text: agentStopText(stopped) }] };
      throw new Error(
        stella
          ? `No agent ${threadId} here. agent_status without a thread_id lists who you can reach.`
          : `${threadId} is not an agent you started. You can stop only agents you started, at any depth.`,
      );
    },
  });

  /**
   * Start an agent the host asked for rather than a tool call (an app-source
   * merge, memory sync, an agent thread another host started): under the
   * orchestrator, at the depth its lineage gives (1 without one), reporting
   * to it like a spawned agent. Once per `key`.
   */
  const startAgent = async (
    harness: Harness,
    args: {
      key: string;
      description: string;
      prompt: string;
      /** The thread id another host chose for it. */
      threadId?: string;
      /** Started for another host's orchestrator, which gets its reports. */
      origin?: AgentOrigin;
      /** The model it runs on, when that host chose it rather than this orchestrator's own. */
      model?: ModelRef;
      /** The thinking level that host admitted it for, with `model`. */
      thinkingLevel?: ModelThinkingLevel;
      /** It may have run elsewhere before (it moved here): its first run takes its log first. */
      catchUp?: boolean;
      /** Where it sits among Stella's agents; absent, it is one of Stella's own. */
      lineage?: AgentLineage;
    },
    context: Context,
  ): Promise<{ threadId: string; existing: boolean }> => {
    const root = await harness.root(context);
    const runsOn: RunsOn = args.model
      ? { model: args.model, ...(args.thinkingLevel ? { thinkingLevel: args.thinkingLevel } : {}) }
      : childRun(await root.agent(context));
    if (args.model) await host.ensureModel?.(args.model, context);
    return await harness.commit(async (tx) => {
      const created = await createAgent(tx, {
        parentConversationId: root.id,
        callKey: `host:${args.key}`,
        depth: args.lineage?.depth ?? 1,
        ...(args.lineage?.startedBy ? { startedBy: args.lineage.startedBy } : {}),
        description: args.description.trim() || "agent",
        prompt: args.prompt,
        runsOn,
        placement: host.rootPlacement,
        ...(args.threadId ? { threadId: args.threadId } : {}),
        ...(args.origin ? { origin: args.origin } : {}),
      });
      if (args.catchUp && !created.existing) {
        const record = (await tx.doc(StellaAgentsDoc, root.id)).agents[created.threadId];
        if (record) record.catchUp = true;
      }
      return created;
    }, context);
  };

  /** One of the orchestrator's agents that may have run elsewhere since: its next run takes its log first. */
  const markCatchUp = async (harness: Harness, threadId: string, context: Context): Promise<void> => {
    const root = await harness.root(context);
    await harness.commit(async (tx) => {
      const record = (await tx.doc(StellaAgentsDoc, root.id)).agents[threadId];
      if (!record) return undefined;
      record.catchUp = true;
      // It moved away and came back: it runs here again.
      if (record.moved) {
        delete record.moved;
        delete record.away;
        runsHereAgain(record);
      }
      return undefined;
    }, context);
  };

  /** One of the orchestrator's agents at any depth, with the conversation that started it. */
  const treeAgent = async (harness: Harness, threadId: string, context: Context): Promise<TreeAgent | undefined> =>
    (await agentTree(harness, (await harness.root(context)).id, context)).find((agent) => agent.threadId === threadId);

  /**
   * Stop one of the orchestrator's agents, or one of theirs, and every agent
   * below it, by thread id (for the host that started it, or a stop from
   * another host). Undefined when no agent here has that id.
   */
  const stopAgentByThread = async (harness: Harness, threadId: string, context: Context): Promise<{ local: string[]; elsewhere: AgentStopResult[] } | undefined> => {
    const found = await treeAgent(harness, threadId, context);
    if (!found) return undefined;
    return await stopSubtree(harness, found, (await harness.root(context)).id, context);
  };

  /**
   * Where one of the orchestrator's agents, or one of theirs, stands: its
   * status as `agentRecords` reads it and its attempt, the messages its
   * starter has given it. Undefined when no agent here has that id.
   */
  const agentStanding = async (
    harness: Harness,
    threadId: string,
    context: Context,
  ): Promise<
    | { status: StellaAgentRecord["status"]; stopped?: true; agentStatus: AgentStatus; attempt: number }
    | undefined
  > => {
    const found = await treeAgent(harness, threadId, context);
    if (!found) return undefined;
    const attempt = Math.max(1, found.given);
    if (found.record.remote) {
      const done = (found.record.answered?.length ?? 0) >= found.given;
      const outcome = remoteOutcome(found.record);
      return done
        ? { status: outcome === "failed" ? "error" : "completed", agentStatus: outcome, attempt }
        : { status: "running", agentStatus: "running", attempt };
    }
    const conversationId = found.record.conversationId as ConversationId;
    const [live, recent] = await Promise.all([
      harness.snapshot(LiveDoc, conversationId, context),
      harness.commit(async (tx) => (await tx.scanEntries({ conversationId, order: "descending" }, 40)).items, context),
    ]);
    const latest = recent.find((entry) => entry.kind === "pi.assistant")?.model?.[0] as AssistantMessage | undefined;
    const idleStopped = live?.run === undefined && (wasStopped(found.record) || stoppedShort(recent));
    // Idle while agents it started still work: it is not done.
    const running =
      live?.run !== undefined ||
      (!idleStopped && (await agentsBusy(busyReader(harness, context), conversationId).catch(() => false)));
    const stopped = !running && idleStopped;
    return {
      status: running ? "running" : latest?.stopReason === "error" ? "error" : "completed",
      ...(stopped ? { stopped: true as const } : {}),
      agentStatus: running ? "running" : stopped ? "canceled" : latest?.stopReason === "error" ? "failed" : "completed",
      attempt,
    };
  };

  /**
   * The orchestrator's agents as the app lists them: each one's status,
   * description, start and latest activity, and its latest prose.
   */
  const agentRecords = async (harness: Harness, context: Context): Promise<StellaAgentRecord[]> => {
    const root = await harness.root(context);
    const state = await harness.snapshot(StellaAgentsDoc, root.id, context);
    const records: StellaAgentRecord[] = [];
    // An agent that runs elsewhere is done once a report came back for each
    // message it was given; what it said is what its reports carried.
    const remoteAgents = Object.entries(state?.agents ?? {}).filter(([, agent]) => agent.remote);
    const reports =
      remoteAgents.length === 0
        ? []
        : (await harness.commit(async (tx) => (await tx.scanEntries({ conversationId: root.id, order: "descending" }, 300)).items, context))
            .filter((entry) => entry.kind === "pi.user")
            .map((entry) => ({ entry, text: messageText(entry.model?.[0]) }))
            .filter(({ text }) => /^\[(Agent completed|Task failed|Task canceled)\]/.test(text.trimStart()));
    for (const [threadId, agent] of remoteAgents) {
      const given = Object.values(state?.calls ?? {}).filter((call) => call.threadId === threadId).length;
      // Newest first, as scanned.
      const back = reports.filter(({ text }) => text.includes(`\nthread_id: ${threadId}\n`));
      const at = (back[0]?.entry.model?.[0] as { timestamp?: number } | undefined)?.timestamp;
      const said = back
        .map(({ text }) => /\n(?:result|error): ([\s\S]*?)(?=\n(?:agent_state|routing|presentation): |$)/.exec(text)?.[1]?.trim() ?? "")
        .filter((text) => text && text !== "(no reply)")
        .reverse()
        .slice(-5);
      records.push({
        threadId,
        description: agent.description,
        placement: agent.placement,
        ...((agent.answered?.length ?? 0) >= given
          ? (() => {
              const outcome = remoteOutcome(agent);
              return outcome === "completed"
                ? { status: "completed" as const, agentStatus: outcome }
                : outcome === "failed"
                  ? { status: "error" as const, agentStatus: outcome }
                  : { status: "completed" as const, stopped: true as const, agentStatus: outcome };
            })()
          : { status: "running" as const, agentStatus: "running" as const }),
        startedAt: agent.startedAt ?? at ?? Date.now(),
        updatedAt: at ?? agent.startedAt ?? Date.now(),
        assistantMessages: said,
      });
    }
    for (const [threadId, agent] of Object.entries(state?.agents ?? {})) {
      if (agent.remote) continue;
      const conversationId = agent.conversationId as ConversationId;
      const [live, [first, recent]] = await Promise.all([
        harness.snapshot(LiveDoc, conversationId, context),
        harness.commit(
          async (tx) =>
            [
              (await tx.scanEntries({ conversationId, order: "ascending" }, 1)).items[0],
              (await tx.scanEntries({ conversationId, order: "descending" }, 40)).items,
            ] as const,
          context,
        ),
      ]);
      const answers = recent
        .filter((entry) => entry.kind === "pi.assistant")
        .map((entry) => entry.model?.[0] as AssistantMessage | undefined)
        .filter((message): message is AssistantMessage => message !== undefined);
      const latest = answers[0];
      const prose = answers.map(textOf).filter((text) => text.trim()).reverse().slice(-5);
      const oldest = first?.model?.[0] as { timestamp?: number } | undefined;
      const idleStopped = live?.run === undefined && (wasStopped(agent) || stoppedShort(recent));
      // Idle while agents it started still work: it is not done.
      const running =
        live?.run !== undefined ||
        (!idleStopped && (await agentsBusy(busyReader(harness, context), conversationId).catch(() => false)));
      const stopped = !running && idleStopped;
      records.push({
        threadId,
        description: agent.description,
        placement: agent.placement,
        status: running ? "running" : latest?.stopReason === "error" ? "error" : "completed",
        startedAt: oldest?.timestamp ?? latest?.timestamp ?? Date.now(),
        updatedAt: latest?.timestamp ?? oldest?.timestamp ?? Date.now(),
        assistantMessages: prose,
        ...(latest?.stopReason === "error" && latest.errorMessage ? { error: latest.errorMessage } : {}),
        ...(stopped ? { stopped: true as const } : {}),
        agentStatus: running
          ? "running"
          : stopped
            ? "canceled"
            : latest?.stopReason === "error"
              ? "failed"
              : "completed",
      });
    }
    return records;
  };

  /**
   * A message from the user to one of the orchestrator's agents, carried
   * like `send_message`: a reporter delivers it and reports the answer up.
   * Once per `key`.
   */
  const messageAgent = async (
    harness: Harness,
    args: {
      key: string;
      threadId: string;
      message: string;
      /** The orchestrator that started it wrote this, not the user in its thread. */
      fromOrchestrator?: boolean;
      /** The report of an agent it started, which wakes it. */
      report?: true;
    },
    context: Context,
  ): Promise<void> => {
    const root = await harness.root(context);
    const known = (await harness.snapshot(StellaAgentsDoc, root.id, context))?.agents[args.threadId];
    if (known?.remote) {
      const remote = remoteHostOf(known);
      if (!remote) throw new Error(`${args.threadId} runs where this conversation cannot reach it now.`);
      await remote.message(
        {
          key: `user:${args.key}`,
          threadId: args.threadId,
          message: args.message,
          ...(args.fromOrchestrator && isFramedAgentMessage(args.message) ? { framed: true } : {}),
        },
        context,
      );
      await expectRemoteReport(harness, root.id, `user:${args.key}`, args.threadId, context);
      return;
    }
    // An agent's own agent takes it as its starter's messages arrive, and reports to that agent.
    const home = known ? root.id : (await treeAgent(harness, args.threadId, context))?.parentConversationId;
    if (home === undefined) throw new Error(`No agent ${args.threadId} here.`);
    await harness.commit(async (tx) => {
      const state = await tx.doc(StellaAgentsDoc, home);
      const callKey = `user:${args.key}`;
      if (state.calls[callKey]) return undefined;
      const agent = state.agents[args.threadId];
      if (!agent) throw new Error(`No agent ${args.threadId} here.`);
      const reporter = await tx.createTask(
        Reporter,
        {
          threadId: args.threadId,
          conversationId: agent.conversationId,
          message: args.message,
          ...(args.fromOrchestrator ? {} : { fromUser: true as const }),
          ...(args.report ? { report: true as const } : {}),
        },
        { ownership: { kind: "conversation" }, background: true, conversationId: home },
      );
      state.calls[callKey] = { threadId: args.threadId, reporter };
      return undefined;
    }, context);
  };

  /**
   * Run an agent another host placed here (a cloud orchestrator's agent on
   * this computer): under the orchestrator, at the depth its lineage gives
   * (1 without one), answering its brief to the host that placed it rather
   * than reporting here. Once per `key`;
   * settles with its answer.
   */
  /**
   * What an agent did elsewhere since it last ran here, from its log, into
   * its conversation here; a few tries, and then it does not run without
   * its memory.
   */
  const catchUpFromLog = async (agentConversationId: ConversationId, threadId: string, context: Context): Promise<{ cwd?: string }> => {
    const agentLog = host.agentLog;
    if (!agentLog) return {};
    let failure: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
      try {
        return await agentLog.importInto(agentConversationId, threadId, context);
      } catch (error) {
        failure = error;
      }
    }
    throw new Error(
      `Its conversation couldn't be read from Stella's cloud (${failure instanceof Error ? failure.message : String(failure)}), so it did not run without its memory. Message it again to retry.`,
    );
  };

  const runPlacedAgent = async (harness: Harness, args: PlacedAgentRun, context: Context): Promise<PlacedAgentResult> => {
    const root = await harness.root(context);
    const runsOn = args.runsOn?.model ? args.runsOn : childRun(await root.agent(context));
    if (args.runsOn?.model) await host.ensureModel?.(args.runsOn.model, context);
    const { threadId } = await harness.commit(
      (tx) =>
        createAgent(tx, {
          parentConversationId: root.id,
          callKey: `${PLACED_CALL_PREFIX}${args.agentKey}`,
          depth: args.lineage?.depth ?? 1,
          ...(args.lineage?.startedBy ? { startedBy: args.lineage.startedBy } : {}),
          description: args.description.trim() || "agent",
          prompt: args.prompt,
          runsOn,
          placement: host.rootPlacement,
          detached: true,
          ...(args.threadId ? { threadId: args.threadId, adoptAs: args.agentKey } : {}),
        }),
      context,
    );
    const record = (await harness.snapshot(StellaAgentsDoc, root.id, context))?.agents[threadId];
    const agent = record ? await harness.conversation(record.conversationId as ConversationId, context) : undefined;
    if (!agent) return { threadId, status: "error", error: "The agent could not start here." };
    if (args.signal?.aborted) return stoppedPlacedRun(threadId, args.signal);
    // Whatever it did elsewhere since it last ran here (all of it, for an
    // agent that moved here) comes first, from its log.
    if (host.agentLog) {
      let imported: { cwd?: string };
      try {
        imported = await catchUpFromLog(agent.id, threadId, context);
      } catch (error) {
        return { threadId, status: "error", error: error instanceof Error ? error.message : String(error) };
      }
      const cwd = imported.cwd;
      const own = await harness.snapshot(AgentDoc, agent.id, context);
      if (cwd && cwd !== own?.cwd && !(await host.directoryProblem?.(cwd).catch(() => "unreadable"))) {
        await harness.commit(async (tx) => {
          await configure(tx, agent.id, { cwd });
          return undefined;
        }, context);
      }
    }
    const carried = await harness.commit(async (tx) => {
      const current = (await tx.doc(StellaAgentsDoc, root.id)).agents[threadId];
      if (!current) return [];
      delete current.away;
      if (current.carried?.runKey === args.runKey) return [...current.carried.messages];
      const messages = [...(current.held ?? [])];
      delete current.held;
      current.carried = { runKey: args.runKey, messages };
      return messages;
    }, context);
    // Its notes to Stella settle once a run ends: the ones it sent as the
    // last step of a run that finished are part of its answer, unless agents
    // it started still work: that answer is not reported, so they go out now.
    const settle = async (answer?: EntryId): Promise<string[]> => {
      const waiting = answer !== undefined && (await agentsBusy(busyReader(harness, context), agent.id).catch(() => false));
      const notes = await harness.commit((tx) => settleNotes(tx, agent.id, waiting ? undefined : answer), context);
      for (const note of notes.send) {
        await deliverNote(root.id, note, context, (id) => harness.conversation(id, context)).catch(() => false);
      }
      return notes.closing.map((note) => note.message);
    };
    let content = [...carried, args.prompt].join("\n\n");
    let requestId = `placed:${args.runKey}`;
    for (let retry = 1; ; retry += 1) {
      const submission = await agent.submit({ type: "input", content, whenBusy: "steer", requestId }, context);
      const stop = async () => {
        const withdrawn = await harness.abortSubmission(submission.id, context, agent.id);
        if (withdrawn === "already_placed") await agent.abort(context);
      };
      const onAbort = () => void stop().catch(() => undefined);
      args.signal?.addEventListener("abort", onAbort, { once: true });
      if (args.signal?.aborted) await stop();
      let settled: Awaited<ReturnType<typeof submission.wait>>;
      try {
        settled = await submission.wait(context);
      } finally {
        args.signal?.removeEventListener("abort", onAbort);
        host.agentLog?.kick(agent.id);
      }
      const stopped = args.signal?.aborted === true || (settled.status === "unanswered" && settled.reason === "aborted");
      const rewake =
        retry === 1 ? await keepWithdrawn(harness, root.id, threadId, args.runKey, settled, [...carried, args.prompt], stopped, context) : [];
      if (stopped) {
        await dropMove(harness, agent.id, context);
        await settle();
        // The reports of its agents a stop withdrew before it read them wake
        // it again, through the host that placed it, once that stop is done.
        const unsent: string[] = [];
        for (const report of rewake) {
          const from = parseAgentReportId(report.key)?.threadId;
          const sent =
            from && args.threadId && report.message.trim().length <= AGENT_MESSAGE_MAX_CHARS
              ? await host.directory
                  ?.message({ key: `rewake:${report.key}`, to: args.threadId, text: report.message, from: { threadId: from, label: "An agent you started" } }, context)
                  .catch(() => undefined)
              : undefined;
          if (!sent) unsent.push(report.message);
        }
        // One that cannot go that way goes with its next message.
        if (unsent.length > 0) {
          await harness.commit(async (tx) => {
            const current = (await tx.doc(StellaAgentsDoc, root.id)).agents[threadId];
            if (current) current.held = [...(current.held ?? []), ...unsent];
            return undefined;
          }, context);
        }
        return args.signal?.aborted
          ? stoppedPlacedRun(threadId, args.signal)
          : { threadId, status: "canceled", error: AGENT_STOPPED_REASON, stopped: true };
      }
      if (settled.status !== "done" || settled.type !== "input") {
        await settle();
        return { threadId, status: "error", error: settled.status === "unanswered" ? settled.reason : "The agent did not answer." };
      }
      const move = await takeMove(harness, agent.id, context);
      if (move) await settle();
      if (move && "moved" in move) {
        await harness.commit(async (tx) => {
          const current = (await tx.doc(StellaAgentsDoc, root.id)).agents[threadId];
          if (current) {
            current.moved = true;
            current.away = true;
          }
          return undefined;
        }, context);
        return { threadId, status: "moved", where: move.moved };
      }
      if (move && "failed" in move) {
        content = moveFailedText(move.failed);
        requestId = `placed:${args.runKey}:stayed:${retry}`;
        continue;
      }
      const answer = await harness.commit(async (tx) => tx.entry(AssistantEntry, settled.answer), context);
      const message = answer?.model?.[0] as AssistantMessage | undefined;
      if (message?.stopReason === "error") {
        await settle();
        return { threadId, status: "error", error: message.errorMessage ?? "The agent failed." };
      }
      return { threadId, status: "ok", finalText: withClosingNotes(await settle(settled.answer), textOf(message)) };
    }
  };

  const keepWithdrawn = async (
    harness: Harness,
    rootId: ConversationId,
    threadId: string,
    runKey: string,
    settled: { status: string; reason?: string; entry?: EntryId },
    given: string[],
    stopped: boolean,
    context: Context,
  ): Promise<Array<{ key: string; message: string }>> => {
    const unread = (record: { status: string; reason?: string; entry?: EntryId } | undefined) =>
      record?.status === "unanswered" && record.reason === "aborted" && record.entry === undefined;
    return await harness.commit(async (tx) => {
      const record = (await tx.doc(StellaAgentsDoc, rootId)).agents[threadId];
      if (!record) return [];
      const steers = record.steers ?? [];
      const outcomes = await Promise.all(
        steers.map((steer) => tx.submissionByRequest(record.conversationId as ConversationId, `steer:${steer.key}`)),
      );
      const unreadSteers = steers.filter((_, index) => unread(outcomes[index]));
      // A stopped run's unread reports wake it again rather than wait for its next message.
      const rewake = stopped ? unreadSteers.filter((steer) => parseAgentReportId(steer.key) !== null) : [];
      const withdrawn = unreadSteers.filter((steer) => !rewake.includes(steer)).map((steer) => steer.message);
      const pending = steers.filter((_, index) => outcomes[index] === undefined || outcomes[index]?.status === "queued");
      const first = record.carried?.runKey !== runKey || !record.carried.settled;
      if (record.carried?.runKey === runKey) record.carried.settled = true;
      const held = [...(first && unread(settled) ? given : []), ...withdrawn];
      if (pending.length > 0) record.steers = pending;
      else delete record.steers;
      if (held.length > 0) record.held = [...(record.held ?? []), ...held];
      return rewake.map((steer) => ({ key: steer.key, message: steer.message }));
    }, context);
  };

  /** A message for an agent another host placed here, from that host; it reads it before its next step. */
  const steerPlacedAgent = async (
    harness: Harness,
    args: { key: string; agentKey: string; message: string },
    context: Context,
  ): Promise<boolean> => {
    const root = await harness.root(context);
    const state = await harness.snapshot(StellaAgentsDoc, root.id, context);
    const threadId =
      state?.calls[`placed:${args.agentKey}`]?.threadId ??
      Object.entries(state?.agents ?? {}).find(([, known]) => known.placedAs === args.agentKey)?.[0];
    const record = threadId ? state?.agents[threadId] : undefined;
    const agent =
      record && record.conversationId >= 0 && !record.away
        ? await harness.conversation(record.conversationId as ConversationId, context)
        : undefined;
    if (!agent || !threadId) return false;
    await harness.commit(async (tx) => {
      const current = (await tx.doc(StellaAgentsDoc, root.id)).agents[threadId];
      if (!current || current.steers?.some((steer) => steer.key === args.key)) return;
      current.steers = [...(current.steers ?? []), { key: args.key, message: args.message }];
    }, context);
    await agent.submit({ type: "input", content: args.message, whenBusy: "steer", requestId: `steer:${args.key}` }, context);
    return true;
  };

  /**
   * An agent's `switch_destination`: checked now (where to, its own agents,
   * what its folder would leave behind), done once this run of it ends,
   * when nothing is in flight (`takeMove`).
   */
  const agentSwitch: AgentSwitch = async (args, api, context) => {
    const self = await roleOf(api, api.conversationId, context);
    if (!self.threadId) throw new Error("Only an agent moves itself this way.");
    const moveAgent = execution?.moveAgent;
    const agentTarget = execution?.agentTarget;
    if (!moveAgent || !agentTarget) throw new Error("This chat is stored only on this computer, so you can only run here.");
    const destination = parseSpawnDestination(args.destination);
    if (destination.kind === "here") throw new Error('destination is required: "cloud" or a device_id.');
    const where = destination.kind === "cloud" ? AGENT_MOVE_CLOUD : destination.deviceId;
    const brief = args.prompt?.trim();
    if (!brief) throw new Error("Pass your brief as prompt: what you will do there next, as you will read it there.");
    const agent = await api.snapshot(AgentDoc, api.conversationId, context);
    const target = await agentTarget(where, { claudeCode: onClaudeCode(agent?.model) }, context);
    if ("error" in target) throw new Error(target.error);
    if (target.here) return { content: [{ type: "text", text: `You already run on ${target.name}. Carry on here.` }] };
    if (await agentsBusy(busyReader(api, context), api.conversationId).catch(() => false)) {
      throw new Error(
        "Agents you started are still at work here, and they stay here. Wait for their reports (or stop them), then move.",
      );
    }
    const left = agent?.cwd ? await execution?.leftBehind?.(agent.cwd).catch(() => undefined) : undefined;
    if (left && args.leave_files !== true) {
      throw new Error(
        `${left} Files in your folder stay on this computer when you move. Commit and push that work first (a WIP branch is fine), then call switch_destination again; or pass leave_files: true to move without it.`,
      );
    }
    await api.commit(async (tx) => {
      const role = await tx.doc(StellaAgentDoc, api.conversationId);
      role.moving = { deviceId: target.deviceId, name: target.name, brief, key: String(api.taskId) };
    }, context);
    return {
      content: [
        {
          type: "text",
          text: `You move to ${target.name} as soon as this turn ends: its own Stella continues you there with this whole conversation and your brief, under the same thread id, and your reports, messages and stops follow you.${
            left ? ` What stays behind on this computer: ${left}` : ""
          } End this turn now with one short line saying you are moving to ${target.name}; do no more work here.`,
        },
      ],
      details: { move: "agent", destination: target.deviceId },
    };
  };

  /**
   * After an agent's run here ended: the move it asked for, if any. Its
   * transcript is in its log by then, and the host hands it over; `moved`
   * says where it runs now, `failed` why it stays.
   */
  const takeMove = async (
    store: Pick<ToolExecutionApi, "snapshot"> & { commit(change: (tx: Tx) => Promise<undefined>, context: Context): Promise<unknown> },
    agentConversationId: ConversationId,
    context: Context,
  ): Promise<{ moved: string; deviceId: string } | { failed: string } | undefined> => {
    const role = await store.snapshot(StellaAgentDoc, agentConversationId, context);
    const move = role?.moving;
    if (!move || !role.threadId || !execution?.moveAgent) return undefined;
    const agent = await store.snapshot(AgentDoc, agentConversationId, context);
    let outcome: { moved: string; deviceId: string } | { failed: string };
    try {
      const done = await execution.moveAgent(
        {
          threadId: role.threadId,
          agentConversationId,
          deviceId: move.deviceId,
          name: move.name,
          brief: move.brief,
          key: move.key,
          ...(agent?.model ? { model: agent.model } : {}),
          ...(agent?.thinkingLevel ? { thinkingLevel: agent.thinkingLevel } : {}),
          ...(agent?.cwd ? { cwd: agent.cwd } : {}),
        },
        context,
      );
      outcome = "error" in done ? { failed: done.error } : { moved: done.where, deviceId: move.deviceId };
    } catch (error) {
      outcome = { failed: error instanceof Error ? error.message : String(error) };
    }
    await store.commit(async (tx) => {
      delete (await tx.doc(StellaAgentDoc, agentConversationId)).moving;
      return undefined;
    }, context);
    return outcome;
  };

  /** A move asked for in a run that was stopped instead of ending: it does not happen. */
  const dropMove = async (
    store: { commit(change: (tx: Tx) => Promise<undefined>, context: Context): Promise<unknown> },
    agentConversationId: ConversationId,
    context: Context,
  ) =>
    store.commit(async (tx) => {
      const role = await tx.doc(StellaAgentDoc, agentConversationId);
      if (role.moving) delete role.moving;
      return undefined;
    }, context);

  /** What an agent whose move failed reads, to carry on where it is. */
  const moveFailedText = (error: string) =>
    `[switch_destination: your move did not happen: ${error} You still run on ${describePlacement(host.rootPlacement)}, with everything as you left it; carry on with your work here.]`;

  const extension = defineExtension({
    name: STELLA_AGENTS_EXTENSION,
    tasks: [Anchor, Reporter],
    hooks: [notesHook],
    tools: [
      spawnAgent,
      sendMessage,
      agentStatus,
      stopAgent,
      ...(switchDestination ? [switchDestination] : []),
    ],
  });
  return {
    extension,
    startAgent,
    agentRecords,
    messageAgent,
    stopAgentByThread,
    agentStanding,
    runPlacedAgent,
    steerPlacedAgent,
    markCatchUp,
  };
}

export type { EntryId };
