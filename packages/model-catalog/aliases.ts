import {
  AGENT_MODELS,
  DEEPSEEK_V4_1_FLASH_MODEL,
  DEEPSEEK_V4_1_FLASH_PROVIDER_OPTIONS,
  getModeConfig,
  getModelConfig,
  isModelMode,
  isStellaModelAllowedForAudience,
  listManagedModelIds,
  LOCKED_AGENT_TYPES,
  MANAGED_MODEL_API_OVERRIDES,
  MANAGED_MODEL_GATEWAY_OVERRIDES,
  resolveManagedModelRouteAlias,
  type ManagedModelAudience,
  type ModelConfig,
  type ModelMode,
} from "./model";
import {
  inferManagedGatewayProviderFromModel,
  resolveManagedGatewayProvider,
  resolveManagedProtocol,
  type ManagedProtocol,
} from "./managed-gateway";

export const STELLA_PROVIDER = "stella";
export const STELLA_DEFAULT_MODEL = `${STELLA_PROVIDER}/default`;
// Bump this whenever Stella default/model/mode mappings change. The catalog
// route reports it as `updatedAt`; clients revalidate by ETag.
export const STELLA_MODEL_CATALOG_UPDATED_AT = Date.UTC(2026, 9, 6, 0, 0);

export type StellaCatalogModel = {
  id: string;
  name: string;
  provider: typeof STELLA_PROVIDER;
  upstreamModel: string;
  api: ManagedProtocol;
  type: "language" | "multimodal";
  allowedForAudience: boolean;
};

export type StellaDefaultEntry = {
  agentType: string;
  model: string;
  resolvedModel: string;
};

const DISPLAY_NAMES: Record<string, string> = {
  "openai/gpt-6-luna": "GPT-6 Luna",
  "deepseek/deepseek-v4.1-flash": "DeepSeek V4.1 Flash",
  "accounts/fireworks/models/deepseek-v4-flash-0731": "DeepSeek V4 Flash 0731",
  "deepseek/deepseek-v4-flash": "DeepSeek V4 Flash",
};

const titleCase = (value: string): string =>
  value
    .split(/[-_.]/g)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");

const deriveDisplayName = (upstreamModel: string): string => {
  const mapped = DISPLAY_NAMES[upstreamModel];
  if (mapped) return mapped;

  const slash = upstreamModel.indexOf("/");
  const rawId = upstreamModel.startsWith("accounts/fireworks/models/")
    ? upstreamModel.slice("accounts/fireworks/models/".length)
    : upstreamModel.startsWith("accounts/fireworks/routers/")
      ? upstreamModel.slice("accounts/fireworks/routers/".length)
      : slash >= 0
        ? upstreamModel.slice(slash + 1)
        : upstreamModel;
  return titleCase(rawId);
};

// A default's `resolvedModel` must name the same id the catalog publishes as
// `upstreamModel` whenever that id already routes to OpenRouter on its own
// (DeepSeek V4.1 Flash): runtimes freeze it into agent snapshots as
// `stella/<resolvedModel>`, and only the catalog spelling is pinnable. The
// `openrouter/` namespace is added only where prefix inference would otherwise
// pick a first-party gateway (e.g. `google/...` hosted on OpenRouter).
const catalogRoutingModel = (config: ModelConfig): string =>
  config.managedGatewayProvider === "openrouter" &&
  !config.model.startsWith("openrouter/") &&
  inferManagedGatewayProviderFromModel(config.model) !== "openrouter"
    ? `openrouter/${config.model}`
    : config.model;

const listUpstreamManagedModels = (): string[] => {
  return listManagedModelIds()
    .filter((model) =>
      isStellaModelAllowedForAudience(toStellaModelId(model), "pro"),
    )
    .sort((a, b) => deriveDisplayName(a).localeCompare(deriveDisplayName(b)));
};

const catalogApiForModel = (upstreamModel: string): ManagedProtocol => {
  const { config } = resolveStellaModelConfigForSelection(
    toStellaModelId(upstreamModel),
    "general",
    "pro",
  );
  const provider = resolveManagedGatewayProvider({
    model: config.model,
    configuredProvider: config.managedGatewayProvider,
  });
  return resolveManagedProtocol({
    provider,
    configuredApi: config.api,
  });
};

export const toStellaModelId = (upstreamModel: string): string =>
  `${STELLA_PROVIDER}/${upstreamModel.trim()}`;

