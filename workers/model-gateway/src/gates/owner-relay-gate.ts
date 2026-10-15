import { isGatewayError } from "../errors.js";
import { DurableObject } from "cloudflare:workers";
import { handleRequest } from "../router.js";
import { defaultDeps } from "../request-util.js";
import {
  getGatewayConfig,
  type GatewayConfigStorage,
} from "../config-cache.js";
import { billingControl, billingGatewayConfig } from "../billing-control.js";
import {
  DEFAULT_ENFORCEMENT_TTL_SECONDS,
  enforcementAdmissionForRecord,
  normalizeStoredOwnerEnforcement,
  type OwnerEnforcementAdmission,
  type StoredOwnerEnforcement,
} from "../owner-enforcement.js";
import {
  SHARED_GATEWAY_CONFIG_KEY,
  sharedGatewayConfigStore,
} from "../shared-config.js";
import {
  GATEWAY_OWNER_RELAY_LIMITS,
  GATEWAY_REFUSED_MINTS_PER_HOUR,
  GATEWAY_TEST_ACCOUNT_MINTS_PER_HOUR,
  GATEWAY_THROTTLED_LIMIT_SHARE,
  limitsAudienceFor,
} from "@stella/contracts/gateway/api";
import type { ManagedModelAudience } from "@stella/contracts/gateway/capability";

import {
  LedgerStore,
  RESERVATION_LEASE_MS,
  type LedgerReserveArgs,
  type LedgerReserveResult,
  type LedgerSettleArgs,
  type LedgerSettleResult,
} from "../ledger-store.js";
import { flushUsageOutbox } from "../usage-outbox.js";
import {
  managedCancellationKey,
  type ManagedCancellationIdentity,
} from "../managed-cancellation.js";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const OWNER_ENFORCEMENT_INITIALIZATION_VERSION = 2;

export type OwnerAdmissionRefusal = {
  refused: "concurrency_limit" | "rate_limited";
  resetAt: number;
};

/**
 * Wire shape of `admitRelay`. `duplicate` marks a request id this owner
 * already holds in flight: it is admitted without a hold of its own, and
 * only the holder releases it.
 */
export type GateAdmission =
  | { ok: true; duplicate?: boolean }
  | ({ ok: false } & OwnerAdmissionRefusal);

export type OwnerReservation =
  | Exclude<LedgerReserveResult, { kind: "reserved" }>
  | ({ kind: "refused" } & OwnerAdmissionRefusal)
  | Extract<LedgerReserveResult, { kind: "reserved" }>;

type RelayAdmissionCheck =
  | { kind: "free" }
  | { kind: "held" }
  | ({ kind: "refused" } & OwnerAdmissionRefusal);

export type MintAdmission =
  | { ok: true; admissionId: number }
  | { ok: false; refused: "rate_limited" | "refused_attempts"; resetAt: number };

type CountRow = { count: number };
type OldestRow = { oldest: number | null };
type InFlightRow = { started_at: number };
type AudienceRow = { audience: string };

