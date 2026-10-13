/**
 * Give a draft worktree its packages:
 *
 *   bun "$STELLA_APP_DIR/packages/desktop/scripts/draft-deps.ts" "$STELLA_DRAFTS_DIR/<name>"
 *
 * Links the app checkout's node_modules while the draft's dependencies match
 * the checkout's, and installs the draft's own once they differ (removing
 * the link first, so the install never touches the running app's packages).
 */
import path from "node:path";
import { prepareDraftDependencies } from "../electron/services/app-source/draft-deps.js";

const draftRoot = path.resolve(process.argv[2] ?? process.cwd());
const appRoot = path.resolve(process.env.STELLA_APP_DIR ?? path.join(import.meta.dirname, "..", "..", ".."));
if (draftRoot === appRoot) {
  console.error("That is the app checkout itself, not a draft.");
  process.exit(2);
}
const result = await prepareDraftDependencies({ draftRoot, appRoot, bun: process.execPath });
const said = {
  ready: "Dependencies are ready.",
  linked: "Linked the app's packages (the draft's dependencies match the app's).",
  installed: "Installed the draft's own packages (its dependencies differ from the app's).",
};
console.log(`${said[result.mode]} (${result.ms} ms)`);
