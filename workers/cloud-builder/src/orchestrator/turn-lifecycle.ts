import type { ImageContent } from "@earendil-works/pi-ai";
import type { AgentMessage } from "@stella/runtime/kernel/agent-core/types.js";
import { assistantMessageHasUsableOutput } from "@stella/runtime/kernel/agent-runtime/run-shared.js";
import type { TurnEventEvent } from "@stella/contracts/turn-plane/owner-events";
import { attachmentImageKey, prepareAttachmentImage } from "../attachment-images.js";
import { sha256Hex } from "../hash.js";
import { deliverOwnerEvents } from "../owner-events.js";
import { crewScopeForConversation } from "../slack/scope.js";
import { unwrapRpc } from "../owner-store/errors.js";
import {
  CONTEXT_MAX_SPILL_HYDRATIONS,
  type ConversationCard,
  MAX_ROW_BYTES,
  type MessageRole,
  type TurnPhase,
  utf8Length,
} from "../conversation-types.js";
import { Journal } from "../journal.js";
import type { ChatTurnRequest, LocalTurnLease, OwedTerminal } from "./types.js";
import {
  LOCAL_TURN_LEASE_KEY,
  turnEventSeqKey,
  TERMINAL_STATUS,
} from "./constants.js";
import {
  json,
  errorMessage,
  log,
  truncateMessage,
  terminalNotice,
} from "./support.js";
import { OrchestratorOwner } from "./owner.js";

export abstract class OrchestratorTurnLifecycle extends OrchestratorOwner {
  protected nextTurnEventSeq(turnId: string): Promise<number> {
    const tail: Promise<unknown> = this.eventSeqTail ?? Promise.resolve();
    const work = tail.then(async () => {
      const key = turnEventSeqKey(turnId);
      const next = ((await this.getTurnState<number>(key)) ?? 0) + 1;
      await this.putTurnState({ [key]: next });
      return next;
    });
    this.eventSeqTail = work.catch(() => undefined);
    return work;
  }

  protected async emitTurnEvent(
    turn: ChatTurnRequest,
    eventKind: string,
    payload: unknown,
    options: {
      terminal?: boolean;
      eventSeq?: number;
      errorMessage?: string;
      resultJson?: string;
      deferred?: boolean;
    } = {},
  ): Promise<number> {
    const eventSeq =
      options.eventSeq ?? (await this.nextTurnEventSeq(turn.turnId));
    const event = this.turnEvent(turn, eventKind, payload, eventSeq, options);
    if (options.deferred || event.terminal)
      await this.deferOwnerEvents([event]);
    else await deliverOwnerEvents(this.env, [event]);
    return eventSeq;
  }

  protected turnEvent(
    turn: ChatTurnRequest,
    eventKind: string,
    payload: unknown,
    eventSeq: number,
    options: { terminal?: boolean; errorMessage?: string; resultJson?: string },
  ): TurnEventEvent {
    const terminal = options.terminal === true;
    return {
      ...this.ownerEventBase(turn, `${turn.turnId}:${eventSeq}`),
      kind: "turn.event",
      turnId: turn.turnId,
      sessionId: turn.sessionId,
      eventSeq,
      eventKind,
      payload,
      terminal,
      ...(terminal
        ? { terminalStatus: TERMINAL_STATUS[eventKind] ?? "failed" }
        : {}),
      ...(options.errorMessage ? { errorMessage: options.errorMessage } : {}),
      ...(options.resultJson ? { resultJson: options.resultJson } : {}),
      createdAt: Date.now(),
    };
  }

  protected async terminalEventSeq(
    turn: ChatTurnRequest,
    owed: OwedTerminal,
  ): Promise<number> {
    if (owed.eventSeq !== undefined) return owed.eventSeq;
    const eventSeq = await this.nextTurnEventSeq(turn.turnId);
    owed.eventSeq = eventSeq;
    await this.ctx.storage.put("terminalOwed", owed);
    return eventSeq;
  }

  /**
   * What this turn still owes the owner, for a caller that did not terminate it
   * itself. `terminalOwed` is the authority — it is written in the same durable
   * put as `terminal` by every path that terminates a turn. The journal's
   * recorded kind is the fallback, and covers exactly one case: a turn that
   * went terminal under a build that predates the key.
   */
  protected async owedTerminal(
    turn: ChatTurnRequest,
  ): Promise<OwedTerminal | null> {
    const owed = await this.ctx.storage.get<OwedTerminal | null>(
      "terminalOwed",
    );
    if (owed) return owed;
    if (!(await this.ctx.storage.get<boolean>("terminal"))) return null;
    const recorded = this.journal.turnState(turn.turnId);
    const kind =
      recorded?.state === "terminal" && recorded.terminal_kind
        ? recorded.terminal_kind
        : "failed";
    return { kind: kind as TurnPhase, message: terminalNotice(kind) };
  }

