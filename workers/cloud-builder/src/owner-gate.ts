import { CloudHomeStore, isHomeControlOp, type HomeControlOp } from "./cloud-home-store.js";
import { builtinCloudAppSkill } from "./builtin-cloud-app-skill.js";
import type { OwnerHomeContext } from "./owner-home-context.js";
import {
  type CloudChatHandoff,
  cloudChatHandoffKey,
  cloudChatTurnKey,
} from "./cloud-chat-admission.js";
import { verifyUserToken } from "./auth-jwt.js";
import { OwnerStore } from "./owner-store/store.js";
import type {
  OwnerCaller,
  OwnerHost,
  OwnerCredentialKind,
  OwnerPurgeMode,
} from "./owner-store/registry.js";
import { createGateHost } from "./owner-store/gate-host.js";
import { RpcError, toBackendError } from "./owner-store/errors.js";
import { crewRefusal } from "./owner-store/crew-scope.js";
import type { OwnerCrewScope } from "./owner-store/registry.js";
import { applyOwnerEventsToStore } from "./owner-store/owner-events.js";
import type { RpcResponse } from "@stella/contracts/backend/protocol";
import {
  GATEWAY_CAPABILITY_ISSUERS,
  GATEWAY_SESSION_CAPABILITY_TTL_MS,
} from "@stella/contracts/gateway/capability";
import { signCapability } from "@stella/contracts/gateway/jwt";
import type {
  GatewaySessionCapabilityResponse,
  IdentityLevel,
} from "@stella/contracts/gateway/api";
import {
  OWNER_SNAPSHOT_VERSION,
  type OwnerSnapshot,
} from "@stella/contracts/turn-plane/owner-snapshot";
import {
  beginOwnerPurge,
  callerSessionRevoked,
  noteCallerIdentity,
  readOwnerState,
  setDeletionHold,
} from "./owner-store/domains/account.js";
import type {
  BillingControlResult,
  GatewayUsageEvent,
  OwnerEnforcementState,
  SessionCapabilityRequest,
} from "@stella/contracts/gateway/usage";
import {
  type BillingPlan,
  CLOUD_SANDBOX_SUBSCRIPTION_REQUIRED_MESSAGE,
} from "@stella/contracts/backend/billing";
import {
  applyGatewayUsage,
  applyStripeEvent,
  billingAccess,
  type BillingAccess,
  billingPaying,
  closeStripeCustomer,
  stopStripeRenewal,
  cloudSandboxAccess,
  recordBillingIdentity,
  reserveSessionGrant,
  setAdminPlan,
  turnAllowance,
  type UsageBatchResult,
} from "./owner-store/domains/billing.js";
import {
  abuseState,
  admitSession,
  enforcementForSnapshot,
  readEnforcement,
  recordGatewayUsageRisk,
  setEnforcement,
  type SetEnforcementInput,
} from "./owner-store/domains/abuse.js";
import {
  handleMobileRoute,
  type MobileRouteInput,
  snapshotDevices,
} from "./owner-store/domains/devices.js";
import {
  handleUserAskReply,
  handleUserAskRoute,
  type UserAskRouteInput,
} from "./owner-store/domains/user-asks.js";
import {
  ensureTestClaudeCloudAccount,
  snapshotEngines,
} from "./owner-store/domains/engines.js";
import { isTestAccountOwner, testClaudeConfigured } from "./test-claude.js";
import { snapshotTimeZone } from "./owner-store/domains/schedules.js";
import type { StripeEvent } from "./billing/stripe.js";
import { BillingConfigError } from "./billing/plans.js";
import { capabilitySigningKey } from "./capability-signer.js";
import {
  type AgentMessageDeviceOutcome,
  type AgentStopDeviceOutcome,
  CLOUD_CAPABILITIES,
  DEVICE_PRESENCE_CLOSE,
  DEVICE_PRESENCE_MAX_FRAME_BYTES,
  DEVICE_PRESENCE_PING_INTERVAL_MS,
  DEVICE_PRESENCE_STALE_AFTER_MS,
  DEVICE_PRESENCE_SUBPROTOCOL,
  type DeviceDestination,
  type DevicePresenceDeviceFrame,
  type DevicesResponse,
  DISPATCH_ACCEPTED_LEASE_MS,
  DISPATCH_OFFER_WINDOW_MS,
  DISPATCH_RECONNECT_GRACE_MS,
  DISPATCH_PAYLOAD_TTL_MS,
  type DispatchError,
  type DispatchState,
  PLACEMENT_PROTOCOL,
} from "@stella/contracts/turn-plane/placement";
import {
  canonicalDispatchPayloadJson,
  sha256Hex,
} from "@stella/contracts/turn-plane/pairing-proof";
import type { OwnerEvent } from "@stella/contracts/turn-plane/owner-events";
import {
  decideDispatchPlacement,
  type DevicePresenceState,
  isTerminalDispatchState,
  MAX_DEVICE_ID_CHARS,
  MAX_DISPATCH_PAYLOAD_BYTES,
} from "./dispatch-policy.js";
import type { OwnerModelGrant } from "./owner-model-grants.js";
import { ownerModeEnabled } from "./selfhost/owner-mode.js";
import { gatewayCapabilities } from "./selfhost/discovery.js";
import { MemoryPolicyError } from "./memory-policy.js";
import type {
  MemoryPolicy,
  MemoryPolicyChange,
} from "@stella/contracts/turn-plane/memory-policy";
import { createOwnerFenceHost } from "./owner-fence-do.js";
import type {
  OwnerGateAdmitInput,
  OwnerGateAdmission,
  OwnerGateAdmissionWithLease,
  OwnerGateFenceLeaseRequest,
  OwnerGateSnapshotWithLease,
  DispatchRow,
  OwnerGateSubmitInput,
  OwnerGateCancelInput,
  OwnerGateDispatchResult,
  OwnerGateStatusResult,
} from "./owner-gate/types.js";
import {
  HEADER_PRESENCE_DEVICE_ID,
  OWNER_GATE_RUNNING_GRACE_MS,
  OWNER_AGENT_CONTAINER_LIMIT,
  SNAPSHOT_TTL_MS,
  STEER_ACK_TIMEOUT_MS,
  LOCAL_AGENT_MESSAGE_ACK_TIMEOUT_MS,
} from "./owner-gate/constants.js";
import {
  type PresenceAttachment,
  presenceTag,
  deviceDestination,
} from "./owner-gate/presence.js";
import {
  withTimeout,
  ownerFenceRequest,
  OwnerGateSnapshotError,
  log,
  isRecord,
  snapshotAllowsCloudSandbox,
  refuse,
  dispatchSummary,
  fail,
  trustedOwnerCaller,
} from "./owner-gate/support.js";
import { OwnerGateCloudDispatch } from "./owner-gate/cloud-dispatch.js";

export type {
  OwnerGateAdmitInput,
  OwnerGateRefusalCode,
  OwnerGateAdmission,
  OwnerGateAdmissionWithLease,
  OwnerGateFenceLeaseRequest,
  OwnerGateSnapshotWithLease,
  OwnerGateSubmitInput,
  OwnerGateCancelInput,
  OwnerGateDispatchResult,
  OwnerGateStatusResult,
} from "./owner-gate/types.js";
export {
  HEADER_PRESENCE_DEVICE_ID,
  HEADER_DEVICE_REQUEST_MOBILE_ID,
  HEADER_DEVICE_REQUEST_ID,
  HEADER_DEVICE_REQUEST_METHOD,
} from "./owner-gate/constants.js";
export {
  OwnerGateSnapshotError,
  executionUnavailableMessage,
  snapshotAllowsExecution,
  snapshotAllowsCloudSandbox,
} from "./owner-gate/support.js";

export class OwnerGate extends OwnerGateCloudDispatch {
  private testClaudeChecked = false;

