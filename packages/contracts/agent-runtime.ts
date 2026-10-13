export const AGENT_IDS = {
  ORCHESTRATOR: "orchestrator",
  GENERAL: "general",
  OFFLINE_RESPONDER: "offline_responder",
} as const;

export type AgentId = (typeof AGENT_IDS)[keyof typeof AGENT_IDS];

type AgentPromptRole = "orchestrator" | "subagent";
/**
 * Where an agent's local CLI runs when its brief names no folder:
 * `stella-home` is Stella's data folder (`~/.stella`), `frontend` the app
 * checkout, `home` the user's home folder.
 */
type LocalCliWorkingDirectory = "home" | "frontend" | "stella-home";
type AgentModelSettings = {
  description?: string;
  order: number;
};

/** Declarative runtime behaviors for each agent. Unset flags default to false. */
export type AgentCapabilities = {
  /**
   * Load the personality doc into the agent context so it is injected as a
   * hidden `~/.stella/PERSONALITY.md` startup doc on the first turn (then
   * replayed from history), mirroring main memory.
   */
  injectsPersonality?: boolean;
  /**
   * Load the user's main memory into the agent context so it is injected as
   * a hidden `~/.stella/memories/main.md` startup doc on the first turn.
   */
  injectsMainMemory?: boolean;
  /** Inject runtime reminder hidden messages. */
  injectsRuntimeReminders?: boolean;
  /**
   * Inject the connected-devices list and this run's own execution
   * destination, so the agent can place work with `spawn_agent`.
   */
  injectsExecutionContext?: boolean;
  /** Inject the skill catalog block into the dynamic context. */
  injectsSkillCatalog?: boolean;
  /** Record a durable thread summary on successful run completion. */
  recordsThreadSummary?: boolean;
};

type AgentDefinition = {
  id: AgentId;
  name: string;
  description: string;
  activityLabel: string | null;
  bundledCore: boolean;
  runsAsSubagent: boolean;
  usesLocalCliRuntime: boolean;
  promptRole: AgentPromptRole;
  localCliWorkingDirectory: LocalCliWorkingDirectory | null;
  modelSettings: AgentModelSettings | null;
  /** Optional capability bundle. Defaults to no capabilities. */
  capabilities?: AgentCapabilities;
};

const BUILTIN_AGENT_DEFINITIONS = [
  {
    id: AGENT_IDS.ORCHESTRATOR,
    name: "Orchestrator",
    description:
      "Coordinates work across agents, talks to the user, manages memory and scheduling.",
    activityLabel: "Coordinating",
    bundledCore: true,
    runsAsSubagent: false,
    usesLocalCliRuntime: true,
    promptRole: "orchestrator",
    // Stella's own folder: the orchestrator works on the user's life, not on
    // the app's source, so nothing of the checkout is its working folder.
    localCliWorkingDirectory: "stella-home",
    modelSettings: {
      description: "Top-level agent that delegates tasks",
      order: 0,
    },
    capabilities: {
      injectsPersonality: true,
      injectsMainMemory: true,
      injectsRuntimeReminders: true,
      injectsExecutionContext: true,
      injectsSkillCatalog: true,
    },
  },
  {
    id: AGENT_IDS.GENERAL,
    name: "General",
    description:
      "Executes delegated work with a fixed base tool pack, Stella's life environment, and bundled native CLIs.",
    activityLabel: "Working",
    bundledCore: true,
    runsAsSubagent: true,
    usesLocalCliRuntime: true,
    promptRole: "subagent",
    localCliWorkingDirectory: "frontend",
    modelSettings: {
      description:
        "Single execution agent that works from files, manuals, and tools",
      order: 1,
    },
    capabilities: {
      injectsExecutionContext: true,
      injectsSkillCatalog: true,
      recordsThreadSummary: true,
    },
  },
  {
    id: AGENT_IDS.OFFLINE_RESPONDER,
    name: "Offline Responder",
    description: "Handles offline fallback responses.",
    activityLabel: "Responding",
    bundledCore: false,
    runsAsSubagent: false,
    usesLocalCliRuntime: false,
    promptRole: "subagent",
    localCliWorkingDirectory: null,
    modelSettings: {
      description: "Responds when Stella is offline",
      order: 9,
    },
  },
] as const satisfies readonly AgentDefinition[];

type BuiltInAgentDefinition = (typeof BUILTIN_AGENT_DEFINITIONS)[number];

export const BUILTIN_AGENT_DEFINITION_BY_ID = Object.freeze(
  Object.fromEntries(
    BUILTIN_AGENT_DEFINITIONS.map((entry) => [entry.id, entry]),
  ) as Record<AgentId, BuiltInAgentDefinition>,
);

export const ORCHESTRATOR_RESERVED_BUILTIN_AGENT_IDS = Object.freeze(
  BUILTIN_AGENT_DEFINITIONS.filter(
    (entry) => entry.id !== AGENT_IDS.GENERAL,
  ).map((entry) => entry.id) as AgentId[],
);

const ORCHESTRATOR_RESERVED_BUILTIN_AGENT_ID_SET = new Set<string>(
  ORCHESTRATOR_RESERVED_BUILTIN_AGENT_IDS,
);

export const isOrchestratorReservedBuiltinAgentId = (
  agentId: string,
): boolean => ORCHESTRATOR_RESERVED_BUILTIN_AGENT_ID_SET.has(agentId);