  protected async completeChatTurn(
    turn: ChatTurnRequest,
    finalText: string,
    started: number,
  ): Promise<Response> {
    const wallClockMs = Math.round(performance.now() - started);
    const completedOwed: OwedTerminal = {
      kind: "completed",
      message: "",
      payload: { text: finalText, wallClockMs },
      eventSeq: await this.nextTurnEventSeq(turn.turnId),
    };
    await this.ctx.storage.put({
      terminal: true,
      terminalOwed: completedOwed,
    });
    this.recordTerminal(turn, "completed", undefined, wallClockMs);
    try {
      await this.emitTurnEvent(
        turn,
        "completed",
        { text: finalText, wallClockMs },
        {
          terminal: true,
          eventSeq: completedOwed.eventSeq,
          resultJson: JSON.stringify({ finalText }),
        },
      );
      await this.ctx.storage.put("terminalDelivered", true);
    } catch {
      await this.ctx.storage.setAlarm(Date.now() + 30_000);
    }
    await this.afterTerminal(turn);
    // Keep the alarm alive while queued turns remain: it is the wake
    // guarantee that lets a restarted DO drain the durable queue. The read
    // and the delete are one step against `/turn`'s enqueue — otherwise a
    // turn accepted between them is left durable under `queued:` with the
    // alarm it was promised already deleted.
    await this.ctx.blockConcurrencyWhile(async () => {
      const queued = await this.ctx.storage.list({
        prefix: "queued:",
        limit: 1,
      });
      if (queued.size === 0) {
        if (
          !(await this.getTurnState<boolean>("terminalDelivered")) ||
          (await this.hasMaintenanceDebt())
        ) {
          const retryAt = Date.now() + 30_000;
          await this.armAlarmNoLaterThan(retryAt);
        } else {
          await this.ctx.storage.deleteAlarm();
        }
      }
    });
    log("info", "chat_turn_completed", {
      turnId: turn.turnId,
      conversationId: turn.conversationId,
      wallClockMs: Math.round(performance.now() - started),
    });
    return json({ ok: true, text: finalText });
  }

  /**
   * The turn's attached images as conversation references. Each was uploaded
   * to the Drive when attached and its model-ready copy prepared in the
   * background as its upload finalized, so this only copies them into the
   * conversation, all at once; an image sent before its copy was ready is
   * prepared here, the oversized ones fitted at most two at a time.
   */
  protected async loadChatAttachmentImages(
    turn: ChatTurnRequest,
    signal?: AbortSignal,
  ): Promise<ImageContent[]> {
    const paths = (turn.attachments ?? []).slice(0, 4);
    if (paths.length === 0) return [];
    const started = performance.now();
    try {
      signal?.throwIfAborted();
      const crew = await crewScopeForConversation(this.env, turn.conversationId);
      const payload = unwrapRpc(
        await this.ownerGate(turn.ownerId).ownerInternal({
          name: "drive.turnAttachments",
          args: { paths },
          ownerGeneration: turn.ownerGeneration,
          ...(crew ? { crew } : {}),
        }),
      ) as {
        attachments?: Array<{ path: string; contentType: string; sizeBytes: number; key?: string }>;
      };
      signal?.throwIfAborted();
      const rpcMs = Math.round(performance.now() - started);
      const via: Record<string, number> = {};
      const results = await Promise.all(
        (payload.attachments ?? []).map(async (entry) => {
          if (!entry.key) return null;
          const driveKey = entry.key;
          const name = await sha256Hex(driveKey);
          try {
            // Usually prepared in the background when it was attached.
            const ready = await this.images.adopt(await attachmentImageKey(turn.ownerId, driveKey), name);
            signal?.throwIfAborted();
            if (ready !== "missing") {
              via[ready ? "ready" : "unusable"] = (via[ready ? "ready" : "unusable"] ?? 0) + 1;
              return ready;
            }
            const prepared = await prepareAttachmentImage(this.env, {
              ownerId: turn.ownerId,
              driveKey,
              contentType: entry.contentType,
              sizeBytes: entry.sizeBytes,
            });
            signal?.throwIfAborted();
            const adopted = prepared ? await this.images.adopt(prepared.key, name) : null;
            const outcome = adopted && adopted !== "missing" ? (prepared?.via ?? "ready") : "unusable";
            via[outcome] = (via[outcome] ?? 0) + 1;
            return adopted && adopted !== "missing" ? adopted : null;
          } catch (error) {
            signal?.throwIfAborted();
            via.failed = (via.failed ?? 0) + 1;
            log("error", "chat_attachment_prepare_failed", {
              turnId: turn.turnId,
              message: errorMessage(error),
            });
            return null;
          }
        }),
      );
      const images = results.filter((image): image is ImageContent => image !== null);
      log("info", "chat_attachments_loaded", {
        turnId: turn.turnId,
        conversationId: turn.conversationId,
        requested: paths.length,
        images: images.length,
        totalMs: Math.round(performance.now() - started),
        rpcMs,
        ...via,
      });
      return images;
    } catch (error) {
      signal?.throwIfAborted();
      log("error", "chat_attachment_hydration_failed", {
        turnId: turn.turnId,
        message: errorMessage(error),
      });
      return [];
    }
  }

