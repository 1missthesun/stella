import { AGENT_IDS } from "./agent-constants";
import {
  type ManagedGatewayProvider,
  type ManagedProtocol,
} from "./managed-gateway";
import type { ManagedModelAudience } from "@stella/contracts/gateway/capability";
export type {
  ManagedGatewayProvider,
  ManagedProtocol,
} from "./managed-gateway";
export type { ManagedModelAudience } from "@stella/contracts/gateway/capability";

type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };

export type ModelConfig = {
  model: string;
  fallback?: string;
  managedGatewayProvider?: ManagedGatewayProvider;
  fallbackManagedGatewayProvider?: ManagedGatewayProvider;
  api?: ManagedProtocol;
  temperature?: number;
  maxOutputTokens?: number;
  serviceTier?: string;
  fallbackServiceTier?: string;
  providerOptions?: Record<string, Record<string, JSONValue>>;
  fallbackProviderOptions?: Record<string, Record<string, JSONValue>>;
};

export const getManagedReasoningEffort = (
  config: ModelConfig,
): string | undefined => {
  const effort = config.providerOptions?.openai?.reasoningEffort;
  return typeof effort === "string" && effort.trim()
    ? effort.trim()
    : undefined;
};

export const MODEL_MODES = [
  "standard",
  "priority",
  "light",
  "builder",
  "designer",
  "vision",
  "max",
] as const;

export type ModelMode = (typeof MODEL_MODES)[number];

type RoutedModelConfig = Omit<
  ModelConfig,
  | "fallback"
  | "fallbackManagedGatewayProvider"
  | "fallbackServiceTier"
  | "fallbackProviderOptions"
>;

type ModeConfig = RoutedModelConfig & {
  fallbackConfig?: RoutedModelConfig;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const clone = <T>(value: T): T => structuredClone(value);

const deepMerge = <T>(base: T, patch?: Partial<T>): T => {
  if (!patch) return clone(base);

  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return clone((patch as T | undefined) ?? base);
  }

  const output = clone(base) as Record<string, unknown>;
  for (const [key, patchValue] of Object.entries(patch)) {
    if (patchValue === undefined) continue;

    const baseValue = output[key];
    output[key] =
      isPlainObject(baseValue) && isPlainObject(patchValue)
        ? deepMerge(baseValue, patchValue)
        : clone(patchValue);
  }

  return output as T;
};

const gatewayOptions = (
  provider: ManagedGatewayProvider,
): Record<string, Record<string, JSONValue>> => ({
  gateway: {
    order: [provider],
  },
});

export const DEEPSEEK_V4_FLASH_FIREWORKS_MODEL =
  "accounts/fireworks/models/deepseek-v4-flash-0731";
export const DEEPSEEK_V4_FLASH_DIRECT_MODEL = "deepseek/deepseek-v4-flash";
export const DEEPSEEK_V4_1_FLASH_MODEL = "deepseek/deepseek-v4.1-flash";
export const DEEPSEEK_V4_1_FLASH_MAX_OUTPUT_TOKENS = 393_216;

export const DEEPSEEK_V4_1_FLASH_PROVIDER_OPTIONS = {
  openai: { reasoningEffort: "xhigh" },
  gateway: { only: ["inference-net"], allow_fallbacks: false },
};

const DEEPSEEK_V4_FLASH_MODEL_CONFIG: ModeConfig = {
  model: DEEPSEEK_V4_1_FLASH_MODEL,
  managedGatewayProvider: "openrouter",
  api: "openai-completions",
  temperature: 1.0,
  maxOutputTokens: DEEPSEEK_V4_1_FLASH_MAX_OUTPUT_TOKENS,
  providerOptions: DEEPSEEK_V4_1_FLASH_PROVIDER_OPTIONS,
};

export const GPT_6_LUNA_MODEL = "openai/gpt-6-luna";
export const GPT_6_LUNA_MAX_OUTPUT_TOKENS = 128_000;

const GPT_6_LUNA_MODEL_CONFIG: ModeConfig = {
  model: GPT_6_LUNA_MODEL,
  managedGatewayProvider: "openrouter",
  api: "openai-completions",
  maxOutputTokens: GPT_6_LUNA_MAX_OUTPUT_TOKENS,
  providerOptions: { openai: { reasoningEffort: "high" } },
};

/**
 * Gateway overrides for pinnable upstream ids whose slug does not encode
 * their gateway. A raw `stella/<model>` pin resolves its gateway purely via
 * `inferManagedGatewayProviderFromModel`, which would send the
 * OpenRouter-hosted DeepSeek slug to the first-party gateway.
 * Consulted by `resolveStellaModelConfigForSelection` before inference.
 */
