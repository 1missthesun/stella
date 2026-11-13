import { promises as fs } from "node:fs";
import path from "node:path";

import { resolveRuntimeStatePath } from "../home/stella-paths.js";
import {
  MEMORY_SYNC_MAX_BYTES,
  isSyncedMemoryPath,
  memorySyncTooLargeMessage,
} from "./memory-client.js";

/**
 * What a task that just wrote a file should know when that file is a memory
 * file too big to sync: it would otherwise stay on this computer with nothing
 * but a log line saying so. Undefined for every other file.
 */
export const memorySyncNoteForFile = async (
  absolutePath: string,
  stellaDataDir?: string,
): Promise<string | undefined> => {
  try {
    const root = path.resolve(stellaDataDir?.trim() || resolveRuntimeStatePath());
    const relative = path.relative(root, path.resolve(absolutePath));
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return undefined;
    }
    const memoryPath = relative.split(path.sep).join("/");
    if (!isSyncedMemoryPath(memoryPath)) return undefined;
    const { size } = await fs.stat(absolutePath);
    if (size <= MEMORY_SYNC_MAX_BYTES) return undefined;
    return `${memorySyncTooLargeMessage(memoryPath, size)} Make it smaller (tighten it, or split it into more area files) so it syncs.`;
  } catch {
    return undefined;
  }
};
