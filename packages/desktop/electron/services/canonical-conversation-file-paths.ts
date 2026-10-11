import { extractLocalFileLinkPaths } from "@stella/contracts/local-file-links";
import type { SqliteDatabase } from "@stella/runtime/kernel/storage/shared";
import fs from "node:fs/promises";
import path from "node:path";

/** Do not turn a linked symlink into a new phone file grant. Include the
 * real path of regular files so macOS /var and /private/var aliases work.
 */
export const resolveCanonicalConversationFilePaths = async (
  paths: readonly string[],
): Promise<Set<string>> => {
  const allowed = new Set<string>();
  for (const filePath of paths) {
    try {
      const resolved = path.resolve(filePath);
      if (!(await fs.lstat(resolved)).isFile()) continue;
      const real = await fs.realpath(resolved);
      allowed.add(resolved);
      allowed.add(real);
    } catch {
      /* Missing or inaccessible files grant nothing. */
    }
  }
  return allowed;
};
