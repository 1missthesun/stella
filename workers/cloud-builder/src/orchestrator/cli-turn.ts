import type { ExecutionContextSnapshot } from "@stella/contracts/execution-context";
import { formatTurnClock } from "@stella/contracts/schedule-zone";
import type { ClaudeUsageLimit, ClaudeUsageLimitCard } from "@stella/contracts/claude-usage-limit";
import type { AgentMessage } from "@stella/runtime/kernel/agent-core/types.js";
import { runToolEffect, sleepWithAbortEffect } from "@stella/runtime/kernel/tools/effect-runtime.js";
import { Effect } from "effect";
import type { ClaudeSessionManifest } from "@stella/contracts/backend/claude-sessions";
import type { RpcResponse } from "@stella/contracts/backend/protocol";
import type { CloudOrchestratorCliAdoptedSession } from "@stella/contracts/cloud-orchestrator-cli";
import { claudeHydratedSessionKey } from "@stella/contracts/cloud-native-state";
import {
  parseCliTurnEventsForward,
  parseCliTurnTerminal,
  parseCliTurnToolForward,
  prewarmOrchestratorCli,
} from "../orchestrator-cli-turn.js";
import {
  createCloudClaudeCodeTransport,
  type CloudClaudeCodeModels,
  type CloudClaudeCodeTransport,
  type CloudClaudeCodeTurn,
  type FrameAnswer,
} from "./claude-code-transport.js";
import type { WakeReport, ChatTurnRequest } from "./types.js";
import {
  CONVERSATION_EXECUTION_KEY,
  LIVE_TOOL_LIMIT,
  LOCAL_TURN_LEASE_KEY,
} from "./constants.js";
import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";
import { json, log, previewArgs } from "./support.js";
import { OrchestratorTools } from "./tools.js";
import { ownerGateStub } from "../rpc-release.js";

/** How long a Claude Code turn waits for its chat turn to bind (after an eviction). */
const CLAUDE_CODE_TURN_WAIT_MS = 60_000;
const CLAUDE_CODE_ATTEMPT_KEY = "claudeCodeAttempt";
const CLAUDE_CODE_MODELS_KEY = "claudeCodeModels";

export abstract class OrchestratorCliTurn extends OrchestratorTools {
  #claudeCode?: CloudClaudeCodeTransport;