export const MANAGED_MODEL_GATEWAY_OVERRIDES: Readonly<
  Record<string, ManagedGatewayProvider>
> = {
  [DEEPSEEK_V4_1_FLASH_MODEL]: "openrouter",
  [GPT_6_LUNA_MODEL]: "openrouter",
};

/**
 * Wire-protocol overrides for pinnable upstream ids, mirroring
 * `MANAGED_MODEL_GATEWAY_OVERRIDES`. Consulted by
 * `resolveStellaModelConfigForSelection` when a raw `stella/<model>` pin is
 * resolved, so a pinned id carries the same transport as its mode config
 * regardless of which mode happens to be the agent default.
 */
export const MANAGED_MODEL_API_OVERRIDES: Readonly<
  Record<string, ManagedProtocol>
> = {
  [DEEPSEEK_V4_1_FLASH_MODEL]: "openai-completions",
  [GPT_6_LUNA_MODEL]: "openai-completions",
};

export const GEMINI_3_1_FLASH_LITE_MODEL = "google/gemini-3.1-flash-lite";

const GEMINI_3_1_FLASH_LITE_IMAGE_DESCRIPTION_CONFIG: ModelConfig = {
  model: GEMINI_3_1_FLASH_LITE_MODEL,
  managedGatewayProvider: "google",
  maxOutputTokens: 4096,
  providerOptions: gatewayOptions("google"),
};

export const GEMINI_3_8_FLASH_OFFLINE_RESPONDER_MODEL =
  "google/gemini-3.8-flash";

const GEMINI_3_8_FLASH_OFFLINE_RESPONDER_CONFIG: ModelConfig = {
  model: GEMINI_3_8_FLASH_OFFLINE_RESPONDER_MODEL,
  managedGatewayProvider: "openrouter",
  maxOutputTokens: 65536,
  providerOptions: {
    openai: {
      reasoningEffort: "low",
    },
  },
};

/**
 * Prompts above this many input tokens bill GPT-6 Luna at 2x input and 1.5x
 * output for the whole request.
 */
export const GPT_6_LUNA_PRICE_TIER_INPUT_TOKENS = 272_000;

/**
 * Input context window each managed upstream is compacted against, as its
 * route serves it. DeepSeek is pinned to OpenRouter's inference-net endpoint,
 * which serves 1,040,000 of the model's 1,048,576. GPT-6 Luna serves
 * 1,050,000 but is held to its price tier: pi compacts before any request
 * whose estimated input passes the window less its 16,384-token reserve, so
 * requests stay near 255k, under the tier. Verified 2026-10-11 against
 * OpenAI, Google and OpenRouter.
 */
export const MANAGED_MODEL_CONTEXT_WINDOWS: Readonly<Record<string, number>> = {
  [GPT_6_LUNA_MODEL]: GPT_6_LUNA_PRICE_TIER_INPUT_TOKENS,
  [DEEPSEEK_V4_1_FLASH_MODEL]: 1_040_000,
  [GEMINI_3_8_FLASH_OFFLINE_RESPONDER_MODEL]: 1_048_576,
  [GEMINI_3_1_FLASH_LITE_MODEL]: 1_048_576,
};

const INTERNAL_MODEL_CONFIGS = {
  image_description: GEMINI_3_1_FLASH_LITE_IMAGE_DESCRIPTION_CONFIG,
  offline_responder: GEMINI_3_8_FLASH_OFFLINE_RESPONDER_CONFIG,
} as const satisfies Record<string, ModelConfig>;

type InternalModelConfigKey = keyof typeof INTERNAL_MODEL_CONFIGS;
type TaskModelSelection = ModelMode | InternalModelConfigKey;

const BASE_MODE_CONFIGS: Record<ModelMode, ModeConfig> = {
  standard: GPT_6_LUNA_MODEL_CONFIG,
  priority: GPT_6_LUNA_MODEL_CONFIG,
  light: GPT_6_LUNA_MODEL_CONFIG,
  builder: GPT_6_LUNA_MODEL_CONFIG,
  designer: GPT_6_LUNA_MODEL_CONFIG,
  vision: GPT_6_LUNA_MODEL_CONFIG,
  max: GPT_6_LUNA_MODEL_CONFIG,
};

const AUDIENCE_MODE_OVERRIDES: Record<
  ManagedModelAudience,
  Partial<Record<ModelMode, Partial<ModeConfig>>>
> = {
  free: {},
  go: {},
  pro: {},
  go_fallback: {},
  pro_fallback: {},
};

const DEFAULT_AGENT_OVERRIDES: Partial<Record<string, TaskModelSelection>> = {
  [AGENT_IDS.ORCHESTRATOR]: "light",
  [AGENT_IDS.GENERAL]: "light",
};

