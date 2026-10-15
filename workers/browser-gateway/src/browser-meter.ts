import { history, sessions } from "@cloudflare/playwright";
import { GatewayError } from "./errors.js";

type HoldResult = { ok: true } | { ok: false; message: string };

// cloud-builder's ComputeBilling entrypoint, which prices browser time at
// Stella's tariff and charges the owner's budget.
export type BrowserBilling = {
  browserHold(input: { ownerId: string; run: string }): Promise<HoldResult>;
  browserSettle(input: {
    ownerId: string;
    run: string;
    seq: number;
    seconds: number;
    basis: "actual" | "estimated";
    final: boolean;
    outcome?: "succeeded" | "aborted";
  }): Promise<HoldResult>;
  browserRelease(input: { ownerId: string; run: string }): Promise<void>;
};

type BrowserWorker = { fetch: typeof fetch };

type MeterRow = {
  run: string;
  owner_id: string;
  session_id: string;
  acquired_at: number;
  settled_through: number;
  last_used_at: number;
  seq: number;
  closed_at: number | null;
};

const SETTLE_EVERY_MS = 5 * 60_000;
const EXPIRY_GRACE_MS = 30_000;

/**
 * Browser Run time of the owner's agent browser sessions, acquire to close
 * (or keep_alive expiry), kept in the profile object's storage. A session is
 * held against the owner's budget before it is acquired; while it lives each
 * 5-minute interval is charged and the hold extended, and a session whose
 * hold cannot be extended is closed.
 */
export class BrowserSessionMeter {
  private pending: { run: string; ownerId: string } | null = null;
  private owner: string | undefined;

  constructor(
    private readonly sql: SqlStorage,
    private readonly billing: BrowserBilling | undefined,
    private readonly endpoint: BrowserWorker,
    private readonly keepAliveMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.table();
  }

  // The profile's purge drops every table; the next session recreates it.
  private table(): void {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS browser_meter (
      run TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      acquired_at INTEGER NOT NULL,
      settled_through INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      closed_at INTEGER
    )`);
  }

  forOwner(ownerId: string): void {
    this.owner = ownerId;
  }

  async admit(): Promise<void> {
    if (!this.billing || !this.owner) return;
    const run = crypto.randomUUID();
    const held = await this.billing.browserHold({ ownerId: this.owner, run });
    if (!held.ok) throw new GatewayError("budget_exhausted", 402, held.message);
    this.pending = { run, ownerId: this.owner };
  }

  acquired(sessionId: string): void {
    if (!this.pending) return;
    this.table();
    const at = this.now();
    this.sql.exec(
      `INSERT OR IGNORE INTO browser_meter (run, owner_id, session_id, acquired_at, settled_through, last_used_at, seq)
       VALUES (?, ?, ?, ?, ?, ?, 0)`,
      this.pending.run,
      this.pending.ownerId,
      sessionId,
      at,
      at,
      at,
    );
    this.pending = null;
  }

  async releasePending(): Promise<void> {
    const pending = this.pending;
    this.pending = null;
    if (pending && this.billing) await this.billing.browserRelease(pending).catch(() => undefined);
  }

  used(sessionId: string | undefined): void {
    if (!sessionId) return;
    this.table();
    this.sql.exec(
      "UPDATE browser_meter SET last_used_at = ? WHERE session_id = ? AND closed_at IS NULL",
      this.now(),
      sessionId,
    );
  }

  closed(sessionId: string): void {
    this.table();
    this.sql.exec(
      "UPDATE browser_meter SET closed_at = ? WHERE session_id = ? AND closed_at IS NULL",
      this.now(),
      sessionId,
    );
  }

  nextDue(): number | null {
    const rows = this.rows();
    if (rows.length === 0) return null;
    const now = this.now();
    return Math.max(
      now + 1_000,
      Math.min(
        ...rows.map((row) =>
          row.closed_at !== null
            ? now
            : Math.min(row.settled_through + SETTLE_EVERY_MS, row.last_used_at + this.keepAliveMs + EXPIRY_GRACE_MS),
        ),
      ),
    );
  }

  async tick(closeForBudget: (sessionId: string) => Promise<void>): Promise<void> {
    if (!this.billing) {
      this.table();
      this.sql.exec("DELETE FROM browser_meter");
      return;
    }
    let closedByCloudflare: Map<string, number> | undefined;
    let live: Set<string> | undefined;
    for (const row of this.rows()) {
      const now = this.now();
      if (row.closed_at !== null) {
        await this.settle(row, row.closed_at, "actual", true);
        continue;
      }
      if (now >= row.last_used_at + this.keepAliveMs + EXPIRY_GRACE_MS) {
        live ??= new Set((await sessions(this.endpoint).catch(() => [])).map((session) => session.sessionId));
        if (!live.has(row.session_id)) {
          closedByCloudflare ??= new Map(
            (await history(this.endpoint).catch(() => [])).map((session) => [session.sessionId, session.endTime]),
          );
          const endedAt = closedByCloudflare.get(row.session_id);
          await this.settle(
            row,
            endedAt ?? row.last_used_at + this.keepAliveMs,
            endedAt === undefined ? "estimated" : "actual",
            true,
          );
          continue;
        }
      }
      if (now - row.settled_through < SETTLE_EVERY_MS) continue;
      const result = await this.settle(row, now, "actual", false);
      if (result && !result.ok) {
        await closeForBudget(row.session_id).catch(() => undefined);
        this.closed(row.session_id);
        const current = this.rows().find((candidate) => candidate.run === row.run);
        if (current) await this.settle(current, current.closed_at ?? this.now(), "actual", true, "aborted");
      }
    }
  }

  private rows(): MeterRow[] {
    this.table();
    return this.sql.exec<MeterRow>("SELECT * FROM browser_meter").toArray();
  }

  private async settle(
    row: MeterRow,
    until: number,
    basis: "actual" | "estimated",
    final: boolean,
    outcome: "succeeded" | "aborted" = "succeeded",
  ): Promise<HoldResult | null> {
    const end = Math.max(row.settled_through, until);
    try {
      const result = await this.billing!.browserSettle({
        ownerId: row.owner_id,
        run: row.run,
        seq: row.seq,
        seconds: (end - row.settled_through) / 1000,
        basis,
        final,
        outcome,
      });
      if (final) {
        this.sql.exec("DELETE FROM browser_meter WHERE run = ?", row.run);
      } else {
        this.sql.exec(
          "UPDATE browser_meter SET settled_through = ?, seq = seq + 1 WHERE run = ?",
          end,
          row.run,
        );
      }
      console.log(
        JSON.stringify({
          service: "browser-gateway",
          event: "browser_meter_settled",
          seq: row.seq,
          seconds: Math.round((end - row.settled_through) / 1000),
          basis,
          final,
          outcome,
          held: result.ok,
        }),
      );
      return result;
    } catch (error) {
      console.error(
        JSON.stringify({
          service: "browser-gateway",
          event: "browser_meter_settle_failed",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      return null;
    }
  }
}
