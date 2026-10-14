export const MICRO_CENTS_PER_CENT = 1_000_000;
export const CENTS_PER_DOLLAR = 100;

export type TokenPriceConfig = {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  cacheReadPerMillionUsd?: number;
  cacheWritePerMillionUsd?: number;
  reasoningPerMillionUsd?: number;
};

export type TokenPriceCatalog = {
  default: TokenPriceConfig;
  models: Record<string, TokenPriceConfig>;
};

export const DEFAULT_TOKEN_PRICE: TokenPriceConfig = {
  inputPerMillionUsd: 0.6,
  outputPerMillionUsd: 3.0,
};

export const DEFAULT_TOKEN_PRICE_CATALOG: TokenPriceCatalog = {
  default: DEFAULT_TOKEN_PRICE,
  models: {},
};

export const centsToMicroCents = (cents: number) =>
  Math.round(cents * MICRO_CENTS_PER_CENT);

export const dollarsToMicroCents = (dollars: number) =>
  centsToMicroCents(dollars * CENTS_PER_DOLLAR);

/**
 * Price one managed completion.
 *
 * Token conventions — every caller must normalize to these before calling,
 * because this function derives the billable buckets by subtraction:
 *
 * - `inputTokens` is GROSS: it includes `cachedInputTokens` and
 *   `cacheWriteInputTokens`. Providers disagree here (OpenAI's
 *   `prompt_tokens` and Google's `promptTokenCount` are gross, Anthropic's
 *   `input_tokens` is already net of both cache buckets), so the parsers
 *   are responsible for adding cache counts back in.
 * - `outputTokens` is GROSS: it includes `reasoningTokens`. Again providers
 *   disagree (OpenAI's `output_tokens` includes reasoning, Google's
 *   `candidatesTokenCount` excludes `thoughtsTokenCount`), so the parsers
 *   normalize to the inclusive form.
 *
 * Passing already-net counts double-discounts them and can silently bill a
 * request at zero.
 */
export type UsageCostArgs = {
  model: string;
  /** Gross prompt tokens, including cached reads and cache writes. */
  inputTokens: number;
  /** Gross completion tokens, including reasoning tokens. */
  outputTokens: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  /**
   * The part of `cacheWriteInputTokens` written to a 1-hour cache entry
   * (Anthropic `ttl: "1h"`, reported as
   * `cache_creation.ephemeral_1h_input_tokens`). Anthropic bills these at 2x
   * the input rate; the remaining (5-minute) writes keep the catalog's
   * cache-write rate, which models.dev publishes as 1.25x input.
   */
  cacheWrite1hInputTokens?: number;
  reasoningTokens?: number;
  price?: TokenPriceConfig;
};

/** Anthropic's 1-hour cache writes cost twice the base input rate. */
export const LONG_CACHE_WRITE_INPUT_MULTIPLIER = 2;

export const computeUsageCostMicroCents = (
  args: UsageCostArgs & {
    catalog?: TokenPriceCatalog;
  },
) => {
  const catalog = args.catalog ?? DEFAULT_TOKEN_PRICE_CATALOG;
  const price = args.price ?? catalog.models[args.model] ?? catalog.default;
  const cachedInputTokens = Math.max(0, args.cachedInputTokens ?? 0);
  const cacheWriteInputTokens = Math.max(0, args.cacheWriteInputTokens ?? 0);
  const cacheWrite1hInputTokens = Math.min(
    cacheWriteInputTokens,
    Math.max(0, args.cacheWrite1hInputTokens ?? 0),
  );
  const billableInputTokens = Math.max(
    0,
    args.inputTokens - cachedInputTokens - cacheWriteInputTokens,
  );
  const reasoningTokens = Math.max(0, args.reasoningTokens ?? 0);
  const textOutputTokens = Math.max(0, args.outputTokens - reasoningTokens);

  const inputUsd = (billableInputTokens / 1_000_000) * price.inputPerMillionUsd;
  const cachedInputUsd =
    (cachedInputTokens / 1_000_000) * (price.cacheReadPerMillionUsd ?? 0);
  const cacheWriteUsd =
    ((cacheWriteInputTokens - cacheWrite1hInputTokens) / 1_000_000) *
      (price.cacheWritePerMillionUsd ?? 0) +
    (cacheWrite1hInputTokens / 1_000_000) *
      (LONG_CACHE_WRITE_INPUT_MULTIPLIER * price.inputPerMillionUsd);
  const outputUsd = (textOutputTokens / 1_000_000) * price.outputPerMillionUsd;
  // A zero reasoning rate means "not published", not "free" — models.dev
  // omits `cost.reasoning` for most models and the sync stores 0. No provider
  // bills reasoning below its output rate, so fall back to it rather than
  // handing out reasoning-heavy completions for nothing.
  const reasoningUsd =
    (reasoningTokens / 1_000_000) *
    (price.reasoningPerMillionUsd || price.outputPerMillionUsd);

  return dollarsToMicroCents(
    inputUsd + cachedInputUsd + cacheWriteUsd + outputUsd + reasoningUsd,
  );
};