const AUDIENCE_AGENT_MODE_OVERRIDES: Partial<
  Record<ManagedModelAudience, Partial<Record<string, TaskModelSelection>>>
> = {
  free: DEFAULT_AGENT_OVERRIDES,
  go: DEFAULT_AGENT_OVERRIDES,
  pro: DEFAULT_AGENT_OVERRIDES,
  go_fallback: DEFAULT_AGENT_OVERRIDES,
  pro_fallback: DEFAULT_AGENT_OVERRIDES,
};

export const canOverrideStellaModel = (
  audience: ManagedModelAudience,
): boolean => audience === "pro";

const UNPAID_MODEL_AUDIENCES = new Set<ManagedModelAudience>(["free"]);

export const isPaidManagedAudience = (
  audience: ManagedModelAudience,
): boolean => !UNPAID_MODEL_AUDIENCES.has(audience);

const PAID_ONLY_STELLA_MODE_IDS: ReadonlySet<string> = new Set<string>([
  "stella/max",
]);

const PRO_ALLOWED_STELLA_MODEL_IDS: ReadonlySet<string> = new Set<string>([
  "stella/light",
  `stella/${DEEPSEEK_V4_FLASH_FIREWORKS_MODEL}`,
  `stella/${DEEPSEEK_V4_FLASH_DIRECT_MODEL}`,
  `stella/${DEEPSEEK_V4_1_FLASH_MODEL}`,
  `stella/${GPT_6_LUNA_MODEL}`,
]);

export const resolveManagedModelRouteAlias = (model: string): string =>
  model === DEEPSEEK_V4_FLASH_FIREWORKS_MODEL ||
  model === DEEPSEEK_V4_FLASH_DIRECT_MODEL
    ? DEEPSEEK_V4_FLASH_MODEL_CONFIG.model
    : model;

export const isStellaModelAllowedForAudience = (
  modelId: string,
  audience: ManagedModelAudience,
): boolean => {
  if (!canOverrideStellaModel(audience)) {
    return modelId === "stella/default" || modelId === "stella/light";
  }
  if (!PRO_ALLOWED_STELLA_MODEL_IDS.has(modelId)) {
    return false;
  }
  if (PAID_ONLY_STELLA_MODE_IDS.has(modelId)) {
    return isPaidManagedAudience(audience);
  }
  return true;
};

export const LOCKED_AGENT_TYPES: ReadonlySet<string> = new Set<string>([
  "chronicle",
  AGENT_IDS.OFFLINE_RESPONDER,
  // Image descriptions must stay on a vision-capable Google route. Treating
  // this utility pass as General lets restricted audiences coerce the model
  // back to DeepSeek while the desktop still serializes a Google request.
  "image_description",
]);

export const TASK_MODEL_SELECTIONS: Record<string, TaskModelSelection> = {
  [AGENT_IDS.OFFLINE_RESPONDER]: "offline_responder",
  [AGENT_IDS.ORCHESTRATOR]: "light",
  [AGENT_IDS.GENERAL]: "light",
  [AGENT_IDS.INSTALL_UPDATE]: "light",
  [AGENT_IDS.STORE]: "light",

  schedule: "light",
  synthesis: "light",
  welcome: "light",
  asset_metadata: "light",
  chronicle: "light",
  image_description: "image_description",
  html_finish: "light",
};

const buildResolvedModeConfig = (
  mode: ModelMode,
  rawModeCatalog: Record<ModelMode, ModeConfig>,
): ModelConfig => {
  const config = rawModeCatalog[mode];
  return buildResolvedConfig(config);
};

const buildResolvedConfig = (config: ModeConfig): ModelConfig => {
  const fallbackConfig = config.fallbackConfig;

  return {
    model: config.model,
    fallback: fallbackConfig?.model,
    managedGatewayProvider: config.managedGatewayProvider,
    fallbackManagedGatewayProvider: fallbackConfig?.managedGatewayProvider,
    api: config.api,
    temperature: config.temperature,
    maxOutputTokens: config.maxOutputTokens,
    serviceTier: config.serviceTier,
    fallbackServiceTier: fallbackConfig?.serviceTier,
    providerOptions: config.providerOptions
      ? clone(config.providerOptions)
      : undefined,
    fallbackProviderOptions: fallbackConfig?.providerOptions
      ? clone(fallbackConfig.providerOptions)
      : undefined,
  };
};

const buildAudienceRawModeCatalog = (
  audience: ManagedModelAudience,
): Record<ModelMode, ModeConfig> => {
  const rawModeCatalog = {} as Record<ModelMode, ModeConfig>;

  for (const mode of MODEL_MODES) {
    rawModeCatalog[mode] = deepMerge(
      BASE_MODE_CONFIGS[mode],
      AUDIENCE_MODE_OVERRIDES[audience][mode],
    );
  }

  return rawModeCatalog;
};