  private async ensureTestClaude(): Promise<void> {
    if (this.testClaudeChecked) return;
    if (!testClaudeConfigured(this.env)) {
      this.testClaudeChecked = true;
      return;
    }
    try {
      const ownerId = this.ownerId();
      if (await isTestAccountOwner(this.env, ownerId)) {
        const store = this.ownerStore();
        try {
          ensureTestClaudeCloudAccount(store.context(null));
        } finally {
          store.flush();
        }
      }
      this.testClaudeChecked = true;
    } catch (error) {
      log("error", "test_claude_account_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private ownerHost(): OwnerHost {
    return (this.ownerHostState ??= createGateHost({
      ownerId: () => this.ownerId(),
      env: this.env as unknown as Cloudflare.Env,
      snapshot: () => this.snapshot(),
      admit: (input) => this.admit(input),
      release: (input) => this.release(input),
      submit: (input) => this.submit(input),
      cancelDispatch: (input) => this.cancelDispatch(input),
      steerDispatch: (input) => this.steerDispatch(input),
      messageLocalAgent: (input) => this.messageLocalAgent(input),
      stopLocalAgent: (input) => this.stopLocalAgent(input),
      askDeviceConsent: (input) => this.askDeviceConsent(input.deviceId, input.requestedAt),
      relayDeviceRequest: (input) => this.relayCloudDeviceRequest(input),
      devices: () => this.devices(),
      homeChanged: (ownerGeneration, revision) =>
        this.homeContextCache().changed(ownerGeneration, revision),
      changeMemoryPolicy: (change) => this.changeMemoryPolicyForCall(change),
      applyOwnerEvents: (events) => this.applyOwnerEvents(events),
      purgeOwner: (mode, requestId) => this.purgeOwnerPass(mode, requestId),
      log,
    }));
  }
  ownerStore(): OwnerStore {
    return (this.ownerStoreState ??= new OwnerStore({
      ctx: this.ctx,
      env: this.env as unknown as Cloudflare.Env,
      ownerId: () => this.ownerId(),
      registry: this.backendRegistry(),
      host: this.ownerHost(),
      verifyToken: async (token) => {
        const verified = await verifyUserToken(
          token,
          this.env as unknown as Cloudflare.Env,
        );
        return verified.ok ? verified.token : null;
      },
      log,
    }));
  }

  async applyOwnerEvents(events: OwnerEvent[]): Promise<void> {
    const ownerId = this.ownerId();
    let generation: string | null = null;
    try {
      generation = (await this.snapshot()).ownerGeneration;
    } catch {
      // Without a snapshot the events still land; a reset is rare and its
      // fences catch anything that matters.
    }
    const current = events.filter(
      (event) =>
        event.ownerId === ownerId &&
        (generation === null || event.ownerGeneration === generation),
    );
    const store = this.ownerStore();
    const effects = applyOwnerEventsToStore(store.context(null), current);
    store.flush();
    await this.scheduleAlarm(Date.now());
    for (const event of current) {
      if (event.kind !== "turn.event" || !event.terminal) continue;
      const outcome = event.terminalStatus;
      if (
        outcome !== "completed" &&
        outcome !== "failed" &&
        outcome !== "canceled"
      )
        continue;
      await this.recordCloudDispatchTerminal({
        ownerGeneration: event.ownerGeneration,
        turnId: event.turnId,
        outcome,
        ...(event.resultJson ? { resultJson: event.resultJson } : {}),
        ...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
      });
    }
    for (const card of effects.cards)
      await this.ownerHost().postConversationCard(card);
  }

  async ownerRpc(input: {
    name: string;
    args: unknown;
    caller: OwnerCaller;
  }): Promise<RpcResponse> {
    await this.ensureTestClaude();
    const store = this.ownerStore();
    const { db } = store.context(input.caller);
    if (callerSessionRevoked(db, input.caller)) {
      return {
        ok: false,
        error: toBackendError(
          new RpcError(
            "UNAUTHENTICATED",
            "You were signed out. Sign in again to continue.",
          ),
        ),
      };
    }
    noteCallerIdentity(db, input.caller);
    const changes = this.sqlChanges();
    const response = await store.call(input.name, input.args, input.caller);
    if (changes === null || this.sqlChanges() !== changes) {
      await this.scheduleAlarm(Date.now());
    }
    return response;
  }

  async storageReport(): Promise<{
    databaseBytes: number;
    tables: Array<{ name: string; rows: number; bytes: number }>;
    jobs: Array<{ kind: string; count: number; nextRunAt: number }>;
    alarmAt: number | null;
  }> {
    this.ensureSchema();
    this.ownerStore().ensureSchema();
    const sql = this.ctx.storage.sql;
    const names = sql
      .exec<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
      )
      .toArray()
      .map((row) => row.name);
    let pages: Map<string, number> | null = null;
    try {
      pages = new Map(
        sql
          .exec<{ name: string; bytes: number }>(
            "SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name",
          )
          .toArray()
          .map((row) => [row.name, row.bytes]),
      );
    } catch {
      pages = null;
    }
    const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
    const tables = names.map((name) => {
      const rows =
        sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${quote(name)}`).one().n;
      let bytes = pages?.get(name) ?? 0;
      if (!pages) {
        try {
          const columns = sql
            .exec<{ name: string }>("SELECT name FROM pragma_table_info(?)", name)
            .toArray()
            .map((row) => `COALESCE(LENGTH(${quote(row.name)}), 0)`);
          bytes = columns.length
            ? (sql
                .exec<{ b: number | null }>(
                  `SELECT SUM(${columns.join(" + ")}) AS b FROM ${quote(name)}`,
                )
                .one().b ?? 0)
            : 0;
        } catch {
          bytes = 0;
        }
      }
      return { name, rows, bytes };
    });
    tables.sort((a, b) => b.bytes - a.bytes);
    const jobs = sql
      .exec<{ kind: string; count: number; next_run_at: number }>(
        "SELECT kind, COUNT(*) AS count, MIN(run_at) AS next_run_at FROM owner_jobs GROUP BY kind",
      )
      .toArray()
      .map((row) => ({ kind: row.kind, count: row.count, nextRunAt: row.next_run_at }));
    return {
      databaseBytes: sql.databaseSize,
      tables,
      jobs,
      alarmAt: await this.ctx.storage.getAlarm(),
    };
  }

  private sqlChanges(): number | null {
    try {
      return this.ctx.storage.sql
        .exec<{ n: number }>("SELECT total_changes() AS n")
        .one().n;
    } catch {
      return null;
    }
  }

  async claudeSessionCommit(input: {
    staged: unknown;
    caller: OwnerCaller;
  }): Promise<RpcResponse> {
    const store = this.ownerStore();
    const { db } = store.context(input.caller);
    if (callerSessionRevoked(db, input.caller)) {
      return {
        ok: false,
        error: toBackendError(
          new RpcError(
            "UNAUTHENTICATED",
            "You were signed out. Sign in again to continue.",
          ),
        ),
      };
    }
    noteCallerIdentity(db, input.caller);
    const changes = this.sqlChanges();
    const response = await store.internalCall(
      "claudeSessions.commitStaged",
      input.staged,
    );
    if (changes === null || this.sqlChanges() !== changes) {
      await this.scheduleAlarm(Date.now());
    }
    return response;
  }

  async ownerInternal(input: {
    name: string;
    args: unknown;
    ownerGeneration: string;
    /**
     * A Stella Crew caller: the call runs in that workspace's drive space and
     * may only be one of `CREW_OWNER_CALLS`. Set by server code from the
     * Slack installation, never from a request body.
     */
    crew?: OwnerCrewScope;
  }): Promise<RpcResponse> {
    const crew = input.crew;
    if (crew !== undefined) {
      const refused = crewRefusal(crew, input.name);
      if (refused) return { ok: false, error: toBackendError(new RpcError("FORBIDDEN", refused)) };
    }
    return await this.#atOwnerGeneration(input.ownerGeneration, input.name, async () => {
      if (crew && !crew.space.startsWith("crew:unplaced-") && !this.#adoptedCrewSpaces.has(`${crew.space}\0${crew.home}`)) {
        const adopted = await this.ownerStore().internalCall("drive.adoptCrewSpace", {}, crew);
        if (!adopted.ok) return adopted;
        this.#adoptedCrewSpaces.add(`${crew.space}\0${crew.home}`);
      }
      return await this.ownerStore().internalCall(input.name, input.args, crew);
    });
  }

  #adoptedCrewSpaces = new Set<string>();

  async ownerCredential(input: {
    kind: OwnerCredentialKind;
    args: unknown;
    ownerGeneration: string;
  }): Promise<RpcResponse> {
    return await this.#atOwnerGeneration(input.ownerGeneration, `credential:${input.kind}`, () =>
      this.ownerStore().credentialCall(input.kind, input.args),
    );
  }

  async #atOwnerGeneration(
    ownerGeneration: string,
    name: string,
    run: () => Promise<RpcResponse>,
  ): Promise<RpcResponse> {
    let current: string;
    try {
      current = (await this.snapshot()).ownerGeneration;
    } catch (error) {
      log("error", "owner_internal_snapshot_failed", {
        name,
        message: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        error: toBackendError(
          new RpcError("UNAVAILABLE", "Owner state is unavailable."),
        ),
      };
    }
    if (current !== ownerGeneration) {
      return {
        ok: false,
        error: toBackendError(
          new RpcError(
            "CONFLICT",
            "This request is from before your cloud data was reset.",
            {
              reason: "owner_generation_stale",
            },
          ),
        ),
      };
    }
    const response = await run();
    await this.scheduleAlarm(Date.now());
    return response;
  }

  async homeControl(input: {
    op: HomeControlOp;
    body: { ownerGeneration: string } & Record<string, unknown>;
  }): Promise<RpcResponse> {
    if (!isHomeControlOp(input.op)) {
      return {
        ok: false,
        error: toBackendError(new RpcError("NOT_FOUND", `Unknown home operation ${String(input.op)}.`)),
      };
    }
    return await this.ownerInternal({
      name: input.op,
      args: input.body,
      ownerGeneration: input.body.ownerGeneration,
    });
  }

  async purgeOwnerData(input: {
    mode: OwnerPurgeMode;
  }): Promise<{ pending: string[] }> {
    const pending: string[] = [];
    for (const [domain, purge] of this.backendRegistry().purges) {
      const result = await this.billingWrite((ctx) => purge(ctx, input.mode));
      if (result.pending) pending.push(domain);
    }
    return { pending };
  }

  async issueSessionCapability(
    request: SessionCapabilityRequest,
  ): Promise<BillingControlResult<GatewaySessionCapabilityResponse>> {
    const now = Date.now();
    const paying = billingPaying(this.ownerStore().context(null, now));
    let snapshot: OwnerSnapshot;
    try {
      snapshot = await this.snapshot({ now });
    } catch {
      return { ok: false, status: null, code: null, retryable: true };
    }
    const admission = await this.billingWrite((ctx) =>
      admitSession(ctx, { ...request, paying, snapshot }),
    );
    if (!admission.ok) return admission;
    const { ownerGeneration, identityLevel } = admission.body;
    const jti = crypto.randomUUID();
    const expiresAt =
      (Math.floor(now / 1000) +
        Math.ceil(GATEWAY_SESSION_CAPABILITY_TTL_MS / 1000)) *
      1000;
    const grant = await this.billingWrite((ctx) => {
      recordBillingIdentity(ctx, { identityLevel });
      return reserveSessionGrant(ctx, { jti, expiresAt });
    });
    const signed = await signCapability(
      {
        iss: GATEWAY_CAPABILITY_ISSUERS.cloudBuilder,
        sub: this.ownerId(),
        jti,
        gen: ownerGeneration,
        dpk: request.deviceKeyHash,
        kind: "session",
        audience: grant.audience,
        budgetMicroCents: grant.budgetMicroCents,
        ...(grant.usageLimit ? { usageLimit: grant.usageLimit.reason } : {}),
      },
      await capabilitySigningKey(this.env),
      { ttlMs: GATEWAY_SESSION_CAPABILITY_TTL_MS, now },
    );
    return {
      ok: true,
      body: {
        capability: signed.token,
        expiresAt: signed.claims.exp * 1000,
        audience: grant.audience,
        budgetMicroCents: grant.budgetMicroCents,
        identityLevel: grant.identityLevel,
      },
    };
  }

  async applyGatewayUsage(
    events: GatewayUsageEvent[],
  ): Promise<UsageBatchResult> {
    return await this.billingWrite((ctx) => {
      const settled = applyGatewayUsage(ctx, events);
      const accepted = events.filter((event) =>
        settled.accepted.includes(event.requestId),
      );
      recordGatewayUsageRisk(ctx, accepted, billingAccess(ctx).identityLevel);
      return settled;
    });
  }

  async ownerEnforcement(): Promise<OwnerEnforcementState> {
    return readEnforcement(this.ownerStore().context(null));
  }

  async setOwnerEnforcement(
    input: SetEnforcementInput,
  ): Promise<OwnerEnforcementState> {
    return await this.billingWrite((ctx) => setEnforcement(ctx, input));
  }

  async abuseState(): Promise<ReturnType<typeof abuseState>> {
    return abuseState(this.ownerStore().context(null));
  }

  async applyStripeEvent(event: StripeEvent): Promise<void> {
    await this.billingWrite((ctx) => applyStripeEvent(ctx, event));
  }

  async billingAccess(): Promise<BillingAccess> {
    return billingAccess(this.ownerStore().context(null));
  }

  async setBillingPlan(input: {
    plan?: BillingPlan;
    usageMode?: "default" | "unlimited";
    resetUsage?: boolean;
    spendAllowance?: boolean;
  }): Promise<void> {
    await this.billingWrite((ctx) => setAdminPlan(ctx, input));
  }

  async closeBilling(): Promise<void> {
    await closeStripeCustomer(this.ownerStore().context(null));
  }

  async mobileRoute(
    input: MobileRouteInput,
  ): Promise<{ status: number; json: string }> {
    const result = await this.billingWrite((ctx) =>
      handleMobileRoute(ctx, input),
    );
    return { status: result.status, json: JSON.stringify(result.body) };
  }

  async userAskRoute(
    input: UserAskRouteInput,
  ): Promise<{ status: number; json: string }> {
    const result = await this.billingWrite((ctx) =>
      handleUserAskRoute(ctx, input),
    );
    return { status: result.status, json: JSON.stringify(result.body) };
  }

  async userAskReply(input: {
    askId: string;
    body: Record<string, unknown>;
  }): Promise<{ status: number; json: string }> {
    const result = await this.billingWrite((ctx) =>
      handleUserAskReply(ctx, input),
    );
    return { status: result.status, json: JSON.stringify(result.body) };
  }

  async setDeletionHold(hold: boolean): Promise<void> {
    await this.billingWrite((ctx) => setDeletionHold(ctx.db, hold));
  }

  async deletionStatus(): Promise<{ closed: boolean; purging: boolean }> {
    const state = readOwnerState(this.ownerStore().context(null).db);
    return { closed: state.closed, purging: state.purge !== null };
  }

  async stopRenewal(): Promise<void> {
    await this.billingWrite((ctx) => stopStripeRenewal(ctx));
  }

  async closeOwner(): Promise<{ pending: string[] }> {
    await this.billingWrite((ctx) => beginOwnerPurge(ctx, "delete"));
    await this.closeBilling();
    await this.ownerStore().runDueJobs();
    const store = this.ownerStore();
    const { purge } = readOwnerState(store.context(null).db);
    store.flush();
    return { pending: purge ? ["owner"] : [] };
  }

  async homeContext(
    ownerGeneration: string,
    fenceGeneration: string,
  ): Promise<OwnerHomeContext> {
    return await this.homeContextCache().load({
      ownerGeneration,
      builtins: (await builtinCloudAppSkill()).versionId,
      assertPolicy: (policy) =>
        this.memoryPolicy().assert(policy, fenceGeneration),
      fetch: async () => {
        if (!this.env.AGENT_HOME)
          throw new Error("Cloud home bucket unavailable");
        const store = new CloudHomeStore(this.env.AGENT_HOME, {
          ownerId: this.ownerId(),
          ownerGeneration,
          control: (op, body) => this.homeControl({ op, body }),
        });
        const [memory, skills] = await Promise.all([
          store.getMemoryContext(),
          store.loadSkillCatalog("orchestrator"),
        ]);
        return { memory, skills };
      },
    });
  }

  async registerConversationReader(args: {
    ownerId: string;
    ownerGeneration: string;
    conversationId: string;
    readerId: string;
  }): Promise<void> {
    if (args.ownerId !== this.ownerId())
      throw new MemoryPolicyError("OWNER_MISMATCH", 403);
    await this.modelGrants().registerReader({
      conversationId: args.conversationId,
      readerId: args.readerId,
    });
  }

  async acquireModelGrant(args: {
    ownerId: string;
    ownerGeneration: string;
    conversationId: string;
    readerId: string;
    turnId: string;
    leaseId: string;
    fenceGeneration: string;
    policy: MemoryPolicy;
  }): Promise<OwnerModelGrant> {
    if (
      args.ownerId !== this.ownerId() ||
      args.ownerGeneration !== args.policy.ownerGeneration
    )
      throw new MemoryPolicyError("OWNER_MISMATCH", 403);
    const sessions = this.env.ORCHESTRATOR_SESSIONS;
    if (!sessions) throw new Error("Conversation execution is not configured.");
    const response = await this.ownerFenceCall("assert", {
      ownerId: args.ownerId,
      ownerGeneration: args.ownerGeneration,
      generation: args.fenceGeneration,
      leaseId: args.leaseId,
      turnId: args.turnId,
      sessionId: sessions.idFromName(args.conversationId).toString(),
    });
    if (!response.ok) throw new MemoryPolicyError("OWNER_FENCE_CHANGED");
    const lease: unknown = await response.json();
    if (
      !lease ||
      typeof lease !== "object" ||
      !("expiresAt" in lease) ||
      typeof lease.expiresAt !== "number" ||
      !Number.isFinite(lease.expiresAt)
    )
      throw new MemoryPolicyError("OWNER_FENCE_CHANGED");
    return await this.issueModelGrant({ ...args, expiresAt: lease.expiresAt });
  }

  async changeMemoryPolicy(
    change: MemoryPolicyChange,
  ): Promise<
    { ok: true } | { ok: false; code: string; status: number; message: string }
  > {
    try {
      await this.memoryPolicy().change(change);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        code:
          error instanceof MemoryPolicyError
            ? error.code
            : "MEMORY_POLICY_UNAVAILABLE",
        status: error instanceof MemoryPolicyError ? error.status : 503,
        message:
          error instanceof MemoryPolicyError
            ? error.message
            : "MEMORY_POLICY_UNAVAILABLE",
      };
    }
  }

  async assertMemoryPolicy(
    policy: MemoryPolicy,
    fenceGeneration: string,
    leaseId: string,
    turnId?: string,
  ): Promise<void> {
    const invokedAt = Date.now();
    const startedAt = performance.now();
    const response = await this.ownerFenceCall("assert", {
      ownerId: this.ownerId(),
      ownerGeneration: policy.ownerGeneration,
      generation: fenceGeneration,
      leaseId,
    });
    if (!response.ok) throw new MemoryPolicyError("OWNER_FENCE_CHANGED");
    const fenceMs = performance.now() - startedAt;
    await this.memoryPolicy().assert(policy, fenceGeneration);
    log("info", "owner_memory_assertion_timing", {
      turnId,
      invokedAt,
      fenceMs,
      policyMs: performance.now() - startedAt - fenceMs,
      totalMs: performance.now() - startedAt,
    });
  }

  /**
   * The owner snapshot, built from this object's own tables on every read:
   * generation and writability from `account`, identity as the owner's last
   * verified token claimed it, enforcement from `abuse`, plan and turn
   * allowance from `billing`, execution from `engines`, devices from
   * `devices`. `refresh` is accepted for callers that still pass it.
   */
  async snapshot(
    options: { refresh?: boolean; now?: number } = {},
  ): Promise<OwnerSnapshot> {
    await this.ensureTestClaude();
    const ownerMode = ownerModeEnabled(this.env);
    const managedModels = ownerMode ? (await gatewayCapabilities(this.env))?.managedModels : undefined;
    const now = options.now ?? Date.now();
    const store = this.ownerStore();
    const ctx = store.context(null, now);
    try {
      const state = readOwnerState(ctx.db);
      const enforcement = enforcementForSnapshot(ctx);
      const owned: OwnerSnapshot = {
        v: OWNER_SNAPSHOT_VERSION,
        ownerId: this.ownerId(),
        ownerGeneration: state.generation,
        writable: state.writable && enforcement?.status !== "suspended",
        isAnonymous: false,
        identityLevel: state.identityLevel,
        ...(enforcement ? { enforcement } : {}),
        plan: "free",
        cloudSandbox: { enabled: false },
        allowance: {
          audience: "free",
          budgetMicroCents: 0,
        },
        ...snapshotDevices(ctx.db),
        ...snapshotEngines(ctx.db, { ownerMode, ...(managedModels === undefined ? {} : { managedModels }) }),
        ...snapshotTimeZone(ctx.db),
        fetchedAt: now,
        ttlMs: SNAPSHOT_TTL_MS,
      };
      let billing: ReturnType<typeof turnAllowance>;
      try {
        recordBillingIdentity(ctx, { identityLevel: state.identityLevel });
        billing = turnAllowance(ctx);
      } catch (error) {
        if (!(error instanceof BillingConfigError)) throw error;
        log("error", "billing_unconfigured", {
          ownerId: this.ownerId(),
          message: error.message,
        });
        return { ...owned, billingUnavailable: true };
      }
      return {
        ...owned,
        plan: billing.plan,
        cloudSandbox: cloudSandboxAccess(ctx),
        identityLevel: billing.identityLevel,
        allowance: billing.allowance,
        ...(billing.usageLimit ? { usageLimit: billing.usageLimit } : {}),
      };
    } finally {
      store.flush();
    }
  }

  async noteIdentity(input: { identityLevel?: IdentityLevel }): Promise<void> {
    const store = this.ownerStore();
    try {
      noteCallerIdentity(store.context(null).db, input);
    } finally {
      store.flush();
    }
  }

  async snapshotWithFenceLease(input: {
    lease: OwnerGateFenceLeaseRequest;
    now?: number;
  }): Promise<OwnerGateSnapshotWithLease> {
    const now = input.now ?? Date.now();
    let snapshot: OwnerSnapshot;
    try {
      snapshot = await this.snapshot({ now });
    } catch (error) {
      const failure =
        error instanceof OwnerGateSnapshotError
          ? error
          : new OwnerGateSnapshotError(
              "internal",
              error instanceof Error ? error.message : String(error),
              true,
            );
      return {
        snapshot: null,
        snapshotError: {
          code: failure.code,
          message: failure.message,
          retryable: failure.retryable,
        },
        lease: { status: "skipped", reason: "snapshot_unavailable" },
      };
    }
    if (!snapshot.writable) {
      return { snapshot, lease: { status: "skipped", reason: "not_writable" } };
    }
    if (snapshot.ownerGeneration !== input.lease.ownerGeneration) {
      return {
        snapshot,
        lease: { status: "skipped", reason: "generation_stale" },
      };
    }
    return { snapshot, lease: await this.registerFenceLease(input.lease) };
  }

  async admitWithFenceLease(input: {
    admission: OwnerGateAdmitInput;
    lease: OwnerGateFenceLeaseRequest;
    includeHomeContext?: boolean;
  }): Promise<OwnerGateAdmissionWithLease> {
    if (input.admission.turnId !== input.lease.turnId) {
      return {
        admission: refuse(
          "internal",
          "Admission and lease turn ids differ.",
          false,
        ),
        lease: { status: "skipped", reason: "admission_refused" },
      };
    }
    const admission = await this.admit(input.admission);
    if (!admission.ok) {
      return {
        admission,
        lease: { status: "skipped", reason: "admission_refused" },
      };
    }
    if (admission.snapshot.ownerGeneration !== input.lease.ownerGeneration) {
      return {
        admission,
        lease: { status: "skipped", reason: "generation_stale" },
      };
    }
    const lease = await this.registerFenceLease(input.lease);
    if (input.includeHomeContext && lease.status === "registered") {
      const [homeContext, destinations] = await Promise.all([
        this.homeContext(input.lease.ownerGeneration, lease.generation).catch(
          () => undefined,
        ),
        this.devices().catch(() => undefined),
      ]);
      return {
        admission,
        lease,
        ...(homeContext ? { homeContext } : {}),
        ...(destinations ? { destinations } : {}),
      };
    }
    return { admission, lease };
  }

  async admit(input: OwnerGateAdmitInput): Promise<OwnerGateAdmission> {
    this.ensureSchema();
    const now = input.now ?? Date.now();
    const turnId = input.turnId?.trim() ?? "";
    if (!turnId || (input.lane !== "chat" && input.lane !== "agent")) {
      return refuse(
        "internal",
        "Owner gate admission requires a lane and turn id.",
        false,
      );
    }
    let snapshot: OwnerSnapshot;
    try {
      snapshot = await this.snapshot({ now });
      if (
        input.expectedGeneration &&
        input.expectedGeneration !== snapshot.ownerGeneration
      ) {
        // The cache can lag a rotation whose push was lost. One forced
        // refresh separates "stale cache" from "stale caller".
        snapshot = await this.snapshot({ refresh: true, now });
      }
    } catch (error) {
      const failure =
        error instanceof OwnerGateSnapshotError
          ? error
          : new OwnerGateSnapshotError(
              "internal",
              error instanceof Error ? error.message : String(error),
              true,
            );
      log("error", "owner_gate_snapshot_unavailable", {
        ownerId: this.ownerId(),
        code: failure.code,
        message: failure.message,
      });
      return failure.code === "owner_purged"
        ? refuse(
            "owner_purged",
            "This account's cloud data is no longer available.",
            false,
          )
        : refuse(
            "internal",
            "Stella can't check your account right now. Try again shortly.",
            true,
          );
    }
    if (
      input.expectedGeneration &&
      input.expectedGeneration !== snapshot.ownerGeneration
    ) {
      return refuse(
        "generation_stale",
        "This cloud owner generation is no longer current.",
        false,
      );
    }
    if (snapshot.enforcement?.status === "suspended") {
      return refuse(
        "owner_suspended",
        "This account can't use Stella's cloud right now.",
        false,
      );
    }
    if (!snapshot.writable) {
      return refuse(
        "owner_purged",
        "This account's cloud data is being reset or deleted.",
        false,
      );
    }
    if (
      input.lane === "agent" &&
      !input.deferCloudSandboxCheck &&
      !snapshotAllowsCloudSandbox(snapshot)
    ) {
      return refuse(
        "subscription_required",
        CLOUD_SANDBOX_SUBSCRIPTION_REQUIRED_MESSAGE,
        false,
      );
    }
    this.prune(now);
    const existing = this.ctx.storage.sql
      .exec<{
        lane: string;
      }>(`SELECT lane FROM running WHERE turn_id = ?`, turnId)
      .toArray();
    if (existing.length > 0) {
      return { ok: true, snapshot, replayed: true };
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO running (turn_id, lane, conversation_id, started_at)
       VALUES (?, ?, ?, ?)`,
      turnId,
      input.lane,
      input.conversationId ?? "",
      now,
    );
    return { ok: true, snapshot, replayed: false };
  }

  async release(input: { turnId: string }): Promise<void> {
    this.ensureSchema();
    const turnId = input.turnId?.trim() ?? "";
    if (!turnId) return;
    this.ctx.storage.sql.exec(`DELETE FROM running WHERE turn_id = ?`, turnId);
  }

  async acquireAgentContainer(input: {
    sandboxId: string;
    now?: number;
  }): Promise<{ ok: boolean; running: number; limit: number }> {
    this.ensureSchema();
    const now = input.now ?? Date.now();
    const sandboxId = input.sandboxId?.trim() ?? "";
    if (!sandboxId)
      throw new TypeError("acquireAgentContainer needs a sandbox id.");
    const sql = this.ctx.storage.sql;
    sql.exec(
      `DELETE FROM agent_containers WHERE acquired_at < ?`,
      now - (this.turnTimeoutMs() + OWNER_GATE_RUNNING_GRACE_MS),
    );
    const held =
      sql
        .exec(`SELECT 1 FROM agent_containers WHERE sandbox_id = ?`, sandboxId)
        .toArray().length > 0;
    const running = sql
      .exec<{ count: number }>(`SELECT COUNT(*) AS count FROM agent_containers`)
      .one().count;
    if (!held && running >= OWNER_AGENT_CONTAINER_LIMIT) {
      return { ok: false, running, limit: OWNER_AGENT_CONTAINER_LIMIT };
    }
    sql.exec(
      `INSERT INTO agent_containers (sandbox_id, acquired_at) VALUES (?, ?)
       ON CONFLICT(sandbox_id) DO UPDATE SET acquired_at = excluded.acquired_at`,
      sandboxId,
      now,
    );
    return {
      ok: true,
      running: held ? running : running + 1,
      limit: OWNER_AGENT_CONTAINER_LIMIT,
    };
  }

  async releaseAgentContainer(input: { sandboxId: string }): Promise<void> {
    this.ensureSchema();
    const sandboxId = input.sandboxId?.trim() ?? "";
    if (!sandboxId) return;
    this.ctx.storage.sql.exec(
      `DELETE FROM agent_containers WHERE sandbox_id = ?`,
      sandboxId,
    );
  }

  async agentContainers(): Promise<string[]> {
    this.ensureSchema();
    return this.ctx.storage.sql
      .exec<{ sandbox_id: string }>(`SELECT sandbox_id FROM agent_containers`)
      .toArray()
      .map((row) => row.sandbox_id);
  }

  async status(now = Date.now()): Promise<{
    running: Array<{
      turnId: string;
      lane: string;
      conversationId: string;
      startedAt: number;
    }>;
  }> {
    this.ensureSchema();
    this.prune(now);
    const running = this.ctx.storage.sql
      .exec<{
        turn_id: string;
        lane: string;
        conversation_id: string;
        started_at: number;
      }>(
        `SELECT turn_id, lane, conversation_id, started_at FROM running ORDER BY started_at ASC`,
      )
      .toArray()
      .map((row) => ({
        turnId: row.turn_id,
        lane: row.lane,
        conversationId: row.conversation_id,
        startedAt: row.started_at,
      }));
    return { running };
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/owner-fence/")) {
      if (request.method !== "POST") {
        return Response.json({ error: "Method not allowed." }, { status: 405 });
      }
      const path = url.pathname.slice("/owner-fence/".length);
      const body: unknown =
        path === "begin" || path === "register" || path === "unregister"
          ? await request.clone().json()
          : undefined;
      const unregister = path === "unregister" ? body : undefined;
      const response = await this.fetchOwnerFence(path, request, body);
      if (
        response.ok &&
        unregister &&
        typeof unregister === "object" &&
        "turnId" in unregister &&
        typeof unregister.turnId === "string" &&
        "leaseId" in unregister &&
        typeof unregister.leaseId === "string"
      ) {
        if (
          "ownerGeneration" in unregister &&
          typeof unregister.ownerGeneration === "string"
        ) {
          await this.modelGrants().retireExactTurnLease({
            ownerGeneration: unregister.ownerGeneration,
            turnId: unregister.turnId,
            leaseId: unregister.leaseId,
          });
        }
        const dispatchId = await this.ctx.storage.get<string>(
          cloudChatTurnKey(unregister.turnId),
        );
        const handoff = dispatchId
          ? await this.ctx.storage.get<CloudChatHandoff>(
              cloudChatHandoffKey(dispatchId),
            )
          : undefined;
        const identity =
          handoff?.phase === "registered" ? handoff.authority : handoff;
        if (
          dispatchId &&
          identity?.turnId === unregister.turnId &&
          identity.leaseId === unregister.leaseId
        ) {
          await this.ctx.storage.put(cloudChatHandoffKey(dispatchId), {
            phase: "retired",
            turnId: identity.turnId,
            leaseId: identity.leaseId,
          } satisfies CloudChatHandoff);
          await this.release({ turnId: identity.turnId });
          this.ctx.storage.sql.exec(
            "UPDATE dispatches SET gate_held = 0 WHERE dispatch_id = ?",
            dispatchId,
          );
        }
      }
      return response;
    }
    if (url.pathname === "/live") {
      if (
        (request.headers.get("upgrade") ?? "").toLowerCase() !== "websocket"
      ) {
        return Response.json(
          { error: "This endpoint speaks WebSocket only." },
          { status: 426 },
        );
      }
      const caller = trustedOwnerCaller(request);
      if (!caller || caller.ownerId !== this.ownerId()) {
        return Response.json(
          { error: "Missing verified identity." },
          { status: 401 },
        );
      }
      const store = this.ownerStore();
      const { db } = store.context(caller);
      if (callerSessionRevoked(db, caller)) {
        return Response.json(
          { error: "You were signed out." },
          { status: 401 },
        );
      }
      noteCallerIdentity(db, caller);
      const response = store.acceptLive(caller);
      await this.scheduleAlarm(Date.now());
      return response;
    }
    if (url.pathname === "/device-request") {
      return await this.handleDeviceRequest(request);
    }
    if (url.pathname !== "/presence") {
      return Response.json({ error: "Not found." }, { status: 404 });
    }
    if ((request.headers.get("upgrade") ?? "").toLowerCase() !== "websocket") {
      return Response.json(
        { error: "This endpoint speaks WebSocket only." },
        { status: 426 },
      );
    }
    const ownerId = request.headers.get("x-stella-owner")?.trim() ?? "";
    const deviceId =
      request.headers.get(HEADER_PRESENCE_DEVICE_ID)?.trim() ?? "";
    const authExpiresAtMs = Number(request.headers.get("x-stella-token-exp"));
    const now = Date.now();
    if (
      !ownerId ||
      ownerId !== this.ownerId() ||
      !deviceId ||
      deviceId.length > MAX_DEVICE_ID_CHARS ||
      !Number.isFinite(authExpiresAtMs) ||
      authExpiresAtMs <= now
    ) {
      return Response.json(
        { error: "Missing verified device identity." },
        { status: 401 },
      );
    }
    this.ensureSchema();
    const pair = new WebSocketPair();
    const server = pair[1]!;
    const attachment: PresenceAttachment = {
      v: 1,
      deviceId,
      authExpiresAtMs,
      connectionId: crypto.randomUUID(),
      nonce: crypto.randomUUID(),
      phase: "challenged",
      lastSeenAtMs: now,
    };
    this.ctx.acceptWebSocket(server, [presenceTag(deviceId)]);
    server.serializeAttachment(attachment);
    this.send(server, {
      type: "challenge",
      connectionId: attachment.connectionId,
      nonce: attachment.nonce,
      pingIntervalMs: DEVICE_PRESENCE_PING_INTERVAL_MS,
      staleAfterMs: DEVICE_PRESENCE_STALE_AFTER_MS,
    });
    await this.scheduleAlarm(now);
    return new Response(null, {
      status: 101,
      webSocket: pair[0]!,
      headers: { "sec-websocket-protocol": DEVICE_PRESENCE_SUBPROTOCOL },
    });
  }

  async webSocketMessage(
    socket: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (this.ownerStore().isLiveSocket(socket)) {
      const deadlinesMayHaveMoved = await this.ownerStore().onLiveMessage(
        socket,
        message,
      );
      if (deadlinesMayHaveMoved) await this.scheduleAlarm(Date.now());
      return;
    }
    const text =
      typeof message === "string"
        ? message
        : new TextDecoder().decode(new Uint8Array(message));
    if (
      new TextEncoder().encode(text).byteLength >
      DEVICE_PRESENCE_MAX_FRAME_BYTES
    ) {
      this.closeSocket(
        socket,
        DEVICE_PRESENCE_CLOSE.protocol,
        "frame_too_large",
      );
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.closeSocket(socket, DEVICE_PRESENCE_CLOSE.protocol, "bad_request");
      return;
    }
    if (!isRecord(parsed)) {
      this.closeSocket(socket, DEVICE_PRESENCE_CLOSE.protocol, "bad_request");
      return;
    }
    const attachment = this.attachment(socket);
    if (!attachment) {
      this.closeSocket(
        socket,
        DEVICE_PRESENCE_CLOSE.unauthorized,
        "unauthorized",
      );
      return;
    }
    this.ensureSchema();
    const now = Date.now();
    if (attachment.authExpiresAtMs <= now) {
      await this.dropSocket(
        socket,
        attachment,
        DEVICE_PRESENCE_CLOSE.stale,
        "stale",
        now,
      );
      return;
    }
    const frame = parsed as DevicePresenceDeviceFrame;
    try {
      await this.handleDeviceFrame(socket, attachment, frame, now);
    } catch (error) {
      log("error", "device_presence_frame_failed", {
        ownerId: this.ownerId(),
        deviceId: attachment.deviceId,
        type: String((frame as { type?: unknown }).type ?? ""),
        message: error instanceof Error ? error.message : String(error),
      });
      this.send(socket, {
        type: "error",
        code: "internal",
        message: "Stella could not process that frame.",
        retryable: true,
      });
    }
  }

  async webSocketClose(socket: WebSocket, code: number): Promise<void> {
    if (this.ownerStore().isLiveSocket(socket)) {
      this.ownerStore().onLiveClose(socket);
      return;
    }
    const attachment = this.attachment(socket);
    const now = Date.now();
    if (attachment?.phase === "connected") {
      this.markDisconnected(attachment, now);
    }
    if (attachment) {
      this.deviceRequestRelay().onDeviceGone(attachment.deviceId, socket);
    }
    this.closeSocket(socket, code >= 3000 && code <= 4999 ? code : 1000, "");
    await this.scheduleAlarm(now);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    if (this.ownerStore().isLiveSocket(socket)) {
      this.ownerStore().onLiveClose(socket);
      return;
    }
    const attachment = this.attachment(socket);
    const now = Date.now();
    if (attachment?.phase === "connected") {
      this.markDisconnected(attachment, now);
    }
    if (attachment) {
      this.deviceRequestRelay().onDeviceGone(attachment.deviceId, socket);
    }
    this.closeSocket(socket, 1011, "socket_error");
  }

  async devices(now = Date.now()): Promise<DevicesResponse> {
    this.ensureSchema();
    const snapshot = await this.snapshot({ now });
    const devices: DeviceDestination[] = [];
    for (const device of snapshot.devices ?? []) {
      const presence = this.presenceRow(device.deviceId);
      const online = Boolean(
        presence?.connected &&
          presence.lastSeenAt + DEVICE_PRESENCE_STALE_AFTER_MS > now,
      );
      devices.push(deviceDestination(device, presence, online));
    }
    return {
      protocol: PLACEMENT_PROTOCOL,
      devices,
      cloud: { capabilities: [...CLOUD_CAPABILITIES] },
    };
  }

  async submit(input: OwnerGateSubmitInput): Promise<OwnerGateDispatchResult> {
    const receivedAt = Date.now();
    const startedAt = performance.now();
    this.ensureSchema();
    const now = input.now ?? Date.now();
    const request = input.request;
    const payloadJson = canonicalDispatchPayloadJson(request.payload);
    if (
      new TextEncoder().encode(payloadJson).byteLength >
      MAX_DISPATCH_PAYLOAD_BYTES
    ) {
      return fail(
        "bad_request",
        "Dispatch payload exceeds the durable payload limit.",
        false,
      );
    }
    const payloadHash = await sha256Hex(payloadJson);
    const targetMode = request.targetMode ?? "automatic";
    const requestingDeviceId = request.requestingDeviceId?.trim() || undefined;
    const pairGrantDeviceId = input.pairGrantDeviceId?.trim() || undefined;
    const requiredCapabilities = [...request.requiredCapabilities];
    const fingerprint = JSON.stringify([
      request.kind,
      request.ingress,
      request.subject,
      targetMode,
      request.targetDeviceId ?? "",
      request.conversationId,
      request.parentTurnId ?? "",
      request.threadId ?? "",
      requestingDeviceId ?? "",
      pairGrantDeviceId ?? "",
      requiredCapabilities,
      payloadHash,
    ]);
    const existing = this.ctx.storage.sql
      .exec<DispatchRow>(
        `SELECT * FROM dispatches WHERE idempotency_key = ?`,
        request.idempotencyKey,
      )
      .toArray()[0];
    if (existing) {
      if (existing.routing_fingerprint !== fingerprint) {
        return fail(
          "conflict",
          "This idempotency key was already used for different execution bytes or routing metadata.",
          false,
        );
      }
      return {
        ok: true,
        response: {
          protocol: PLACEMENT_PROTOCOL,
          dispatch: dispatchSummary(existing),
          replayed: true,
        },
      };
    }
    const dispatchId = `dsp:${crypto.randomUUID()}`;
    let snapshot: OwnerSnapshot;
    let gateHeld = false;
    if (request.kind === "agent") {
      const admission = await this.admit({
        lane: "agent",
        turnId: dispatchId,
        conversationId: request.conversationId,
        deferCloudSandboxCheck: true,
        ...(input.expectedGeneration
          ? { expectedGeneration: input.expectedGeneration }
          : {}),
        now,
      });
      if (!admission.ok) {
        return fail(
          admission.code,
          admission.message,
          admission.retryable,
          admission.retryAfterMs,
        );
      }
      snapshot = admission.snapshot;
      gateHeld = true;
    } else {
      const resolved = await this.submitSnapshot(input.expectedGeneration, now);
      if (!resolved.ok) return resolved;
      snapshot = resolved.snapshot;
    }
    const refuse = async (
      code: DispatchError["error"]["code"],
      message: string,
    ): Promise<OwnerGateDispatchResult> => {
      if (gateHeld) await this.release({ turnId: dispatchId });
      return fail(code, message, false);
    };
    const decision = decideDispatchPlacement({
      ingress: request.ingress,
      subject: request.subject,
      targetMode,
    });
    let candidates: DevicePresenceState[] = [];
    let awaitsReconnect = false;
    if (decision.kind === "offer") {
      if (
        request.ingress === "mobile" &&
        Boolean(requestingDeviceId) !== Boolean(pairGrantDeviceId)
      ) {
        return await refuse(
          "bad_request",
          "Mobile execution admission requires both sides of a verified desktop pairing.",
        );
      }
      if (
        targetMode === "device" &&
        request.ingress === "mobile" &&
        request.targetDeviceId !== pairGrantDeviceId
      ) {
        return await refuse(
          "forbidden",
          "The selected computer does not match the verified pairing.",
        );
      }
      candidates = this.eligibleDevices({
        snapshot,
        deviceIds: this.offerCandidateIds(
          {
            ingress: request.ingress,
            requesting_device_id: requestingDeviceId ?? null,
            pair_grant_device_id: pairGrantDeviceId ?? null,
            requested_target_mode: targetMode,
            requested_executor_device_id: request.targetDeviceId ?? null,
          },
          snapshot,
        ),
        kind: request.kind,
        requiredCapabilities,
        now,
      });
      if (
        candidates.length === 0 &&
        targetMode === "device" &&
        request.targetDeviceId
      ) {
        const reconnecting = this.reconnectingDevice({
          snapshot,
          deviceId: request.targetDeviceId,
          kind: request.kind,
          requiredCapabilities,
          now,
        });
        if (reconnecting) {
          candidates = [reconnecting];
          awaitsReconnect = true;
        }
      }
    }
    const targetConsent =
      targetMode === "device" && request.targetDeviceId
        ? await this.deviceRemoteExecution(request.targetDeviceId, now)
        : undefined;
    if (
      targetConsent !== undefined &&
      targetConsent !== "enabled" &&
      request.targetDeviceId
    ) {
      await this.requestDeviceConsent({
        deviceId: request.targetDeviceId,
        remoteExecution: targetConsent,
        now,
      });
    }
    if (
      decision.kind === "commit" &&
      decision.placement === "computer" &&
      !requestingDeviceId
    ) {
      return await refuse(
        "bad_request",
        "A desktop dispatch must name the device that will run it.",
      );
    }

    let state: DispatchState;
    let placement: "computer" | "cloud" | null = null;
    let executorDeviceId: string | null = null;
    let executorSessionId: string | null = null;
    let onNoEligibleComputer: "cloud" | "blocked" =
      request.subject === "computer" ? "blocked" : "cloud";
    let fallbackReason: string | null = null;
    let errorCode: string | null = null;
    let errorMessage: string | null = null;
    let offerDeadlineAt: number | null = null;
    let leaseExpiresAt: number | null = null;

    if (decision.kind === "commit") {
      placement = decision.placement;
      fallbackReason = decision.reason;
      if (decision.placement === "cloud") {
        state = "cloud_committed";
        leaseExpiresAt = now + DISPATCH_ACCEPTED_LEASE_MS;
      } else {
        state = "computer_accepted";
        executorDeviceId = requestingDeviceId!;
        executorSessionId =
          this.presenceRow(requestingDeviceId!)?.presenceSessionId ?? null;
        leaseExpiresAt = now + DISPATCH_ACCEPTED_LEASE_MS;
      }
    } else if (decision.kind === "blocked") {
      state = "blocked";
      onNoEligibleComputer = "blocked";
      fallbackReason = decision.reason;
      errorCode = "COMPUTER_REQUIRED_UNAVAILABLE";
      errorMessage =
        "This work requires a computer, but this execution surface cannot safely provide one.";
    } else {
      onNoEligibleComputer = decision.onNoEligibleComputer;
      if (candidates.length > 0) {
        state = "offering";
        fallbackReason = decision.reason;
        offerDeadlineAt =
          now +
          (awaitsReconnect
            ? DISPATCH_RECONNECT_GRACE_MS
            : DISPATCH_OFFER_WINDOW_MS);
      } else if (decision.onNoEligibleComputer === "cloud") {
        state = "cloud_committed";
        placement = "cloud";
        fallbackReason = "no-eligible-paired-computer";
        leaseExpiresAt = now + DISPATCH_ACCEPTED_LEASE_MS;
      } else {
        state = "blocked";
        const explicitDevice = targetMode === "device";
        const refusal = explicitDevice
          ? this.selectedDeviceRefusal({
              deviceId: request.targetDeviceId ?? null,
              now,
              ...(targetConsent ? { remoteExecution: targetConsent } : {}),
            })
          : null;
        fallbackReason = refusal
          ? refusal.fallbackReason
          : explicitDevice
            ? "selected-device-unavailable"
            : "no-eligible-paired-computer";
        errorCode = refusal
          ? refusal.errorCode
          : explicitDevice
            ? "SELECTED_DEVICE_UNAVAILABLE"
            : "COMPUTER_REQUIRED_UNAVAILABLE";
        errorMessage = refusal
          ? refusal.errorMessage
          : explicitDevice
            ? "The selected computer is online but isn't accepting work right now. It may still be starting up, be signed out, have cloud sync off, or not allow work from other devices."
            : "This work requires your paired computer, but no eligible computer is reachable.";
      }
    }

    if (
      request.kind === "agent" &&
      state === "cloud_committed" &&
      !snapshotAllowsCloudSandbox(snapshot)
    ) {
      return await refuse(
        "subscription_required",
        CLOUD_SANDBOX_SUBSCRIPTION_REQUIRED_MESSAGE,
      );
    }

    const terminal = state === "blocked";
    // The payload is deleted the moment a computer durably accepts it: after
    // that the desktop's own inbox is the only copy and this object must
    // never be able to serve it a second time.
    const keepsPayload = !terminal && state !== "computer_accepted";
    this.ctx.storage.sql.exec(
      `INSERT INTO dispatches (
         dispatch_id, idempotency_key, owner_generation, kind, ingress, subject,
         requested_target_mode, requested_executor_device_id, conversation_id,
         parent_turn_id, thread_id, requesting_device_id, pair_grant_device_id,
         required_capabilities, routing_fingerprint, state, placement,
         executor_device_id, executor_presence_session_id,
         on_no_eligible_computer, revision, fallback_reason, cancel_request_id,
         cancel_reason, error_code, error_message, cloud_turn_id,
         cloud_thread_id, payload_json, payload_hash, payload_expires_at,
         offer_deadline_at, lease_expires_at, started_at, gate_held,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 1, ?, NULL, NULL, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      dispatchId,
      request.idempotencyKey,
      snapshot.ownerGeneration,
      request.kind,
      request.ingress,
      request.subject,
      targetMode,
      request.targetDeviceId ?? null,
      request.conversationId,
      request.parentTurnId ?? null,
      request.threadId ?? null,
      requestingDeviceId ?? null,
      pairGrantDeviceId ?? null,
      JSON.stringify(requiredCapabilities),
      fingerprint,
      state,
      placement,
      executorDeviceId,
      executorSessionId,
      onNoEligibleComputer,
      fallbackReason,
      errorCode,
      errorMessage,
      keepsPayload ? payloadJson : null,
      payloadHash,
      keepsPayload ? now + DISPATCH_PAYLOAD_TTL_MS : null,
      offerDeadlineAt,
      leaseExpiresAt,
      gateHeld && !terminal ? 1 : 0,
      now,
      now,
    );
    let row = this.dispatchRow(dispatchId)!;
    if (terminal) {
      if (gateHeld) await this.release({ turnId: dispatchId });
    } else if (state === "computer_accepted" && executorDeviceId) {
      this.notifyExecutor(row);
    } else if (state === "offering" && offerDeadlineAt !== null) {
      if (awaitsReconnect) {
        log("info", "dispatch_offer_awaits_reconnect", {
          dispatchId,
          deviceId: request.targetDeviceId,
        });
      }
      for (const candidate of candidates) {
        this.openOffer(dispatchId, candidate, offerDeadlineAt, now);
        this.pushOffer(row, candidate.deviceId, offerDeadlineAt);
      }
    } else if (state === "cloud_committed") {
      log("info", "dispatch_cloud_route_timing", {
        dispatchId,
        originUserMessageId: request.payload.userMessageEventId,
        receivedAt,
        conversationDispatchAt: Date.now(),
        preparationMs: Math.round(performance.now() - startedAt),
      });
      row = await this.runCloudBranch(row, now);
    }
    await this.scheduleAlarm(now);
    return {
      ok: true,
      response: {
        protocol: PLACEMENT_PROTOCOL,
        dispatch: dispatchSummary(row),
        replayed: false,
      },
    };
  }

  async recordCloudDispatchTerminal(input: {
    ownerGeneration: string;
    turnId: string;
    outcome: "completed" | "failed" | "canceled";
    resultJson?: string;
    errorMessage?: string;
  }): Promise<void> {
    this.ensureSchema();
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO cloud_dispatch_terminals
       (turn_id, owner_generation, outcome, result_json, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      input.turnId,
      input.ownerGeneration,
      input.outcome,
      input.resultJson ?? null,
      input.errorMessage ?? null,
      Date.now(),
    );
    const dispatch = this.ctx.storage.sql
      .exec<{ dispatch_id: string }>(
        `SELECT dispatch_id FROM dispatches
       WHERE cloud_turn_id = ? AND owner_generation = ? AND placement = 'cloud'`,
        input.turnId,
        input.ownerGeneration,
      )
      .toArray()[0];
    if (dispatch) await this.dispatchStatus(dispatch.dispatch_id);
  }

  async dispatchStatus(dispatchId: string): Promise<OwnerGateStatusResult> {
    this.ensureSchema();
    let row = this.dispatchRow(dispatchId.trim());
    if (!row) return fail("not_found", "Dispatch not found.", false);
    const receipt =
      row.placement === "cloud" && row.cloud_turn_id
        ? this.ctx.storage.sql
            .exec<{
              outcome: "completed" | "failed" | "canceled";
              result_json: string | null;
              error_message: string | null;
            }>(
              `SELECT outcome, result_json, error_message FROM cloud_dispatch_terminals
           WHERE turn_id = ? AND owner_generation = ?`,
              row.cloud_turn_id,
              row.owner_generation,
            )
            .toArray()[0]
        : undefined;
    if (receipt && !isTerminalDispatchState(row.state as DispatchState)) {
      row = await this.patchDispatch(
        row,
        {
          state: receipt.outcome,
          error_message: receipt.error_message,
          payload_json: null,
          payload_expires_at: null,
          lease_expires_at: null,
        },
        Date.now(),
      );
      await this.releaseGate(row);
      await this.scheduleAlarm(Date.now());
    }
    return {
      ok: true,
      response: {
        protocol: PLACEMENT_PROTOCOL,
        dispatch: {
          ...dispatchSummary(row),
          ...(receipt?.result_json ? { resultJson: receipt.result_json } : {}),
        },
      },
    };
  }

  async steerDispatch(input: {
    dispatchId: string;
    messageId: string;
    text: string;
  }): Promise<{ delivered: boolean; reason?: "not_running" | "unreachable" | "timeout" }> {
    this.ensureSchema();
    const row = this.dispatchRow(input.dispatchId.trim());
    if (
      !row ||
      row.kind !== "agent" ||
      !row.executor_device_id ||
      (row.state !== "computer_accepted" && row.state !== "computer_running")
    ) {
      return { delivered: false, reason: "not_running" };
    }
    const socket = this.liveSocket(row.executor_device_id);
    if (!socket) return { delivered: false, reason: "unreachable" };
    const key = `${row.dispatch_id}:${input.messageId}`;
    const acknowledged = withTimeout(
      new Promise<boolean | "timeout">((resolve) => {
        this.steerAcks.set(key, (delivered) => {
          this.steerAcks.delete(key);
          resolve(delivered);
        });
      }),
      STEER_ACK_TIMEOUT_MS,
      "steer acknowledgement timed out",
    ).catch(() => {
      this.steerAcks.delete(key);
      return "timeout" as const;
    });
    this.send(socket, {
      type: "steer",
      dispatchId: row.dispatch_id,
      messageId: input.messageId,
      text: input.text,
    });
    const answer = await acknowledged;
    if (answer === "timeout") return { delivered: false, reason: "timeout" };
    return answer ? { delivered: true } : { delivered: false, reason: "not_running" };
  }

  async messageLocalAgent(input: {
    deviceId: string;
    threadId: string;
    ownerGeneration: string;
    messageId: string;
    text: string;
  }): Promise<{
    outcome: AgentMessageDeviceOutcome | "unreachable" | "timeout";
  }> {
    const socket = this.liveSocket(input.deviceId);
    if (!socket) return { outcome: "unreachable" };
    const key = `${input.deviceId}:${input.messageId}`;
    const acknowledged = withTimeout(
      new Promise<AgentMessageDeviceOutcome>((resolve) => {
        this.localAgentMessageAcks.set(key, (outcome) => {
          this.localAgentMessageAcks.delete(key);
          resolve(outcome);
        });
      }),
      LOCAL_AGENT_MESSAGE_ACK_TIMEOUT_MS,
      "agent message acknowledgement timed out",
    ).catch(() => {
      this.localAgentMessageAcks.delete(key);
      return "timeout" as const;
    });
    this.send(socket, {
      type: "agent-message",
      messageId: input.messageId,
      threadId: input.threadId,
      ownerGeneration: input.ownerGeneration,
      text: input.text,
    });
    return { outcome: await acknowledged };
  }

  /**
   * Stop an agent a device runs locally, and the agents it started there,
   * and wait for the device to say how it landed (`agent-pause`, the frame's
   * name from before `stop_agent`). `unreachable` means no live socket;
   * `timeout` that no answer came in time, so it may still have landed.
   */
  async stopLocalAgent(input: {
    deviceId: string;
    threadId: string;
    ownerGeneration: string;
    commandId: string;
  }): Promise<{
    outcome: AgentStopDeviceOutcome | "unreachable" | "timeout";
  }> {
    const socket = this.liveSocket(input.deviceId);
    if (!socket) return { outcome: "unreachable" };
    const key = `${input.deviceId}:${input.commandId}`;
    const acknowledged = withTimeout(
      new Promise<AgentStopDeviceOutcome>((resolve) => {
        this.localAgentStopAcks.set(key, (outcome) => {
          this.localAgentStopAcks.delete(key);
          resolve(outcome);
        });
      }),
      LOCAL_AGENT_MESSAGE_ACK_TIMEOUT_MS,
      "agent stop acknowledgement timed out",
    ).catch(() => {
      this.localAgentStopAcks.delete(key);
      return "timeout" as const;
    });
    this.send(socket, {
      type: "agent-pause",
      commandId: input.commandId,
      threadId: input.threadId,
      ownerGeneration: input.ownerGeneration,
    });
    return { outcome: await acknowledged };
  }

  async cancelDispatch(
    input: OwnerGateCancelInput,
  ): Promise<OwnerGateStatusResult> {
    this.ensureSchema();
    const now = input.now ?? Date.now();
    const row = this.dispatchRow(input.dispatchId.trim());
    if (!row) return fail("not_found", "Dispatch not found.", false);
    const cancelRequestId = input.cancelRequestId.trim().slice(0, 128);
    if (!cancelRequestId) {
      return fail("bad_request", "cancelRequestId is required.", false);
    }
    if (row.cancel_request_id && row.cancel_request_id !== cancelRequestId) {
      return fail(
        "conflict",
        "A different cancellation request already owns this dispatch.",
        false,
      );
    }
    if (isTerminalDispatchState(row.state as DispatchState)) {
      return {
        ok: true,
        response: {
          protocol: PLACEMENT_PROTOCOL,
          dispatch: dispatchSummary(row),
        },
      };
    }
    const reason = input.reason?.trim().slice(0, 512) ?? "";
    const unaccepted =
      row.state === "offering" || row.state === "computer_claimed";
    const cloudNeverStarted =
      row.state === "cloud_committed" && !row.cloud_turn_id;
    this.withdrawOffers(row.dispatch_id, null, "canceled", now);
    const next = await this.patchDispatch(
      row,
      {
        state: unaccepted || cloudNeverStarted ? "canceled" : "cancel_pending",
        cancel_request_id: cancelRequestId,
        ...(reason ? { cancel_reason: reason } : {}),
        ...(unaccepted || cloudNeverStarted
          ? {
              payload_json: null,
              payload_expires_at: null,
              offer_deadline_at: null,
              lease_expires_at: null,
              executor_device_id: null,
              executor_presence_session_id: null,
            }
          : {}),
      },
      now,
      { notifyExecutor: false },
    );
    if (unaccepted || cloudNeverStarted) {
      await this.releaseGate(next);
    } else if (next.placement === "computer" && next.executor_device_id) {
      const socket = this.connectedSocket(next.executor_device_id);
      if (socket) {
        this.send(socket, {
          type: "cancel",
          dispatchId: next.dispatch_id,
          cancelRequestId,
          reason: reason || "The turn was stopped.",
        });
      }
    } else if (next.placement === "cloud" && next.cloud_turn_id) {
      await this.cancelCloudDispatch(next, cancelRequestId, reason);
    }
    await this.scheduleAlarm(now);
    return {
      ok: true,
      response: {
        protocol: PLACEMENT_PROTOCOL,
        dispatch: dispatchSummary(next),
      },
    };
  }

  async alarm(): Promise<void> {
    this.ensureSchema();
    const now = Date.now();
    const ownerFenceHost = createOwnerFenceHost({
      ctx: this.ctx,
      env: this.env,
    });
    let fenceDeadline: number | null = null;
    let fenceAlarmCompleted = false;
    try {
      const pendingFence = await this.modelGrants().pendingFenceBarrier();
      if (pendingFence) {
        await this.fetchOwnerFence(
          pendingFence.path,
          ownerFenceRequest(pendingFence.path, pendingFence.body),
          pendingFence.body,
        ).catch((error: unknown) => {
          log("error", "owner_grant_fence_retry_pending", {
            message:
              error instanceof Error
                ? error.message
                : "Owner fence replay failed.",
          });
        });
      }
      fenceDeadline = await ownerFenceHost.alarm(now);
      fenceAlarmCompleted = true;
      await this.expirePresence(now);
      await this.expireDispatches(now);
      await this.ownerStore().onAlarm(now);
      await this.memoryPolicy()
        .retry()
        .catch((error: unknown) => {
          log("error", "memory_policy_retry_pending", {
            message:
              error instanceof Error
                ? error.message
                : "Memory policy retry failed.",
          });
        });
    } finally {
      if (!fenceAlarmCompleted) {
        fenceDeadline = await ownerFenceHost.nextDeadline();
      }
      await this.scheduleAlarm(now, {
        fenceDeadline,
        preserveExisting: false,
        afterAlarm: true,
      });
    }
  }
}
