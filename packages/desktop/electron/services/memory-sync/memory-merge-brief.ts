import path from "node:path";

import { memoryFileMaxChars } from "@stella/runtime/kernel/memory/memory-client.js";

export type MemoryMerge = { path: string; copy: string };

const limit = memoryFileMaxChars;

export const memoryMergeBrief = (
  stellaDataDir: string,
  merges: readonly MemoryMerge[],
): { description: string; prompt: string } => {
  const files = merges
    .map((merge) => {
      const target = path.join(stellaDataDir, ...merge.path.split("/"));
      return `- \`${target}\` (at most ${limit(merge.path).toLocaleString("en-US")} characters). This computer's version: \`${merge.copy}\``;
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
- Keep its layout and stay under its character limit; tighten wording rather than drop facts.
- When the file is merged, delete this computer's saved version.

Touch no other file. The app copies the merged file to the cloud and your other computers by itself; never upload anything yourself. Report in one or two lines what you merged.`,
  };
};
