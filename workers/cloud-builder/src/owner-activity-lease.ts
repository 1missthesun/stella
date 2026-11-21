import { OwnerPurgeFenceError } from "./build-session/shared/errors.js";
import { OWNER_FENCE_DEFAULT_MAX_LEASE_MS } from "./owner-fence-store.js";
import type { OwnerFenceClient } from "./owner-fence-client.js";

export const withOwnerActivityLease = async <T>(
  fence: OwnerFenceClient,
  ownerGeneration: string,
  activityId: string,
  operation: (generation: string, leaseId: string) => Promise<T>,
): Promise<T> => {
  const sessionId = `activity-${activityId}`;
  const turnId = activityId;
  const leaseId = crypto.randomUUID();
  // Activity leases cannot be canceled by owner purge, so every one needs a
  // durable crash expiry. Thirty minutes leaves ample room for large world
  // operations while guaranteeing an evicted isolate cannot wedge the owner.
  // The fence clamps the request to its own maximum and tolerates a caller
  // clock that runs ahead, so asking for the full maximum is safe.
  const expiresAt = Date.now() + OWNER_FENCE_DEFAULT_MAX_LEASE_MS;
  const registered = await fence.register({
    leaseId,
    sessionId,
    turnId,
    ownerGeneration,
    namespace: "activity",
    role: "activity",
    expiresAt,
  });
  if (!registered.ok) throw new OwnerPurgeFenceError();
  try {
    return await operation(registered.generation, leaseId);
  } finally {
    await fence
      .unregister({
        leaseId,
        sessionId,
        turnId,
        ownerGeneration,
        generation: registered.generation,
      })
      .catch(() => undefined);
  }
};
