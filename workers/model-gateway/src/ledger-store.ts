import {
  GATEWAY_MAX_RESULT_CACHE_BYTES,
  GATEWAY_RESULT_CACHE_TTL_MS,
  GATEWAY_UPSTREAM_MAX_DURATION_MS,
} from "@stella/contracts/gateway/api";
import { GATEWAY_BUDGET_UNLIMITED } from "@stella/contracts/gateway/capability";
import type { GatewayUsageEvent } from "@stella/contracts/gateway/usage";

export const RESERVATION_LEASE_MS = GATEWAY_UPSTREAM_MAX_DURATION_MS + 60_000;

export type LedgerReserveArgs = {
  jti: string;
  budgetMicroCents: number;
  maxRequests?: number;
  /** Capability expiry, ms since epoch. */
  expiresAt: number;
  requestId: string;
  /** The most this attempt can cost; held in full when the budget allows. */
  estimatedMicroCents: number;
  /** Hold less than the estimate, down to this floor, when that is all that is left. */
  minimumMicroCents?: number;
};

export type LedgerReserveResult =
  | {
      kind: "reserved";
      attempt: string;
      /** 1 for the first physical attempt of this request id, 2+ for retries. */
      attemptNumber: number;
      heldMicroCents: number;
      remainingMicroCents: number | null;
    }
  | { kind: "replay"; status: number; body: string }
  | { kind: "in_flight" }
  | { kind: "budget_exhausted"; remainingMicroCents: number }
  | { kind: "request_limit"; maxRequests: number };

export type LedgerSettleArgs = {
  requestId: string;
  attempt: string;
  chargedMicroCents: number;
  /** Refund the request count when no provider output byte was received. */
  refundRequest: boolean;
  /** Present for a completed result that should be replayable. */
  result?: { status: number; body: string };
  /** Kept in the outbox, in the same transaction, until billing acknowledges it. */
  usage?: GatewayUsageEvent;
};

export type LedgerSettleResult = {
  ok: boolean;
  spentMicroCents: number;
  reservedMicroCents: number;
  cached: boolean;
};

export type LedgerSnapshot = {
  budgetMicroCents: number;
  spentMicroCents: number;
  reservedMicroCents: number;
  requests: number;
  maxRequests: number | null;
  expiresAt: number;
} | null;

type LedgerRow = {
  jti: string;
  budget: number;
  spent: number;
  reserved: number;
  requests: number;
  max_requests: number | null;
  expires_at: number;
};

