import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";
import { isAccountProviderId } from "@stella/contracts/backend/providers";
import {
  DEFAULT_REASONING_EFFORT,
  normalizeReasoningEffortLevel,
  type ReasoningEffortLevel,
} from "@stella/contracts/reasoning-effort";

const CLOUD_SPAWN_MODEL =
  /^(?:claude(?:-code)?(?:\/(?:[A-Za-z0-9][A-Za-z0-9._-]{0,191}|[A-Za-z0-9][A-Za-z0-9._-]{0,187}\[1m\]))?|codex(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,191})?|stella\/[A-Za-z0-9._:/-]{1,185})(?::(?:low|medium|high|xhigh|max))?$/;

export const isValidCloudSpawnModel = (model: string): boolean =>
  CLOUD_SPAWN_MODEL.test(model);

export const CLOUD_SPAWN_MODEL_HELP =
  'Cloud spawn model must be "claude[/model]" (or "claude-code[/model]"), "codex[/model]", a canonical "stella/..." model, or "<provider>/<model>" for a key saved to the account, optionally followed by :low, :medium, :high, :xhigh, or :max.';

export const DEFAULT_CLOUD_ANTHROPIC_EXECUTION: CloudExecutionSelection = {
  engine: "anthropic",
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  reasoningEffort: DEFAULT_REASONING_EFFORT,
};

export const DEFAULT_CLOUD_CODEX_EXECUTION: CloudExecutionSelection = {
  engine: "chatgpt",
  provider: "chatgpt",
  model: "gpt-6.1-sol",
  reasoningEffort: DEFAULT_REASONING_EFFORT,
};

type SpawnEffort = ReasoningEffortLevel;

const inheritedEffort = (
  inherited: CloudExecutionSelection,
): ReasoningEffortLevel =>
  normalizeReasoningEffortLevel(inherited.reasoningEffort);

export const resolveCloudSpawnExecution = (
  model: string | undefined,
  inherited: CloudExecutionSelection,
): CloudExecutionSelection => {
  const trimmed = model?.trim() ?? "";
  if (!trimmed || trimmed === "default") return inherited;
  const accountRoute = /^([a-z0-9-]+)\/(.+?)(?::(low|medium|high|xhigh|max))?$/.exec(trimmed);
  if (accountRoute && isAccountProviderId(accountRoute[1])) {
    return {
      engine: "provider",
      provider: accountRoute[1],
      model: accountRoute[2]!,
      reasoningEffort:
        (accountRoute[3] as SpawnEffort | undefined) ?? inheritedEffort(inherited),
    };
  }
  if (!isValidCloudSpawnModel(trimmed)) throw new Error(CLOUD_SPAWN_MODEL_HELP);
  const effortMatch = /:(low|medium|high|xhigh|max)$/.exec(trimmed);
  const reasoningEffort: CloudExecutionSelection["reasoningEffort"] =
    (effortMatch?.[1] as SpawnEffort | undefined) ?? inheritedEffort(inherited);
  const route = (
    effortMatch ? trimmed.slice(0, -effortMatch[0].length) : trimmed
  ).replace(/^claude-code(?=\/|$)/, "claude");
  if (route === "claude") {
    return { ...DEFAULT_CLOUD_ANTHROPIC_EXECUTION, reasoningEffort };
  }
  if (route.startsWith("claude/")) {
    return {
      ...DEFAULT_CLOUD_ANTHROPIC_EXECUTION,
      model: route.slice("claude/".length),
      reasoningEffort,
    };
  }
  if (route === "codex") {
    return { ...DEFAULT_CLOUD_CODEX_EXECUTION, reasoningEffort };
  }
  if (route.startsWith("codex/")) {
    return {
      ...DEFAULT_CLOUD_CODEX_EXECUTION,
      model: route.slice("codex/".length),
      reasoningEffort,
    };
  }
  return {
    engine: "stella",
    provider: "stella",
    model: route,
    reasoningEffort,
  };
};
