// What Stella pays for the resources it meters, at provider list price or our
// best estimate. Bump TARIFF_VERSION whenever a rate changes; every cost
// ledger row records the version it was priced with.

export const TARIFF_VERSION = "2026-10-14.1";

export const MICRO_CENTS_PER_USD = 100_000_000;

export const usdToMicroCents = (usd: number): number => Math.round(usd * MICRO_CENTS_PER_USD);

// Cloudflare Containers, list rates checked 2026-10-14
// (developers.cloudflare.com/containers/pricing). Memory and disk are billed
// as provisioned for the time the container runs; CPU only while busy.
export const CONTAINER_TARIFF = {
  memoryUsdPerGibSecond: 0.0000025,
  diskUsdPerGbSecond: 0.00000007,
  activeVcpuUsdPerSecond: 0.00002,
  // CPU use when we cannot read the container's own counter: measured
  // agent containers sit near idle (~5% of one vCPU) outside setup bursts.
  estimatedCpuUtilization: 0.05,
} as const;

export const containerCostMicroCents = (input: {
  seconds: number;
  memoryGib: number;
  diskGb: number;
  vcpu: number;
  activeVcpuSeconds?: number;
}): number => {
  const seconds = Math.max(0, input.seconds);
  const cpuSeconds =
    input.activeVcpuSeconds ?? seconds * input.vcpu * CONTAINER_TARIFF.estimatedCpuUtilization;
  return usdToMicroCents(
    seconds * input.memoryGib * CONTAINER_TARIFF.memoryUsdPerGibSecond +
      seconds * input.diskGb * CONTAINER_TARIFF.diskUsdPerGbSecond +
      Math.max(0, cpuSeconds) * CONTAINER_TARIFF.activeVcpuUsdPerSecond,
  );
};

// Cloudflare Browser Run (Browser Rendering), billed per browser-hour.
export const BROWSER_TARIFF = {
  usdPerBrowserHour: 0.09,
  // Smallest unit a session start is billed for.
  minimumSeconds: 60,
} as const;

export const browserCostMicroCents = (seconds: number): number =>
  usdToMicroCents(
    (Math.max(BROWSER_TARIFF.minimumSeconds, seconds) / 3_600) * BROWSER_TARIFF.usdPerBrowserHour,
  );

// Workers / Dynamic Workers serving hosted apps and Crew previews.
export const HOSTING_TARIFF = {
  usdPerMillionRequests: 0.3,
  usdPerMillionCpuMs: 0.02,
} as const;

export const hostingCostMicroCents = (input: { requests: number; cpuMs: number }): number =>
  usdToMicroCents(
    (Math.max(0, input.requests) / 1_000_000) * HOSTING_TARIFF.usdPerMillionRequests +
      (Math.max(0, input.cpuMs) / 1_000_000) * HOSTING_TARIFF.usdPerMillionCpuMs,
  );

// Read-aloud. fal Gemini TTS is priced per input character; OpenAI mini TTS
// by its token tariff, approximated per character.
export const TTS_TARIFF = {
  falGeminiUsdPerThousandChars: 0.03,
  openAiMiniUsdPerThousandChars: 0.015,
  openRouterGeminiInputUsdPerMillionTokens: 0.5,
  openRouterGeminiAudioUsdPerMillionTokens: 6,
} as const;

// Google Maps Platform list prices for the SKUs the resolver calls.
export const MAPS_TARIFF = {
  placeTextSearchUsd: 0.032,
  routeUsd: 0.01,
  maxPlacesPerRequest: 8,
} as const;

// Fixed always-on infrastructure (Durable Objects, D1, logs, storage, Worker
// overhead) that does not follow usage. Allocated per active account-day as a
// cost line only; customers are never charged for it. Estimate from the
// 2026-10-13 infra measurement, version with TARIFF_VERSION.
export const FIXED_INFRA_TARIFF = {
  usdPerActiveDay: 0.05,
} as const;

export const COST_CATEGORIES = [
  "model",
  "media",
  "voice",
  "dictation",
  "tts",
  "search",
  "maps",
  "container",
  "browser",
  "hosting",
  "infra_fixed",
] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

export type CostBasis = "actual" | "estimated";

export type CostOutcome = "succeeded" | "failed" | "aborted" | "cancelled" | "expired";

// One paid attempt, as recorded in the owner's cost ledger. `providerCost`
// is what Stella paid (or our best estimate); `charged` is what the
// customer's budget was debited, which can differ (subsidies, free fixed
// infra, failures we absorb).
export type CostEntry = {
  id: string;
  category: CostCategory;
  provider: string;
  sku?: string;
  quantity?: Record<string, number>;
  providerCostMicroCents: number;
  basis: CostBasis;
  outcome: CostOutcome;
  attempt?: number;
  requestId?: string;
  tariffVersion?: string;
};

// Speech-to-text. Muse is priced per second of audio streamed to it; the
// OpenRouter clip route settles at the provider's reported cost, else this rate.
export const DICTATION_TARIFF = {
  museUsdPerHour: 0.18,
  openRouterFallbackUsdPerSecond: 0.0000611,
} as const;

// Web search per request. Cloudflare AI Search providers are flat per call;
// OpenRouter's web plugin reports its cost, and this is the most one request
// can cost (6 results plus the summarizing model).
export const SEARCH_TARIFF = {
  ceramicUsd: 0.00025,
  exaUsd: 0.007,
  linkupUsd: 0.005,
  openRouterEstimateUsd: 0.02,
  openRouterMaxUsd: 0.03,
} as const;

// OpenAI GPT-Live realtime voice, billed per second of open session.
export const REALTIME_VOICE_TARIFF = {
  gptLiveUsdPerMinute: 0.05,
  minimumBilledSeconds: 15,
} as const;
