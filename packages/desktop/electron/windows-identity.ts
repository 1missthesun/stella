import { app, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { getMainLogger } from "./observability/main-logger.js";
import {
  STELLA_WINDOWS_APP_USER_MODEL_ID,
  STELLA_WINDOWS_DEV_APP_USER_MODEL_ID,
  STELLA_WINDOWS_TOAST_ACTIVATOR_CLSID,
} from "./bootstrap/constants.js";

// Electron names it after electron.exe's own ProductName.
const ELECTRON_SHORTCUT_NAME = "Electron.lnk";

const removeStrayShortcut = (shortcutPath: string) => {
  const stat = fs.lstatSync(shortcutPath, { throwIfNoEntry: false });
  if (!stat?.isFile()) return;
  const { appUserModelId } = shell.readShortcutLink(shortcutPath);
  if (
    appUserModelId !== STELLA_WINDOWS_APP_USER_MODEL_ID &&
    appUserModelId !== STELLA_WINDOWS_DEV_APP_USER_MODEL_ID
  ) {
    return;
  }
  fs.unlinkSync(shortcutPath);
  getMainLogger()?.process("windows-identity.stray-shortcut-removed", {
    appUserModelId,
  });
};

/**
 * Stella's name and icon on the taskbar and in Start come from the launcher's
 * Stella.lnk, which carries our AppUserModelID. The first notification makes
 * Electron write a second shortcut with that ID: "Electron", pointing at bare
 * electron.exe. Windows then shows Stella as Electron on the taskbar, and
 * Start lists "Electron", which opens an empty Electron window, instead of
 * Stella. Electron has no switch for it, so a folder holds the shortcut's name
 * and the write fails. Start doesn't list empty folders, and notifications
 * only need the ID on Stella.lnk.
 */
const keepElectronShortcutOut = () => {
  const shortcutPath = path.join(
    app.getPath("appData"),
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    ELECTRON_SHORTCUT_NAME,
  );
  try {
    removeStrayShortcut(shortcutPath);
    // A file still here is some other app's Electron.lnk.
    if (!fs.existsSync(shortcutPath)) fs.mkdirSync(shortcutPath);
  } catch (error) {
    console.warn("[windows-identity] Could not keep Electron's shortcut out of Start:", error);
  }
};

/** Before the first window and the first notification. */
export const applyWindowsIdentity = (options: { isInstalledProduct: boolean }) => {
  // A test copy with the product's ID shares its taskbar button and its
  // notifications.
  app.setAppUserModelId(
    options.isInstalledProduct
      ? STELLA_WINDOWS_APP_USER_MODEL_ID
      : STELLA_WINDOWS_DEV_APP_USER_MODEL_ID,
  );
  // Left unset, Electron registers a new random one under HKCU\Software\Classes
  // on every launch.
  app.setToastActivatorCLSID(STELLA_WINDOWS_TOAST_ACTIVATOR_CLSID);
  keepElectronShortcutOut();
};
