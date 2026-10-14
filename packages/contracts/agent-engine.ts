import type { ReasoningEffortLevel } from "./reasoning-effort.js";

export type AgentRuntimeEngine = "default" | "claude_code_local" | "codex_cli";

export const DEFAULT_AGENT_RUNTIME_ENGINE: AgentRuntimeEngine = "default";
export const DEFAULT_CODEX_MODEL = "gpt-6.1-sol";
export type CodexServiceTier = "standard" | "fast";
export const DEFAULT_CODEX_SERVICE_TIER: CodexServiceTier = "standard";

export type SpawnReasoningEffort = ReasoningEffortLevel;

export type AgentModelReasoningEffort = "none" | ReasoningEffortLevel;

export type AgentModelConfigSnapshot = {
  engine: AgentRuntimeEngine;
  subscriptionHarnessEnabled?: boolean;
  routeModel: string;
  engineModel?: string;
  reasoningEffort?: AgentModelReasoningEffort;
  serviceTier?: CodexServiceTier;
  executionProfile?: "spawn_override";
};

type CloudExecutionSelectionBase = {
  model: string;
  reasoningEffort: AgentModelReasoningEffort;
};

export type CloudExecutionSelection =
  | (CloudExecutionSelectionBase & {
      engine: "stella";
      provider: "stella";
    })
  | (CloudExecutionSelectionBase & {
      engine: "anthropic";
      provider: "anthropic";
    })
  | (CloudExecutionSelectionBase & {
      engine: "chatgpt";
      provider: "chatgpt";
    })
  | (CloudExecutionSelectionBase & {
      engine: "provider";
      provider: string;
    });

export type LegacyCloudExecutionSelection = Exclude<
  CloudExecutionSelection,
  { engine: "provider" }
>;

export const isLegacyCloudExecution = (
  execution: CloudExecutionSelection,
): execution is LegacyCloudExecutionSelection => execution.engine !== "provider";

export const AGENT_RUNTIME_ENGINES: readonly AgentRuntimeEngine[] = [
  "default",
  "claude_code_local",
  "codex_cli",
];

export type SpawnEngineSelection =
  | { engine: "default"; model?: never }
  | {
      engine: Exclude<AgentRuntimeEngine, "default">;
      model?: string;
    };

export const isAgentRuntimeEngine = (
  value: unknown,
): value is AgentRuntimeEngine =>
  typeof value === "string" &&
  (AGENT_RUNTIME_ENGINES as readonly string[]).includes(value);

export const coerceAgentRuntimeEngine = (value: unknown): AgentRuntimeEngine =>
  isAgentRuntimeEngine(value) ? value : DEFAULT_AGENT_RUNTIME_ENGINE;

