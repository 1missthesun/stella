export const AGENT_IDS = {
  ORCHESTRATOR: "orchestrator",
  GENERAL: "general",
  OFFLINE_RESPONDER: "offline_responder",
} as const;

export type AgentId = (typeof AGENT_IDS)[keyof typeof AGENT_IDS];

type AgentPromptRole = "orchestrator" | "subagent";
type LocalCliWorkingDirectory = "home" | "frontend" | "stella-home";
type AgentModelSettings = {
  description?: string;
  order: number;
};

export type AgentCapabilities = {
  injectsPersonality?: boolean;
  injectsMainMemory?: boolean;
  injectsRuntimeReminders?: boolean;
  injectsExecutionContext?: boolean;
  injectsSkillCatalog?: boolean;
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

export const getAgentCapabilities = (agentType: string): AgentCapabilities =>
  getAgentDefinition(agentType)?.capabilities ?? {};

export const agentHasCapability = (
  agentType: string,
  capability: keyof AgentCapabilities,
): boolean => {
  const value = getAgentCapabilities(agentType)[capability];
  return value !== undefined && value !== false;
};

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
  ASSISTANT_MESSAGE: "assistant-message",
} as const;

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

export type TaskLifecycleStatus =
  | "running"
  | "completed"
  | "error"
  | "canceled";

export type TerminalTaskLifecycleStatus = Exclude<
  TaskLifecycleStatus,
  "running"
>;

export const AGENT_RUN_FINISH_OUTCOMES = {
  COMPLETED: "completed",
  ERROR: "error",
  CANCELED: "canceled",
} as const satisfies Record<string, TerminalTaskLifecycleStatus>;

export type AgentRunFinishOutcome = TerminalTaskLifecycleStatus;

export const TOOL_IDS = {
  NO_RESPONSE: "NoResponse",
  READ: "Read",
} as const;
