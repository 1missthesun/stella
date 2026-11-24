import {
  normalizeOwnerGeneration,
  ownerGenerationMatches,
} from "./owner-generation.js";
import {
  OwnerFenceLeaseValidationError,
  OwnerFenceStore,
  type OwnerFenceLease,
  type OwnerFenceLeaseNamespace,
  type OwnerFenceLeaseRole,
} from "./owner-fence-store.js";

export const OWNER_FENCE_KEY = "ownerPurgeFence";
export const OWNER_FENCE_LEASE_TTL_MS = 30 * 60_000;
const OWNER_FENCE_MAX_ACTIVE_LEASES = 512;
// Version 3 with an empty `active` map tells a rolled-back Worker to rebuild its mirror from SQL.
const OWNER_FENCE_RECORD_VERSION = 3;

export type OwnerPurgeMode = "temporary" | "permanent";

export type OwnerPurgeFence = {
  ownerId?: string;
  generation: string;
  beginRequestId?: string;
  lastReleasedGeneration?: string;
  state: "open" | "blocked";
  mode?: OwnerPurgeMode;
  leaseStorageVersion?: number;
  active: Record<string, unknown>;
};

export type OwnerFenceRefusal = {
  ok: false;
  status: 400 | 409 | 503;
  code?: string;
  error: string;
};

export type OwnerFenceLeaseInput = {
  ownerId: string;
  leaseId: string;
  sessionId: string;
  turnId: string;
  ownerGeneration: string;
  namespace: OwnerFenceLeaseNamespace;
  role: OwnerFenceLeaseRole;
  generation?: string;
  expiresAt?: number;
};

export type OwnerFenceUnregisterInput = {
  ownerId: string;
  leaseId: string;
  sessionId: string;
  turnId: string;
  ownerGeneration?: string;
  generation?: string;
};

export type OwnerFenceAssertInput = {
  ownerId: string;
  ownerGeneration: string;
  generation: string;
  leaseId: string;
};

export type OwnerFenceBeginInput = {
  mode: OwnerPurgeMode;
  requestId: string;
  ownerId: string;
};

export type OwnerFenceRegisterResult =
  | { ok: true; generation: string; expiresAt: number }
  | OwnerFenceRefusal;
export type OwnerFenceUnregisterResult =
  | { ok: true; alreadyUnregistered?: true }
  | OwnerFenceRefusal;
export type OwnerFenceAssertResult =
  | { ok: true; expiresAt: number }
  | OwnerFenceRefusal;
export type OwnerFenceBeginResult =
  | {
      ok: true;
      generation: string;
      mode: OwnerPurgeMode;
      active: OwnerFenceLease[];
    }
  | OwnerFenceRefusal;
export type OwnerFenceBlockedResult =
  | { ok: true; active: OwnerFenceLease[]; beginRequestId?: string }
  | OwnerFenceRefusal;
export type OwnerFenceReleaseResult =
  | { ok: true; generation: string; alreadyReleased?: true }
  | OwnerFenceRefusal;

const refuse = (
  status: OwnerFenceRefusal["status"],
  error: string,
  code?: string,
): OwnerFenceRefusal => ({ ok: false, status, error, ...(code ? { code } : {}) });

const FENCE_CHANGED = (): OwnerFenceRefusal =>
  refuse(409, "Owner purge fence changed.");

