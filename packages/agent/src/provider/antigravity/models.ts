import type { Api, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";

export const ANTIGRAVITY_PROVIDER_ID = "antigravity";
export const ANTIGRAVITY_API = "antigravity-cloudcode" as Api;
export const ANTIGRAVITY_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
export const ANTIGRAVITY_ENDPOINTS = [ANTIGRAVITY_ENDPOINT, "https://cloudcode-pa.googleapis.com"] as const;

/** The official Antigravity CLI build whose request identity Stella sends. */
const AGY_CLI_VERSION = "1.5.8";
const AGY_CLI_CHANGE_LIST = "1020628950";

export const antigravityUserAgent = (): string => {
  const os = process.platform === "win32" ? "windows" : process.platform || "unknown";
  const arch = process.arch === "x64" ? "amd64" : process.arch === "ia32" ? "386" : process.arch || "unknown";
  return `antigravity/cli/${AGY_CLI_VERSION} (aidev_client; os_type=${os}; arch=${arch}; cl=${AGY_CLI_CHANGE_LIST}; auth_method=consumer)`;
};

/** The endpoint override exists only for Stella's own checks against a local stand-in server. */
export const antigravityEndpoint = (): string => process.env.STELLA_ANTIGRAVITY_ENDPOINT?.trim() || ANTIGRAVITY_ENDPOINT;

type Tier = "low" | "medium" | "high" | "xhigh";

type Family = {
  id: string;
  name: string;
  tiers: readonly Tier[];
  defaultTier: Tier;
  contextWindow: number;
  maxTokens: number;
};

/**
 * Antigravity's Gemini models, as the official CLI's server catalog names
 * them. Each tier is its own wire model (`gemini-4-neon-high`); Stella shows
 * one model per family and picks the tier from the reasoning setting.
 */
const FAMILIES: readonly Family[] = [
  {
    id: "gemini-4-neon",
    name: "Gemini 4 Neon",
    tiers: ["low", "medium", "high", "xhigh"],
    defaultTier: "high",
    contextWindow: 1_048_576,
    maxTokens: 262_144,
  },
  {
    id: "gemini-4-hydrogen",
    name: "Gemini 4 Hydrogen",
    tiers: ["low", "medium", "high", "xhigh"],
    defaultTier: "high",
    contextWindow: 1_048_576,
    maxTokens: 262_144,
  },
  {
    id: "gemini-4-carbon",
    name: "Gemini 4 Carbon",
    tiers: ["low", "medium", "high"],
    defaultTier: "medium",
    contextWindow: 1_048_576,
    maxTokens: 262_144,
  },
  {
    id: "gemini-4-argon",
    name: "Gemini 4 Argon",
    tiers: ["low", "medium", "high"],
    defaultTier: "medium",
    contextWindow: 1_048_576,
    maxTokens: 65_536,
  },
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    tiers: ["low", "medium", "high"],
    defaultTier: "medium",
    contextWindow: 1_048_576,
    maxTokens: 65_536,
  },
];

const familyOf = (modelId: string): Family | undefined => {
  const base = modelId.toLowerCase().replace(/-(?:minimal|low|medium|high|xhigh)$/u, "");
  return FAMILIES.find((family) => family.id === base);
};

const thinkingLevelMap = (family: Family): Model<Api>["thinkingLevelMap"] => ({
  off: null,
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  ...(family.tiers.includes("xhigh") ? { xhigh: "xhigh" } : {}),
});

export const antigravityModels = (): Model<Api>[] =>
  FAMILIES.map((family) => ({
    id: family.id,
    name: family.name,
    api: ANTIGRAVITY_API,
    provider: ANTIGRAVITY_PROVIDER_ID,
    baseUrl: ANTIGRAVITY_ENDPOINT,
    reasoning: true,
    thinkingLevelMap: thinkingLevelMap(family),
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: family.contextWindow,
    maxTokens: family.maxTokens,
  }));

export type WireRoute = {
  wireModel: string;
  thinkingConfig: Record<string, unknown>;
  maxOutputTokens: number;
};

/** The wire model and thinking config the CLI sends for a family at a reasoning level. */
export const antigravityRoute = (modelId: string, reasoning: ModelThinkingLevel | undefined): WireRoute | undefined => {
  const family = familyOf(modelId);
  if (!family) return undefined;
  const requested = (modelId.match(/-(low|medium|high|xhigh)$/u)?.[1] ?? reasoning) as string | undefined;
  const order: Tier[] = ["low", "medium", "high", "xhigh"];
  const wanted: Tier =
    requested === "minimal"
      ? "low"
      : requested === "max"
        ? "xhigh"
        : order.includes(requested as Tier)
          ? (requested as Tier)
          : family.defaultTier;
  const tier = family.tiers.includes(wanted) ? wanted : family.tiers[family.tiers.length - 1]!;
  const thinkingConfig = { includeThoughts: true, thinkingLevel: tier === "xhigh" ? 100 : tier.toUpperCase() };
  return { wireModel: `${family.id}-${tier}`, thinkingConfig, maxOutputTokens: family.maxTokens };
};

const MODEL_ENUMS: Readonly<Record<string, string>> = {
  "gemini-4-neon-low": "MODEL_PLACEHOLDER_M534",
  "gemini-4-neon-medium": "MODEL_PLACEHOLDER_M533",
  "gemini-4-neon-high": "MODEL_PLACEHOLDER_M532",
  "gemini-4-neon-xhigh": "MODEL_PLACEHOLDER_M535",
  "gemini-4-hydrogen-low": "MODEL_PLACEHOLDER_M527",
  "gemini-4-hydrogen-medium": "MODEL_PLACEHOLDER_M526",
  "gemini-4-hydrogen-high": "MODEL_PLACEHOLDER_M525",
  "gemini-4-hydrogen-xhigh": "MODEL_PLACEHOLDER_M528",
  "gemini-4-carbon-low": "MODEL_PLACEHOLDER_M438",
  "gemini-4-carbon-medium": "MODEL_PLACEHOLDER_M437",
  "gemini-4-carbon-high": "MODEL_PLACEHOLDER_M427",
  "gemini-4-argon-low": "MODEL_PLACEHOLDER_M419",
  "gemini-4-argon-medium": "MODEL_PLACEHOLDER_M418",
  "gemini-4-argon-high": "MODEL_PLACEHOLDER_M417",
  "gemini-3.8-flash-low": "MODEL_PLACEHOLDER_M320",
  "gemini-3.8-flash-medium": "MODEL_PLACEHOLDER_M319",
  "gemini-3.8-flash-high": "MODEL_PLACEHOLDER_M318",
};

/** The server's enum for a wire model, which the CLI echoes in each request's labels. */
export const antigravityModelEnum = (wireModel: string): string | undefined => MODEL_ENUMS[wireModel];

export const isAntigravityModel = (modelId: string): boolean => familyOf(modelId) !== undefined;