export const isStellaModel = (model: string | null | undefined): boolean => {
  const trimmed = model?.trim();
  return Boolean(trimmed) && trimmed!.startsWith(`${STELLA_PROVIDER}/`);
};

export const parseStellaModelSelection = (
  selection: string | null | undefined,
):
  | { kind: "default" }
  | { kind: "mode"; mode: ModelMode }
  | { kind: "upstream"; model: string }
  | null => {
  const trimmed = selection?.trim();
  if (!trimmed) {
    return { kind: "default" };
  }
  if (!trimmed.startsWith(`${STELLA_PROVIDER}/`)) {
    return null;
  }

  const aliasOrUpstreamModel = trimmed
    .slice(`${STELLA_PROVIDER}/`.length)
    .trim();
  if (!aliasOrUpstreamModel || aliasOrUpstreamModel === "default") {
    return { kind: "default" };
  }
  if (isModelMode(aliasOrUpstreamModel)) {
    return { kind: "mode", mode: aliasOrUpstreamModel };
  }
  return { kind: "upstream", model: aliasOrUpstreamModel };
};

export const isListedStellaModel = (selection: string): boolean => {
  const parsed = parseStellaModelSelection(selection);
  if (!parsed) return false;
  if (parsed.kind !== "upstream") return true;
  return isStellaModelAllowedForAudience(selection.trim(), "pro");
};

export const resolveStellaModelConfigForSelection = (
  selection: string | null | undefined,
  agentType: string,
  audience: ManagedModelAudience = "free",
): { config: ModelConfig; applied: boolean } => {
  const trimmed = selection?.trim();
  const parsed =
    trimmed && trimmed !== STELLA_DEFAULT_MODEL
      ? parseStellaModelSelection(trimmed)
      : null;
  const allowed =
    !!trimmed &&
    parsed !== null &&
    parsed.kind !== "default" &&
    !LOCKED_AGENT_TYPES.has(agentType) &&
    isStellaModelAllowedForAudience(trimmed, audience);

  if (allowed && parsed?.kind === "mode") {
    return { config: getModeConfig(parsed.mode, audience), applied: true };
  }
  if (allowed && parsed?.kind === "upstream") {
    const model = resolveManagedModelRouteAlias(parsed.model);
    return {
      config: {
        ...getModelConfig(agentType, audience),
        model,
        ...(model === DEEPSEEK_V4_1_FLASH_MODEL
          ? {
              providerOptions: structuredClone(DEEPSEEK_V4_1_FLASH_PROVIDER_OPTIONS),
            }
          : {}),
        // Prefix inference alone would send `deepseek/deepseek-v4.1-flash`
        // to the DeepSeek first-party gateway; it is an OpenRouter-hosted slug
        // (see MANAGED_MODEL_GATEWAY_OVERRIDES in agent/model.ts).
        managedGatewayProvider:
          MANAGED_MODEL_GATEWAY_OVERRIDES[model] ??
          inferManagedGatewayProviderFromModel(model),
        // Same for the wire protocol: the pinned id must not inherit the
        // agent default's transport. `api: undefined` here intentionally
        // clears a base-config value when the pinned model has no override.
        api: MANAGED_MODEL_API_OVERRIDES[model],
      },
      applied: true,
    };
  }
  return { config: getModelConfig(agentType, audience), applied: false };
};

export const listStellaCatalogModels = (
  audience: ManagedModelAudience = "free",
): StellaCatalogModel[] => [
  ...listUpstreamManagedModels().map<StellaCatalogModel>((upstreamModel) => ({
    id: toStellaModelId(upstreamModel),
    name: deriveDisplayName(upstreamModel),
    provider: STELLA_PROVIDER,
    upstreamModel,
    api: catalogApiForModel(upstreamModel),
    type: "language",
    allowedForAudience: isStellaModelAllowedForAudience(
      toStellaModelId(upstreamModel),
      audience,
    ),
  })),
];

export const listStellaDefaultSelections = (
  audience: ManagedModelAudience = "free",
): StellaDefaultEntry[] =>
  Object.keys(AGENT_MODELS).map((agentType) => {
    const config = getModelConfig(agentType, audience);
    return {
      agentType,
      model: STELLA_DEFAULT_MODEL,
      resolvedModel: catalogRoutingModel(config),
    };
  });