export class OwnerFence {
  private readonly store: OwnerFenceStore;
  private initialized = false;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly ownerId: string,
  ) {
    this.store = new OwnerFenceStore(ctx.storage.sql);
  }

  leases(now = Date.now()): OwnerFenceStore {
    if (!this.initialized) {
      this.store.initialize(now);
      this.initialized = true;
    }
    return this.store;
  }

  async record(now = Date.now()): Promise<OwnerPurgeFence> {
    this.leases(now);
    const stored = await this.ctx.storage.get<OwnerPurgeFence>(OWNER_FENCE_KEY);
    if (stored?.ownerId !== undefined && stored.ownerId !== this.ownerId) {
      throw new Error("Owner fence identity does not match.");
    }
    if (
      stored &&
      stored.leaseStorageVersion === OWNER_FENCE_RECORD_VERSION &&
      Object.keys(stored.active ?? {}).length === 0
    ) {
      return stored;
    }
    const record: OwnerPurgeFence = {
      ...(stored ?? { generation: crypto.randomUUID(), state: "open" }),
      ownerId: this.ownerId,
      leaseStorageVersion: OWNER_FENCE_RECORD_VERSION,
      active: {},
    };
    await this.ctx.storage.put(OWNER_FENCE_KEY, record);
    return record;
  }

  private scoped(ownerId: unknown): boolean {
    return ownerId === this.ownerId;
  }

  async register(
    input: OwnerFenceLeaseInput,
    now = Date.now(),
  ): Promise<OwnerFenceRegisterResult> {
    if (!this.scoped(input.ownerId))
      return refuse(409, "Owner fence identity does not match.");
    const current = await this.record(now);
    if (current.state !== "open") {
      return refuse(
        409,
        "Owner purge is active.",
        current.mode === "permanent"
          ? "owner_purge_permanent"
          : "owner_purge_temporary",
      );
    }
    const ownerGeneration = normalizeOwnerGeneration(input.ownerGeneration);
    if (
      (input.generation !== undefined &&
        input.generation !== current.generation) ||
      !input.leaseId ||
      !input.sessionId ||
      !input.turnId ||
      !ownerGeneration
    ) {
      return refuse(400, "Invalid owner lease.", "bad_request");
    }
    const namespace: OwnerFenceLeaseNamespace =
      input.namespace === "orchestrator" || input.namespace === "activity"
        ? input.namespace
        : "build";
    const role: OwnerFenceLeaseRole =
      input.role === "run" ||
      input.role === "orchestrator" ||
      input.role === "activity"
        ? input.role
        : "aux";
    const expiresAt =
      typeof input.expiresAt === "number" &&
      Number.isFinite(input.expiresAt) &&
      input.expiresAt > now
        ? input.expiresAt
        : now + OWNER_FENCE_LEASE_TTL_MS;
    const store = this.leases(now);
    if (
      !store.activeLease(input.leaseId, now) &&
      store.activeLeaseCount(now) >= OWNER_FENCE_MAX_ACTIVE_LEASES
    ) {
      return refuse(503, "Owner lease capacity exceeded.", "lease_capacity");
    }
    try {
      return this.ctx.storage.transactionSync(() => {
        store.pruneRetiredLeases(now);
        let result = store.registerLeaseExact(
          {
            leaseId: input.leaseId,
            ownerId: this.ownerId,
            ownerGeneration,
            reservationGeneration: current.generation,
            sessionId: input.sessionId,
            turnId: input.turnId,
            namespace,
            role,
            expiresAt,
          },
          now,
        );
        if (result.status === "replayed") {
          const renewed = store.renewLeaseExact(result.lease, expiresAt, now);
          if (renewed.status === "renewed")
            result = { status: "replayed", lease: renewed.lease };
        }
        if (result.status === "conflict")
          return refuse(409, "Owner lease identity conflicts.", "bad_request");
        return {
          ok: true as const,
          generation: current.generation,
          expiresAt: result.lease.expiresAt,
        };
      });
    } catch (error) {
      if (error instanceof OwnerFenceLeaseValidationError)
        return refuse(400, "Invalid owner lease.", "bad_request");
      throw error;
    }
  }

  async unregister(
    input: OwnerFenceUnregisterInput,
    now = Date.now(),
  ): Promise<OwnerFenceUnregisterResult> {
    if (!this.scoped(input.ownerId))
      return refuse(409, "Owner fence identity does not match.");
    if (!input.leaseId || !input.sessionId || !input.turnId)
      return refuse(400, "Invalid owner lease.");
    await this.record(now);
    const store = this.leases(now);
    const active = store.lease(input.leaseId);
    if (!active || active.state === "retired")
      return { ok: true, alreadyUnregistered: true };
    if (
      active.sessionId !== input.sessionId ||
      active.turnId !== input.turnId ||
      !ownerGenerationMatches(active.ownerGeneration, input.ownerGeneration)
    ) {
      return refuse(409, "Owner lease identity does not match.");
    }
    const retired = store.retireLeaseExact(active, now);
    if (retired.status !== "retired" && retired.status !== "already_retired")
      throw new Error("Exact owner lease retirement failed.");
    return { ok: true };
  }

  async assert(
    input: OwnerFenceAssertInput,
    now = Date.now(),
  ): Promise<OwnerFenceAssertResult> {
    if (!this.scoped(input.ownerId)) return FENCE_CHANGED();
    const current = await this.record(now);
    if (
      current.state !== "open" ||
      input.generation !== current.generation ||
      !input.leaseId
    ) {
      return FENCE_CHANGED();
    }
    const store = this.leases(now);
    const lease = store.activeLease(input.leaseId, now);
    if (
      !lease ||
      !ownerGenerationMatches(lease.ownerGeneration, input.ownerGeneration)
    ) {
      return FENCE_CHANGED();
    }
    if (lease.expiresAt - now > OWNER_FENCE_LEASE_TTL_MS / 2)
      return { ok: true, expiresAt: lease.expiresAt };
    const renewed = store.renewLeaseExact(
      lease,
      now + OWNER_FENCE_LEASE_TTL_MS,
      now,
    );
    return renewed.status === "renewed"
      ? { ok: true, expiresAt: renewed.lease.expiresAt }
      : FENCE_CHANGED();
  }

  async assertBlocked(
    generation: string,
    now = Date.now(),
  ): Promise<OwnerFenceBlockedResult> {
    const current = await this.record(now);
    if (current.state !== "blocked" || generation !== current.generation)
      return refuse(409, "Owner purge generation is not active.");
    return {
      ok: true,
      active: this.leases(now).activeLeases(now),
      ...(current.beginRequestId
        ? { beginRequestId: current.beginRequestId }
        : {}),
    };
  }

  async begin(
    input: OwnerFenceBeginInput,
    beforeAuthorityChange?: () => Promise<void>,
    now = Date.now(),
  ): Promise<OwnerFenceBeginResult> {
    if (!this.scoped(input.ownerId))
      return refuse(409, "Owner fence identity does not match.");
    const requestId = normalizeOwnerGeneration(input.requestId);
    const mode: OwnerPurgeMode =
      input.mode === "permanent" ? "permanent" : "temporary";
    const current = await this.record(now);
    const start = current.state === "open";
    if (!requestId || (!start && requestId !== current.beginRequestId))
      return refuse(409, "Owner purge generation cannot be joined.");
    const upgrade = !start && mode === "permanent";
    if (start || upgrade) await beforeAuthorityChange?.();
    if (start) {
      current.generation = crypto.randomUUID();
      current.beginRequestId = requestId;
      current.state = "blocked";
      current.mode = mode;
    } else if (upgrade) {
      current.mode = "permanent";
    }
    await this.ctx.storage.put(OWNER_FENCE_KEY, current);
    return {
      ok: true,
      generation: current.generation,
      mode: current.mode ?? mode,
      active: this.leases(now).activeLeases(now),
    };
  }

  async release(
    generation: string,
    now = Date.now(),
  ): Promise<OwnerFenceReleaseResult> {
    const requested = normalizeOwnerGeneration(generation);
    const current = await this.record(now);
    if (
      requested &&
      current.state === "open" &&
      current.lastReleasedGeneration === requested
    ) {
      return { ok: true, generation: current.generation, alreadyReleased: true };
    }
    if (
      !requested ||
      current.state !== "blocked" ||
      current.mode !== "temporary" ||
      requested !== current.generation ||
      this.leases(now).activeLeaseCount(now) !== 0
    ) {
      return refuse(409, "Owner purge fence cannot be released.");
    }
    current.lastReleasedGeneration = current.generation;
    current.generation = crypto.randomUUID();
    current.state = "open";
    delete current.beginRequestId;
    delete current.mode;
    await this.ctx.storage.put(OWNER_FENCE_KEY, current);
    return { ok: true, generation: current.generation };
  }
}