  protected async resolveTurnLocale(
    turn: ChatTurnRequest,
    assertActive?: () => void,
  ): Promise<string | undefined> {
    assertActive?.();
    try {
      const carried = turn.locale?.trim();
      if (carried && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(carried)) {
        const stored = await this.ctx.storage.get<string>("locale");
        assertActive?.();
        if (stored !== carried) {
          assertActive?.();
          await this.ctx.storage.put("locale", carried);
          assertActive?.();
        }
        return carried;
      }
      const stored = await this.ctx.storage.get<string>("locale");
      assertActive?.();
      return stored;
    } catch {
      assertActive?.();
      return undefined;
    }
  }

  protected bindConversation(turn: ChatTurnRequest): void {
    this.journal.setConversationId(turn.conversationId);
    const meta = this.journal.meta();
    if (!meta.owner_id) {
      this.journal.bindOwner({
        ownerId: turn.ownerId,
        ownerGeneration: turn.ownerGeneration,
        createdAt: turn.queuedAt ?? Date.now(),
        title: turn.title ?? "",
        conversationId: turn.conversationId,
      });
    } else if (meta.owner_id !== turn.ownerId) {
      throw new Error("This conversation belongs to a different owner.");
    }
    if (turn.title) this.journal.setTitle(turn.title);
  }

  protected appendProduced(
    turn: ChatTurnRequest,
    message: AgentMessage,
    target: { writer: string; writerKey: string; streamId: string | null },
  ): ReturnType<Journal["appendMessage"]> | null {
    const { streamId } = target;
    const role = (message as { role?: string }).role;
    if (role !== "user" && role !== "assistant" && role !== "toolResult")
      return null;
    // An assistant message with no usable output is never persisted: ONE such
    // row poisons every future Anthropic request for this conversation. The
    // predicate is the retry ladder's own — a message it would pop from the
    // live context on resume must never have reached the journal, or the
    // transcript keeps a reply the model no longer has and the next turn
    // rebuilds history with two consecutive assistant messages. This covers
    // the errored placeholder (empty text) and the thinking-only completion
    // that hit the output cap while reasoning.
    if (!assistantMessageHasUsableOutput(message)) return null;
    let stored = message;
    let payloadJson = JSON.stringify(message);
    if (utf8Length(payloadJson) > MAX_ROW_BYTES) {
      // No R2 round trip is available here: the Agent's event sink drops
      // returned promises, so an oversize loop row is truncated in place with
      // an explicit marker rather than silently lost. Nothing in the pinned
      // tool set can currently produce a message this large.
      stored = truncateMessage(message, MAX_ROW_BYTES);
      payloadJson = JSON.stringify(stored);
      log("error", "conversation_row_truncated", {
        turnId: turn.turnId,
        role,
        bytes: utf8Length(JSON.stringify(message)),
      });
    }
    const appended = this.journal.appendMessage({
      turnId: turn.turnId,
      writer: target.writer,
      writerKey: target.writerKey,
      role: role as MessageRole,
      message: stored,
      payloadJson,
      ...(role === "assistant" && streamId ? { streamId } : {}),
    });
    this.journal.setTurnSpan(turn.turnId, appended.seq);
    return appended;
  }

  protected async hydrateWindow(
    selection: ReturnType<Journal["selectWindow"]>,
  ): Promise<AgentMessage[]> {
    if (selection.spilled.length === 0) return selection.messages;
    const messages = selection.messages.slice();
    const now = Date.now();
    let hydrated = 0;
    for (const entry of [...selection.spilled].reverse()) {
      if (hydrated < CONTEXT_MAX_SPILL_HYDRATIONS) {
        const payload = await this.archive
          .readSpill(entry.spillKey)
          .catch(() => null);
        if (payload) {
          messages[entry.index] = payload as AgentMessage;
          hydrated += 1;
          continue;
        }
      } else {
        this.journal.markModelSkip(entry.seq);
      }
      messages[entry.index] = this.journal.omittedPlaceholder(
        entry.role,
        now,
        entry.toolCallId,
      );
    }
    return messages;
  }

