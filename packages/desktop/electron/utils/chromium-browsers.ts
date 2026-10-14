import os from "node:os";
import path from "node:path";

type ChromiumBrowser = {
  mac: string[];
  linux: string[];
  windows: string[];
};

const CHROMIUM_BROWSERS: readonly ChromiumBrowser[] = [
  { mac: ["Google", "Chrome"], linux: ["google-chrome"], windows: ["Google", "Chrome"] },
  { mac: ["Microsoft Edge"], linux: ["microsoft-edge"], windows: ["Microsoft", "Edge"] },
  {
    mac: ["BraveSoftware", "Brave-Browser"],
    linux: ["BraveSoftware", "Brave-Browser"],
    windows: ["BraveSoftware", "Brave-Browser"],
  },
  { mac: ["Chromium"], linux: ["chromium"], windows: ["Chromium"] },
];

export const chromiumUserDataRoots = (): string[] => {
  const homedir = os.homedir();
  const plat = os.platform();
  if (plat === "darwin") {
    const appSupport = path.join(homedir, "Library", "Application Support");
    return CHROMIUM_BROWSERS.map((browser) => path.join(appSupport, ...browser.mac));
  }
  if (plat === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA?.trim() || path.join(homedir, "AppData", "Local");
    return CHROMIUM_BROWSERS.map((browser) =>
      path.join(localAppData, ...browser.windows, "User Data"),
    );
  }
  const cfg = path.join(homedir, ".config");
  return CHROMIUM_BROWSERS.map((browser) => path.join(cfg, ...browser.linux));
};

export const chromiumWindowsRegistryVendorKeys = (): string[] =>
  CHROMIUM_BROWSERS.map((browser) => browser.windows.join("\\"));
