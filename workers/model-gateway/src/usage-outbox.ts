import type {
  BillingControlRpc,
  GatewayUsageEvent,
} from "@stella/contracts/gateway/usage";
import { GATEWAY_USAGE_EVENT_VERSION } from "@stella/contracts/gateway/usage";
import type { LedgerStore, OutboxEntry } from "./ledger-store.js";

const BATCH_SIZE = 100;
const RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 180_000, 600_000, 1_800_000, 3_600_000] as const;
const UNRECONCILED_AFTER_TRIES = RETRY_DELAYS_MS.length;
const GIVE_UP_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

// The owner refuses these for good; retrying cannot land them.
const PERMANENT_REJECTIONS = new Set(["owner_mismatch"]);

const retryDelay = (tries: number): number =>
  RETRY_DELAYS_MS[Math.min(tries, RETRY_DELAYS_MS.length) - 1] ??
  RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];

export const logUnreconciled = (
  event: GatewayUsageEvent,
  reason: string,
  extra: Record<string, unknown> = {},
): void => {
  console.error(
    JSON.stringify({
      event: "billing_usage_unreconciled",
      reason,
      ownerId: event.ownerId,
      capabilityId: event.capabilityId,
      requestId: event.requestId,
      attempt: event.attempt ?? 1,
      outcome: event.outcome,
      chargedMicroCents: event.chargedMicroCents,
      providerCostMicroCents: event.providerCostMicroCents ?? event.chargedMicroCents,
      ...extra,
      usage: event,
    }),
  );
};

/**
 * Delivers due usage events to the owner's billing. An event leaves the
 * outbox only once billing has accepted it or already had it; everything
 * else is retried with backoff, and logged as unreconciled when it keeps
 * failing.
 */
export const flushUsageOutbox = async (
  store: LedgerStore,
  billing: BillingControlRpc,
  now = Date.now(),
): Promise<void> => {
  for (;;) {
    const due = store.dueUsage(now, BATCH_SIZE);
    if (due.length === 0) return;
    let rejected = new Map<string, string>();
    let landed = new Set<string>();
    let failure: string | null = null;
    try {
      const result = await billing.ingestUsage({
        v: GATEWAY_USAGE_EVENT_VERSION,
        events: due.map((entry) => entry.event),
      });
      landed = new Set([...result.accepted, ...result.duplicate]);
      rejected = new Map(result.rejected.map((entry) => [entry.requestId, entry.reason]));
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    const delivered: string[] = [];
    for (const entry of due) {
      const reason = failure ?? rejected.get(entry.event.requestId) ?? null;
      if (!failure && landed.has(entry.event.requestId) && !rejected.has(entry.event.requestId)) {
        delivered.push(entry.id);
        continue;
      }
      if (reason && PERMANENT_REJECTIONS.has(reason)) {
        logUnreconciled(entry.event, reason, { permanent: true });
        delivered.push(entry.id);
        continue;
      }
      defer(store, entry, reason ?? "not_acknowledged", now);
    }
    store.deliveredUsage(delivered);
    if (failure || delivered.length < due.length) return;
  }
};

const defer = (store: LedgerStore, entry: OutboxEntry, reason: string, now: number): void => {
  const tries = entry.tries + 1;
  if (now - entry.createdAt >= GIVE_UP_AFTER_MS) {
    logUnreconciled(entry.event, reason, { tries, droppedAfterMs: now - entry.createdAt });
    store.deliveredUsage([entry.id]);
    return;
  }
  if (tries === UNRECONCILED_AFTER_TRIES) logUnreconciled(entry.event, reason, { tries, retrying: true });
  else {
    console.warn(
      `[model-gateway:usage] delivery deferred reason=${reason} tries=${tries} request=${entry.event.requestId} attempt=${entry.event.attempt ?? 1}`,
    );
  }
  store.deferUsage(entry.id, tries, now + retryDelay(tries));
};
