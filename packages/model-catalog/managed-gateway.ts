import {
  STELLA_DEEPSEEK_V4_FLASH_UPSTREAM_MODEL,
  STELLA_DEFAULT_UPSTREAM_MODEL,
} from "@stella/contracts/stella-api";
export const MANAGED_GATEWAY_PROVIDERS = [
  "openrouter",
  "fireworks",
  "deepseek",
  "xai",
  "openai",
  "anthropic",
  "google",
  "meta",
] as const;

export type ManagedGatewayProvider = (typeof MANAGED_GATEWAY_PROVIDERS)[number];

export type ManagedProtocol =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai";

export type ManagedGatewayConfig = {
  provider: ManagedGatewayProvider;
  baseURL: string;
  apiKeyEnvVar: string;
  apiKeyEnvVarFallbacks?: readonly string[];
  extraHeaders?: Record<string, string>;
};

const MANAGED_GATEWAY_CONFIGS: Record<
  ManagedGatewayProvider,
  ManagedGatewayConfig
> = {
  openrouter: {
    provider: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    apiKeyEnvVar: "OPENROUTER_API_KEY",
  },
  fireworks: {
    provider: "fireworks",
    baseURL: "https://api.fireworks.ai/inference/v1",
    apiKeyEnvVar: "FIREWORKS_API_KEY",
  },
  // DeepSeek first-party API. Both `/responses` and `/chat/completions` hang
  // off the root — there is no `/v1` segment for the Responses endpoint.
  deepseek: {
    provider: "deepseek",
    baseURL: "https://api.deepseek.com",
    apiKeyEnvVar: "DEEPSEEK_API_KEY",
  },
  xai: {
    provider: "xai",
    baseURL: "https://api.x.ai/v1",
    apiKeyEnvVar: "XAI_API_KEY",
  },
  openai: {
    provider: "openai",
    baseURL: "https://api.openai.com/v1",
    apiKeyEnvVar: "OPENAI_API_KEY",
  },
  anthropic: {
    provider: "anthropic",
    baseURL: "https://api.anthropic.com/v1",
    apiKeyEnvVar: "ANTHROPIC_API_KEY",
  },
  google: {
    provider: "google",
    baseURL: "https://generativelanguage.googleapis.com",
    apiKeyEnvVar: "GOOGLE_AI_API_KEY",
  },
  meta: {
    provider: "meta",
    baseURL: "https://api.meta.ai/v1",
    apiKeyEnvVar: "META_MODEL_API_KEY",
    // Meta's own docs export the key as MODEL_API_KEY; accept either name.
    apiKeyEnvVarFallbacks: ["MODEL_API_KEY"],
  },
};

const FIREWORKS_MODEL_PREFIXES = [
  "accounts/fireworks/models/",
  "accounts/fireworks/routers/",
] as const;

const DIRECT_MODEL_PROVIDER_PREFIXES = [
  ["deepseek/", "deepseek"],
  ["x-ai/", "xai"],
  ["xai/", "xai"],
  ["openai/", "openai"],
  ["anthropic/", "anthropic"],
  ["google/", "google"],
  ["meta/", "meta"],
  ["openrouter/", "openrouter"],
] as const;

export function getManagedGatewayConfig(
  provider: ManagedGatewayProvider = "openrouter",
): ManagedGatewayConfig {
  return MANAGED_GATEWAY_CONFIGS[provider];
}

export function listManagedGatewayApiKeyEnvVars(
  config: ManagedGatewayConfig,
): readonly string[] {
  return [config.apiKeyEnvVar, ...(config.apiKeyEnvVarFallbacks ?? [])];
}

export function resolveManagedGatewayApiKeyFromEnv(
  config: ManagedGatewayConfig,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  for (const envVar of listManagedGatewayApiKeyEnvVars(config)) {
    const value = env[envVar]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function inferManagedGatewayProviderFromModel(
  model: string,
): ManagedGatewayProvider | undefined {
  if (
    model === STELLA_DEEPSEEK_V4_FLASH_UPSTREAM_MODEL ||
    model === STELLA_DEFAULT_UPSTREAM_MODEL
  ) {
    return "openrouter";
  }
  const directProvider = DIRECT_MODEL_PROVIDER_PREFIXES.find(([prefix]) =>
    model.startsWith(prefix),
  )?.[1];
  if (directProvider) {
    return directProvider;
  }
  return FIREWORKS_MODEL_PREFIXES.some((prefix) => model.startsWith(prefix))
    ? "fireworks"
    : undefined;
}

export function resolveManagedGatewayProvider(args: {
  model: string;
  configuredProvider?: ManagedGatewayProvider;
}): ManagedGatewayProvider {
  return (
    args.configuredProvider ??
    inferManagedGatewayProviderFromModel(args.model) ??
    "openrouter"
  );
}

export const resolveManagedProtocol = (args: {
  provider: ManagedGatewayProvider;
  configuredApi?: ManagedProtocol;
}): ManagedProtocol => {
  if (args.configuredApi) return args.configuredApi;
  switch (args.provider) {
    case "fireworks":
    case "deepseek":
    case "xai":
    case "openai":
      return "openai-responses";
    case "anthropic":
      return "anthropic-messages";
    case "google":
      return "google-generative-ai";
    case "openrouter":
    case "meta":
      return "openai-completions";
  }
};
