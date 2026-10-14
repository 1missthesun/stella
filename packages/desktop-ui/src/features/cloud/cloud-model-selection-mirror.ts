import {
  DEFAULT_CODEX_MODEL,
  type CloudExecutionSelection,
} from "@stella/contracts/agent-engine";
import {
  buildEngineReasoningPatch,
  buildEngineRoutingPatch,
  buildEngineTransitionReasoningPatch,
  buildModelSelectionPatch,
  DEFAULT_CLAUDE_CODE_MODEL,
  type EngineReasoningEffort,
  type EngineReasoningPreferences,
  type EngineRoutingPreferences,
} from "@/global/settings/lib/engine-model-routing";
import { normalizeReasoningEffortLevel } from "@stella/contracts/reasoning-effort";

export type MirroredModelPreferences = EngineRoutingPreferences &
  EngineReasoningPreferences;

const STELLA_DEFAULT_MODEL = "stella/default";
const CONVERSATION_AGENT_KEYS = ["orchestrator", "general"] as const;

const toLocalEffort = (
  effort: CloudExecutionSelection["reasoningEffort"],
): EngineReasoningEffort => normalizeReasoningEffortLevel(effort);

const conversationEffort = (
  preferences: EngineReasoningPreferences,
): EngineReasoningEffort =>
  normalizeReasoningEffortLevel(
    preferences.reasoningEfforts.orchestrator ??
      preferences.reasoningEfforts.general,
  );

export const sameCloudExecution = (
  left: CloudExecutionSelection,
  right: CloudExecutionSelection,
): boolean =>
  left.engine === right.engine &&
  left.provider === right.provider &&
  left.model === right.model &&
  left.reasoningEffort === right.reasoningEffort;

export function cloudExecutionFromLocal(
  preferences: MirroredModelPreferences,
  accountProviders: ReadonlySet<string> = new Set(),
): CloudExecutionSelection | null {
  switch (preferences.agentRuntimeEngine) {
    case "claude_code_local":
      return {
        engine: "anthropic",
        provider: "anthropic",
        model: preferences.claudeCodeModel || DEFAULT_CLAUDE_CODE_MODEL,
        reasoningEffort: preferences.claudeCodeReasoningEffort,
      };
    case "codex_cli":
      return {
        engine: "chatgpt",
        provider: "chatgpt",
        model: preferences.codexModel || DEFAULT_CODEX_MODEL,
        reasoningEffort: preferences.codexReasoningEffort,
      };
    default: {
      const model =
        preferences.modelOverrides.orchestrator ??
        preferences.modelOverrides.general ??
        "";
      if (!model) {
        return {
          engine: "stella",
          provider: "stella",
          model: STELLA_DEFAULT_MODEL,
          reasoningEffort: conversationEffort(preferences),
        };
      }
      if (!model.startsWith("stella/")) {
        const slash = model.indexOf("/");
        const provider = slash > 0 ? model.slice(0, slash) : "";
        const modelId = slash > 0 ? model.slice(slash + 1).trim() : "";
        if (!modelId || !accountProviders.has(provider)) return null;
        return {
          engine: "provider",
          provider,
          model: modelId,
          reasoningEffort: conversationEffort(preferences),
        };
      }
      return {
        engine: "stella",
        provider: "stella",
        model,
        reasoningEffort: conversationEffort(preferences),
      };
    }
  }
}

export function localPatchForCloudExecution(
  preferences: MirroredModelPreferences,
  execution: CloudExecutionSelection,
): Partial<MirroredModelPreferences> & { codexModelExplicit?: boolean } {
  if (execution.engine === "stella" || execution.engine === "provider") {
    const selected = buildModelSelectionPatch(
      preferences,
      execution.engine === "provider"
        ? `${execution.provider}/${execution.model}`
        : execution.model === STELLA_DEFAULT_MODEL
          ? ""
          : execution.model,
      { assistant: true, configurableAgentKeys: [] },
    );
    return {
      ...selected,
      ...buildEngineReasoningPatch(
        { ...preferences, ...selected },
        "default",
        toLocalEffort(execution.reasoningEffort),
        CONVERSATION_AGENT_KEYS,
      ),
    };
  }
  const engine =
    execution.engine === "anthropic" ? "claude_code_local" : "codex_cli";
  const routed = {
    ...buildEngineRoutingPatch(preferences, engine, execution.model),
    ...buildEngineTransitionReasoningPatch(preferences, engine),
  };
  return {
    ...routed,
    ...buildEngineReasoningPatch(
      { ...preferences, ...routed },
      engine,
      toLocalEffort(execution.reasoningEffort),
      CONVERSATION_AGENT_KEYS,
    ),
    ...(engine === "codex_cli" ? { codexModelExplicit: true } : {}),
  };
}
