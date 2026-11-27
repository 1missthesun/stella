// Stella's pinned Bun: the version in packages/desktop/launcher.json, which every launcher installs
// into `<launcher root>/runtimes/bun-<version>/`. The Rune host runs only on that Bun (another
// version can fail at module load with nothing but `ResolveMessage {}`), so dev scripts pick it
// and the host entries refuse any other. Node built-ins only: imported before anything that
// could fail to load on the wrong Bun.

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const LAUNCHER_JSON = path.resolve(import.meta.dir, "../../../desktop/launcher.json");

export const pinnedBunVersion = (): string => {
  const pins = JSON.parse(readFileSync(LAUNCHER_JSON, "utf8")) as { bun?: { version?: string } };
  if (!pins.bun?.version) throw new Error(`no bun.version in ${LAUNCHER_JSON}`);
  return pins.bun.version;
};

/** The launchers' install root (launcher/{linux,macos,windows}): STELLA_LAUNCHER_ROOT wins. */
export const launcherRoot = (): string => {
  const override = process.env.STELLA_LAUNCHER_ROOT?.trim();
  if (override) return path.resolve(override.replace(/^~(?=$|[\\/])/, os.homedir()));
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Stella");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Stella");
  const xdg = process.env.XDG_DATA_HOME?.trim();
  return xdg ? path.join(xdg, "stella") : path.join(os.homedir(), ".local", "share", "stella");
};

export const pinnedBunPath = (version = pinnedBunVersion()): string =>
  path.join(launcherRoot(), "runtimes", `bun-${version}`, process.platform === "win32" ? "bun.exe" : "bun");

const runningPinned = (version: string) => typeof Bun !== "undefined" && Bun.version === version;

/**
 * The Bun to start the Rune host with: STELLA_RUNE_BUN, else the pinned runtime, else this
 * process's Bun when it is the pinned version. Throws with what to do when none is.
 */
export const stellaBun = (): string => {
  const version = pinnedBunVersion();
  const explicit = process.env.STELLA_RUNE_BUN?.trim();
  if (explicit) return explicit;
  const pinned = pinnedBunPath(version);
  if (existsSync(pinned)) return pinned;
  if (runningPinned(version)) return process.execPath;
  throw new Error(
    `Stella's Bun ${version} is not installed at ${pinned}, and this is Bun ${typeof Bun === "undefined" ? "(none)" : Bun.version} (${process.execPath}). ` +
      `Install it by running Stella's launcher once, or point STELLA_RUNE_BUN at a Bun ${version} binary.`,
  );
};

/** Exits the host with a clear message unless it runs on the pinned Bun (STELLA_RUNE_ANY_BUN=1 skips the check). */
export const requirePinnedBun = (entry: string) => {
  if (process.env.STELLA_RUNE_ANY_BUN === "1") return;
  let version: string;
  try {
    version = pinnedBunVersion();
  } catch (error) {
    console.error(`[${entry}] cannot read Stella's pinned Bun version: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (runningPinned(version)) return;
  console.error(
    `[${entry}] The Rune host needs Stella's Bun ${version}, but it was started with Bun ${typeof Bun === "undefined" ? "(none)" : Bun.version} at ${process.execPath}. ` +
      `Start it with ${pinnedBunPath(version)} (set STELLA_RUNE_BUN for the engine), or set STELLA_RUNE_ANY_BUN=1 to try anyway.`,
  );
  process.exit(78);
};

// `bun host/services/stella-bun.ts` prints the Bun to start the host with (scripts/xvfb.sh, launch.sh).
if (import.meta.main) {
  try {
    console.log(stellaBun());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
