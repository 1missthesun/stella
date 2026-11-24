export const STELLA_LAUNCHER_ENV = "STELLA_LAUNCHER";
export const STELLA_DEV_HARNESS_ENV = "STELLA_DEV_HARNESS";

export type AppInstall = "product" | "harness" | "checkout";

export type AppIdentityOptions = {
  env?: NodeJS.ProcessEnv;
  isPackaged?: boolean;
};

export const resolveAppInstall = (
  options: AppIdentityOptions = {},
): AppInstall => {
  const env = options.env ?? process.env;
  if (options.isPackaged) return "product";
  if (env[STELLA_DEV_HARNESS_ENV]?.trim() === "1") return "harness";
  return env[STELLA_LAUNCHER_ENV]?.trim() === "1" ? "product" : "checkout";
};

export const isInstalledProduct = (options: AppIdentityOptions = {}): boolean =>
  resolveAppInstall(options) === "product";

export const isDevHarness = (options: AppIdentityOptions = {}): boolean =>
  resolveAppInstall(options) === "harness";
