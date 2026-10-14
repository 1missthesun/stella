import os from "node:os";
import path from "node:path";
import {
  resolveAppInstall,
  type AppIdentityOptions,
  type AppInstall,
} from "./app-identity.js";

export const STELLA_PRODUCTION_DATA_DIR_NAME = ".stella";
export const STELLA_DEVELOPMENT_DATA_DIR_NAME = ".stella-development";

export type DesktopStellaDataMode = "development" | "production";

export const resolveDesktopStellaDataDirPath = (options: {
  mode: DesktopStellaDataMode;
  configuredStatePath?: string | null;
  homeDir?: string;
}): string => {
  const configured = options.configuredStatePath?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.join(
    options.homeDir ?? os.homedir(),
    options.mode === "development"
      ? STELLA_DEVELOPMENT_DATA_DIR_NAME
      : STELLA_PRODUCTION_DATA_DIR_NAME,
  );
};

export const desktopStellaDataMode = (
  install: AppInstall,
): DesktopStellaDataMode =>
  install === "product" ? "production" : "development";

export const resolveDesktopStellaDataDirForInstall = (
  options: AppIdentityOptions = {},
): string => {
  const env = options.env ?? process.env;
  const mode = desktopStellaDataMode(resolveAppInstall(options));
  return resolveDesktopStellaDataDirPath({
    mode,
    configuredStatePath:
      mode === "production" ? env.STELLA_DATA_DIR : env.STELLA_V2_DEV_DATA_DIR,
  });
};