type ResultRow = {
  request_id: string;
  attempt: string | null;
  attempts: number;
  status: number;
  body: string | null;
  bytes: number;
  reserved: number;
  created_at: number;
};

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ledger (
    jti TEXT PRIMARY KEY,
    budget INTEGER NOT NULL,
    spent INTEGER NOT NULL DEFAULT 0,
    reserved INTEGER NOT NULL DEFAULT 0,
    requests INTEGER NOT NULL DEFAULT 0,
    max_requests INTEGER,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ledger_expiry ON ledger(expires_at)`,
  `CREATE TABLE IF NOT EXISTS results (
    jti TEXT NOT NULL,
    request_id TEXT NOT NULL,
    attempt TEXT,
    status INTEGER NOT NULL,
    body TEXT,
    bytes INTEGER NOT NULL DEFAULT 0,
    reserved INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (jti, request_id)
  )`,
  `CREATE TABLE IF NOT EXISTS usage_outbox (
    id TEXT PRIMARY KEY,
    event TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    next_at INTEGER NOT NULL,
    tries INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS usage_outbox_due ON usage_outbox(next_at)`,
];

// Result rows: status > 0 holds a replayable result, 0 an attempt in flight,
// and SETTLED_UNREPLAYABLE a finished attempt whose result was not kept, so
// the next attempt for that request id is counted as a retry.
const SETTLED_UNREPLAYABLE = -1;

export type OutboxEntry = { id: string; event: GatewayUsageEvent; tries: number; createdAt: number };

export const usageOutboxId = (event: GatewayUsageEvent): string =>
  JSON.stringify([event.capabilityId, event.requestId, event.attempt ?? 1]);

const clampMicroCents = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

/**
 * Capability budget, request-count and replay accounting, keyed by jti.
 * Every method is synchronous SQL, so the hosting object's input gate makes
 * each one atomic. A reservation is owned by the attempt token `reserve`
 * returns: only that attempt can settle it, and once its lease lapses the
 * next reserve for the same request id replaces it with a new attempt.
 */
export class LedgerStore {
  constructor(private readonly storage: DurableObjectStorage) {
    for (const statement of SCHEMA) this.storage.sql.exec(statement);
    const columns = new Set(
      this.storage.sql
        .exec<{ name: string }>("SELECT name FROM pragma_table_info('results')")
        .toArray()
        .map((column) => column.name),
    );
    if (!columns.has("attempt")) {
      this.storage.sql.exec("ALTER TABLE results ADD COLUMN attempt TEXT");
    }
    if (!columns.has("jti")) {
      this.storage.sql.exec("ALTER TABLE results ADD COLUMN jti TEXT");
    }
    if (!columns.has("attempts")) {
      this.storage.sql.exec("ALTER TABLE results ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0");
    }
  }

  private ledgerRow(jti: string): LedgerRow | null {
    return (
      this.storage.sql
        .exec<LedgerRow>("SELECT * FROM ledger WHERE jti = ?", jti)
        .toArray()[0] ?? null
    );
  }

  snapshot(jti: string): LedgerSnapshot {
    const row = this.ledgerRow(jti);
    return row
      ? {
          budgetMicroCents: row.budget,
          spentMicroCents: row.spent,
          reservedMicroCents: row.reserved,
          requests: row.requests,
          maxRequests: row.max_requests,
          expiresAt: row.expires_at,
        }
      : null;
  }

  replay(jti: string, requestId: string): { status: number; body: string } | null {
    const row = this.storage.sql
      .exec<ResultRow>(
        "SELECT * FROM results WHERE jti = ? AND request_id = ? AND status > 0",
        jti,
        requestId,
      )
      .toArray()[0];
    return row && row.body !== null
      ? { status: row.status, body: row.body }
      : null;
  }

  reserveSync(args: LedgerReserveArgs): LedgerReserveResult {
    const now = Date.now();
    const estimate = clampMicroCents(args.estimatedMicroCents);
    const floor = Math.min(estimate, clampMicroCents(args.minimumMicroCents ?? estimate));
    let row = this.ledgerRow(args.jti);
    if (!row) {
      this.storage.sql.exec(
        "INSERT INTO ledger (jti, budget, spent, reserved, requests, max_requests, expires_at) VALUES (?, ?, 0, 0, 0, ?, ?)",
        args.jti,
        Math.round(args.budgetMicroCents),
        args.maxRequests === undefined ? null : Math.floor(args.maxRequests),
        Math.round(args.expiresAt),
      );
      row = this.ledgerRow(args.jti);
      if (!row) throw new Error("ledger row vanished after insert");
    }

    const existing = this.storage.sql
      .exec<ResultRow>(
        "SELECT * FROM results WHERE jti = ? AND request_id = ?",
        args.jti,
        args.requestId,
      )
      .toArray()[0];
    let replacingLapsed = false;
    if (existing) {
      if (existing.status > 0 && existing.body !== null) {
        return { kind: "replay", status: existing.status, body: existing.body };
      }
      if (existing.status === 0) {
        if (now - existing.created_at <= RESERVATION_LEASE_MS) {
          return { kind: "in_flight" };
        }
        this.storage.sql.exec(
          "UPDATE ledger SET reserved = MAX(0, reserved - ?) WHERE jti = ?",
          existing.reserved,
          args.jti,
        );
        row = this.ledgerRow(args.jti) ?? row;
        replacingLapsed = true;
      }
    }

    if (
      !replacingLapsed &&
      row.max_requests !== null &&
      row.requests >= row.max_requests
    ) {
      return { kind: "request_limit", maxRequests: row.max_requests };
    }
    const unlimited = row.budget === GATEWAY_BUDGET_UNLIMITED || row.budget < 0;
    const remaining = unlimited
      ? null
      : Math.max(0, row.budget - row.spent - row.reserved);
    const held = remaining === null ? estimate : Math.min(estimate, remaining);
    if (remaining !== null && (held < floor || (estimate > 0 && held <= 0))) {
      return { kind: "budget_exhausted", remainingMicroCents: remaining };
    }

    const attempt = crypto.randomUUID();
    const attemptNumber = Math.max(0, existing?.attempts ?? 0) + 1;
    this.storage.sql.exec(
      `INSERT INTO results (jti, request_id, attempt, attempts, status, body, bytes, reserved, created_at)
       VALUES (?, ?, ?, ?, 0, NULL, 0, ?, ?)
       ON CONFLICT(jti, request_id) DO UPDATE SET attempt = excluded.attempt, attempts = excluded.attempts,
         status = 0, body = NULL, bytes = 0, reserved = excluded.reserved, created_at = excluded.created_at`,
      args.jti,
      args.requestId,
      attempt,
      attemptNumber,
      held,
      now,
    );
    this.storage.sql.exec(
      "UPDATE ledger SET reserved = reserved + ?, requests = requests + ? WHERE jti = ?",
      held,
      replacingLapsed ? 0 : 1,
      args.jti,
    );
    return {
      kind: "reserved",
      attempt,
      attemptNumber,
      heldMicroCents: held,
      remainingMicroCents: remaining === null ? null : Math.max(0, remaining - held),
    };
  }

  settleSync(args: LedgerSettleArgs & { jti: string }): LedgerSettleResult {
    if (args.usage) this.enqueueUsageSync(args.usage);
    const row = this.ledgerRow(args.jti);
    const pending = this.storage.sql
      .exec<ResultRow>(
        "SELECT * FROM results WHERE jti = ? AND request_id = ? AND attempt IS ? AND status = 0",
        args.jti,
        args.requestId,
        args.attempt ?? null,
      )
      .toArray()[0];
    if (!row || !pending) {
      return {
        ok: false,
        spentMicroCents: row?.spent ?? 0,
        reservedMicroCents: row?.reserved ?? 0,
        cached: false,
      };
    }
    const charged = clampMicroCents(args.chargedMicroCents);
    this.storage.sql.exec(
      "UPDATE ledger SET reserved = MAX(0, reserved - ?), spent = spent + ?, requests = MAX(0, requests - ?) WHERE jti = ?",
      pending.reserved,
      charged,
      args.refundRequest ? 1 : 0,
      args.jti,
    );
    let cached = false;
    const result = args.result;
    if (result && result.status > 0) {
      const bytes = new TextEncoder().encode(result.body).byteLength;
      if (bytes <= GATEWAY_MAX_RESULT_CACHE_BYTES) {
        this.storage.sql.exec(
          "UPDATE results SET status = ?, body = ?, bytes = ?, reserved = 0 WHERE jti = ? AND request_id = ?",
          result.status,
          result.body,
          bytes,
          args.jti,
          args.requestId,
        );
        cached = true;
      }
    }
    if (!cached) {
      this.storage.sql.exec(
        "UPDATE results SET status = ?, body = NULL, bytes = 0, reserved = 0 WHERE jti = ? AND request_id = ?",
        SETTLED_UNREPLAYABLE,
        args.jti,
        args.requestId,
      );
    }
    const updated = this.ledgerRow(args.jti);
    return {
      ok: true,
      spentMicroCents: updated?.spent ?? 0,
      reservedMicroCents: updated?.reserved ?? 0,
      cached,
    };
  }

  enqueueUsageSync(event: GatewayUsageEvent): void {
    const now = Date.now();
    this.storage.sql.exec(
      "INSERT OR IGNORE INTO usage_outbox (id, event, created_at, next_at, tries) VALUES (?, ?, ?, ?, 0)",
      usageOutboxId(event),
      JSON.stringify(event),
      now,
      now,
    );
  }

  dueUsage(now: number, limit: number): OutboxEntry[] {
    return this.storage.sql
      .exec<{ id: string; event: string; tries: number; created_at: number }>(
        "SELECT id, event, tries, created_at FROM usage_outbox WHERE next_at <= ? ORDER BY next_at LIMIT ?",
        now,
        limit,
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        event: JSON.parse(row.event) as GatewayUsageEvent,
        tries: row.tries,
        createdAt: row.created_at,
      }));
  }

  hasPendingUsage(): boolean {
    return this.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM usage_outbox")
      .one().count > 0;
  }

  deliveredUsage(ids: readonly string[]): void {
    for (const id of ids) this.storage.sql.exec("DELETE FROM usage_outbox WHERE id = ?", id);
  }

  deferUsage(id: string, tries: number, nextAt: number): void {
    this.storage.sql.exec(
      "UPDATE usage_outbox SET tries = ?, next_at = ? WHERE id = ?",
      tries,
      nextAt,
      id,
    );
  }

  private nextAlarmAt(): number | null {
    const ledger = this.storage.sql
      .exec<{ at: number | null }>(
        "SELECT MIN(expires_at) + ? AS at FROM ledger",
        GATEWAY_RESULT_CACHE_TTL_MS,
      )
      .one().at;
    const outbox = this.storage.sql
      .exec<{ at: number | null }>("SELECT MIN(next_at) AS at FROM usage_outbox")
      .one().at;
    const candidates = [ledger, outbox].filter((at): at is number => at !== null);
    return candidates.length > 0 ? Math.min(...candidates) : null;
  }

  /** Arms the alarm for the next ledger expiry or usage delivery, unless an earlier one is set. */
  async armAlarm(): Promise<void> {
    const next = this.nextAlarmAt();
    if (next === null) return;
    const at = Math.max(Date.now() + 250, next);
    const current = await this.storage.getAlarm();
    if (current === null || at < current) await this.storage.setAlarm(at);
  }

  /** Inside alarm(): the fired alarm is gone, so set the next one unconditionally. */
  async rearmAfterAlarm(): Promise<void> {
    const next = this.nextAlarmAt();
    if (next !== null) await this.storage.setAlarm(Math.max(Date.now() + 250, next));
  }

  expireSync(): void {
    const cutoff = Date.now() - GATEWAY_RESULT_CACHE_TTL_MS;
    this.storage.sql.exec(
      "DELETE FROM results WHERE jti IN (SELECT jti FROM ledger WHERE expires_at <= ?)",
      cutoff,
    );
    this.storage.sql.exec("DELETE FROM ledger WHERE expires_at <= ?", cutoff);
  }
}
