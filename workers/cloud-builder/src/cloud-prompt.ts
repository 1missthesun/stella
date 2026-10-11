/**
 * Canonical cloud prompt assembly.
 *
 * The prompt set is bundled into this worker (`prompts/defaults.generated.ts`,
 * generated from the runtime sources desktop Stella ships), so a turn reads
 * it from the module with no fetch. Publishing a prompt change is a deploy.
 *
 * `orchestrator.md` is one source for every environment: what differs in the
 * cloud sits in its `<!-- when cloud -->` fences and in tool fences that
 * follow this turn's real tools (`memory` and `history` exist only while
 * cloud memory is on), so nothing here overrides or rewrites it. Everything
 * else the model reads (personality, memory, skills, execution context) is
 * placed by the same resident registry as on the desktop.
 */



import { bundledPrompt } from "./prompts/bundled.js";

export type CanonicalPrompts = {
  /** The raw `agents/orchestrator.md` source; rendered per turn. */
  orchestratorBody: string;
  personalityBody: string;
  /** The summarizer's system prompt, as on the desktop. */
  compactionSystemPrompt: string;
};

export const CANONICAL_PROMPTS: CanonicalPrompts = {
  orchestratorBody: bundledPrompt("agents/orchestrator.md"),
  personalityBody: bundledPrompt("prompts/personality.md"),
  compactionSystemPrompt: bundledPrompt("prompts/thread-compaction.md"),
};
