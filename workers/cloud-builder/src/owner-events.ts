import {
  ownerReadsEvent,
  type OwnerEvent,
} from "@stella/contracts/turn-plane/owner-events";
import { ownerGateStub } from "./rpc-release.js";

export type OwnerEventsEnv = Pick<Cloudflare.Env, "OWNER_GATES">;

export const deliverOwnerEvents = async (
  env: OwnerEventsEnv,
  events: readonly OwnerEvent[],
): Promise<void> => {
  const byOwner = new Map<string, OwnerEvent[]>();
  for (const event of events) {
    if (!ownerReadsEvent(event)) continue;
    const batch = byOwner.get(event.ownerId) ?? [];
    batch.push(event);
    byOwner.set(event.ownerId, batch);
  }
  for (const [ownerId, batch] of byOwner) {
    await ownerGateStub(env.OWNER_GATES, ownerId).applyOwnerEvents(batch);
  }
};
