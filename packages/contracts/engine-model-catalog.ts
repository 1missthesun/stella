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
 * Gemini on the user's Google Antigravity plan, which runs only on a computer
 * signed in to it. Keep in step with `agent/src/provider/antigravity/models.ts`.
 */
export const ANTIGRAVITY_ENGINE_MODELS: readonly EngineModelOption[] = [
  {
    id: "gemini-4-neon",
    name: "Gemini 4 Neon",
    description: "Most capable · Google AI Pro or Ultra",
  },
  {
    id: "gemini-4-hydrogen",
    name: "Gemini 4 Hydrogen",
    description: "Google AI Pro or Ultra",
  },
  {
    id: "gemini-4-carbon",
    name: "Gemini 4 Carbon",
    description: "Google AI Ultra",
  },
  {
    id: "gemini-4-argon",
    name: "Gemini 4 Argon",
    description: "Google AI Pro or Ultra",
  },
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    description: "Fast · every plan",
  },
];

export type EngineModelCatalog = {
  claude: EngineModelOption[];
  chatgpt: EngineModelOption[];
};

export const ENGINE_MODEL_CATALOG: EngineModelCatalog = {
  claude: [...CLAUDE_ENGINE_MODELS],
  chatgpt: [...CHATGPT_ENGINE_MODELS],
};
