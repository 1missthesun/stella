import { DurableObject } from "cloudflare:workers";
import {
  LedgerStore,
  type LedgerReserveArgs,
  type LedgerReserveResult,
  type LedgerSettleArgs,
  type LedgerSettleResult,
} from "./ledger-store.js";

/**
 * One SQLite-backed Durable Object per legacy capability `jti`: the budget,
 * request-count and replay authority for capabilities without an owner
 * ledger scope. At `expires_at + GATEWAY_RESULT_CACHE_TTL_MS` it deletes
 * everything.
 */
export class CapabilityLedger extends DurableObject<Env> {
  private store!: LedgerStore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      this.store = new LedgerStore(ctx.storage);
      ctx.storage.sql.exec(
        "UPDATE results SET jti = (SELECT jti FROM ledger LIMIT 1) WHERE jti IS NULL",
      );
    });
  }

  async reserve(args: LedgerReserveArgs): Promise<LedgerReserveResult> {
    const result = this.store.reserveSync(args);
    await this.store.armAlarm();
    return result;
  }

  async settle(args: LedgerSettleArgs): Promise<LedgerSettleResult> {
    const jti = this.ctx.storage.sql
      .exec<{ jti: string }>("SELECT jti FROM ledger LIMIT 1")
      .toArray()[0]?.jti;
    if (jti === undefined) {
      return { ok: false, spentMicroCents: 0, reservedMicroCents: 0, cached: false };
    }
    return this.store.settleSync({ ...args, jti });
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
    this.store = new LedgerStore(this.ctx.storage);
  }
}
