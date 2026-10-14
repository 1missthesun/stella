import path from "path";
import { promises as fs } from "fs";
import type { App } from "electron";

import { Effect } from "effect";

import { ensurePrivateDir } from "../shared/private-fs.js";
import {
  migrateLegacyHomeLayout,
  migrateLegacySystemSkillRoot,
} from "./legacy-migration.js";
import {
  listIncludedBundledSkillIds,
  reconcileBundledSkillsEffect,
  summarizeSkillsSync,
} from "./skills-sync.js";
import { withHome } from "./home-runtime.js";
import { removeGeneratedConnectorSkills } from "./generated-connector-skills.js";
import {
  resolveRuntimeStatePath,
  resolveStellaAppDir,
  resolveStellaDataSeedDir,
} from "./stella-paths.js";

// Path helpers are re-exported so existing Electron-side importers keep
// working; runtime-worker code must import `stella-paths.js` directly so this
// module (and the sync machinery it drags in) stays out of the worker bundle.
export {
  resolveRuntimeStatePath,
  resolveStellaAppDir,
  resolveStellaDataSeedDir,
};

export type StellaDataDir = {
  stellaAppDir: string;
  stellaDataDir: string;
  extensionsPath: string;
  statePath: string;
  workspacePath: string;
  workspaceAppsPath: string;
};

export type StellaDataDirSeedReport = {
  synced: boolean;
};

const tryIO = <A>(f: () => Promise<A>): Effect.Effect<A, unknown> =>
  Effect.tryPromise({ try: f, catch: (error) => error });

const ensureDir = async (dirPath: string) => {
  await ensurePrivateDir(dirPath);
};

const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const copyPathIfMissing = async (sourcePath: string, targetPath: string) => {
  if (await pathExists(targetPath)) {
    return;
  }
  const stat = await fs.lstat(sourcePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  if (stat.isDirectory()) {
    await fs.cp(sourcePath, targetPath, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    return;
  }
  await fs.copyFile(sourcePath, targetPath);
};

const STELLA_DATA_SEED_ENTRIES = [path.join("outputs", "README.md")] as const;

export const ensureStellaDataDirSeededEffect = (
  stellaAppDir: string,
  stellaDataDir: string,
): Effect.Effect<StellaDataDirSeedReport, unknown> =>
  Effect.gen(function* () {
    yield* tryIO(() => ensureDir(stellaDataDir));
    const seedPath = resolveStellaDataSeedDir(stellaAppDir);
    for (const entry of STELLA_DATA_SEED_ENTRIES) {
      const sourcePath = path.join(seedPath, entry);
      if (!(yield* tryIO(() => pathExists(sourcePath)))) {
        continue;
      }
      yield* tryIO(() =>
        copyPathIfMissing(sourcePath, path.join(stellaDataDir, entry)),
      );
    }

    yield* tryIO(() => migrateLegacyHomeLayout(stellaDataDir));

    const bundledSkillsDir = path.join(seedPath, "skills");
    const bundledSkillIds = yield* tryIO(() =>
      listIncludedBundledSkillIds(bundledSkillsDir),
    );
    yield* tryIO(() =>
      migrateLegacySystemSkillRoot(stellaDataDir, bundledSkillIds),
    );
    const removedConnectorSkills = yield* tryIO(() =>
      removeGeneratedConnectorSkills(stellaDataDir),
    );
    if (removedConnectorSkills.length > 0) {
      yield* Effect.sync(() =>
        console.log(
          `[stella-home] removed generated connector skills: ${removedConnectorSkills.join(", ")}`,
        ),
      );
    }
    const skillsSync = yield* reconcileBundledSkillsEffect(
      bundledSkillsDir,
      path.join(stellaDataDir, "skills"),
    );
    const applied = skillsSync.actions.some(
      (action) =>
        action.type === "seed" ||
        action.type === "update" ||
        action.type === "remove-obsolete",
    );
    if (applied) {
      yield* Effect.sync(() =>
        console.log(
          `[stella-home] bundled skills reconciled: ${summarizeSkillsSync(skillsSync)}`,
        ),
      );
    }

    return { synced: applied };
  });

export const ensureStellaDataDirSeeded = (
  stellaAppDir: string,
  stellaDataDir: string,
): Promise<StellaDataDirSeedReport> =>
  withHome((home) => home.ensureStellaDataDirSeeded(stellaAppDir, stellaDataDir));

export const resolveStellaDataDirEffect = (
  app: App,
  explicitRoot?: string,
  explicitStatePath?: string,
): Effect.Effect<StellaDataDir, unknown> =>
  Effect.gen(function* () {
    const resolved = yield* Effect.sync(() => {
      const stellaAppDir = resolveStellaAppDir(app, explicitRoot);
      const statePath = resolveRuntimeStatePath(
        app,
        stellaAppDir,
        explicitStatePath,
      );
      const runtimeRoot = path.join(stellaAppDir, "runtime");
      const workspacePath = path.join(statePath, "workspace");

      const extensionsPath = path.join(runtimeRoot, "extensions");
      const workspaceAppsPath = path.join(workspacePath, "apps");

      process.env.STELLA_APP_DIR = stellaAppDir;
      process.env.STELLA_DATA_DIR = statePath;

      return {
        stellaAppDir,
        statePath,
        extensionsPath,
        workspacePath,
        workspaceAppsPath,
      };
    });

    yield* tryIO(() => ensureDir(resolved.workspacePath));
    yield* tryIO(() => ensureDir(resolved.workspaceAppsPath));

    return {
      stellaAppDir: resolved.stellaAppDir,
      stellaDataDir: resolved.statePath,
      extensionsPath: resolved.extensionsPath,
      statePath: resolved.statePath,
      workspacePath: resolved.workspacePath,
      workspaceAppsPath: resolved.workspaceAppsPath,
    };
  });

export const resolveStellaDataDir = (
  app: App,
  explicitRoot?: string,
  explicitStatePath?: string,
): Promise<StellaDataDir> =>
  withHome((home) =>
    home.resolveStellaDataDir(app, explicitRoot, explicitStatePath),
  );
