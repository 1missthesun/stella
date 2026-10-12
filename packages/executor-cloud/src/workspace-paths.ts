/**
 * The one world a cloud turn runs in, and where its private state lives.
 *
 * The mount path is part of the cloud contract, not a local convention: the
 * BuildSession DO checkpoints exactly one directory per owner, so the executor
 * and the DO must agree on the path character-for-character or a turn
 * checkpoints the wrong tree.
 */

import path from "node:path";

/** The single checkpointed root, mirrored from the builder worker. */
export const WORLD_ROOT = "/workspace/world";

/**
 * Where the user's drive is hydrated and where deliverables are collected
 * from. A file anywhere else in the world is the agent's working material,
 * not something the user receives.
 */
export const worldDriveRoot = (worldRoot: string): string =>
  path.join(worldRoot, "drive");

/**
 * Where the tool host keeps its private state (shell state, deferred-delete
 * logs, office sessions).
 *
 * It is deliberately a dot-directory inside the world root rather than a
 * sibling: `/workspace` outside the world is root-owned and holds per-turn
 * files the tool account must never write. This state is per-turn scratch that
 * happens to ride along in the checkpoint.
 */
export const toolStateDir = (root: string): string =>
  path.join(root, ".stella");

export const worldDriveWorkspace = (worldRoot: string) => {
  const root = worldDriveRoot(worldRoot);
  return Object.freeze({ root, stateDir: toolStateDir(root) });
};
