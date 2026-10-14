import { sha256Hex } from "./hash.js";
import { sandboxLifecycleId } from "./sandbox-lifecycle.js";

export const WORLD_ROOT = "/workspace/world";

/**
 * Scratch root for the legacy app-build turn. Outside the world on purpose:
 * an app build is rebuilt from its sources every time and is never restored.
 */
export const APP_BUILD_ROOT = "/workspace/app";

export const checkpointKey = async (ownerId: string): Promise<string> =>
  `ws:${await sha256Hex(ownerId)}`;

export const worldName = async (ownerId: string): Promise<string> =>
  `${await sha256Hex(ownerId)}:${await sha256Hex(await checkpointKey(ownerId))}`;

export const agentSandboxId = async (
  ownerId: string,
  threadId: string,
): Promise<string> =>
  await sandboxLifecycleId("agent", {
    ownerId,
    workspaceKey: await checkpointKey(ownerId),
    threadId,
  });

export const worldSandboxId = async (ownerId: string): Promise<string> =>
  await sandboxLifecycleId("world", {
    ownerId,
    workspaceKey: await checkpointKey(ownerId),
  });

export const agentTurnSessionId = (turnId: string): string =>
  `agent-run-${turnId}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 56);

export const checkpointBackupName = (key: string): string =>
  `stella-${key.slice(3, 27)}`;
