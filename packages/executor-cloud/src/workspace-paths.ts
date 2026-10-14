import path from "node:path";

export const WORLD_ROOT = "/workspace/world";

export const worldDriveRoot = (worldRoot: string): string =>
  path.join(worldRoot, "drive");

export const toolStateDir = (root: string): string =>
  path.join(root, ".stella");

export const worldDriveWorkspace = (worldRoot: string) => {
  const root = worldDriveRoot(worldRoot);
  return Object.freeze({ root, stateDir: toolStateDir(root) });
};
