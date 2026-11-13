import path from "node:path";

import { memoryFileMaxChars } from "@stella/runtime/kernel/memory/memory-client.js";
import {
  MAIN_MEMORY_RELATIVE_PATH,
  RULES_MEMORY_RELATIVE_PATH,
} from "@stella/runtime/kernel/memory/memory-layout.js";

export type MemoryMerge = { path: string; copy: string };

// Only the files in every turn's context have a size that matters to a merge;
// sync carries an area file of any ordinary size.
const limitNote = (relative: string): string =>
  relative === MAIN_MEMORY_RELATIVE_PATH || relative === RULES_MEMORY_RELATIVE_PATH
    ? ` (at most ${memoryFileMaxChars(relative).toLocaleString("en-US")} characters)`
    : "";

export const memoryMergeBrief = (
  stellaDataDir: string,
  merges: readonly MemoryMerge[],
): { description: string; prompt: string } => {
  const files = merges
    .map((merge) => {
      const target = path.join(stellaDataDir, ...merge.path.split("/"));
      return `- \`${target}\`${limitNote(merge.path)}. This computer's version: \`${merge.copy}\``;
    })
    .join("\n");
  return {
    description:
      merges.length === 1
        ? `Merge memory edits to ${merges[0]!.path}`
        : `Merge memory edits to ${merges.length} files`,
    prompt: `Stella's memory changed on this computer and in the cloud at the same time, and the two versions below differ. The app kept the cloud's version in place and saved this computer's version beside it. Nobody is waiting on a question: merge them.

${files}

For each file:
- Edit the file in place with your file tools so it holds everything true from both versions: keep what either side added, drop duplicates, and where they contradict keep the one that reads as newer.
- Keep its layout, and keep a file with a character limit under it; tighten wording rather than drop facts.
- When the file is merged, delete this computer's saved version.

Touch no other file. The app copies the merged file to the cloud and your other computers by itself; never upload anything yourself. Report in one or two lines what you merged.`,
  };
};