  protected claudeCodeTransport(): CloudClaudeCodeTransport {
    this.#claudeCode ??= createCloudClaudeCodeTransport({
      env: this.env,
      inlineImages: (content) => this.images.inlineContent(content),
      turn: async (signal) => {
        const runtime = this.piRuntime;
        if (!runtime) throw new Error("No Stella turn is running to carry this Claude Code turn.");
        const binding = await (await runtime).boundTurn(
          AbortSignal.any([signal, AbortSignal.timeout(CLAUDE_CODE_TURN_WAIT_MS)]),
        );
        const execution = binding.authority.execution;
        if (execution.engine !== "anthropic") {
          throw new Error("This conversation's turn does not run on Claude Code.");
        }
        return {
          turnId: binding.turnId,
          ownerId: binding.authority.ownerId,
          ownerGeneration: binding.authority.ownerGeneration,
          conversationId: binding.authority.conversationId,
          audience: binding.authority.audience,
          budgetMicroCents: binding.authority.budgetMicroCents,
          execution,
        };
      },
      nextAttempt: async () => {
        const next = ((await this.ctx.storage.get<number>(CLAUDE_CODE_ATTEMPT_KEY)) ?? 0) + 1;
        await this.ctx.storage.put(CLAUDE_CODE_ATTEMPT_KEY, next);
        return next;
      },
      adoption: (turn) => this.claudeCodeAdoption(turn),
      models: {
        read: async () => await this.ctx.storage.get<CloudClaudeCodeModels>(CLAUDE_CODE_MODELS_KEY),
        write: async (models) => {
          await this.ctx.storage.put(CLAUDE_CODE_MODELS_KEY, models);
        },
      },
      stageSession: async (turn, sessionId, transcript) => {
        const bucket = this.env.BACKUP_BUCKET;
        if (!bucket) throw new Error("This deployment has no storage for a Claude Code session.");
        await bucket.put(
          claudeHydratedSessionKey(turn.ownerId, turn.conversationId, sessionId),
          transcript,
          { httpMetadata: { contentType: "application/x-ndjson" } },
        );
      },
      sleep: (ms, signal) =>
        runToolEffect(sleepWithAbortEffect(ms, signal, () => new Error("aborted")).pipe(Effect.ignore)),
      log: (event, fields) => log("info", event, fields),
    });
    return this.#claudeCode;
  }

  protected async claudeCodeAdoption(
    turn: CloudClaudeCodeTurn,
  ): Promise<CloudOrchestratorCliAdoptedSession | null> {
    const promptSeq = this.journal.selectTurnMessages(turn.turnId).rows[0]?.seq;
    if (typeof promptSeq !== "number") return null;
    const prior = this.ctx.storage.sql
      .exec<{ seq: number | null }>(
        `SELECT MIN(seq) AS seq FROM journal
          WHERE kind = 'message' AND role = 'user'
            AND turn_id = (
              SELECT turn_id FROM journal
               WHERE kind = 'message' AND role = 'user' AND seq < ?
               ORDER BY seq DESC LIMIT 1
            )`,
        promptSeq,
      )
      .toArray()[0]?.seq;
    if (typeof prior !== "number") return null;
    const response = (await ownerGateStub(this.env.OWNER_GATES, turn.ownerId)
      .ownerInternal({
        name: "claudeSessions.latestForRestore",
        args: { threadId: turn.conversationId },
        ownerGeneration: turn.ownerGeneration,
      })
      .catch(() => null)) as RpcResponse | null;
    const manifest = response?.ok
      ? (response.value as ClaudeSessionManifest | null)
      : null;
    if (
      !manifest ||
      manifest.engine !== "claude_code_local" ||
      manifest.conversationId !== turn.conversationId ||
      (manifest.journalSeq ?? -1) < prior
    ) {
      return null;
    }
    return {
      threadId: manifest.threadId,
      sessionId: manifest.sessionId,
      deviceId: manifest.deviceId,
    };
  }

  protected prewarmCliContainer(ownerId: string, conversationId: string): void {
    if (!conversationId) return;
    const startedAt = performance.now();
    this.ctx.waitUntil(
      prewarmOrchestratorCli({
        env: this.env,
        ownerId,
        conversationId,
      }).then((result) => {
        log("info", "orchestrator_cli_prewarm", {
          conversationId,
          ok: result.ok,
          status: result.status ?? null,
          alreadyRunning: result.alreadyRunning ?? null,
          startMs: result.startMs ?? null,
          elapsedMs: Math.round(performance.now() - startedAt),
        });
      }),
    );
  }

  private composerPrewarmAt = 0;

  protected prewarmForComposer(): void {
    const now = Date.now();
    if (now - this.composerPrewarmAt < 60_000) return;
    if (this.activeTurnId || this.turnExecutions.size > 0) return;
    const kv = this.ctx.storage.kv;
    if (!kv || kv.get(LOCAL_TURN_LEASE_KEY)) return;
    if (Array.from(kv.list({ prefix: "queued:", limit: 1 })).length > 0) return;
    const ownerId = this.journal.ownerId();
    const conversationId = this.conversationId();
    if (!ownerId || !conversationId) return;
    this.composerPrewarmAt = now;
    this.ctx.waitUntil(
      this.ctx.storage
        .get<CloudExecutionSelection>(CONVERSATION_EXECUTION_KEY)
        .then((execution) => {
          if (execution?.engine !== "anthropic") return;
          log("info", "orchestrator_composer_prewarm", { conversationId });
          this.prewarmCliContainer(ownerId, conversationId);
        })
        .catch(() => undefined),
    );
  }

  protected async journalCliPrompt(
    turn: ChatTurnRequest,
    executionContext: ExecutionContextSnapshot,
    report: WakeReport,
    engine: "claude-code" | "pi" = "claude-code",
  ): Promise<number> {
    const now = Date.now();
    const durablePrompt = {
      role: "user",
      content: [{ type: "text", text: report.prompt }],
      timestamp: now,
      executionContext,
      ...(turn.originUserMessageId
        ? { originUserMessageId: turn.originUserMessageId }
        : {}),
      providerContext: {
        version: 2,
        epoch: `${engine}:${turn.turnId}`,
        prepend: [],
        clock: formatTurnClock(now, turn.timeZone),
        ...(turn.attachments?.length
          ? { attachments: [...turn.attachments] }
          : {}),
      },
      ...(turn.source ? { source: turn.source } : {}),
      ...(turn.context?.display
        ? { metadata: { context: turn.context.display } }
        : {}),
    } as AgentMessage;
    const promptPayload = await this.spillOversizePrompt(
      turn.turnId,
      durablePrompt,
    );
    for (const repaired of this.journal.repairTail(now)) {
      this.publish(repaired.record);
    }
    this.drainInbox();
    const promptRow = this.journal.appendMessage({
      turnId: turn.turnId,
      writer: "orchestrator",
      writerKey: `turn:${turn.turnId}:prompt`,
      role: "user",
      hidden: turn.hiddenMessage === true,
      clientMsgId: turn.clientMsgId,
      createdAt: now,
      message: durablePrompt,
      ...promptPayload,
    });
    this.journal.setTurnSpan(turn.turnId, promptRow.seq);
    this.publish(promptRow.record);
    this.publishAgentTerminal(turn, report);
    await this.publishStagedWakeCards(turn.turnId);
    const startedRow = this.journal.appendTurn({
      turnId: turn.turnId,
      writer: "orchestrator",
      writerKey: `turn:${turn.turnId}:phase:started`,
      phase: "started",
      lane: turn.lane ?? "chat",
      source: turn.source,
      promptSeq: promptRow.seq,
      createdAt: now,
    });
    this.journal.setTurnSpan(turn.turnId, startedRow.seq);
    this.publish(startedRow.record);
    return promptRow.seq;
  }

  protected noteTurnTool(
    turn: ChatTurnRequest,
    call: { toolCallId: string; name: string; args: unknown },
    phase: "start" | "end",
    isError?: boolean,
  ): void {
    if (this.live?.turnId === turn.turnId) {
      if (phase === "start") {
        this.live.tools.push({
          toolCallId: call.toolCallId,
          name: call.name,
          phase: "start",
        });
        if (this.live.tools.length > LIVE_TOOL_LIMIT) this.live.tools.shift();
      } else {
        const entry = this.live.tools.find(
          (tool) => tool.toolCallId === call.toolCallId,
        );
        if (entry) {
          entry.phase = "end";
          entry.isError = isError === true;
        }
      }
    }
    this.hub.broadcastTool({
      turnId: turn.turnId,
      toolCallId: call.toolCallId,
      name: call.name,
      phase,
      ...(phase === "start"
        ? { argsPreview: previewArgs(call.args) }
        : { isError: isError === true }),
    });
    this.slack().tool(turn.turnId, call.toolCallId, call.name, phase, isError);
  }

  protected async holdForClaudeUsageLimit(
    turn: ChatTurnRequest,
    limit: ClaudeUsageLimit,
  ): Promise<boolean> {
    try {
      const response = (await ownerGateStub(this.env.OWNER_GATES, turn.ownerId).ownerInternal({
        name: "agentThreads.holdForUsageLimit",
        args: {
          conversationId: turn.conversationId,
          ownerGeneration: turn.ownerGeneration,
          ...(limit.resetsAt !== undefined ? { resetsAt: limit.resetsAt } : {}),
          ...(limit.monthly ? { monthly: true } : {}),
        },
        ownerGeneration: turn.ownerGeneration,
      })) as RpcResponse;
      if (!response.ok) throw new Error(response.error.message);
    } catch (error) {
      log("error", "claude_usage_limit_hold_failed", {
        turnId: turn.turnId,
        conversationId: turn.conversationId,
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
    const card: ClaudeUsageLimitCard = {
      type: "usage-limit",
      state: "held",
      ...(limit.resetsAt !== undefined ? { until: limit.resetsAt } : {}),
      ...(limit.monthly ? { monthly: true as const } : {}),
    };
    const appended = this.journal.appendCard({
      turnId: turn.turnId,
      card,
      writer: "orchestrator",
      writerKey: `turn:${turn.turnId}:usage-limit`,
    });
    this.journal.setTurnSpan(turn.turnId, appended.seq);
    if (appended.inserted) this.publish(appended.record);
    log("info", "claude_usage_limit_held", {
      turnId: turn.turnId,
      conversationId: turn.conversationId,
      resetsAt: limit.resetsAt ?? null,
    });
    return true;
  }

  protected async handleCliTurnTool(request: Request): Promise<Response> {
    const forward = parseCliTurnToolForward(
      await request.json().catch(() => null),
    );
    if (!forward) return json({ error: "Malformed CLI tool call." }, 400);
    return this.frameResponse(await this.claudeCodeTransport().tool(forward));
  }

  protected async handleCliTurnEvents(request: Request): Promise<Response> {
    const forward = parseCliTurnEventsForward(
      await request.json().catch(() => null),
    );
    if (!forward) return json({ error: "Malformed CLI event batch." }, 400);
    return this.frameResponse(this.claudeCodeTransport().events(forward));
  }

  protected async handleCliTurnTerminal(request: Request): Promise<Response> {
    const terminal = parseCliTurnTerminal(
      await request.json().catch(() => null),
    );
    if (!terminal) return json({ error: "Malformed CLI turn terminal." }, 400);
    return this.frameResponse(this.claudeCodeTransport().terminal(terminal));
  }

  private frameResponse(answer: FrameAnswer): Response {
    return json(answer.body, answer.status);
  }
}
