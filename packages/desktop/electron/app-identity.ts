export const STELLA_LAUNCHER_ENV = "STELLA_LAUNCHER";
export const STELLA_DEV_HARNESS_ENV = "STELLA_DEV_HARNESS";

export type AppInstall = "product" | "harness" | "checkout";

export type AppIdentityOptions = {
  env?: NodeJS.ProcessEnv;
  /**
   * `app.isPackaged`, for the one caller that still has it. Stella has no
   * packaging step, so this is false everywhere; it is honoured only so that a
   * hypothetical packaged build would classify as the product rather than as a
   * developer checkout.
   */
  isPackaged?: boolean;
};

export const resolveAppInstall = (
  options: AppIdentityOptions = {},
): AppInstall => {
  const env = options.env ?? process.env;
  // A packaged build could never be a harness, and a harness is never the
  // product even when the launcher started it.
  if (options.isPackaged) return "product";
  if (env[STELLA_DEV_HARNESS_ENV]?.trim() === "1") return "harness";
  return env[STELLA_LAUNCHER_ENV]?.trim() === "1" ? "product" : "checkout";
};

export const isInstalledProduct = (options: AppIdentityOptions = {}): boolean =>
  resolveAppInstall(options) === "product";

export const isDevHarness = (options: AppIdentityOptions = {}): boolean =>
  resolveAppInstall(options) === "harness";
