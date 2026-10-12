/**
 * Backend-hosted Stella endpoints: the model catalog and the prompt bundle.
 * Model traffic itself goes to the model gateway advertised by the catalog
 * (`gateway.origin`, see `@stella/contracts/gateway/api`), never to the backend.
 */
const STELLA_API_BASE_PATH = "/api/stella";
export const STELLA_MODELS_PATH = `${STELLA_API_BASE_PATH}/models`;
export const STELLA_PROMPTS_PATH = `${STELLA_API_BASE_PATH}/prompts`;
export const STELLA_DEFAULT_MODEL = "stella/default";
export const STELLA_STANDARD_MODEL = "stella/standard";
/** OpenAI GPT-6 Luna on OpenRouter. */
export const STELLA_DEFAULT_UPSTREAM_MODEL = "openai/gpt-6-luna";
/** Shared Flash route identity for clients and the gateway. */
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

/**
 * Reduce a configured Stella site URL to its root. Accepts the root itself or
 * one of the backend-hosted Stella endpoints (`/api/stella`, `/models`,
 * `/prompts`), with or without a trailing slash.
 */
export const normalizeStellaSiteUrl = (value: string): string =>
  value
    .trim()
    .replace(/\/api\/stella\/(?:models|prompts)\/?$/i, "")
    .replace(/\/api\/stella\/?$/i, "")
    .replace(/\/+$/, "");

/** A configured backend origin, normalized, or null when unset or blank. */
export const readConfiguredBackendUrl = (
  value: string | null | undefined,
): string | null => {
  if (typeof value !== "string") return null;
  const normalized = normalizeStellaSiteUrl(value);
  return normalized.length > 0 ? normalized : null;
};

