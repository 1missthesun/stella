

import { bundledPrompt } from "./prompts/bundled.js";

export type CanonicalPrompts = {
  orchestratorBody: string;
  personalityBody: string;
  compactionSystemPrompt: string;
};

export const CANONICAL_PROMPTS: CanonicalPrompts = {
  orchestratorBody: bundledPrompt("agents/orchestrator.md"),
  personalityBody: bundledPrompt("prompts/personality.md"),
  compactionSystemPrompt: bundledPrompt("prompts/thread-compaction.md"),
};
