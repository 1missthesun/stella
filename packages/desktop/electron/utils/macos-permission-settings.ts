import { shell } from "electron";

const SETTINGS_URL_BY_KIND: Record<string, string> = {
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  "full-disk-access": "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
  microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
};

const SETTINGS_RELAUNCH_GUARD_MS = 1500;
let lastLaunchAt = 0;
let launching: Promise<boolean> | null = null;

export const launchPermissionSettings = (
  open: () => Promise<unknown>,
): Promise<boolean> => {
  if (launching) return launching;
  if (Date.now() - lastLaunchAt < SETTINGS_RELAUNCH_GUARD_MS) {
    return Promise.resolve(false);
  }
  launching = (async () => {
    try {
      await open();
      lastLaunchAt = Date.now();
      return true;
    } catch {
      return false;
    } finally {
      launching = null;
    }
  })();
  return launching;
};

export const openMacPermissionSettings = async (
  kind: string,
): Promise<{ opened: boolean; url: string | null }> => {
  const url = SETTINGS_URL_BY_KIND[kind] ?? null;
  if (!url) return { opened: false, url };
  return { opened: await launchPermissionSettings(() => shell.openExternal(url)), url };
};
