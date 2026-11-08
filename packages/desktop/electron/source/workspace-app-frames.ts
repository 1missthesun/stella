import { app } from "electron";
import { RENDERER_ORIGIN } from "./origin.js";

const WORKSPACE_APP_ROOT = /^\/workspace-apps\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\//;

const workspaceAppRoot = (value: string): string | null => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const root = WORKSPACE_APP_ROOT.exec(url.pathname);
  return root ? `${url.origin}${root[0]}` : null;
};

/**
 * A workspace app frame (CloudAppPanel) is agent-authored and may load any
 * https script, and it shares the app session. It stays inside its own signed
 * app root; only the app renderer may point the frame elsewhere.
 * Must run before any window exists.
 */
export const guardWorkspaceAppFrames = () => {
  app.on("web-contents-created", (_event, contents) => {
    const guard = (
      details: Electron.Event<
        | Electron.WebContentsWillFrameNavigateEventParams
        | Electron.WebContentsWillRedirectEventParams
      >,
    ) => {
      const frame = details.frame;
      if (details.isMainFrame || !frame) return;
      const root = workspaceAppRoot(frame.url);
      if (!root || workspaceAppRoot(details.url) === root) return;
      if (details.initiator?.url.startsWith(`${RENDERER_ORIGIN}/`)) return;
      details.preventDefault();
    };
    contents.on("will-frame-navigate", guard);
    contents.on("will-redirect", guard);
  });
};