const buildAudienceModeCatalog = (
  audience: ManagedModelAudience,
): Record<ModelMode, ModelConfig> => {
  const rawModeCatalog = buildAudienceRawModeCatalog(audience);
  const resolvedModeCatalog = {} as Record<ModelMode, ModelConfig>;
  for (const mode of MODEL_MODES) {
    resolvedModeCatalog[mode] = buildResolvedModeConfig(mode, rawModeCatalog);
  }

  return resolvedModeCatalog;
};

const buildAudienceAgentCatalog = (
  audience: ManagedModelAudience,
  modeCatalog: Record<ModelMode, ModelConfig>,
): Record<string, ModelConfig> => {
  const taskCatalog: Record<string, ModelConfig> = {};
  const audienceModeOverrides = AUDIENCE_AGENT_MODE_OVERRIDES[audience] ?? {};

  for (const [agentType, defaultSelection] of Object.entries(
    TASK_MODEL_SELECTIONS,
  )) {
    const selection = audienceModeOverrides[agentType] ?? defaultSelection;
    taskCatalog[agentType] = isModelMode(selection)
      ? clone(modeCatalog[selection])
      : clone(INTERNAL_MODEL_CONFIGS[selection]);
  }

  return taskCatalog;
};

const AUDIENCE_MODE_CONFIGS: Record<
  ManagedModelAudience,
  Record<ModelMode, ModelConfig>
> = {
  free: buildAudienceModeCatalog("free"),
  go: buildAudienceModeCatalog("go"),
  pro: buildAudienceModeCatalog("pro"),
  go_fallback: buildAudienceModeCatalog("go_fallback"),
  pro_fallback: buildAudienceModeCatalog("pro_fallback"),
};

export const AUDIENCE_AGENT_MODELS: Record<
  ManagedModelAudience,
  Record<string, ModelConfig>
> = {
  free: buildAudienceAgentCatalog("free", AUDIENCE_MODE_CONFIGS.free),
  go: buildAudienceAgentCatalog("go", AUDIENCE_MODE_CONFIGS.go),
  pro: buildAudienceAgentCatalog("pro", AUDIENCE_MODE_CONFIGS.pro),
  go_fallback: buildAudienceAgentCatalog(
    "go_fallback",
    AUDIENCE_MODE_CONFIGS.go_fallback,
  ),
  pro_fallback: buildAudienceAgentCatalog(
    "pro_fallback",
    AUDIENCE_MODE_CONFIGS.pro_fallback,
  ),
};

export const AGENT_MODELS = AUDIENCE_AGENT_MODELS.free;
export const DEFAULT_MODEL = AGENT_MODELS[AGENT_IDS.OFFLINE_RESPONDER];

export function getModeConfig(
  mode: ModelMode,
  audience: ManagedModelAudience = "free",
): ModelConfig {
  const config = AUDIENCE_MODE_CONFIGS[audience]?.[mode];
  if (!config) throw new Error(`No model mode config for mode: ${mode}`);
  return config;
}

export function getModelConfig(
  agentType: string,
  audience: ManagedModelAudience = "free",
): ModelConfig {
  const config =
    AUDIENCE_AGENT_MODELS[audience]?.[agentType] ?? AGENT_MODELS[agentType];
  if (!config) throw new Error(`No model config for agent type: ${agentType}`);
  return config;
}

export function isModelMode(value: string): value is ModelMode {
  return Object.prototype.hasOwnProperty.call(BASE_MODE_CONFIGS, value);
}

export const ADDITIONAL_MANAGED_MODEL_IDS = [] as const;

export function listManagedModelIds(): string[] {
  const modelIds = new Set<string>();

  const append = (value?: string) => {
    const trimmed = value?.trim();
    if (trimmed) {
      modelIds.add(trimmed);
    }
  };

  append(DEFAULT_MODEL.model);
  append(DEFAULT_MODEL.fallback);

  for (const modeCatalog of Object.values(AUDIENCE_MODE_CONFIGS)) {
    for (const config of Object.values(modeCatalog)) {
      append(config.model);
      append(config.fallback);
    }
  }

  for (const configMap of Object.values(AUDIENCE_AGENT_MODELS)) {
    for (const config of Object.values(configMap)) {
      append(config.model);
      append(config.fallback);
    }
  }

  for (const modelId of ADDITIONAL_MANAGED_MODEL_IDS) {
    append(modelId);
  }

  return Array.from(modelIds).sort();
}
