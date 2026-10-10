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

/**
 * The account's model selection lives on the server (`cloud_engine_settings`)
 * so every client picks from one list and one choice. The desktop runtime
 * still reads its local preferences, so these helpers translate between the
 * two shapes in both directions.
 */
export type MirroredModelPreferences = EngineRoutingPreferences &
  EngineReasoningPreferences;

const STELLA_DEFAULT_MODEL = "stella/default";
const CONVERSATION_AGENT_KEYS = ["orchestrator", "general"] as const;

const toLocalEffort = (
  effort: CloudExecutionSelection["reasoningEffort"],
): EngineReasoningEffort => (effort === "none" ? "default" : effort);

export const sameCloudExecution = (
  left: CloudExecutionSelection,
  right: CloudExecutionSelection,
): boolean =>
  left.engine === right.engine &&
  left.provider === right.provider &&
  left.model === right.model &&
  // Managed Stella routes take their effort from the backend; a provider
  // model keeps the effort its picker chose (the desktop has no field for it).
  (left.engine === "stella" ||
    left.engine === "provider" ||
    left.reasoningEffort === right.reasoningEffort);

/**
 * The server selection equivalent to the local preferences, or null when the
 * local choice has no server form: a model on a provider whose key is only
 * on this computer (`accountProviders` lists the ones saved to the account).
 */
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
        preferences.modelOverrides.general ??
        preferences.modelOverrides.orchestrator ??
        "";
      if (!model) {
        return {
          engine: "stella",
          provider: "stella",
          model: STELLA_DEFAULT_MODEL,
          reasoningEffort: "default",
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
          reasoningEffort: "default",
        };
      }
      return {
        engine: "stella",
        provider: "stella",
        model,
        reasoningEffort: "default",
      };
    }
  }
}

/** The local preference write that applies a server selection. */
export function localPatchForCloudExecution(
  preferences: MirroredModelPreferences,
  execution: CloudExecutionSelection,
): Partial<MirroredModelPreferences> & { codexModelExplicit?: boolean } {
  if (execution.engine === "stella") {
    return buildModelSelectionPatch(
      preferences,
      execution.model === STELLA_DEFAULT_MODEL ? "" : execution.model,
      { assistant: true, configurableAgentKeys: [] },
    );
  }
  if (execution.engine === "provider") {
    // The runtime runs it on this computer's own key, or on the account's
    // through the model gateway when it has none.
    return buildModelSelectionPatch(
      preferences,
      `${execution.provider}/${execution.model}`,
      { assistant: true, configurableAgentKeys: [] },
    );
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
