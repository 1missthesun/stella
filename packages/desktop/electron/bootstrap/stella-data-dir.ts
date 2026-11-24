import path from "node:path";
import type { App } from "electron";
import {
  resolveRuntimeStatePath,
  resolveStellaAppDir,
} from "@stella/node-shared/home/stella-paths";
import { ensurePrivateDir } from "@stella/node-shared/shared/private-fs";

export type StellaDataDir = {
  stellaAppDir: string;
  statePath: string;
  workspacePath: string;
};

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
