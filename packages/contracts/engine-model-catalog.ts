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

export type EngineModelCatalog = {
  claude: EngineModelOption[];
  chatgpt: EngineModelOption[];
};

export const ENGINE_MODEL_CATALOG: EngineModelCatalog = {
  claude: [...CLAUDE_ENGINE_MODELS],
  chatgpt: [...CHATGPT_ENGINE_MODELS],
};
