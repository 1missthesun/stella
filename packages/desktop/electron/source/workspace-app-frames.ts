import { app, shell } from "electron";
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

const EXTERNAL_OPEN_MIN_INTERVAL_MS = 1_000;
let lastExternalOpenAtMs = 0;

/** A link that leaves the app opens in the browser, like links in the main window. */
const openOutsideApp = (value: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return;
  const now = Date.now();
  if (now - lastExternalOpenAtMs < EXTERNAL_OPEN_MIN_INTERVAL_MS) return;
  lastExternalOpenAtMs = now;
  void shell.openExternal(url.toString());
};

/**
 * A workspace app frame (CloudAppPanel) is agent-authored and may load any
 * https script, and it shares the app session. It stays inside its own signed
 * app root; only the app renderer may point the frame elsewhere. A link it
 * follows out of that root opens in the browser instead.
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
      return true;
    };
    contents.on("will-frame-navigate", (details) => {
      if (guard(details) === true) openOutsideApp(details.url);
    });
    contents.on("will-redirect", guard);
  });
};
