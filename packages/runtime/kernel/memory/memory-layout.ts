/**
 * The on-disk layout of Stella's memory, and the budget that bounds what is
 * injected from it.
 *
 * Memory is plain markdown under `~/.stella/memories/`. The orchestrator
 * edits it through the `memory` client inside `code` (`memory-client.ts`);
 * every other agent uses its ordinary file tools. In the cloud the same files
 * live in the owner's world under `/workspace/world/.stella/`, and each of
 * the owner's computers keeps its copy the same as the cloud's, both ways
 * (the desktop's memory sync in Electron main, over cloud-builder's
 * `memory.files.*`).
 *
 *   - `memories/main.md`  the one resident document: who the user is, how
 *     they want Stella to work, global rules, and an "Areas" section with one
 *     line per area file. Onboarding writes it first.
 *   - `memories/areas/<area>.md`  one file per area of the user's life and
 *     work, matching the named-area agents. Read on demand, never injected.
 *
 * The budget below bounds INJECTION only — it never deletes anything on
 * disk. An over-budget document is truncated at a line boundary with a
 * visible marker, so the agent can see that it is not reading the whole file
 * and curate it down.
 */

import path from "node:path";

export const MEMORIES_DIR = "memories";
export const MEMORY_AREAS_DIR = "areas";

export const MAIN_MEMORY_FILE = "main.md";
/** `memories/main.md`, relative to `~/.stella`. */
export const MAIN_MEMORY_RELATIVE_PATH = `${MEMORIES_DIR}/${MAIN_MEMORY_FILE}`;
/**
 * The user's personality override beside memory, `~/.stella/PERSONALITY.md`.
 * Not memory to the model (`memory.*` never names it), but it is kept the
 * same on every computer and in the cloud, and a memory wipe erases it.
 */
export const PERSONALITY_FILE = "PERSONALITY.md";

/** Display path — what the model sees and what it edits. */
export const MAIN_MEMORY_DISPLAY_PATH = "~/.stella/memories/main.md";

/**
 * Injection budget, in unicode code points. Hitting it means the document
 * needs editing down, not that memory should be thrown away.
 */
export const MAIN_MEMORY_INJECTED_MAX_CHARS = 23_000;

export const memoriesDirPath = (stellaDataDir: string): string =>
  path.join(stellaDataDir, MEMORIES_DIR);

export const mainMemoryPath = (stellaDataDir: string): string =>
  path.join(stellaDataDir, MEMORIES_DIR, MAIN_MEMORY_FILE);
