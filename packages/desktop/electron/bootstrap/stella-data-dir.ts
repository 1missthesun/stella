import path from "node:path";
import type { App } from "electron";
import {
  resolveRuntimeStatePath,
  resolveStellaAppDir,
} from "@stella/runtime/kernel/home/stella-paths";
import { ensurePrivateDir } from "@stella/runtime/kernel/shared/private-fs";

export type StellaDataDir = {
  stellaAppDir: string;
  statePath: string;
  workspacePath: string;
};

/**
 * Which app checkout and home folder this launch uses, published to the
 * environment for everything main starts. Seeding the home folder (bundled
 * skills, layout migrations) is the runtime's job when it starts.
 */
export const resolveStellaDataDir = async (
  app: App,
  explicitRoot?: string,
  explicitStatePath?: string,
): Promise<StellaDataDir> => {
  const stellaAppDir = resolveStellaAppDir(app, explicitRoot);
  const statePath = resolveRuntimeStatePath(app, stellaAppDir, explicitStatePath);
  const workspacePath = path.join(statePath, "workspace");
  process.env.STELLA_APP_DIR = stellaAppDir;
  process.env.STELLA_DATA_DIR = statePath;
  await ensurePrivateDir(workspacePath);
  await ensurePrivateDir(path.join(workspacePath, "apps"));
  return { stellaAppDir, statePath, workspacePath };
};
