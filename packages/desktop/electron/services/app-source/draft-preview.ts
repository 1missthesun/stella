import { WebContentsView } from "electron";
import { serveRendererSource } from "../../source/renderer-protocol.js";
import { getSourceUrl } from "../../windows/window-load.js";
import { createSharedWebPreferences } from "../../windows/shared-window-preferences.js";
import { configureStellaSessionPermissions } from "../../bootstrap/session-permissions.js";
import { getMainLogger } from "../../observability/main-logger.js";
import { DRAFT_REF_PREFIX, isDraftName, listWorktrees } from "./git.js";
import { prepareDraftDependencies } from "./draft-deps.js";

export type DraftPreview = {
  view: WebContentsView;
  url: string;
  dispose: () => void;
};

/**
 * The full Stella UI served from a draft worktree, headless inside the
 * running app: same preload and IPC as the real windows (so the user's real
 * account and runtime), but its own in-memory session, so browser storage is
 * separate.
 */
export const openDraftPreview = async (options: {
  name: string;
  stellaAppDir: string;
  preloadPath: string;
}): Promise<DraftPreview> => {
  if (!isDraftName(options.name)) {
    throw new Error(`"${options.name}" is not a valid draft name.`);
  }
  const branch = `${DRAFT_REF_PREFIX}${options.name}`;
  const worktree = (await listWorktrees(options.stellaAppDir)).find(
    (tree) => tree.branch === branch,
  );
  if (!worktree) {
    throw new Error(
      `No draft named "${options.name}" is in progress (no worktree on draft/${options.name}).`,
    );
  }
  const deps = await prepareDraftDependencies({ draftRoot: worktree.path, appRoot: options.stellaAppDir });
  getMainLogger()?.process("app-source.preview-deps", { draft: options.name, mode: deps.mode, ms: deps.ms });
  const partition = `stella-preview-${options.name}`;
  configureStellaSessionPermissions({ appPartition: partition });
  const source = serveRendererSource({
    partition,
    sourceRoot: worktree.path,
    envRoot: options.stellaAppDir,
    // A preview is an authoring surface: the agent iterating on the draft wants
    // hot updates and readable errors, whichever mode the app itself serves.
    mode: "development",
    // Closing the preview then gives back everything its server allocated.
    isolate: "process",
    log: (message) =>
      getMainLogger()?.process("renderer.preview-source", {
        draft: options.name,
        message,
      }),
  });
  const view = new WebContentsView({
    webPreferences: createSharedWebPreferences({
      preloadPath: options.preloadPath,
      sessionPartition: partition,
      // Agents screenshot it while it sits in a hidden host.
      backgroundThrottling: false,
    }),
  });
  return {
    view,
    url: getSourceUrl("full"),
    dispose: () => source.dispose(),
  };
};
