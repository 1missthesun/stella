import { parseCloudAgentLifecycleCard } from "@stella/contracts/cloud-agent-lifecycle";
import {
  applySafeguardEvent,
  emptySafeguardFold,
  parseSafeguardCard,
  SAFEGUARD_CARD_TYPE,
  SAFEGUARD_CLEARED_CONTEXT_NOTICE,
  safeguardEventOfRecord,
  safeguardNotice,
  type SafeguardAction,
  type SafeguardCard,
} from "@stella/contracts/safeguard-block";
import { redactSensitiveJson } from "@stella/contracts/sensitive-data";
import { parseViewCard, VIEW_CARD_TYPE, viewCardTurnId } from "@stella/contracts/view-card";
import type { AgentMessage } from "@stella/runtime/kernel/agent-core/types.js";
import type { ConversationDeletedEvent } from "@stella/contracts/turn-plane/owner-events";
import { sha256Hex } from "../hash.js";
import {
  APPEND_MAX_BYTES,
  APPEND_MAX_ROWS,
  APPEND_WINDOW_MAX_BYTES,
  APPEND_WINDOW_MAX_REQUESTS,
  APPEND_WINDOW_MS,
  CLOSE_DELETED,
  CONVERSATION_MAX_STORED_BYTES,
  type ConversationCard,
  INBOX_MAX_BYTES,
  INBOX_MAX_ROWS,
  type JournalRecord,
  MAX_ROW_BYTES,
  type MessageRole,
  utf8Length,
} from "../conversation-types.js";
import { ConversationDeletedError } from "../journal.js";
import {
  isLocalTurnId,
  LOCAL_DEVICE_ID_PATTERN,
  LOCAL_TURN_ID_PATTERN,
  parseExpectedOwnerGeneration,
} from "../local-turn-protocol.js";
import { parseVoiceJournalRecords } from "../journal-append-protocol.js";
import type { ChatTurnRequest, OwnerFencedTurn } from "./types.js";
import { json, errorMessage, log, truncateMessage } from "./support.js";
import { OrchestratorRunTurn } from "./run-turn.js";
import { JOURNAL_CHECKPOINT_KEY } from "./constants.js";

const SAFEGUARD_FOLD_RECORDS = 400;
const SAFEGUARD_REMOVED_TURNS = 64;

