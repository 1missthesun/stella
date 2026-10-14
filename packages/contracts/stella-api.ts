const STELLA_API_BASE_PATH = "/api/stella";
export const STELLA_MODELS_PATH = `${STELLA_API_BASE_PATH}/models`;
export const STELLA_PROMPTS_PATH = `${STELLA_API_BASE_PATH}/prompts`;
export const STELLA_DEFAULT_MODEL = "stella/default";
export const STELLA_STANDARD_MODEL = "stella/standard";
export const STELLA_DEFAULT_UPSTREAM_MODEL = "openai/gpt-6-luna";
export const STELLA_DEEPSEEK_V4_FLASH_UPSTREAM_MODEL =
  "deepseek/deepseek-v4.1-flash";

export const STELLA_RELAY_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "fireworks",
  "deepseek",
  "openrouter",
] as const;
export type StellaRelayProvider = (typeof STELLA_RELAY_PROVIDERS)[number];

export const normalizeStellaSiteUrl = (value: string): string =>
  value
    .trim()
    .replace(/\/api\/stella\/(?:models|prompts)\/?$/i, "")
    .replace(/\/api\/stella\/?$/i, "")
    .replace(/\/+$/, "");

export const readConfiguredBackendUrl = (
  value: string | null | undefined,
): string | null => {
  if (typeof value !== "string") return null;
  const normalized = normalizeStellaSiteUrl(value);
  return normalized.length > 0 ? normalized : null;
};

