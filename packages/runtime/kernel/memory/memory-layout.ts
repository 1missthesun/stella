import path from "node:path";

export const MEMORIES_DIR = "memories";

export const MAIN_MEMORY_FILE = "main.md";
export const MAIN_MEMORY_RELATIVE_PATH = `${MEMORIES_DIR}/${MAIN_MEMORY_FILE}`;
export const PERSONALITY_FILE = "PERSONALITY.md";

export const MAIN_MEMORY_DISPLAY_PATH = "~/.stella/memories/main.md";

export const MAIN_MEMORY_INJECTED_MAX_CHARS = 23_000;
export const MAIN_MEMORY_NEAR_CAP_RATIO = 0.9;

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

export const mainMemoryPath = (stellaDataDir: string): string =>
  path.join(stellaDataDir, MEMORIES_DIR, MAIN_MEMORY_FILE);
