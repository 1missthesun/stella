import { TARIFF_VERSION, type CostCategory } from "@stella/contracts/billing-tariffs";
import { object, string } from "../args.js";
import type { OwnerContext } from "../registry.js";
import { reservationHeld, settleSpend } from "./billing.js";

export const SPEND_EXPIRE_JOB = "spend.expire";

const expireJobId = (id: string) => `spend.expire:${id}`;

// Only holds for provider calls that may have been billed without settling.
// Session grants, turn grants and compute holds expire uncharged by design.
const EXPIRING_PREFIXES = ["tts:", "dictation:", "maps:", "search:"];
const chargesOnExpiry = (id: string): boolean => EXPIRING_PREFIXES.some((prefix) => id.startsWith(prefix));

type ExpiryTarget = { id: string; category: CostCategory; provider: string; sku: string };

// When the caller that reserved never settles (its worker died mid-request),
// charge whatever is still held at the deadline as the best estimate of what
// the provider billed. Every normal path settles and releases first, so this
// finds nothing to charge.
export const expireSpendAt = (ctx: OwnerContext, target: ExpiryTarget, at: number): void => {
  if (!chargesOnExpiry(target.id)) throw new Error(`spend.expire does not handle ${target.id}.`);
  ctx.jobs.schedule(SPEND_EXPIRE_JOB, at, target, { id: expireJobId(target.id) });
};

export const cancelSpendExpiry = (ctx: OwnerContext, id: string): void => {
  ctx.jobs.cancel(expireJobId(id));
};

const targetArg = object({
  id: string({ min: 1, max: 200 }),
  category: string({ min: 1, max: 40 }),
  provider: string({ min: 1, max: 80 }),
  sku: string({ max: 200 }),
});

const runExpiry = (ctx: OwnerContext, raw: unknown): void => {
  const target = targetArg(raw);
  if (!chargesOnExpiry(target.id)) return;
  const held = reservationHeld(ctx, target.id);
  if (held <= 0) return;
  const now = Date.now();
  settleSpend(
    { ...ctx, now },
    {
      receiptId: `${target.id}:expired`,
      chargeMicroCents: held,
      reservationId: target.id,
      release: true,
      cost: {
        id: `${target.id}:expired`,
        category: target.category as CostCategory,
        provider: target.provider,
        sku: target.sku,
        providerCostMicroCents: held,
        basis: "estimated",
        outcome: "expired",
        tariffVersion: TARIFF_VERSION,
      },
    },
  );
  console.log(JSON.stringify({ event: "spend_expired_unsettled", id: target.id, chargedMicroCents: held }));
};

export const spendExpiryJobs = {
  [SPEND_EXPIRE_JOB]: { run: runExpiry },
};
