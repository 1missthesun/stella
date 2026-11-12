import path from "node:path";
import { removeWorktree } from "../electron/services/app-source/dir-links.js";

// Removes a finished draft's worktree; its `draft/<name>` branch stays.
//   bun "$STELLA_APP_DIR/packages/desktop/scripts/remove-draft.ts" "$STELLA_DRAFTS_DIR/<name>"
// Like `git worktree remove`, it refuses while the draft has uncommitted or
// untracked files. Use it instead of git on every platform: on Windows git
// follows the junctions in a draft's packages and can't remove its install.
const draft = process.argv[2] ? path.resolve(process.argv[2]) : "";
const appRoot = path.resolve(process.env.STELLA_APP_DIR ?? path.join(import.meta.dirname, "..", "..", ".."));
if (!draft || draft === appRoot) {
  console.error("Give the draft's folder (not the app checkout).");
  process.exit(2);
}
try {
  await removeWorktree(appRoot, draft, { keepChanges: true });
  console.log(`Removed ${draft}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