export const MODEL_SETTINGS_AGENTS = Object.freeze(
  BUILTIN_AGENT_DEFINITIONS.filter(
    (
      entry,
    ): entry is BuiltInAgentDefinition & {
      modelSettings: AgentModelSettings;
    } => entry.modelSettings !== null,
  )
    .sort((a, b) => a.modelSettings.order - b.modelSettings.order)
    .map((entry) => ({
      key: entry.id as AgentId,
      label: entry.name,
      desc: entry.modelSettings.description ?? entry.description,
    })),
);

export const getAgentDefinition = (
  agentType: string,
): AgentDefinition | undefined =>
  BUILTIN_AGENT_DEFINITION_BY_ID[agentType as AgentId] as AgentDefinition;

export const getLocalCliWorkingDirectory = (
  agentType: string,
): LocalCliWorkingDirectory | null =>
  getAgentDefinition(agentType)?.localCliWorkingDirectory ?? null;

/** Resolve declarative capabilities for an agent. */
export const getAgentCapabilities = (agentType: string): AgentCapabilities =>
  getAgentDefinition(agentType)?.capabilities ?? {};

export const agentHasCapability = (
  agentType: string,
  capability: keyof AgentCapabilities,
): boolean => {
  const value = getAgentCapabilities(agentType)[capability];
  return value !== undefined && value !== false;
};

// All IPC stream event types. RUN_FINISHED is the single terminal event for
// a run; per-agent lifecycle is the AGENT_* family below.
export const AGENT_STREAM_EVENT_TYPES = {
  RUN_STARTED: "run-started",
  RUN_FINISHED: "run-finished",
  STATUS: "status",
  AGENT_REASONING: "agent-reasoning",
  TOOL_START: "tool-start",
  TOOL_END: "tool-end",
  AGENT_STARTED: "agent-started",
  AGENT_PROGRESS: "agent-progress",
  AGENT_COMPLETED: "agent-completed",
  AGENT_FAILED: "agent-failed",
  AGENT_CANCELED: "agent-canceled",
  /**
   * The one and only carrier of assistant text. Emitted once per completed
   * assistant message segment (a run may produce several — preamble →
   * post-tool answer), after the row is persisted, carrying that row's
   * eventId and the segment's full canonical text.
   */
  ASSISTANT_MESSAGE: "assistant-message",
} as const;

// Per-agent lifecycle (subset of AGENT_STREAM_EVENT_TYPES). Tracks one
// subagent task from spawn to terminal state.
export const TASK_LIFECYCLE_EVENT_TYPES = [
  AGENT_STREAM_EVENT_TYPES.AGENT_STARTED,
  AGENT_STREAM_EVENT_TYPES.AGENT_PROGRESS,
  AGENT_STREAM_EVENT_TYPES.AGENT_COMPLETED,
  AGENT_STREAM_EVENT_TYPES.AGENT_FAILED,
  AGENT_STREAM_EVENT_TYPES.AGENT_CANCELED,
] as const;

export type TaskLifecycleEventType =
  (typeof TASK_LIFECYCLE_EVENT_TYPES)[number];

export const TASK_LIFECYCLE_TERMINAL_TYPES = [
  AGENT_STREAM_EVENT_TYPES.AGENT_COMPLETED,
  AGENT_STREAM_EVENT_TYPES.AGENT_FAILED,
  AGENT_STREAM_EVENT_TYPES.AGENT_CANCELED,
] as const;

export type TaskLifecycleTerminalType =
  (typeof TASK_LIFECYCLE_TERMINAL_TYPES)[number];

const TASK_LIFECYCLE_TYPE_SET: ReadonlySet<string> = new Set(
  TASK_LIFECYCLE_EVENT_TYPES,
);
const TASK_LIFECYCLE_TERMINAL_SET: ReadonlySet<string> = new Set(
  TASK_LIFECYCLE_TERMINAL_TYPES,
);

export const isTaskLifecycleEventType = (
  type: string,
): type is TaskLifecycleEventType => TASK_LIFECYCLE_TYPE_SET.has(type);

export const isTaskLifecycleTerminalType = (
  type: string,
): type is TaskLifecycleTerminalType => TASK_LIFECYCLE_TERMINAL_SET.has(type);

// Single status enum used by every layer that tracks a task's lifecycle
// state: TaskItem (UI), ConversationTaskSnapshot (IPC resume), and the
// runtime LocalAgentManager.
export type TaskLifecycleStatus =
  | "running"
  | "completed"
  | "error"
  | "canceled";

/**
 * Redacted task-scoped tool state used by the Activity summary engine.
 * Raw tool arguments must never be placed here: this shape crosses IPC and
 * is persisted in local chat lifecycle rows.
 */
export type TaskToolActivity = {
  toolCallId: string;
  toolName: string;
  label: string;
  argsHint?: string;
  state: "started" | "completed";
  exitCode?: number | null;
};

export type TerminalTaskLifecycleStatus = Exclude<
  TaskLifecycleStatus,
  "running"
>;

// Outcome of a single run (RUN_FINISHED). Mirrors the terminal subset of
// TaskLifecycleStatus.
export const AGENT_RUN_FINISH_OUTCOMES = {
  COMPLETED: "completed",
  ERROR: "error",
  CANCELED: "canceled",
} as const satisfies Record<string, TerminalTaskLifecycleStatus>;

/** How a run (not an agent) finished. */
export type AgentRunFinishOutcome = TerminalTaskLifecycleStatus;

export const TOOL_IDS = {
  NO_RESPONSE: "NoResponse",
  READ: "Read",
} as const;
