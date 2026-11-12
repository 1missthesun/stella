import path from "node:path";

export const MEMORIES_DIR = "memories";

export const MAIN_MEMORY_FILE = "main.md";
export const MAIN_MEMORY_RELATIVE_PATH = `${MEMORIES_DIR}/${MAIN_MEMORY_FILE}`;
export const PERSONALITY_FILE = "PERSONALITY.md";

export const MAIN_MEMORY_DISPLAY_PATH = "~/.stella/memories/main.md";

export const MAIN_MEMORY_INJECTED_MAX_CHARS = 23_000;
export const MAIN_MEMORY_NEAR_CAP_RATIO = 0.9;

/** The user's standing rules for all work: in Stella's context and in every task's and helper's. */
export const RULES_MEMORY_FILE = "rules.md";
export const RULES_MEMORY_RELATIVE_PATH = `${MEMORIES_DIR}/${RULES_MEMORY_FILE}`;
export const RULES_MEMORY_DISPLAY_PATH = "~/.stella/memories/rules.md";
export const RULES_MEMORY_MAX_CHARS = 6_000;

const formatChars = (chars: number): string => chars.toLocaleString("en-US");

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

export const rulesMemoryCapNote = (chars: number): string | undefined => {
  const size = `rules.md is ${formatChars(chars)}/${formatChars(RULES_MEMORY_MAX_CHARS)} characters`;
  if (chars > RULES_MEMORY_MAX_CHARS) {
    return `${size}; anything past the cap is cut from every task's context. Tighten lines, or move rules that only one area needs into its area file.`;
  }
  if (chars >= RULES_MEMORY_MAX_CHARS * MAIN_MEMORY_NEAR_CAP_RATIO) {
    return `${size}; near the cap, past which the rest is cut from every task's context. Tighten lines, or move rules that only one area needs into its area file.`;
  }
  return undefined;
};

export const memoryCapNote = (relativePath: string, chars: number): string | undefined =>
  relativePath === RULES_MEMORY_RELATIVE_PATH ? rulesMemoryCapNote(chars) : mainMemoryCapNote(chars);

export const mainMemoryPath = (stellaDataDir: string): string =>
  path.join(stellaDataDir, MEMORIES_DIR, MAIN_MEMORY_FILE);
