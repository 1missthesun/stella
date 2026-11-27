import fs from "node:fs";
import { sleep } from "../shared/effect-timers.js";

/**
 * A first install opens Stella from a prebuilt app bundle, without git or
 * packages, and the launcher then sets up the rest of the app's folder behind
 * it: the git checkout, its signature and the packages. While it does, it
 * keeps its progress in the file STELLA_APP_HYDRATION names:
 *
 *   { "status": "pending" | "running" | "done" | "failed", "pid": n,
 *     "step": "...", "error": "..." }
 *
 * Anything that needs git or the packages (changing Stella, updating it,
 * building from source) waits on it with `waitForAppHydration` instead of
 * failing or doing the same work beside it.
 */

export const APP_HYDRATION_ENV = "STELLA_APP_HYDRATION";

export type AppHydrationState = {
  status: "pending" | "running" | "done" | "failed";
  pid?: number;
  step?: string;
  error?: string;
};

const POLL_MS = 500;

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const hydrationFile = (): string | null =>
  process.env[APP_HYDRATION_ENV]?.trim() || null;

export const readAppHydration = (): AppHydrationState | null => {
  const file = hydrationFile();
  if (!file) return null;
  try {
    const state = JSON.parse(fs.readFileSync(file, "utf8")) as AppHydrationState;
    return typeof state?.status === "string" ? state : null;
  } catch {
    return null;
  }
};

/** True while the launcher is still setting up the app's folder. */
export const appHydrationInProgress = (): boolean => {
  const state = readAppHydration();
  if (!state || state.status === "done" || state.status === "failed") return false;
  // A launcher that quit part way leaves "running"; the next launch resumes.
  return typeof state.pid !== "number" || alive(state.pid);
};

export class AppHydrationError extends Error {}

/**
 * Resolves once the app's folder is set up. Throws when the launcher could not
 * finish it (or quit part way), so the caller reports that instead of acting
 * on a folder without git or packages.
 */
export const waitForAppHydration = async (
  options: { signal?: AbortSignal; onWait?: (state: AppHydrationState) => void } = {},
): Promise<{ waited: boolean }> => {
  let state = readAppHydration();
  if (!state || state.status === "done") return { waited: false };
  let told = false;
  while (appHydrationInProgress() && !options.signal?.aborted) {
    if (!told && state) {
      told = true;
      options.onWait?.(state);
    }
    await sleep(POLL_MS);
    state = readAppHydration();
  }
  state = readAppHydration();
  if (options.signal?.aborted) throw new AppHydrationError("Stopped waiting for Stella to finish installing.");
  if (state && state.status !== "done") {
    throw new AppHydrationError(
      state.status === "failed"
        ? `Stella could not finish installing${state.error ? `: ${state.error}` : "."} Restart Stella to try again.`
        : "Stella has not finished installing. Restart Stella to finish.",
    );
  }
  return { waited: told };
};
