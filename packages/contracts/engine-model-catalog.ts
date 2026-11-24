export type EngineModelOption = {
  id: string;
  name: string;
  description?: string;
};

export const CLAUDE_ENGINE_MODELS: readonly EngineModelOption[] = [
  {
    id: "default",
    name: "Default",
    description: "Recommended model for your Claude account",
  },
  {
    id: "best",
    name: "Best",
    description: "Most capable model available to you",
  },
  {
    id: "fable",
    name: "Fable",
    description: "Long, hard tasks and deep autonomy",
  },
  {
    id: "opus",
    name: "Opus",
    description: "Latest Opus for complex reasoning",
  },
  {
    id: "sonnet",
    name: "Sonnet",
    description: "Latest Sonnet for everyday work",
  },
  {
    id: "haiku",
    name: "Haiku",
    description: "Fast and efficient for simple tasks",
  },
];

export const CHATGPT_ENGINE_MODELS: readonly EngineModelOption[] = [
  {
    id: "gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    description: "Balanced default for everyday coding",
  },
  {
    id: "gpt-6-astra",
    name: "GPT-6 Astra",
    description: "Most capable for hard, long tasks",
  },
  {
    id: "gpt-6-luna",
    name: "GPT-6 Luna",
    description: "Fast and low-cost",
  },
];

/**
 * Gemini on the user's Google Antigravity plan, run inside Google's own
 * Antigravity CLI (`agy`) on a computer signed in to it. The models are the
 * ones `agy` reports for that account (`antigravityModelsOf`); these stand in
 * until it has.
 */
export const ANTIGRAVITY_MODEL_IDS: readonly string[] = [
  "gemini-4-neon",
  "gemini-4-carbon",
  "gemini-4-hydrogen",
];

/** Models Google removes from Antigravity on 2026-11-30, and what runs instead. */
const ANTIGRAVITY_REPLACED_MODELS: Readonly<Record<string, string>> = {
  "gemini-4-argon": "gemini-4-neon",
  "gemini-3.8-flash": "gemini-4-hydrogen",
};

const ANTIGRAVITY_MODEL_NOTES: Readonly<Record<string, string>> = {
  "gemini-4-neon": "Most capable",
  "gemini-4-hydrogen": "Fast",
};

const MAX_ANTIGRAVITY_MODELS = 12;
const ANTIGRAVITY_MODEL_ID = /^gemini-[a-z0-9][a-z0-9.-]{0,47}$/u;

/** `gemini-4-neon-high` → `gemini-4-neon`: the thinking level is chosen on its own. */
export const antigravityModelBase = (id: string): string =>
  id.replace(/-(?:minimal|low|medium|high|xhigh|max)$/u, "");

/**
 * The Gemini models among the ones `agy` reports, in its order. Orchestrator is
 * a pair of models (a planner handing work to another), not one.
 */
export const antigravityModelsOf = (reported: unknown): string[] =>
  Array.isArray(reported)
    ? [
        ...new Set(
          reported
            .filter((id): id is string => typeof id === "string")
            .map(antigravityModelBase)
            .filter(
              (id) =>
                ANTIGRAVITY_MODEL_ID.test(id) &&
                !id.includes("orchestrator") &&
                !Object.hasOwn(ANTIGRAVITY_REPLACED_MODELS, id),
            ),
        ),
      ].slice(0, MAX_ANTIGRAVITY_MODELS)
    : [];

/** "Gemini 4 Neon" for `gemini-4-neon`. */
export const antigravityModelName = (id: string): string =>
  id
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

/** The models to offer, given the ones a signed-in computer's `agy` reports. */
export const antigravityModelOptions = (reported?: readonly string[]): EngineModelOption[] => {
  const listed = antigravityModelsOf(reported);
  return (listed.length > 0 ? listed : ANTIGRAVITY_MODEL_IDS).map((id) => ({
    id,
    name: antigravityModelName(id),
    ...(ANTIGRAVITY_MODEL_NOTES[id] ? { description: ANTIGRAVITY_MODEL_NOTES[id] } : {}),
  }));
};

/** The model that runs for a pick: itself, or what replaces one Google removed. */
export const antigravityModelInUse = (model: string, reported?: readonly string[]): string => {
  const base = antigravityModelBase(model);
  const successor = Object.hasOwn(ANTIGRAVITY_REPLACED_MODELS, base)
    ? ANTIGRAVITY_REPLACED_MODELS[base]!
    : model;
  const listed = antigravityModelsOf(reported);
  return listed.length === 0 || listed.includes(antigravityModelBase(successor))
    ? successor
    : listed[0]!;
};

const ANTIGRAVITY_REF = "antigravity/";

/** A whole model reference, with a removed Antigravity model read as what replaces it. */
export const currentModelReference = (reference: string): string =>
  reference.startsWith(ANTIGRAVITY_REF)
    ? `${ANTIGRAVITY_REF}${antigravityModelInUse(reference.slice(ANTIGRAVITY_REF.length))}`
    : reference;

export type EngineModelCatalog = {
  claude: EngineModelOption[];
  chatgpt: EngineModelOption[];
};

export const ENGINE_MODEL_CATALOG: EngineModelCatalog = {
  claude: [...CLAUDE_ENGINE_MODELS],
  chatgpt: [...CHATGPT_ENGINE_MODELS],
};
