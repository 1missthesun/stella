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

export type GrossTokenUsage = {
  /** Includes cached reads and cache writes. */
  inputTokens: number;
  /** Includes reasoning tokens. */
  outputTokens: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  /** The part of `cacheWriteInputTokens` written to a 1-hour cache entry. */
  cacheWrite1hInputTokens?: number;
  reasoningTokens?: number;
};

declare const billableTokensBrand: unique symbol;

export type BillableTokens = {
  readonly uncachedInput: number;
  readonly cacheRead: number;
  readonly cacheWrite5m: number;
  readonly cacheWrite1h: number;
  readonly textOutput: number;
  readonly reasoning: number;
  readonly [billableTokensBrand]: true;
};

const count = (value: number | undefined): number =>
  value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 0;

export const billableTokens = (usage: GrossTokenUsage): BillableTokens => {
  const cacheRead = count(usage.cachedInputTokens);
  const cacheWrite = count(usage.cacheWriteInputTokens);
  const cacheWrite1h = Math.min(cacheWrite, count(usage.cacheWrite1hInputTokens));
  const reasoning = count(usage.reasoningTokens);
  return {
    uncachedInput: Math.max(0, count(usage.inputTokens) - cacheRead - cacheWrite),
    cacheRead,
    cacheWrite5m: cacheWrite - cacheWrite1h,
    cacheWrite1h,
    textOutput: Math.max(0, count(usage.outputTokens) - reasoning),
    reasoning,
  } as BillableTokens;
};

/** Anthropic bills 1-hour cache writes at twice the base input rate. */
export const LONG_CACHE_WRITE_INPUT_MULTIPLIER = 2;

/** Reasoning tokens are output tokens: no provider bills them below the output rate. */
export const effectiveReasoningRate = (
  published: number | undefined,
  outputPerMillionUsd: number,
): number => Math.max(published ?? 0, outputPerMillionUsd);

export const computeUsageCostMicroCents = (args: {
  model: string;
  tokens: BillableTokens;
  price?: TokenPriceConfig;
  catalog?: TokenPriceCatalog;
}) => {
  const catalog = args.catalog ?? DEFAULT_TOKEN_PRICE_CATALOG;
  const price = args.price ?? catalog.models[args.model] ?? catalog.default;
  const { tokens } = args;
  const perToken = (rate: number) => rate / 1_000_000;
  return dollarsToMicroCents(
    tokens.uncachedInput * perToken(price.inputPerMillionUsd) +
      tokens.cacheRead * perToken(price.cacheReadPerMillionUsd ?? 0) +
      tokens.cacheWrite5m * perToken(price.cacheWritePerMillionUsd ?? 0) +
      tokens.cacheWrite1h *
        perToken(LONG_CACHE_WRITE_INPUT_MULTIPLIER * price.inputPerMillionUsd) +
      tokens.textOutput * perToken(price.outputPerMillionUsd) +
      tokens.reasoning *
        perToken(
          effectiveReasoningRate(
            price.reasoningPerMillionUsd,
            price.outputPerMillionUsd,
          ),
        ),
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
