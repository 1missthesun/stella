import { BrowserWindow, type WebContents } from "electron";

/**
 * The window a native dialog may be parented to. Electron parents a dialog to
 * the window it is given, and on Wayland a dialog parented to an unmapped
 * window (hidden, or a never-shown host such as an in-app browser tab's) is a
 * protocol error that aborts the app. Returns undefined when no candidate is
 * visible; the dialog then opens on its own.
 */
export const visibleDialogParent = (
  sender?: WebContents | null,
  ...fallbacks: Array<BrowserWindow | null | undefined>
): BrowserWindow | undefined =>
  [
    sender && !sender.isDestroyed() ? BrowserWindow.fromWebContents(sender) : null,
    BrowserWindow.getFocusedWindow(),
    ...fallbacks,
  ].find(
    (window): window is BrowserWindow =>
      !!window && !window.isDestroyed() && window.isVisible(),
  );
