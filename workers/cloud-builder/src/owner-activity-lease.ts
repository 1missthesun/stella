import { OwnerPurgeFenceError } from "./build-session/shared/errors.js";
import { OWNER_FENCE_DEFAULT_MAX_LEASE_MS } from "./owner-fence-store.js";

export type OwnerFenceCaller = (
  path: string,
  body: Record<string, unknown>,
) => Promise<Response>;

export const withOwnerActivityLease = async <T>(
  fence: OwnerFenceCaller,
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
  const registered = await fence("register", {
    leaseId,
    sessionId,
    turnId,
    ownerGeneration,
    namespace: "activity",
    role: "activity",
    expiresAt,
  });
  const registration = (await registered.json().catch(() => null)) as {
    generation?: string;
  } | null;
  if (!registered.ok || !registration?.generation) {
    throw new OwnerPurgeFenceError();
  }
  try {
    return await operation(registration.generation, leaseId);
  } finally {
    await fence("unregister", {
      leaseId,
      sessionId,
      turnId,
      ownerGeneration,
      generation: registration.generation,
    }).catch(() => undefined);
  }
};