export abstract class OrchestratorJournalWrites extends OrchestratorRunTurn {
  protected async handleJournalAppend(request: Request): Promise<Response> {
    const ownerId = request.headers.get("x-stella-owner") ?? "";
    if (!ownerId) return json({ error: "Unauthorized." }, 401);
    if (this.purged()) {
      return json(
        { code: "deleted", message: "This conversation was deleted." },
        410,
      );
    }
    let body: {
      deviceId?: string;
      expectedOwnerGeneration?: unknown;
      localTurnId?: string;
      source?: unknown;
      records?: unknown;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ code: "bad_request", message: "Malformed request." }, 400);
    }
    const deviceId = body.deviceId?.trim();
    const expectedOwnerGeneration = parseExpectedOwnerGeneration(
      body.expectedOwnerGeneration,
    );
    const localTurnId = body.localTurnId?.trim();
    const records = body.records;
    if (
      !deviceId ||
      !LOCAL_DEVICE_ID_PATTERN.test(deviceId) ||
      !expectedOwnerGeneration ||
      !localTurnId ||
      !LOCAL_TURN_ID_PATTERN.test(localTurnId) ||
      (body.source !== "voice" && body.source !== "import" && body.source !== "note") ||
      !Array.isArray(records) ||
      records.length === 0
    ) {
      return json({ code: "bad_request", message: "Malformed request." }, 400);
    }
    const ownerRecord = await this.resolveOwnerForCaller(
      { ownerId },
      { refreshGeneration: true },
    );
    if (!ownerRecord) {
      return json({ error: "Conversation not found." }, 404);
    }
    const bound = this.journal.ownerId() || ownerRecord.ownerId;
    if (!bound) return json({ error: "Conversation not found." }, 404);
    if (bound !== ownerId)
      return json({ error: "Conversation not found." }, 404);
    const currentOwnerGeneration = ownerRecord.ownerGeneration;
    if (currentOwnerGeneration !== expectedOwnerGeneration) {
      return json(
        {
          code: "owner_generation_stale",
          message: "This cloud owner generation is no longer current.",
        },
        409,
      );
    }
    if (records.length > APPEND_MAX_ROWS) {
      return json(
        {
          code: "too_many_records",
          message: "That's more history than one request can carry.",
        },
        413,
      );
    }
    const parsedRecords = parseVoiceJournalRecords(records);
    if (
      !parsedRecords ||
      (body.source === "note" && parsedRecords.some((record) => record.role !== "user" || !record.hidden))
    ) {
      return json({ code: "bad_request", message: "Malformed request." }, 400);
    }
    let totalBytes = 0;
    for (const record of parsedRecords)
      totalBytes += utf8Length(record.payloadJson);
    if (totalBytes > APPEND_MAX_BYTES) {
      return json(
        {
          code: "too_large",
          message: "That's more history than one request can carry.",
        },
        413,
      );
    }
    const source: "voice" | "import" | "note" = body.source;
    const receiptKey = `${source}:${deviceId}:${localTurnId}`;
    const turnId = `${source}:${deviceId}:${localTurnId}`;
    const appendLease: OwnerFencedTurn = {
      ownerId: bound,
      ownerGeneration: expectedOwnerGeneration,
      turnId,
    };
    try {
      appendLease.ownerPurgeGeneration = await this.registerOwnerTurn(
        appendLease,
        true,
      );
    } catch {
      return json(
        { code: "owner_purge", message: "Cloud activity is being reset." },
        409,
      );
    }
    let settleAppend!: () => void;
    const appendSettled = new Promise<void>((resolve) => {
      settleAppend = resolve;
    });
    const activeAppend = { lease: appendLease, settled: appendSettled };
    const appendLeaseId = appendLease.ownerPurgeLeaseId;
    if (!appendLeaseId) {
      await this.unregisterOwnerTurn(appendLease);
      return json(
        { code: "owner_purge", message: "Cloud activity is being reset." },
        409,
      );
    }
    this.ownerFencedAppends.set(appendLeaseId, activeAppend);
    try {
      const fingerprint = await sha256Hex(
        JSON.stringify({
          deviceId,
          expectedOwnerGeneration,
          localTurnId,
          source,
          records,
        }),
      );
      const receiptResponse = (): Response | null => {
        const receipt = this.journal.appendReceipt(receiptKey);
        if (!receipt) return null;
        if (receipt.fingerprint !== fingerprint) {
          return json(
            {
              code: "idempotency_conflict",
              message: "That append id was already used for different history.",
            },
            409,
          );
        }
        return json({
          firstSeq: receipt.first_seq,
          lastSeq: receipt.last_seq,
          epoch: receipt.epoch,
          replayed: true,
        });
      };
      const replay = receiptResponse();
      if (replay) return replay;
      const storedBytes = this.journal.storedBytes();
      if (storedBytes + totalBytes > CONVERSATION_MAX_STORED_BYTES) {
        log("error", "conversation_storage_ceiling", {
          conversationId: this.conversationId(),
          storedBytes,
        });
        return json(
          {
            code: "conversation_full",
            message:
              "This conversation has reached its size limit. Start a new conversation to keep going.",
          },
          413,
        );
      }
      const budgetArgs = {
        bytes: totalBytes,
        windowMs: APPEND_WINDOW_MS,
        maxRequests: APPEND_WINDOW_MAX_REQUESTS,
        maxBytes: APPEND_WINDOW_MAX_BYTES,
      };
      const probe = this.journal.appendBudget({
        ...budgetArgs,
        now: Date.now(),
        commit: false,
      });
      if (!probe.allowed) {
        return json(
          {
            code: "rate_limited",
            message:
              "That's more history than this conversation can take right now.",
            retryAfterMs: probe.retryAfterMs,
          },
          429,
        );
      }
      if (await this.turnRunning()) {
        return json(
          {
            code: "turn_in_progress",
            message: "Stella is mid-reply — try again in a moment.",
            retryAfterMs: 3_000,
          },
          409,
        );
      }
      const now = Date.now();
      const prepared: Array<{
        kind: "message";
        writerKey: string;
        role: MessageRole;
        hidden: boolean;
        message: AgentMessage;
        payloadJson: string;
        spillKey?: string;
      }> = [];
      for (let ordinal = 0; ordinal < parsedRecords.length; ordinal += 1) {
        const record = parsedRecords[ordinal]!;
        const writerKey = `${source}:${deviceId}:${localTurnId}:${ordinal}`;
        const sized = await this.prepareOversize(
          record.role,
          record.message,
          record.payloadJson,
          writerKey,
        );
        prepared.push({
          kind: "message",
          writerKey,
          role: record.role,
          hidden: record.hidden,
          message: sized.message,
          payloadJson: sized.payloadJson,
          ...(sized.spillKey ? { spillKey: sized.spillKey } : {}),
        });
      }

      try {
        await this.assertOwnerTurn(appendLease);
      } catch {
        return json(
          { code: "owner_purge", message: "Cloud activity is being reset." },
          409,
        );
      }

      let firstSeq: number | null = null;
      let lastSeq = -1;
      const publishAfterCommit: JournalRecord[] = [];
      let finalResponse: Response | null = null;
      let appendFailure: unknown;
      await this.ctx.blockConcurrencyWhile(async () => {
        if (await this.turnRunning()) {
          finalResponse = json(
            {
              code: "turn_in_progress",
              message: "Stella is mid-reply — try again in a moment.",
              retryAfterMs: 3_000,
            },
            409,
          );
          return;
        }
        if (this.purged()) {
          finalResponse = json(
            { code: "deleted", message: "This conversation was deleted." },
            410,
          );
          return;
        }
        const racedReplay = receiptResponse();
        if (racedReplay) {
          finalResponse = racedReplay;
          return;
        }
        try {
          this.journal.appendBudget({ ...budgetArgs, now, commit: true });
          const writer = `${source}:${deviceId}`;
          this.journal.transactionSync(() => {
            this.journal.upsertTurn({
              turnId,
              sessionId: `${source}-${deviceId}`.slice(0, 64),
              ownerId: bound,
              lane: "chat",
              source,
              state: "terminal",
              now,
            });
            for (const entry of prepared) {
              const appended = this.journal.appendMessage({
                turnId,
                writer,
                writerKey: entry.writerKey,
                role: entry.role,
                hidden: entry.hidden,
                message: entry.message,
                payloadJson: entry.payloadJson,
                ...(entry.spillKey ? { spillKey: entry.spillKey } : {}),
                createdAt: now,
              });
              if (firstSeq === null) firstSeq = appended.seq;
              lastSeq = appended.seq;
              this.journal.setTurnSpan(turnId, appended.seq);
              if (appended.inserted) publishAfterCommit.push(appended.record);
            }
            this.journal.setTurnTerminal(turnId, "completed", now);
            this.journal.putAppendReceipt({
              writerKey: receiptKey,
              fingerprint,
              firstSeq: firstSeq ?? lastSeq,
              lastSeq,
              epoch: this.journal.meta().epoch,
              createdAt: now,
            });
          });
        } catch (error) {
          appendFailure = error;
        }
      });
      if (finalResponse) return finalResponse;
      if (appendFailure) {
        if (appendFailure instanceof ConversationDeletedError) {
          return json(
            { code: "deleted", message: "This conversation was deleted." },
            410,
          );
        }
        log("error", "conversation_desktop_append_failed", {
          deviceId,
          localTurnId,
          message: errorMessage(appendFailure),
        });
        return json(
          {
            code: "append_failed",
            message: "Saving that to the cloud conversation failed. Try again.",
          },
          503,
        );
      }
      for (const record of publishAfterCommit) this.publish(record);
      void this.index
        .flush({ activity: "idle", updatedAt: now })
        .catch(() => undefined);
      if (!(await this.turnRunning())) {
        await this.archive.maybeRollover(Date.now());
      }
      return json({
        firstSeq: firstSeq ?? lastSeq,
        lastSeq,
        epoch: this.journal.meta().epoch,
        replayed: false,
      });
    } finally {
      await this.unregisterOwnerTurn(appendLease);
      if (this.ownerFencedAppends.get(appendLeaseId) === activeAppend) {
        this.ownerFencedAppends.delete(appendLeaseId);
      }
      settleAppend();
    }
  }

  /** Durable Object SQLite refuses a row over 2 MB. Providers reject a tool result whose assistant tool call is missing, so an oversize assistant message is truncated rather than spilled. */
  protected async prepareOversize(
    role: MessageRole,
    message: AgentMessage,
    payloadJson: string,
    writerKey: string,
  ): Promise<{
    message: AgentMessage;
    payloadJson: string;
    spillKey?: string;
  }> {
    if (utf8Length(payloadJson) <= MAX_ROW_BYTES) {
      return { message, payloadJson };
    }
    if (role !== "assistant") {
      const spillKey = await this.archive
        .writeSpill(
          writerKey,
          role === "toolResult"
            ? redactSensitiveJson(payloadJson)
            : payloadJson,
        )
        .catch(() => null);
      if (spillKey) return { message, payloadJson, spillKey };
    }
    const truncated = truncateMessage(message, MAX_ROW_BYTES);
    const truncatedJson = JSON.stringify(truncated);
    if (utf8Length(truncatedJson) > MAX_ROW_BYTES) {
      throw new Error("Oversize message spill failed.");
    }
    return { message: truncated, payloadJson: truncatedJson };
  }

  protected async handleCard(request: Request): Promise<Response> {
    let body: {
      ownerId?: string;
      ownerGeneration?: string;
      sourceTurnId?: string;
      card?: ConversationCard;
      onlyFirst?: boolean;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Malformed request." }, 400);
    }
    const sourceTurnId = body.sourceTurnId?.trim();
    const ownerId = body.ownerId?.trim();
    const ownerGeneration = body.ownerGeneration?.trim();
    const card = body.card;
    if (!ownerId || !ownerGeneration || !sourceTurnId || !card?.type) {
      return json({ error: "Malformed request." }, 400);
    }
    if (this.purged()) {
      return json({ error: "This conversation was deleted." }, 410);
    }
    try {
      const owner = await this.resolveOwnerForCaller(
        { ownerId },
        { refreshGeneration: true },
      );
      if (
        !owner ||
        owner.ownerId !== ownerId ||
        owner.ownerGeneration !== ownerGeneration
      ) {
        return json({ error: "Conversation generation is stale." }, 409);
      }
    } catch (error) {
      log("error", "conversation_card_owner_lookup_failed", {
        sourceTurnId,
        message: errorMessage(error),
      });
      return json({ error: "Conversation owner is unavailable." }, 409);
    }
    let writerKey = `card:${sourceTurnId}:${card.type}`;
    if (body.onlyFirst === true && this.journal.meta().next_seq > 0) {
      return json({ skipped: true });
    }
    if (card.type === "agent-lifecycle") {
      const lifecycle = parseCloudAgentLifecycleCard(card);
      if (!lifecycle) return json({ error: "Malformed request." }, 400);
      writerKey = `card:${lifecycle.eventId}`;
      this.refreshAgentsSoon();
    }
    if (card.type === VIEW_CARD_TYPE) {
      // Each version of a task's view is its own card; the group (sourceTurnId) keeps them together.
      const view = parseViewCard(card);
      if (!view || sourceTurnId !== viewCardTurnId(view.agentId, view.slug)) {
        return json({ error: "Malformed request." }, 400);
      }
      writerKey = `card:${sourceTurnId}:${view.createdAt}`;
    }
    const payloadJson = JSON.stringify(card);
    const now = Date.now();
    if (utf8Length(payloadJson) > MAX_ROW_BYTES) {
      return json({ error: "Card payload is too large." }, 413);
    }
    try {
      if (this.purged()) {
        return json({ error: "This conversation was deleted." }, 410);
      }
      if (await this.turnRunning()) {
        const size = this.journal.inboxSize();
        if (size.rows >= INBOX_MAX_ROWS || size.bytes >= INBOX_MAX_BYTES) {
          return json(
            {
              code: "inbox_full",
              message: "Stella is mid-reply — try again in a moment.",
              retryAfterMs: 5_000,
            },
            429,
          );
        }
        this.journal.stageInbox({
          writer: "service",
          writerKey,
          kind: "card",
          turnId: sourceTurnId,
          payloadJson,
          now,
        });
        return json({ staged: true });
      }
      const appended = this.journal.appendCard({
        turnId: sourceTurnId,
        writer: "service",
        writerKey,
        card,
        createdAt: now,
      });
      this.publish(appended.record);
      void this.index
        .flush({ activity: "idle", updatedAt: now })
        .catch(() => undefined);
      if (!(await this.turnRunning())) {
        await this.archive.maybeRollover(Date.now());
      }
      return json({ seq: appended.seq });
    } catch (error) {
      log("error", "conversation_card_failed", {
        sourceTurnId,
        message: errorMessage(error),
      });
      return json({ error: "Recording that card failed." }, 503);
    }
  }

  protected async handleSafeguard(request: Request): Promise<Response> {
    let body: {
      ownerId?: string;
      ownerGeneration?: string;
      action?: SafeguardAction;
      requestId?: string;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Malformed request." }, 400);
    }
    const ownerId = body.ownerId?.trim();
    const ownerGeneration = body.ownerGeneration?.trim();
    const requestId = body.requestId?.trim();
    const action = body.action;
    if (
      !ownerId ||
      !ownerGeneration ||
      !requestId ||
      (action !== "remove" && action !== "switch" && action !== "clear")
    ) {
      return json({ error: "Malformed request." }, 400);
    }
    if (this.purged()) {
      return json({ error: "This conversation was deleted." }, 410);
    }
    const owner = await this.resolveOwnerForCaller(
      { ownerId },
      { refreshGeneration: true },
    ).catch(() => null);
    if (
      !owner ||
      owner.ownerId !== ownerId ||
      owner.ownerGeneration !== ownerGeneration
    ) {
      return json({ error: "Conversation generation is stale." }, 409);
    }
    const writerKey = `card:safeguard:${requestId}:${SAFEGUARD_CARD_TYPE}`;
    const settled = parseSafeguardCard(this.journal.cardByWriterKey(writerKey));
    if (settled) return json({ resolved: true, card: settled, ranInCloud: false });
    if (await this.turnRunning()) {
      return json(
        {
          code: "turn_running",
          message: "Stella is replying right now. Try again when she's done.",
        },
        409,
      );
    }
    let fold = emptySafeguardFold();
    for (const record of this.journal.recentOutcomes(SAFEGUARD_FOLD_RECORDS)) {
      const event = safeguardEventOfRecord(record);
      if (event) fold = applySafeguardEvent(fold, event);
    }
    const block = fold.block;
    if (!block) {
      return json(
        {
          code: "not_blocked",
          message: "Nothing is stopped in this conversation right now.",
        },
        409,
      );
    }
    const meta = this.journal.meta();
    const base = { type: SAFEGUARD_CARD_TYPE, requestId };
    let card: SafeguardCard;
    if (action === "remove") {
      const checkpoint = await this.journalCheckpoint();
      const fromSeq = Math.max(
        this.journal.lastCompletedSeq() + 1,
        meta.hot_min_seq,
        (checkpoint?.throughSeq ?? -1) + 1,
        0,
      );
      const toSeq = Math.max(fromSeq, meta.next_seq - 1);
      card = {
        ...base,
        state: "removed",
        fromSeq,
        toSeq,
        turnIds: this.journal.skipModelRange(fromSeq, toSeq, SAFEGUARD_REMOVED_TURNS),
      };
    } else if (action === "clear") {
      card = { ...base, state: "cleared" };
    } else {
      const to = safeguardNotice(fold)?.switchTo;
      if (!to) {
        return json(
          {
            code: "no_other_model",
            message: "There is no other model to continue with here.",
          },
          409,
        );
      }
      card = {
        ...base,
        state: "switched",
        turnId: block.turnId,
        pick: to.pick,
        label: to.label,
      };
    }
    const now = Date.now();
    const appended = this.journal.appendCard({
      turnId: `safeguard:${requestId}`,
      writer: "service",
      writerKey,
      card,
      createdAt: now,
    });
    if (card.state === "cleared") {
      await this.ctx.storage.put(JOURNAL_CHECKPOINT_KEY, {
        summary: SAFEGUARD_CLEARED_CONTEXT_NOTICE,
        throughSeq: appended.seq,
        epoch: meta.epoch,
      });
    }
    this.publish(appended.record);
    void this.index
      .flush({ activity: "idle", updatedAt: now })
      .catch(() => undefined);
    log("info", "safeguard_block_resolved", {
      conversationId: this.conversationId(),
      action,
      seq: appended.seq,
      ...(card.state === "removed"
        ? { fromSeq: card.fromSeq, toSeq: card.toSeq, turns: card.turnIds.length }
        : {}),
    });
    return json({
      resolved: true,
      card,
      ranInCloud: !isLocalTurnId(block.turnId),
    });
  }

  private purgeInFlight?: Promise<{ body: Record<string, unknown>; status: number }>;

  protected async handlePurge(): Promise<Response> {
    this.purgeInFlight ??= this.purgeOnce().finally(() => {
      this.purgeInFlight = undefined;
    });
    const { body, status } = await this.purgeInFlight;
    return json(body, status);
  }

  private async purgeOnce(): Promise<{ body: Record<string, unknown>; status: number }> {
    const now = Date.now();
    const identity = this.indexIdentity();
    this.journal.markDeleted(now);
    this.sealed = true;
    this.archive.seal();
    this.hub.closeAll(CLOSE_DELETED);
    const pi = this.piRuntime;
    this.piRuntime = undefined;
    const runtime = await pi?.catch(() => undefined);
    if (runtime) {
      await runtime.discard().then(
        (runs) => log("info", "pi_purge_discarded", { runs }),
        (error: unknown) =>
          log("error", "pi_purge_discard_failed", {
            message: errorMessage(error),
          }),
      );
    }
    await this.archive.quiesce();
    await this.journal.bootstrap();
    const enqueued = new Set<string>();
    const enqueueNewKeys = (): number => {
      const keys = [
        ...this.journal.allSegmentKeys(),
        ...this.journal.allSpillKeys(),
        ...this.archive.piEntryArchiveKeys(),
      ].filter((key) => !enqueued.has(key));
      for (const key of keys) enqueued.add(key);
      this.journal.enqueuePurge(keys, now);
      return keys.length;
    };
    enqueueNewKeys();
    let { pending } = await this.archive.drainPurge();
    const images = await this.images.purge().catch((error: unknown) => {
      log("error", "conversation_images_purge_failed", { message: errorMessage(error) });
      return { deleted: 0, done: false };
    });
    if (!images.done) pending += 1;
    if (pending === 0 && enqueueNewKeys() > 0) {
      pending = (await this.archive.drainPurge()).pending;
    }
    if (pending > 0) {
      log("error", "conversation_purge_incomplete", {
        conversationId: this.conversationId(),
        pending,
      });
      return { body: { purged: false, pending }, status: 202 };
    }
    const purgedId = this.conversationId();
    await this.ctx.storage.deleteAll();
    const dropped: ChatTurnRequest[] = [];
    await this.ctx.blockConcurrencyWhile(async () => {
      const stragglers = await this.ctx.storage.list<ChatTurnRequest>({
        prefix: "queued:",
      });
      for (const [key, straggler] of stragglers) {
        dropped.push(straggler);
        await this.ctx.storage.delete(key);
      }
      await this.ctx.storage.deleteAlarm();
      if (stragglers.size > 0) {
        log("info", "conversation_purge_dropped_queued", {
          conversationId: this.ctx.id.name ?? "",
          dropped: stragglers.size,
        });
      }
    });
    for (const straggler of dropped) await this.releaseOwnerGate(straggler);
    // `deleteAll()` drops the tables while this instance keeps serving.
    await this.journal.bootstrap();
    if (this.ctx.id.name) this.journal.setConversationId(this.ctx.id.name);
    if (identity) {
      await this.deferOwnerEvents([
        {
          ...this.ownerEventBase(identity, purgedId),
          kind: "conversation.deleted",
          conversationId: purgedId,
          deletedAt: now,
        } satisfies ConversationDeletedEvent,
      ]).catch(() => undefined);
    }
    log("info", "conversation_purged", { conversationId: purgedId });
    return { body: { purged: true }, status: 200 };
  }
}
