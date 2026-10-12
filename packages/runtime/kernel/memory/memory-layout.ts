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
 *   - `memories/main.md`  the one resident document: an "Areas" section
 *     first, with one line per area file, then who the user is, how they
 *     want Stella to work, and global rules. Onboarding writes it first.
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
 * Injection budget, in unicode code points. Writes past it still succeed;
 * the injected copy keeps the top (Areas first) and is cut at the cap.
 */
export const MAIN_MEMORY_INJECTED_MAX_CHARS = 23_000;
/** From this share of the cap, a write to main.md reports how full it is. */
export const MAIN_MEMORY_NEAR_CAP_RATIO = 0.9;

const formatChars = (chars: number): string => chars.toLocaleString("en-US");

/**
 * The one-line size reminder for main.md at `chars` characters, or undefined
 * while it is comfortably under the cap.
 */
export const mainMemoryCapNote = (chars: number): string | undefined => {
  const size = `main.md is ${formatChars(chars)}/${formatChars(MAIN_MEMORY_INJECTED_MAX_CHARS)} characters`;
  if (chars > MAIN_MEMORY_INJECTED_MAX_CHARS) {
    return `${size}; anything past the cap is cut from your context. Move area detail into area files or tighten lines.`;
  }
  if (chars >= MAIN_MEMORY_INJECTED_MAX_CHARS * MAIN_MEMORY_NEAR_CAP_RATIO) {
    return `${size}; near the cap, past which the rest is cut from your context. Move area detail into area files or tighten lines.`;
  }
  return undefined;
};

export const memoriesDirPath = (stellaDataDir: string): string =>
  path.join(stellaDataDir, MEMORIES_DIR);

export const mainMemoryPath = (stellaDataDir: string): string =>
  path.join(stellaDataDir, MEMORIES_DIR, MAIN_MEMORY_FILE);
