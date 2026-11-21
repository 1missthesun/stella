import { purgeSlackOwner } from "./slack/store.js";
import type { Env } from "./build-session/shared/env.js";
import { errorMessage, log } from "./build-session/shared/keys.js";
import { purgeOwnerStorage } from "./build-session/owner-purge-transfer.js";
import type { OwnerPurgeMode } from "./owner-store/registry.js";
import type {
  OwnerFenceBeginInput,
  OwnerFenceBeginResult,
  OwnerFenceBlockedResult,
  OwnerFenceReleaseResult,
} from "./owner-fence.js";
import type { TurnStateOwnerResult } from "./turn-state-owner-routes.js";

export type OwnerPurgePass = {
  pending: string[];
};

/** The owner fence as the purge drives it; OwnerGate passes its own. */
export type OwnerPurgeFenceHandle = {
  begin(input: OwnerFenceBeginInput): Promise<OwnerFenceBeginResult>;
  assertBlocked(generation: string): Promise<OwnerFenceBlockedResult>;
  release(generation: string): Promise<OwnerFenceReleaseResult>;
  purgeTurnState(generation: string): Promise<TurnStateOwnerResult>;
};

/**
 * Blocks the owner fence, then asks every object holding a lease on it to
 * stop its turn, until no lease is left. Activity leases are not canceled;
 * they end on their own (or expire).
 */
const blockAndDrain = async (
  env: Env,
  ownerId: string,
  fence: OwnerPurgeFenceHandle,
  mode: "temporary" | "permanent",
  requestId: string,
): Promise<string> => {
  const begun = await fence.begin({ mode, requestId, ownerId });
  if (!begun.ok) throw new Error("Owner purge fence could not be created.");
  const { generation } = begun;
  let active = begun.active;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (active.length === 0) return generation;
    await Promise.all(
      active.map(async ({ leaseId, sessionId, turnId, namespace, ownerGeneration }) => {
        if (namespace === "activity") return;
        try {
          const target = namespace === "orchestrator" ? env.ORCHESTRATOR_SESSIONS : env.BUILD_SESSIONS;
          await target.get(target.idFromString(sessionId)).fetch("https://build-session/owner-purge-cancel", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ownerId, turnId, ownerGeneration, generation, leaseId }),
          });
        } catch (error) {
          log("error", "owner_purge_turn_cancel_failed", { sessionId, message: errorMessage(error) });
        }
      }),
    );
    await scheduler.wait(250);
    const blocked = await fence.assertBlocked(generation);
    if (!blocked.ok) throw new Error("Owner purge fence changed unexpectedly.");
    active = blocked.active;
  }
  throw new Error("Owner cloud turns did not quiesce before purge.");
};

const purgeTurnState = async (fence: OwnerPurgeFenceHandle, generation: string): Promise<boolean> => {
  try {
    const result = await fence.purgeTurnState(generation);
    return !result.ok || (result.value as { pending?: unknown } | null)?.pending !== false;
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
  fence: OwnerPurgeFenceHandle;
}): Promise<OwnerPurgePass> => {
  const { env, ownerId, mode, fence } = input;
  const generation = await blockAndDrain(
    env,
    ownerId,
    fence,
    mode === "delete" ? "permanent" : "temporary",
    input.requestId,
  );
  const pending: string[] = [];
  if (await purgeTurnState(fence, generation)) pending.push("turn-state");
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
    const released = await fence.release(generation);
    if (!released.ok) pending.push("fence");
  }
  log("info", "owner_purge_pass", { mode, deleted: storage.deleted, pending });
  return { pending };
};