  protected recordTerminal(
    turn: ChatTurnRequest,
    phase: TurnPhase,
    notice?: string,
    wallClockMs?: number,
  ): void {
    try {
      const now = Date.now();
      const row = this.journal.appendTurn({
        turnId: turn.turnId,
        writer: "orchestrator",
        writerKey: `turn:${turn.turnId}:phase:${phase}`,
        phase,
        lane: turn.lane ?? "chat",
        source: turn.source,
        notice,
        wallClockMs,
        createdAt: now,
      });
      this.journal.setTurnSpan(turn.turnId, row.seq);
      this.journal.setTurnTerminal(turn.turnId, phase, now);
      this.publish(row.record);
    } catch (error) {
      log("error", "conversation_terminal_record_failed", {
        turnId: turn.turnId,
        phase,
        message: errorMessage(error),
      });
    } finally {
      this.live = null;
      this.hub.endTurn(turn.turnId);
    }
    void this.publishStagedWakeCards(turn.turnId).catch((error: unknown) =>
      log("error", "conversation_wake_cards_failed", {
        turnId: turn.turnId,
        message: errorMessage(error),
      }),
    );
  }

  protected async afterTerminal(turn: ChatTurnRequest): Promise<void> {
    this.finalizedTurnId = turn.turnId;
    const now = Date.now();
    const indexAt = performance.now();
    await this.index
      .flush({ activity: "idle", updatedAt: now })
      .catch(() => undefined);
    const drainAt = performance.now();
    try {
      this.drainInbox();
    } catch (error) {
      log("error", "conversation_inbox_drain_aborted", {
        turnId: turn.turnId,
        message: errorMessage(error),
      });
    }
    const rolloverAt = performance.now();
    await this.archive.maybeRollover(now);
    log("info", "chat_turn_maintenance", {
      turnId: turn.turnId,
      indexFlushMs: Math.round(drainAt - indexAt),
      inboxMs: Math.round(rolloverAt - drainAt),
      rolloverMs: Math.round(performance.now() - rolloverAt),
    });
  }

  protected async finalizeTerminalTurn(turn: ChatTurnRequest): Promise<void> {
    if (this.finalizedTurnId === turn.turnId) return;
    if (this.activeTurnId === turn.turnId) return;
    await this.afterTerminal(turn);
  }

  protected async turnRunning(): Promise<boolean> {
    const localLease =
      await this.ctx.storage.get<LocalTurnLease>(LOCAL_TURN_LEASE_KEY);
    if (localLease) return true;
    const [turn, queued] = await Promise.all([
      this.ctx.storage.get<ChatTurnRequest>("turn"),
      this.ctx.storage.list<ChatTurnRequest>({
        prefix: "queued:",
        limit: 1,
      }),
    ]);
    if (queued.size > 0) return true;
    if (!turn) return false;
    return !(await this.ctx.storage.get<boolean>("terminal"));
  }

  protected drainInbox(): void {
    for (;;) {
      const rows = this.journal.takeInbox(50);
      if (rows.length === 0) return;
      for (const row of rows) {
        try {
          if (row.kind === "card") {
            this.publish(
              this.journal.appendCard({
                turnId: row.turn_id,
                writer: row.writer,
                writerKey: row.writer_key,
                card: JSON.parse(row.payload_json) as ConversationCard,
                createdAt: row.created_at,
              }).record,
            );
          } else if (row.kind === "turn") {
            const detail = JSON.parse(row.payload_json) as {
              phase: TurnPhase;
              lane?: string;
              source?: string;
              notice?: string;
            };
            this.publish(
              this.journal.appendTurn({
                turnId: row.turn_id,
                writer: row.writer,
                writerKey: row.writer_key,
                phase: detail.phase,
                lane: detail.lane,
                source: detail.source,
                notice: detail.notice,
                createdAt: row.created_at,
              }).record,
            );
          } else {
            this.publish(
              this.journal.appendMessage({
                turnId: row.turn_id,
                writer: row.writer,
                writerKey: row.writer_key,
                role: (row.role ?? "user") as MessageRole,
                hidden: row.hidden === 1,
                message: JSON.parse(row.payload_json) as AgentMessage,
                payloadJson: row.payload_json,
                createdAt: row.created_at,
              }).record,
            );
          }
        } catch (error) {
          log("error", "conversation_inbox_drain_failed", {
            writerKey: row.writer_key,
            message: errorMessage(error),
          });
        } finally {
          this.journal.dropInbox(row.id);
        }
      }
    }
  }
}