export type StaticManagedModelPrice = {
  sourceProvider: string;
  sourceModelId: string;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  cacheReadPerMillionUsd?: number;
  cacheWritePerMillionUsd?: number;
  reasoningPerMillionUsd?: number;
  modalitiesInput?: string[];
  modalitiesOutput?: string[];
};

export const STATIC_MANAGED_MODEL_PRICE_OVERRIDES: Record<
  string,
  StaticManagedModelPrice
> = {
  "deepseek/deepseek-v4.1-flash": {
    sourceProvider: "openrouter",
    sourceModelId: "deepseek-v4.1-flash",
    inputPerMillionUsd: 0.02,
    outputPerMillionUsd: 0.45,
    cacheReadPerMillionUsd: 0.003,
    reasoningPerMillionUsd: 0.45,
    modalitiesInput: ["text", "image"],
    modalitiesOutput: ["text"],
  },
  "openai/gpt-6-luna": {
    sourceProvider: "openrouter",
    sourceModelId: "gpt-6-luna",
    inputPerMillionUsd: 0.1,
    outputPerMillionUsd: 0.5,
    cacheReadPerMillionUsd: 0.01,
    reasoningPerMillionUsd: 0.5,
    modalitiesInput: ["text", "image"],
    modalitiesOutput: ["text"],
  },
  "meta/muse-spark-1.2": {
    sourceProvider: "meta",
    sourceModelId: "muse-spark-1.2",
    inputPerMillionUsd: 1.25,
    outputPerMillionUsd: 4.25,
    reasoningPerMillionUsd: 4.25,
    modalitiesInput: ["text", "image", "video", "pdf"],
    modalitiesOutput: ["text"],
  },
  "openai/gpt-5.6-sol": {
    sourceProvider: "openai",
    sourceModelId: "gpt-5.6-sol",
    inputPerMillionUsd: 5,
    outputPerMillionUsd: 30,
    cacheReadPerMillionUsd: 0.5,
    cacheWritePerMillionUsd: 6.25,
    reasoningPerMillionUsd: 30,
    modalitiesInput: ["text", "image"],
    modalitiesOutput: ["text"],
  },
  "openai/gpt-5.6-luna": {
    sourceProvider: "openai",
    sourceModelId: "gpt-5.6-luna",
    inputPerMillionUsd: 1,
    outputPerMillionUsd: 6,
    cacheReadPerMillionUsd: 0.1,
    cacheWritePerMillionUsd: 1.25,
    reasoningPerMillionUsd: 6,
    modalitiesInput: ["text", "image"],
    modalitiesOutput: ["text"],
  },
  "deepseek/deepseek-v4-flash": {
    sourceProvider: "deepseek",
    sourceModelId: "deepseek-v4-flash",
    inputPerMillionUsd: 0.14,
    outputPerMillionUsd: 0.28,
    cacheReadPerMillionUsd: 0.0028,
    cacheWritePerMillionUsd: 0,
    reasoningPerMillionUsd: 0.28,
    modalitiesInput: ["text"],
    modalitiesOutput: ["text"],
  },
  "google/gemini-3.8-flash": {
    sourceProvider: "openrouter",
    sourceModelId: "google/gemini-3.8-flash",
    inputPerMillionUsd: 0.75,
    outputPerMillionUsd: 3.75,
    cacheReadPerMillionUsd: 0.075,
    cacheWritePerMillionUsd: 0.041667,
    reasoningPerMillionUsd: 3.75,
    modalitiesInput: ["text", "image", "audio", "video", "pdf"],
    modalitiesOutput: ["text"],
  },
  "google/gemini-3.6-flash": {
    sourceProvider: "google",
    sourceModelId: "gemini-3.6-flash",
    inputPerMillionUsd: 1.5,
    outputPerMillionUsd: 7.5,
    cacheReadPerMillionUsd: 0.15,
    reasoningPerMillionUsd: 7.5,
    modalitiesInput: ["text", "image", "audio", "video", "pdf"],
    modalitiesOutput: ["text"],
  },
};
