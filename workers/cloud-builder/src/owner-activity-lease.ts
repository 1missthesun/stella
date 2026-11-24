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
