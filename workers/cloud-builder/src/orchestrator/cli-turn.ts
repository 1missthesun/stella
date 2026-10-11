import type { ExecutionContextSnapshot } from "@stella/contracts/execution-context";
import type { AgentMessage } from "@stella/runtime/kernel/agent-core/types.js";
import type { ClaudeSessionManifest } from "@stella/contracts/backend/claude-sessions";
import type { RpcResponse } from "@stella/contracts/backend/protocol";
import type { CloudOrchestratorCliAdoptedSession } from "@stella/contracts/cloud-orchestrator-cli";
import {
  parseCliTurnEventsForward,
  parseCliTurnTerminal,
  parseCliTurnToolForward,
  prewarmOrchestratorCli,
} from "../orchestrator-cli-turn.js";
import {
  createCloudClaudeCodeTransport,
  type CloudClaudeCodeTransport,
  type CloudClaudeCodeTurn,
  type FrameAnswer,
} from "./claude-code-transport.js";
import type { WakeReport, ChatTurnRequest } from "./types.js";
import { LIVE_TOOL_LIMIT } from "./constants.js";
import { json, log, previewArgs } from "./support.js";
import { OrchestratorTools } from "./tools.js";

/** How long a Claude Code turn waits for its chat turn to bind (after an eviction). */
const CLAUDE_CODE_TURN_WAIT_MS = 60_000;
/** Storage key of the conversation's latest Claude Code attempt on its orchestrator thread. */
const CLAUDE_CODE_ATTEMPT_KEY = "claudeCodeAttempt";

/**
 * Claude Code turns, which pi runs on its Claude Code engine: the bridge to
 * the conversation's orchestrator container (`claude-code-transport.ts`),
 * the prompt row every chat turn journals, and the live tool view.
 */
export abstract class OrchestratorCliTurn extends OrchestratorTools {
  #claudeCode?: CloudClaudeCodeTransport;

  /** The transport pi's Claude Code engine runs this conversation's CLI turns on. */
  protected claudeCodeTransport(): CloudClaudeCodeTransport {
    this.#claudeCode ??= createCloudClaudeCodeTransport({
      env: this.env,
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
      sleep: (ms, signal) =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, ms);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        }),
      log: (event, fields) => log("info", event, fields),
    });
    return this.#claudeCode;
  }

  /**
   * A computer's synced Claude Code session (`claudeSessions`) for the cloud
   * to resume, when it has no session of its own for this conversation and
   * the computer's sync covers the conversation's last turn there.
   */
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
    const response = (await this.env.OWNER_GATES.getByName(turn.ownerId)
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

  /**
   * Wake the conversation's orchestrator container for a Claude Code turn that
   * is being admitted right now, so the turn does not pay a cold start. Fire
   * and forget. Only an admitted turn warms a container: a socket connect or
   * any other passive signal would hold an instance for its whole idle window
   * without a turn ever arriving.
   */
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

  /**
   * The CLI turn's prompt row and `started` phase, the same rows Stella's
   * own loop writes. Its provider context names an epoch no Stella prompt
   * context ever has, so a later Stella turn replays it with its clock and
   * attachments but no stale system reminders.
   */
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
        clock: new Date(now).toISOString(),
        ...(turn.attachments?.length
          ? { attachments: [...turn.attachments] }
          : {}),
      },
      ...(turn.source ? { source: turn.source } : {}),
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

  /** `CLOUD_CLI_TURN_DO_PATHS.tool`: a CLI tool call, answered by pi's tool task. */
  protected async handleCliTurnTool(request: Request): Promise<Response> {
    const forward = parseCliTurnToolForward(
      await request.json().catch(() => null),
    );
    if (!forward) return json({ error: "Malformed CLI tool call." }, 400);
    return this.frameResponse(await this.claudeCodeTransport().tool(forward));
  }

  /** `CLOUD_CLI_TURN_DO_PATHS.events`: one ordered batch of the CLI's messages and status. */
  protected async handleCliTurnEvents(request: Request): Promise<Response> {
    const forward = parseCliTurnEventsForward(
      await request.json().catch(() => null),
    );
    if (!forward) return json({ error: "Malformed CLI event batch." }, 400);
    return this.frameResponse(this.claudeCodeTransport().events(forward));
  }

  /**
   * `CLOUD_CLI_TURN_DO_PATHS.terminal`: the attempt is over. A terminal for an
   * attempt this object no longer runs is acknowledged, so the BuildSession
   * stops retrying.
   */
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
