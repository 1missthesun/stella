import { storageKeks } from "../secret-rotation.js";
import type { DevicesResponse } from "@stella/contracts/turn-plane/placement";
import { DurableObject } from "cloudflare:workers";
import type {
  TurnExecution,
  TurnRetryCancellation,
} from "../turn-cancellation.js";
import { LocalOwnerModelGrants } from "../local-owner-model-grants.js";
import { verifyUserToken } from "../auth-jwt.js";
import type { OwnerModelGrant } from "../owner-model-grants.js";
import type { OwnerEvent } from "@stella/contracts/turn-plane/owner-events";
import "../conversation-hub.js";
import {
  BACKFILL_BATCH_RECORDS,
  CLOSE_DELETED,
  type ConversationHub,
  type ConversationOwnerRecord,
  createConversationHub,
  INITIAL_WINDOW_RECORDS,
  type JournalHead,
  type JournalRange,
  type JournalReader,
  type JournalRecord,
  type LiveTurnSnapshot,
} from "../conversation-types.js";
import { Journal } from "../journal.js";
import { ConversationArchive } from "../archive.js";
import { ConversationIndex } from "../index-flush.js";
import { ExactTurnCancellationLedger } from "../execution-placement-turn-cancellation.js";
import type {
  Env,
  ChatTurnRequest,
  OwnerFencedTurn,
  LocalTurnLease,
  AgentsView,
} from "./types.js";
import {
  AGENT_RUNTIME_KEY,
  AGENTS_VIEW_KEY,
  LOCAL_TURN_LEASE_KEY,
  JOURNAL_CHECKPOINT_KEY,
} from "./constants.js";
import { listedAgents, errorMessage, log } from "./support.js";
import type { OrchestratorOwner } from "./owner.js";
import { SlackRelay } from "../slack/relay.js";
import { ownerGateStub } from "../rpc-release.js";

export abstract class OrchestratorSessionCore extends DurableObject<Env> {
  protected firstChatInIsolate = true;
  protected gatewayPreparedInInstance = false;
  protected readonly isolateId = crypto.randomUUID();
  protected readerReady?: Promise<void>;
  protected readonly localOwnerModelGrants = new LocalOwnerModelGrants(
    this.isolateId,
  );
  protected readonly admittedOwnerModelGrants = new Map<
    string,
    OwnerModelGrant
  >();
  protected wakeTiming?: {
    bootstrapMs: number;
    restoreMs: number;
    totalMs: number;
  };
  protected queue: Promise<unknown> = Promise.resolve();
  protected readonly turnExecutions = new Map<
    string,
    TurnExecution<Response>
  >();
  protected readonly ownerFencedAppends = new Map<
    string,
    { lease: OwnerFencedTurn; settled: Promise<void> }
  >();

  protected readonly journal: Journal;
  protected readonly archive: ConversationArchive;
  protected readonly index: ConversationIndex;
  protected readonly hub: ConversationHub;
  protected readonly exactTurnCancellations: ExactTurnCancellationLedger;

  protected background: Promise<unknown> = Promise.resolve();

  protected live: LiveTurnSnapshot | null = null;

  protected activeTurnId: string | null = null;
  protected finalizedTurnId: string | null = null;

  /**
   * This object has been purged, whatever its journal now says.
   *
   * `handlePurge` ends in `deleteAll()` plus a fresh `bootstrap()`, so the
   * durable tombstone is gone and `journal.isDeleted()` reads false again the
   * moment it returns. Any request that checked the tombstone before the purge
   * and was still awaiting something when it landed would otherwise resume
   * against that empty journal and write rows — and R2 objects — into a
   * conversation the owner has already recorded as deleted, where no purge, sweep
   * or manifest will ever name them again. The durable tombstone fences the
   * window before `deleteAll()`; this fences the window after it.
   */
  protected sealed = false;

  protected turnAdmissionTail: Promise<void> = Promise.resolve();
  protected eventSeqTail: Promise<unknown> = Promise.resolve();
  protected ownerGeneration?: string;

  protected currentTurnCancellation?: TurnRetryCancellation;
  protected currentPiRun?: { abort(): void };
  protected piRuntime?: Promise<
    import("../pi-runtime.js").PiConversationRuntime
  >;
  protected piClientsAttaching = false;

  protected readonly cloudHomePreparations = new Map<
    string,
    {
      home: ReturnType<OrchestratorOwner["prepareCloudHomeContext"]>;
      destinations: Promise<DevicesResponse | null>;
    }
  >();

  protected agentsReconciledAt = 0;

