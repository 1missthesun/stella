import { WorkerEntrypoint } from "cloudflare:workers";
import type { CostBasis, CostOutcome } from "@stella/contracts/billing-tariffs";
import { holdBrowser, releaseBrowser, settleBrowser, type BrowserHoldResult } from "../browser-billing.js";

const validOwner = (ownerId: unknown): ownerId is string =>
  typeof ownerId === "string" && ownerId.length > 0 && ownerId.length <= 512;

const validRun = (run: unknown): run is string => typeof run === "string" && /^[A-Za-z0-9-]{1,64}$/u.test(run);

// Metered compute other Workers run for an owner (the browser gateway's
// agent browser sessions), charged to that owner's budget.
export class ComputeBilling extends WorkerEntrypoint<Env> {
  async browserHold(input: { ownerId: string; run: string }): Promise<BrowserHoldResult> {
    if (!validOwner(input?.ownerId) || !validRun(input.run)) throw new Error("Invalid browser hold.");
    return await holdBrowser(this.env, input);
  }

  async browserSettle(input: {
    ownerId: string;
    run: string;
    seq: number;
    seconds: number;
    basis: CostBasis;
    final: boolean;
    outcome?: CostOutcome;
  }): Promise<BrowserHoldResult> {
    if (
      !validOwner(input?.ownerId) ||
      !validRun(input.run) ||
      !Number.isSafeInteger(input.seq) ||
      input.seq < 0 ||
      !Number.isFinite(input.seconds) ||
      input.seconds < 0 ||
      (input.basis !== "actual" && input.basis !== "estimated")
    ) {
      throw new Error("Invalid browser settlement.");
    }
    return await settleBrowser(this.env, {
      ownerId: input.ownerId,
      run: input.run,
      seq: input.seq,
      seconds: Math.min(input.seconds, 24 * 3_600),
      basis: input.basis,
      final: input.final === true,
      ...(input.outcome ? { outcome: input.outcome } : {}),
    });
  }

  async browserRelease(input: { ownerId: string; run: string }): Promise<void> {
    if (!validOwner(input?.ownerId) || !validRun(input.run)) throw new Error("Invalid browser release.");
    await releaseBrowser(this.env, input);
  }
}