const parseAuthoritativeOwnerEnforcement = (
  value: unknown,
): StoredOwnerEnforcement | null | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const updatedAt = Reflect.get(value, "updatedAt");
  const enforcement = Reflect.get(value, "enforcement");
  if (
    (updatedAt !== null &&
      (typeof updatedAt !== "number" || !Number.isFinite(updatedAt))) ||
    !enforcement ||
    typeof enforcement !== "object" ||
    Array.isArray(enforcement)
  )
    return undefined;
  const status = Reflect.get(enforcement, "status");
  const until = Reflect.get(enforcement, "until");
  const reason = Reflect.get(enforcement, "reason");
  if (
    (until !== undefined &&
      (typeof until !== "number" || !Number.isFinite(until))) ||
    (reason !== undefined && typeof reason !== "string")
  )
    return undefined;
  if (updatedAt === null) {
    return status === "ok" ? null : undefined;
  }
  return (
    normalizeStoredOwnerEnforcement({
      status,
      ...(typeof until === "number" ? { until } : {}),
      updatedAt,
      expiresAt:
        typeof until === "number"
          ? until
          : updatedAt + DEFAULT_ENFORCEMENT_TTL_SECONDS * 1_000,
    }) ?? undefined
  );
};

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS in_flight (
    request_id TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL,
    attempt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS relay_admissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admitted_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS relay_admissions_at
    ON relay_admissions(admitted_at)`,
  `CREATE TABLE IF NOT EXISTS mint_admissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admitted_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS mint_admissions_at
    ON mint_admissions(admitted_at)`,
  `CREATE TABLE IF NOT EXISTS mint_refusals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    refused_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS mint_refusals_at
    ON mint_refusals(refused_at)`,
  `CREATE TABLE IF NOT EXISTS mint_audience (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    audience TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS managed_cancellations (
    identity TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS managed_cancellations_expiry
    ON managed_cancellations(expires_at)`,
  `CREATE TABLE IF NOT EXISTS owner_enforcement_state (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    status TEXT NOT NULL,
    until_at INTEGER,
    updated_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS owner_enforcement_meta (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    initialized INTEGER NOT NULL
  )`,
];

const ownerLedgerJti = (generation: string, jti: string): string =>
  JSON.stringify([generation, jti]);

const ownerAdmissionId = (
  generation: string,
  jti: string,
  requestId: string,
): string => JSON.stringify([generation, jti, requestId]);

const scaledLimit = (limit: number, throttled: boolean): number =>
  throttled
    ? Math.max(1, Math.floor(limit * GATEWAY_THROTTLED_LIMIT_SHARE))
    : limit;

export class OwnerRelayGate extends DurableObject<Env> {
  private readonly ledger: LedgerStore;
  private readonly instanceId = crypto.randomUUID();
  private readonly managedControllers = new Map<
    string,
    { controller: AbortController; references: number }
  >();
  private enforcementInitialization?: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ledger = new LedgerStore(ctx.storage);
    void ctx.blockConcurrencyWhile(async () => {
      for (const statement of SCHEMA) this.ctx.storage.sql.exec(statement);
      const inFlightColumns = this.ctx.storage.sql
        .exec<{ name: string }>("SELECT name FROM pragma_table_info('in_flight')")
        .toArray();
      if (!inFlightColumns.some((column) => column.name === "attempt")) {
        this.ctx.storage.sql.exec("ALTER TABLE in_flight ADD COLUMN attempt TEXT");
      }
    });
  }

  override fetch(request: Request): Promise<Response> {
    return handleRequest(
      request,
      this.env,
      this.ctx,
      {
        ...defaultDeps(this.ctx),
        beforeProviderDispatch: () => this.ctx.storage.sync(),
      },
      {
        matchesOwner: (ownerId) =>
          this.env.OWNER_RELAY_GATE.idFromName(ownerId).toString() ===
          this.ctx.id.toString(),
        accounting: this,
        instanceId: this.instanceId,
        configStorage: this.configStorage,
        ownerEnforcement: (ownerId, now) =>
          this.admitOwnerEnforcement(ownerId, now),
        cancellation: {
          begin: (identity) => this.beginManagedRequest(identity),
          release: (key) => this.releaseManagedRequest(key),
        },
      },
    );
  }

  private get configStorage(): GatewayConfigStorage {
    return {
      source: this.env.STELLA_BACKEND_URL,
      read: () => this.ctx.storage.kv.get(SHARED_GATEWAY_CONFIG_KEY),
      write: (record) =>
        this.ctx.storage.kv.put(SHARED_GATEWAY_CONFIG_KEY, record),
    };
  }

  private enforcementRecord(): StoredOwnerEnforcement | null {
    const row = this.ctx.storage.sql
      .exec<{
        status: string;
        until_at: number | null;
        updated_at: number;
        expires_at: number;
      }>(
        "SELECT status, until_at, updated_at, expires_at FROM owner_enforcement_state WHERE singleton = 1",
      )
      .toArray()[0];
    if (!row) return null;
    return normalizeStoredOwnerEnforcement({
      status: row.status,
      ...(row.until_at === null ? {} : { until: row.until_at }),
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
    });
  }

  private applyOwnerEnforcementSync(
    record: StoredOwnerEnforcement,
    current: StoredOwnerEnforcement | null,
  ): StoredOwnerEnforcement {
    if (!current || record.updatedAt > current.updatedAt) {
      const normalized = {
        ...record,
        expiresAt:
          record.expiresAt ??
          record.until ??
          record.updatedAt + DEFAULT_ENFORCEMENT_TTL_SECONDS * 1_000,
      };
      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO owner_enforcement_state
          (singleton, status, until_at, updated_at, expires_at) VALUES (1, ?, ?, ?, ?)`,
        normalized.status,
        normalized.until ?? null,
        normalized.updatedAt,
        normalized.expiresAt,
      );
      return normalized;
    }
    return current;
  }

  async applyOwnerEnforcement(
    input: StoredOwnerEnforcement,
  ): Promise<StoredOwnerEnforcement> {
    const record = normalizeStoredOwnerEnforcement(input);
    if (!record || typeof record.expiresAt !== "number") {
      throw new Error("Owner enforcement update is invalid.");
    }
    const current = this.enforcementRecord();
    const applied = this.applyOwnerEnforcementSync(record, current);
    // A delayed authenticated push cannot attest to a newer legacy KV seed.
    // Leave its v1 marker for the authoritative bootstrap in that case.
    if (!current || record.updatedAt >= current.updatedAt) {
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO owner_enforcement_meta(singleton, initialized) VALUES (1, ?)",
        OWNER_ENFORCEMENT_INITIALIZATION_VERSION,
      );
    }
    return applied;
  }

  private async initializeOwnerEnforcement(ownerId: string): Promise<void> {
    const initialized = this.ctx.storage.sql
      .exec<{
        initialized: number;
      }>("SELECT initialized FROM owner_enforcement_meta WHERE singleton = 1")
      .toArray()[0];
    if (
      initialized?.initialized !== undefined &&
      initialized.initialized >= OWNER_ENFORCEMENT_INITIALIZATION_VERSION
    )
      return;
    // KV is an eventual mirror. Bootstrap from the owner's object on
    // cloud-builder so a stale KV read can never seed this durable state.
    let state: unknown;
    try {
      state = await billingControl(this.env).ownerEnforcement(ownerId);
    } catch {
      throw new Error("Owner enforcement bootstrap unavailable.");
    }
    const authoritative = parseAuthoritativeOwnerEnforcement(state);
    if (authoritative === undefined) {
      throw new Error("Owner enforcement bootstrap response is invalid.");
    }
    if (authoritative) {
      this.applyOwnerEnforcementSync(authoritative, this.enforcementRecord());
    }
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO owner_enforcement_meta(singleton, initialized) VALUES (1, ?)",
      OWNER_ENFORCEMENT_INITIALIZATION_VERSION,
    );
  }

  async admitOwnerEnforcement(
    ownerId: string,
    now: number,
  ): Promise<OwnerEnforcementAdmission> {
    if (
      this.env.OWNER_RELAY_GATE.idFromName(ownerId).toString() !==
      this.ctx.id.toString()
    ) {
      throw new Error("Owner enforcement identity does not match.");
    }
    this.enforcementInitialization ??= this.initializeOwnerEnforcement(
      ownerId,
    ).catch((error) => {
      this.enforcementInitialization = undefined;
      throw error;
    });
    await this.enforcementInitialization;
    return enforcementAdmissionForRecord(this.enforcementRecord(), now);
  }

  async prepare(ownerId: string, traceId?: string): Promise<void> {
    const startedAt = performance.now();
    const invokedAt = Date.now();
    const durations: {
      pricingMs?: number;
      enforcementMs?: number;
      configAgeMs?: number;
    } = {};
    console.info(
      JSON.stringify({
        event: "gateway_owner_preparation_timing",
        traceId,
        executorInstanceId: this.instanceId,
        invokedAt,
        status: "started",
      }),
    );
    try {
      if (
        this.env.OWNER_RELAY_GATE.idFromName(ownerId).toString() !==
        this.ctx.id.toString()
      ) {
        throw new Error("Owner preparation identity does not match.");
      }
      await Promise.all([
        (async () => {
          const pricingStartedAt = performance.now();
          try {
            const config = await getGatewayConfig(
              billingGatewayConfig(this.env),
              (work) => this.ctx.waitUntil(work),
              Date.now,
              this.configStorage,
              sharedGatewayConfigStore(this.env),
            );
            durations.configAgeMs = Math.max(0, Date.now() - config.fetchedAt);
          } finally {
            durations.pricingMs = performance.now() - pricingStartedAt;
          }
        })(),
        (async () => {
          const enforcementStartedAt = performance.now();
          try {
            await this.admitOwnerEnforcement(ownerId, Date.now());
          } finally {
            durations.enforcementMs = performance.now() - enforcementStartedAt;
          }
        })(),
      ]);
      console.info(
        JSON.stringify({
          event: "gateway_owner_preparation_timing",
          traceId,
          executorInstanceId: this.instanceId,
          invokedAt,
          status: "completed",
          totalMs: performance.now() - startedAt,
          ...durations,
        }),
      );
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: "gateway_owner_preparation_timing",
          traceId,
          executorInstanceId: this.instanceId,
          invokedAt,
          status: "failed",
          totalMs: performance.now() - startedAt,
          code: isGatewayError(error) ? error.code : "internal",
          ...durations,
        }),
      );
      throw error;
    }
  }

  async admitRelay(args: {
    audience: ManagedModelAudience;
    requestId: string;
    throttled: boolean;
  }): Promise<GateAdmission> {
    const now = Date.now();
    const check = this.checkRelayAdmission(args, now);
    if (check.kind === "refused") {
      return { ok: false, refused: check.refused, resetAt: check.resetAt };
    }
    if (check.kind === "held") return { ok: true, duplicate: true };
    this.holdRelay(args.requestId, now, null);
    return { ok: true };
  }

  private checkRelayAdmission(
    args: {
      audience: ManagedModelAudience;
      requestId: string;
      throttled: boolean;
    },
    now: number,
  ): RelayAdmissionCheck {
    this.ctx.storage.sql.exec(
      "DELETE FROM in_flight WHERE started_at <= ?",
      now - RESERVATION_LEASE_MS,
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM relay_admissions WHERE admitted_at <= ?",
      now - MINUTE_MS,
    );

    const existing = this.ctx.storage.sql
      .exec<InFlightRow>(
        "SELECT started_at FROM in_flight WHERE request_id = ?",
        args.requestId,
      )
      .toArray()[0];
    if (existing) return { kind: "held" };

    const policy = GATEWAY_OWNER_RELAY_LIMITS[limitsAudienceFor(args.audience)];
    const inFlightLimit = scaledLimit(policy.inFlight, args.throttled);
    const inFlight = this.ctx.storage.sql
      .exec<CountRow>("SELECT COUNT(*) AS count FROM in_flight")
      .one().count;
    if (inFlight >= inFlightLimit) {
      const oldest = this.ctx.storage.sql
        .exec<OldestRow>("SELECT MIN(started_at) AS oldest FROM in_flight")
        .one().oldest;
      return {
        kind: "refused",
        refused: "concurrency_limit",
        resetAt: (oldest ?? now) + RESERVATION_LEASE_MS,
      };
    }

    const minuteLimit = scaledLimit(policy.perMinute, args.throttled);
    const minuteAdmissions = this.ctx.storage.sql
      .exec<CountRow>("SELECT COUNT(*) AS count FROM relay_admissions")
      .one().count;
    if (minuteAdmissions >= minuteLimit) {
      const oldest = this.ctx.storage.sql
        .exec<OldestRow>(
          "SELECT MIN(admitted_at) AS oldest FROM relay_admissions",
        )
        .one().oldest;
      return {
        kind: "refused",
        refused: "rate_limited",
        resetAt: (oldest ?? now) + MINUTE_MS,
      };
    }
    return { kind: "free" };
  }

  private holdRelay(
    requestId: string,
    now: number,
    attempt: string | null,
  ): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO in_flight (request_id, started_at, attempt) VALUES (?, ?, ?)
       ON CONFLICT(request_id) DO UPDATE SET started_at = excluded.started_at, attempt = excluded.attempt`,
      requestId,
      now,
      attempt,
    );
  }

  /**
   * Owner-wide admission and generation/JTI accounting commit together; the
   * admission is held by the reservation's attempt until that attempt settles.
   */
  async admitAndReserve(args: {
    audience: ManagedModelAudience;
    requestId: string;
    throttled: boolean;
    generation: string;
    reservation: LedgerReserveArgs;
  }): Promise<OwnerReservation> {
    const admissionId = ownerAdmissionId(
      args.generation,
      args.reservation.jti,
      args.requestId,
    );
    const now = Date.now();
    const result = this.ctx.storage.transactionSync((): OwnerReservation => {
      const check = this.checkRelayAdmission(
        { ...args, requestId: admissionId },
        now,
      );
      if (check.kind === "refused") return check;
      if (check.kind === "free") {
        this.ctx.storage.sql.exec(
          "INSERT INTO relay_admissions (admitted_at) VALUES (?)",
          now,
        );
      }
      const reservation = this.ledger.reserveSync({
        ...args.reservation,
        requestId: args.requestId,
        jti: ownerLedgerJti(args.generation, args.reservation.jti),
      });
      if (reservation.kind === "reserved") {
        this.holdRelay(admissionId, now, reservation.attempt);
      }
      return reservation;
    });
    await this.ledger.armAlarm();
    return result;
  }

  async settleCapability(
    args: LedgerSettleArgs & { generation: string; jti: string },
  ): Promise<LedgerSettleResult> {
    const settled = this.ctx.storage.transactionSync(() => {
      const settled = this.ledger.settleSync({
        ...args,
        jti: ownerLedgerJti(args.generation, args.jti),
      });
      this.ctx.storage.sql.exec(
        "DELETE FROM in_flight WHERE request_id = ? AND attempt = ?",
        ownerAdmissionId(args.generation, args.jti, args.requestId),
        args.attempt,
      );
      return settled;
    });
    if (args.usage) await this.ledger.armAlarm();
    return settled;
  }

  private async armCancellationAlarm(): Promise<void> {
    const next = this.ctx.storage.sql
      .exec<{
        at: number | null;
      }>("SELECT MIN(expires_at) AS at FROM managed_cancellations")
      .one().at;
    if (next === null) return;
    const current = await this.ctx.storage.getAlarm();
    const at = Math.max(Date.now() + 1_000, next);
    if (current === null || at < current) await this.ctx.storage.setAlarm(at);
  }

  async alarm(): Promise<void> {
    this.ledger.expireSync();
    try {
      await flushUsageOutbox(this.ledger, billingControl(this.env));
    } finally {
      await this.ledger.rearmAfterAlarm();
    }
    this.ctx.storage.sql.exec(
      "DELETE FROM managed_cancellations WHERE expires_at <= ?",
      Date.now(),
    );
    await this.armCancellationAlarm();
  }

  async cancelManagedRequest(
    identity: ManagedCancellationIdentity,
  ): Promise<{ canceled: boolean }> {
    if (
      this.env.OWNER_RELAY_GATE.idFromName(identity.ownerId).toString() !==
      this.ctx.id.toString()
    ) {
      return { canceled: false };
    }
    const now = Date.now();
    if (identity.expiresAt <= now) return { canceled: false };
    this.ctx.storage.sql.exec(
      "DELETE FROM managed_cancellations WHERE expires_at <= ?",
      now,
    );
    const key = managedCancellationKey(identity);
    this.ctx.storage.sql.exec(
      `INSERT INTO managed_cancellations (identity, expires_at) VALUES (?, ?)
       ON CONFLICT(identity) DO UPDATE SET expires_at = MIN(expires_at, excluded.expires_at)`,
      key,
      identity.expiresAt,
    );
    this.managedControllers
      .get(key)
      ?.controller.abort("managed_request_canceled");
    await this.armCancellationAlarm();
    return { canceled: true };
  }

  beginManagedRequest(
    identity: ManagedCancellationIdentity,
  ):
    | { canceled: true }
    | { canceled: false; key: string; signal: AbortSignal } {
    const key = managedCancellationKey(identity);
    const tombstone = this.ctx.storage.sql
      .exec<{
        expires_at: number;
      }>(
        "SELECT expires_at FROM managed_cancellations WHERE identity = ? AND expires_at > ?",
        key,
        Date.now(),
      )
      .toArray()[0];
    if (tombstone) return { canceled: true };
    const active = this.managedControllers.get(key);
    if (active) {
      active.references += 1;
      return { canceled: false, key, signal: active.controller.signal };
    }
    const controller = new AbortController();
    this.managedControllers.set(key, { controller, references: 1 });
    return { canceled: false, key, signal: controller.signal };
  }

  releaseManagedRequest(key: string): void {
    const active = this.managedControllers.get(key);
    if (!active) return;
    active.references -= 1;
    if (active.references === 0) this.managedControllers.delete(key);
  }

  async releaseRelay(requestId: string): Promise<void> {
    this.ctx.storage.sql.exec(
      "DELETE FROM in_flight WHERE request_id = ?",
      requestId,
    );
  }

  async admitMint(args: {
    audience: ManagedModelAudience;
    throttled: boolean;
    testAccount?: boolean;
  }): Promise<MintAdmission> {
    const now = Date.now();
    this.ctx.storage.sql.exec(
      "DELETE FROM mint_admissions WHERE admitted_at <= ?",
      now - HOUR_MS,
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM mint_refusals WHERE refused_at <= ?",
      now - HOUR_MS,
    );
    const refusals = this.ctx.storage.sql
      .exec<CountRow>("SELECT COUNT(*) AS count FROM mint_refusals")
      .one().count;
    if (refusals >= GATEWAY_REFUSED_MINTS_PER_HOUR.owner) {
      const oldest = this.ctx.storage.sql
        .exec<OldestRow>("SELECT MIN(refused_at) AS oldest FROM mint_refusals")
        .one().oldest;
      return {
        ok: false,
        refused: "refused_attempts",
        resetAt: (oldest ?? now) + HOUR_MS,
      };
    }
    const issued = this.ctx.storage.sql
      .exec<AudienceRow>("SELECT audience FROM mint_audience WHERE singleton = 1")
      .toArray()[0]?.audience;
    const policy = GATEWAY_OWNER_RELAY_LIMITS[limitsAudienceFor(issued ?? args.audience)];
    const limit = args.testAccount
      ? GATEWAY_TEST_ACCOUNT_MINTS_PER_HOUR
      : scaledLimit(policy.mintsPerHour, args.throttled);
    const admissions = this.ctx.storage.sql
      .exec<CountRow>("SELECT COUNT(*) AS count FROM mint_admissions")
      .one().count;
    if (admissions >= limit) {
      const oldest = this.ctx.storage.sql
        .exec<OldestRow>(
          "SELECT MIN(admitted_at) AS oldest FROM mint_admissions",
        )
        .one().oldest;
      return {
        ok: false,
        refused: "rate_limited",
        resetAt: (oldest ?? now) + HOUR_MS,
      };
    }
    const admissionId = this.ctx.storage.sql
      .exec<{ id: number }>(
        "INSERT INTO mint_admissions (admitted_at) VALUES (?) RETURNING id",
        now,
      )
      .one().id;
    return { ok: true, admissionId };
  }

  async settleMint(args: { admissionId: number; issuedAudience?: string }): Promise<void> {
    if (args.issuedAudience === undefined) {
      this.ctx.storage.sql.exec("DELETE FROM mint_admissions WHERE id = ?", args.admissionId);
      this.ctx.storage.sql.exec("INSERT INTO mint_refusals (refused_at) VALUES (?)", Date.now());
      return;
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO mint_audience (singleton, audience, updated_at) VALUES (1, ?, ?)
       ON CONFLICT (singleton) DO UPDATE SET audience = excluded.audience, updated_at = excluded.updated_at`,
      args.issuedAudience,
      Date.now(),
    );
  }

}
