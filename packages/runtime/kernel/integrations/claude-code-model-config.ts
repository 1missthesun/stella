import {
  DEFAULT_CLAUDE_CODE_MODEL,
  getModelOverride,
  loadLocalPreferences,
} from "@stella/node-shared/preferences/local-preferences.js";
import type { AgentModelReasoningEffort } from "@stella/contracts/agent-engine";

export const CLAUDE_CODE_LIGHT_MODEL = "haiku";

export const getClaudeCodeAgentModelId = (
  stellaAppDir?: string,
  stellaModel?: string,
  agentType?: string,
  modelOverride?: string,
): string => {
  const pinnedModel = modelOverride?.trim();
  if (pinnedModel) {
    return `claude-code/${pinnedModel}`;
  }
  const configuredStellaModel =
    stellaModel ??
    (stellaAppDir && agentType
      ? getModelOverride(stellaAppDir, agentType)
      : undefined);
  const lightDefault =
    configuredStellaModel?.trim() === "stella/light"
      ? CLAUDE_CODE_LIGHT_MODEL
      : undefined;
  const prefs = stellaAppDir ? loadLocalPreferences(stellaAppDir) : null;
  const preferredModel = prefs?.claudeCodeModel;
  const userSelectedModel =
    preferredModel && preferredModel !== DEFAULT_CLAUDE_CODE_MODEL
      ? preferredModel
      : undefined;
  const model =
    lightDefault ??
    userSelectedModel ??
    preferredModel ??
    DEFAULT_CLAUDE_CODE_MODEL;
  return `claude-code/${model || DEFAULT_CLAUDE_CODE_MODEL}`;
};

const CLAUDE_CODE_EFFORT_BY_REASONING: Record<
  Exclude<AgentModelReasoningEffort, "none">,
  string
> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

export const getClaudeCodeRuntimeEffortLevel = (
  stellaAppDir?: string,
  spawnOverride?: AgentModelReasoningEffort,
): string | undefined => {
  if (spawnOverride === "none") return undefined;
  if (spawnOverride) return CLAUDE_CODE_EFFORT_BY_REASONING[spawnOverride];
  const envOverride = process.env.CLAUDE_CODE_EFFORT_LEVEL?.trim();
  if (envOverride) return envOverride;
  const prefs = stellaAppDir ? loadLocalPreferences(stellaAppDir) : null;
  const effort = prefs?.claudeCodeReasoningEffort;
  return effort ? CLAUDE_CODE_EFFORT_BY_REASONING[effort] : undefined;
};
