import { purgeSlackOwner } from "./slack/store.js";
import type { Env } from "./build-session/shared/env.js";
import { errorMessage, log } from "./build-session/shared/keys.js";
import {
  beginOwnerPurge,
  callOwnerFence,
  purgeOwnerStorage,
} from "./build-session/owner-purge-transfer.js";
import type { OwnerPurgeMode } from "./owner-store/registry.js";

export type OwnerPurgePass = {
  pending: string[];
};

const purgeTurnState = async (env: Env, ownerId: string, generation: string): Promise<boolean> => {
  try {
    const response = await callOwnerFence(env, ownerId, "turn-state/purge", { schemaVersion: 1, generation });
    const result = (await response.json().catch(() => null)) as { pending?: unknown } | null;
    return !response.ok || result?.pending !== false;
  } catch (error) {
    log("error", "owner_storage_purge_step_failed", { store: "turn-state", message: errorMessage(error) });
    return true;
  }
};

const purgeBrowserProfile = async (env: Env, ownerId: string): Promise<boolean> => {
  if (!env.BROWSER_GATEWAY) return true;
  const requestId = crypto.randomUUID();
  try {
    const response = await env.BROWSER_GATEWAY.fetch("https://browser-gateway/internal/owners/purge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, ownerId, requestId }),
    });
    const result = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return !(response.ok && result?.requestId === requestId && result.purged === true);
  } catch {
    log("error", "owner_storage_purge_step_failed", { store: "browser-profile:default" });
    return true;
  }
};

export const runOwnerPurge = async (input: {
  env: Env;
  ownerId: string;
  mode: OwnerPurgeMode;
  requestId: string;
  purgeOwnerData: () => Promise<{ pending: string[] }>;
}): Promise<OwnerPurgePass> => {
  const { env, ownerId, mode } = input;
  const { generation } = await beginOwnerPurge(
    env,
    ownerId,
    mode === "delete" ? "permanent" : "temporary",
    input.requestId,
  );
  const pending: string[] = [];
  if (await purgeTurnState(env, ownerId, generation)) pending.push("turn-state");
  if (await purgeBrowserProfile(env, ownerId)) pending.push("browser-profile:default");
  try {
    await purgeSlackOwner(env as unknown as Cloudflare.Env, ownerId, mode === "delete" ? "delete" : "reset");
  } catch (error) {
    pending.push("slack");
    log("error", "owner_storage_purge_step_failed", { store: "slack", message: errorMessage(error) });
  }
  try {
    const ownerData = await input.purgeOwnerData();
    pending.push(...ownerData.pending.map((domain) => `owner-data:${domain}`));
  } catch (error) {
    pending.push("owner-data");
    log("error", "owner_storage_purge_step_failed", { store: "owner-data", message: errorMessage(error) });
  }
  const storage = await purgeOwnerStorage(env, ownerId, { ownerId, purgeGeneration: generation, mode });
  pending.push(...storage.pending);
  if (pending.length === 0 && mode === "reset") {
    const released = await callOwnerFence(env, ownerId, "release", { generation });
    if (!released.ok) pending.push("fence");
  }
  log("info", "owner_purge_pass", { mode, deleted: storage.deleted, pending });
  return { pending };
};
