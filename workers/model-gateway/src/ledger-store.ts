import {
  GATEWAY_MAX_RESULT_CACHE_BYTES,
  GATEWAY_RESULT_CACHE_TTL_MS,
  GATEWAY_UPSTREAM_MAX_DURATION_MS,
} from "@stella/contracts/gateway/api";
import { GATEWAY_BUDGET_UNLIMITED } from "@stella/contracts/gateway/capability";

export const RESERVATION_LEASE_MS = GATEWAY_UPSTREAM_MAX_DURATION_MS + 60_000;

export type LedgerReserveArgs = {
  jti: string;
  budgetMicroCents: number;
  maxRequests?: number;
  /** Capability expiry, ms since epoch. */
  expiresAt: number;
  requestId: string;
  estimatedMicroCents: number;
};

export type LedgerReserveResult =
  | { kind: "reserved"; attempt: string; remainingMicroCents: number | null }
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
];

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
  private alarmAt: number | null = null;

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
      if (now - existing.created_at <= RESERVATION_LEASE_MS) {
        return { kind: "in_flight" };
      }
      this.storage.sql.exec(
        "UPDATE ledger SET reserved = MAX(0, reserved - ?) WHERE jti = ?",
        existing.reserved,
        args.jti,
      );
      this.storage.sql.exec(
        "DELETE FROM results WHERE jti = ? AND request_id = ?",
        args.jti,
        args.requestId,
      );
      row = this.ledgerRow(args.jti) ?? row;
      replacingLapsed = true;
    }

    if (
      !replacingLapsed &&
      row.max_requests !== null &&
      row.requests >= row.max_requests
    ) {
      return { kind: "request_limit", maxRequests: row.max_requests };
    }
    const unlimited = row.budget === GATEWAY_BUDGET_UNLIMITED || row.budget < 0;
    const remaining = unlimited ? null : row.budget - row.spent - row.reserved;
    if (
      remaining !== null &&
      row.spent + row.reserved + estimate > row.budget
    ) {
      return {
        kind: "budget_exhausted",
        remainingMicroCents: Math.max(0, remaining),
      };
    }

    const attempt = crypto.randomUUID();
    this.storage.sql.exec(
      "INSERT INTO results (jti, request_id, attempt, status, body, bytes, reserved, created_at) VALUES (?, ?, ?, 0, NULL, 0, ?, ?)",
      args.jti,
      args.requestId,
      attempt,
      estimate,
      now,
    );
    this.storage.sql.exec(
      "UPDATE ledger SET reserved = reserved + ?, requests = requests + ? WHERE jti = ?",
      estimate,
      replacingLapsed ? 0 : 1,
      args.jti,
    );
    return {
      kind: "reserved",
      attempt,
      remainingMicroCents:
        remaining === null ? null : Math.max(0, remaining - estimate),
    };
  }

  settleSync(args: LedgerSettleArgs & { jti: string }): LedgerSettleResult {
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
        "DELETE FROM results WHERE jti = ? AND request_id = ?",
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

  async armAlarm(): Promise<void> {
    const next = this.storage.sql
      .exec<{
        at: number | null;
      }>(
        "SELECT MIN(expires_at) + ? AS at FROM ledger",
        GATEWAY_RESULT_CACHE_TTL_MS,
      )
      .one().at;
    if (next !== null && (this.alarmAt === null || next < this.alarmAt)) {
      const at = Math.max(Date.now() + 1_000, next);
      await this.storage.setAlarm(at);
      this.alarmAt = at;
    }
  }

  async alarm(): Promise<void> {
    const cutoff = Date.now() - GATEWAY_RESULT_CACHE_TTL_MS;
    this.storage.sql.exec(
      "DELETE FROM results WHERE jti IN (SELECT jti FROM ledger WHERE expires_at <= ?)",
      cutoff,
    );
    this.storage.sql.exec("DELETE FROM ledger WHERE expires_at <= ?", cutoff);
    this.alarmAt = null;
    await this.armAlarm();
  }
}