  protected agentsViewStored = false;
  protected agentsView: AgentsView | null = null;
  protected agentsRefresh: Promise<void> | null = null;
  protected agentsRefreshAgain = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.exactTurnCancellations = new ExactTurnCancellationLedger(ctx.storage);
    this.journal = new Journal(
      ctx,
      log,
      storageKeks(env),
    );
    this.archive = new ConversationArchive(
      env.CONVERSATION_ARCHIVE,
      this.journal,
      log,
      async () => {
        const stored = await ctx.storage.get<{ throughSeq?: unknown; epoch?: unknown }>(
          JOURNAL_CHECKPOINT_KEY,
        );
        return stored &&
          stored.epoch === this.journal.meta().epoch &&
          typeof stored.throughSeq === "number"
          ? stored.throughSeq
          : undefined;
      },
      ctx.storage,
    );
    this.index = new ConversationIndex(
      this.journal,
      log,
      () => this.indexIdentity(),
      {
        enqueue: (events) => this.deferOwnerEvents(events),
        purged: () => this.purged(),
      },
    );
    this.hub = createConversationHub({
      ctx,
      reader: this.reader(),
      lookupOwner: (identity) => this.resolveOwnerForCaller(identity),
      cancelTurn: (turnId) => this.cancelTurn(turnId),
      onConnect: () => {
        this.flushIndexIfLagging();
        this.reconcileRunningAgentsSoon();
      },
      conversationId: () => this.conversationId(),
      log,
      verifyToken: (token) =>
        verifyUserToken(token, this.env as unknown as Cloudflare.Env),
      pi: {
        enabled: async () =>
          (await this.ctx.storage.get<string>(AGENT_RUNTIME_KEY)) === "pi",
        attach: () => this.attachPiClients(),
        older: async (beforeEntryId) => {
          const runtime = await this.openPiRuntime(this.piGatewayOrigin());
          const { contextFor } = await import("../pi-runtime.js");
          return await runtime.olderForClients(beforeEntryId, contextFor());
        },
        detach: () => {
          void this.piRuntime
            ?.then((runtime) => runtime.stopWatchingForClients())
            .catch(() => undefined);
        },
      },
    });
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
    const wake = this.ctx.blockConcurrencyWhile(async () => {
      const wakeStartedAt = performance.now();
      await this.journal.bootstrap();
      const bootstrapMs = Math.round(performance.now() - wakeStartedAt);
      const restoreStartedAt = performance.now();
      this.ownerGeneration = await this.ctx.storage.get<string>(
        "ownerDataGeneration",
      );
      if (this.journal.meta().conversation_id === "" && this.ctx.id.name) {
        this.journal.setConversationId(this.ctx.id.name);
      }
      const agentsView =
        await this.ctx.storage.get<AgentsView>(AGENTS_VIEW_KEY);
      this.agentsViewStored = agentsView !== undefined;
      this.agentsView =
        agentsView ??
        ((await this.ctx.storage.get<string>(AGENT_RUNTIME_KEY)) === "pi"
          ? { pi: [], owner: [] }
          : null);
      const localLease =
        await this.ctx.storage.get<LocalTurnLease>(LOCAL_TURN_LEASE_KEY);
      if (localLease) {
        await this.restoreLocalLease(localLease);
      } else {
        const orphan = await this.claimOrphanedTurnResume();
        if (orphan) this.enqueue(orphan.turn, false, { resume: orphan.resume });
        for (const turn of await this.queuedTurns()) this.enqueue(turn);
      }
      this.wakeTiming = {
        bootstrapMs,
        restoreMs: Math.round(performance.now() - restoreStartedAt),
        totalMs: Math.round(performance.now() - wakeStartedAt),
      };
      log("info", "conversation_wake_timing", this.wakeTiming);
    });
    this.readerReady = wake;
    // Registration must follow durable identity restore, but must not be
    // awaited inside blockConcurrencyWhile: OwnerGate may synchronously call
    // this reader during freeze and would otherwise deadlock the object.
    ctx.waitUntil(
      wake.then(async () => {
        const identity = this.indexIdentity();
        const conversationId = this.conversationId();
        if (!identity || !conversationId) return;
        try {
          await this.ownerGate(identity.ownerId).registerConversationReader({
            ...identity,
            conversationId,
            readerId: this.isolateId,
          });
        } catch (error) {
          log("info", "conversation_model_reader_registration_failed", {
            conversationId,
            message: errorMessage(error),
          });
        }
      }),
    );
  }

  protected conversationId(): string {
    return this.journal.meta().conversation_id || this.ctx.id.name || "";
  }

  protected async getTurnState<T>(key: string): Promise<T | undefined> {
    return this.ctx.storage.kv
      ? this.ctx.storage.kv.get<T>(key)
      : await this.ctx.storage.get<T>(key);
  }

  protected async putTurnState(
    entries: Record<string, unknown>,
    removals: readonly string[] = [],
  ): Promise<void> {
    const { storage } = this.ctx;
    if (storage.kv) {
      storage.transactionSync(() => {
        for (const [key, value] of Object.entries(entries))
          storage.kv.put(key, value);
        for (const key of removals) storage.kv.delete(key);
      });
    } else {
      await storage.transaction(async (txn) => {
        await txn.put(entries);
        if (removals.length > 0) await txn.delete([...removals]);
      });
    }
  }

  protected async armAlarmNoLaterThan(at: number): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > at) await this.ctx.storage.setAlarm(at);
  }

  protected indexIdentity(): {
    ownerId: string;
    ownerGeneration: string;
  } | null {
    const ownerId = this.journal.meta().owner_id;
    if (!ownerId || !this.ownerGeneration) return null;
    return { ownerId, ownerGeneration: this.ownerGeneration };
  }

  protected ownerGate(ownerId: string) {
    const gates = this.env.OWNER_GATES;
    if (!gates) throw new Error("Owner gate namespace is not bound.");
    return ownerGateStub(gates, ownerId);
  }

  protected reader(): JournalReader {
    return {
      head: (): JournalHead =>
        this.journal.head(this.live ? "running" : "idle"),
      ownerId: () => this.journal.ownerId(),
      bindOwner: (record) =>
        this.journal.bindOwner({
          ...record,
          conversationId: this.conversationId(),
        }),
      readRange: (fromSeq, toSeq, limit): Promise<JournalRange> =>
        this.archive.readRange(
          fromSeq,
          toSeq,
          Math.min(limit, BACKFILL_BATCH_RECORDS),
        ),
      newest: (limit): JournalRecord[] =>
        this.journal.newest(Math.min(limit, INITIAL_WINDOW_RECORDS)),
      liveTurn: () => this.live,
      runningAgents: (limit) =>
        this.agentsView
          ? listedAgents(this.agentsView, limit)
          : this.journal.runningAgents(limit),
    };
  }

  protected flushIndexIfLagging(): void {
    if (!this.index.lagging()) return;
    void this.index
      .flush({
        activity: this.live ? "running" : "idle",
        updatedAt: Date.now(),
      })
      .catch(() => undefined);
  }

  protected publish(record: JournalRecord | null | undefined): void {
    if (!record) return;
    try {
      this.hub.broadcastRecord(record);
    } catch (error) {
      log("error", "conversation_broadcast_failed", {
        seq: record.seq,
        message: errorMessage(error),
      });
    }
    this.slack().observe(record);
  }

  private slackRelay?: SlackRelay;

  protected slack(): SlackRelay {
    this.slackRelay ??= new SlackRelay(
      this.ctx.storage,
      this.env as unknown as Cloudflare.Env,
      () => this.conversationId(),
      (work) => this.ctx.waitUntil(work),
    );
    return this.slackRelay;
  }

  /**
   * Deleted, by either fence: the durable tombstone, or the in-memory seal that
   * outlives the `deleteAll()` which destroys it. Every write path asks this
   * rather than the journal directly.
   */
  protected purged(): boolean {
    return this.sealed || this.journal.isDeleted();
  }

  /**
   * Raise the in-memory seal from outside `handlePurge`.
   *
   * The only caller is the index flush learning from the owner that this
   * conversation id is fenced as purged — which is the one fact this isolate
   * cannot derive for itself. A DO restarted after its purge has an empty
   * journal and a false `sealed`, and there is no request that would ever tell
   * it otherwise. This is a stop, not a delete: no storage is touched, because
   * an object in this state has none of the user's data left to remove.
   */
  protected sealPurged(reason: string): void {
    if (this.sealed) return;
    this.sealed = true;
    log("error", "conversation_sealed_after_purge", {
      conversationId: this.conversationId(),
      reason,
    });
    try {
      this.hub.closeAll(CLOSE_DELETED);
    } catch (error) {
      log("error", "conversation_seal_close_failed", {
        message: errorMessage(error),
      });
    }
  }

  protected abstract cancelTurn(turnId: string): Promise<void>;
  protected abstract journalStoppedPrompt(turn: ChatTurnRequest): Promise<void>;
  protected abstract publishStagedWakeCards(turnId: string): Promise<void>;
  protected abstract claimOrphanedTurnResume(): Promise<{
    turn: ChatTurnRequest;
    resume: boolean;
  } | null>;
  protected abstract deferOwnerEvents(events: OwnerEvent[]): Promise<void>;
  protected abstract enqueue(
    turn: ChatTurnRequest,
    freshAdmission?: boolean,
    options?: { resume?: boolean },
  ): void;
  protected abstract queuedTurns(): Promise<ChatTurnRequest[]>;
  protected abstract resolveOwnerForCaller(
    caller: { ownerId: string },
    options?: { refreshGeneration?: boolean },
  ): Promise<ConversationOwnerRecord | null>;
  protected abstract restoreLocalLease(lease: LocalTurnLease): Promise<void>;
  protected abstract attachPiClients(): Promise<{
    snapshot: unknown;
    hasOlder: boolean;
  }>;
  protected abstract openPiRuntime(
    gatewayOrigin: string,
  ): Promise<import("../pi-runtime.js").PiConversationRuntime>;
  protected abstract piGatewayOrigin(): string;
  protected abstract reconcileRunningAgentsSoon(): void;
}
