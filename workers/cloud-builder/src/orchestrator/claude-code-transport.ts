/**
 * Claude Code as pi's engine in the cloud: the `ClaudeCodeTransport` the
 * conversation's pi runtime runs Stella's Claude Code turns on.
 *
 * Each CLI turn runs in the conversation's orchestrator container, dispatched
 * to its BuildSession as an orchestrator agent turn, exactly as before. What
 * changed is who answers it: the CLI's tool calls come back here and are
 * answered by pi's own tool tasks (`executeTool` waits for pi's result), and
 * its finished assistant messages become the stream pi's generation reads.
 * The CLI keeps none of its built-ins in the cloud, so every file and shell
 * call is one of pi's tools, which run wherever the conversation's tools run:
 * the cloud, or one of the owner's computers through pi's execution host.
 *
 *   pi generation --runTurn--> BuildSession --> executor --> claude
 *   claude --MCP--> executor --> BuildSession --tool--> here --> pi's tool task
 *   claude --stream-json--> executor --> BuildSession --events--> here --> pi
 */
import { claudeUsageLimitOf } from "@stella/contracts/claude-usage-limit";
import type {
  ClaudeCodeSessionRef,
  ClaudeCodeToolOutcome,
  ClaudeCodeTransport,
  ClaudeCodeTurnSpec,
} from "@stella/agent/engine/claude-code";
import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";
import {
  orchestratorCliThreadId,
  type CloudCliAssistantMessage,
  type CloudCliTurnEventsForward,
  type CloudCliTurnIdentity,
  type CloudCliTurnTerminal,
  type CloudCliTurnToolForward,
  type CloudOrchestratorCliAdoptedSession,
  type CloudOrchestratorToolCallResponse,
  type CloudOrchestratorToolContent,
} from "@stella/contracts/cloud-orchestrator-cli";
import {
  cancelOrchestratorCliTurn,
  dispatchOrchestratorCliTurn,
  OrchestratorCliPreviousTurnBusy,
  sameCliTurnIdentity,
  type BuildSessionEnv,
} from "../orchestrator-cli-turn.js";

/** The chat turn a Claude Code turn runs for. */
export type CloudClaudeCodeTurn = {
  turnId: string;
  ownerId: string;
  ownerGeneration: string;
  conversationId: string;
  audience: string;
  budgetMicroCents: number;
  execution: Extract<CloudExecutionSelection, { engine: "anthropic" }>;
};

export type CloudClaudeCodeHost = {
  env: BuildSessionEnv;
  /** The chat turn running now; waits briefly for one to bind. */
  turn(signal: AbortSignal): Promise<CloudClaudeCodeTurn>;
  /** The next attempt on the conversation's orchestrator thread, kept across evictions. */
  nextAttempt(): Promise<number>;
  /** A session another host ran for this conversation and synced, for one that has none here. */
  adoption(turn: CloudClaudeCodeTurn): Promise<CloudOrchestratorCliAdoptedSession | null>;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  log(event: string, fields: Record<string, unknown>): void;
};

type Attempt = {
  identity: CloudCliTurnIdentity;
  turn: CloudClaudeCodeTurn;
  spec: ClaudeCodeTurnSpec;
  appliedBatchSeq: number;
  /** Tool calls by the CLI's tool_use id, with the arguments they came with. */
  calls: Map<string, { args: string; outcome: Promise<ClaudeCodeToolOutcome> }>;
  resolve(result: { text: string; sessionId: string }): void;
  reject(error: Error): void;
  finished: boolean;
};

/** A frame's answer: its HTTP status and JSON body. */
export type FrameAnswer = { status: number; body: unknown };

const BUSY_RETRY_MS = 2_000;
const BUSY_RETRIES = 10;
const MCP_PREFIX = "mcp__stella__";

const attemptKey = (identity: CloudCliTurnIdentity): string => `${identity.turnId}#${identity.attemptGeneration}`;

const STOP_REASONS: Record<CloudCliAssistantMessage["stopReason"], string> = {
  stop: "end_turn",
  toolUse: "tool_use",
  length: "max_tokens",
  error: "end_turn",
  aborted: "end_turn",
};

/** One finished CLI message as the stream events the engine reads (`stream_event` lines). */
const streamEventsOf = (message: CloudCliAssistantMessage): Record<string, unknown>[] => {
  const event = (inner: Record<string, unknown>) => ({ type: "stream_event", event: inner });
  const events: Record<string, unknown>[] = [
    event({
      type: "message_start",
      message: {
        usage: {
          input_tokens: message.usage.input,
          cache_read_input_tokens: message.usage.cacheRead,
          cache_creation_input_tokens: message.usage.cacheWrite,
          output_tokens: 0,
        },
      },
    }),
  ];
  message.content.forEach((part, index) => {
    if (part.type === "text") {
      events.push(
        event({ type: "content_block_start", index, content_block: { type: "text", text: "" } }),
        event({ type: "content_block_delta", index, delta: { type: "text_delta", text: part.text } }),
      );
    } else if (part.type === "thinking") {
      events.push(
        event({ type: "content_block_start", index, content_block: { type: "thinking", thinking: "" } }),
        event({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: part.thinking } }),
        ...(part.thinkingSignature
          ? [event({ type: "content_block_delta", index, delta: { type: "signature_delta", signature: part.thinkingSignature } })]
          : []),
      );
    } else {
      events.push(
        event({
          type: "content_block_start",
          index,
          content_block: { type: "tool_use", id: part.id, name: `${MCP_PREFIX}${part.name}`, input: {} },
        }),
        event({
          type: "content_block_delta",
          index,
          delta: { type: "input_json_delta", partial_json: JSON.stringify(part.arguments ?? {}) },
        }),
      );
    }
    events.push(event({ type: "content_block_stop", index }));
  });
  events.push(
    event({
      type: "message_delta",
      delta: { stop_reason: STOP_REASONS[message.stopReason] },
      usage: { output_tokens: message.usage.output },
    }),
    event({ type: "message_stop" }),
  );
  return events;
};

const toolContent = (outcome: ClaudeCodeToolOutcome): CloudOrchestratorToolContent[] =>
  outcome.content.map((part) =>
    part.type === "image"
      ? { type: "image", data: part.data, mimeType: part.mimeType }
      : { type: "text", text: part.text },
  );

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export type CloudClaudeCodeTransport = ClaudeCodeTransport & {
  /** `CLOUD_CLI_TURN_DO_PATHS.tool`. */
  tool(forward: CloudCliTurnToolForward): Promise<FrameAnswer>;
  /** `CLOUD_CLI_TURN_DO_PATHS.events`. */
  events(forward: CloudCliTurnEventsForward): FrameAnswer;
  /** `CLOUD_CLI_TURN_DO_PATHS.terminal`. */
  terminal(terminal: CloudCliTurnTerminal): FrameAnswer;
  /** The user-safe reason the chat turn's last Claude Code turn failed, once. */
  takeFailure(turnId: string): string | undefined;
};

export const createCloudClaudeCodeTransport = (host: CloudClaudeCodeHost): CloudClaudeCodeTransport => {
  const attempts = new Map<string, Attempt>();
  const failures = new Map<string, string>();
  /** A synced session to resume on the next dispatch, by conversation. */
  const adopting = new Map<string, CloudOrchestratorCliAdoptedSession>();

  const settle = (attempt: Attempt, outcome: { ok: true; text: string } | { ok: false; error: Error }) => {
    if (attempt.finished) return;
    attempt.finished = true;
    attempts.delete(attemptKey(attempt.identity));
    if (outcome.ok) attempt.resolve({ text: outcome.text, sessionId: attempt.identity.threadId });
    else attempt.reject(outcome.error);
  };

  const cancel = (attempt: Attempt, reason: string) => {
    void cancelOrchestratorCliTurn({
      env: host.env,
      ownerId: attempt.turn.ownerId,
      ownerGeneration: attempt.turn.ownerGeneration,
      identity: attempt.identity,
      cancelRequestId: `claude-code:${attempt.identity.turnId}`,
    })
      .then(({ status }) => host.log("claude_code_attempt_canceled", { turnId: attempt.identity.turnId, status, reason }))
      .catch((error: unknown) =>
        host.log("claude_code_attempt_cancel_failed", { turnId: attempt.identity.turnId, message: errorText(error) }),
      );
  };

  const runTurn: ClaudeCodeTransport["runTurn"] = async (spec) => {
    if (spec.session.role !== "orchestrator") {
      throw new Error("In the cloud, Claude Code runs only Stella's own turns; her agents run in containers of their own.");
    }
    const turn = await host.turn(spec.signal);
    const attemptGeneration = await host.nextAttempt();
    const identity: CloudCliTurnIdentity = {
      conversationId: turn.conversationId,
      threadId: orchestratorCliThreadId(turn.conversationId),
      turnId: `${turn.turnId}.cc${attemptGeneration}`,
      attemptGeneration,
    };
    const result = new Promise<{ text: string; sessionId: string }>((resolve, reject) => {
      attempts.set(attemptKey(identity), {
        identity,
        turn,
        spec,
        appliedBatchSeq: 0,
        calls: new Map(),
        resolve,
        reject,
        finished: false,
      });
    });
    const attempt = attempts.get(attemptKey(identity))!;
    const onAbort = () => {
      cancel(attempt, "stopped");
      settle(attempt, { ok: false, error: new Error("Stopped.") });
    };
    spec.signal.addEventListener("abort", onAbort, { once: true });
    void result.finally(() => spec.signal.removeEventListener("abort", onAbort)).catch(() => undefined);
    if (spec.signal.aborted) {
      onAbort();
      return await result;
    }
    const adoptSession = adopting.get(turn.conversationId);
    const started = performance.now();
    try {
      for (let busy = 0; ; busy += 1) {
        try {
          await dispatchOrchestratorCliTurn({
            env: host.env,
            ownerId: turn.ownerId,
            ownerGeneration: turn.ownerGeneration,
            audience: turn.audience,
            budgetMicroCents: turn.budgetMicroCents,
            identity,
            execution: turn.execution,
            prompt: spec.prompt,
            spec: {
              systemPrompt: spec.systemPrompt,
              toolCatalog: spec.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              })),
              ...(adoptSession ? { adoptSession } : {}),
              ...(spec.quiet ? { quiet: true } : {}),
            },
            signal: spec.signal,
          });
          break;
        } catch (error) {
          if (!(error instanceof OrchestratorCliPreviousTurnBusy) || busy >= BUSY_RETRIES) throw error;
          await host.sleep(BUSY_RETRY_MS, spec.signal);
        }
      }
    } catch (error) {
      settle(attempt, { ok: false, error: error instanceof Error ? error : new Error(errorText(error)) });
      return await result;
    }
    if (adoptSession) adopting.delete(turn.conversationId);
    spec.onSessionId(identity.threadId);
    host.log("claude_code_attempt_dispatched", {
      turnId: turn.turnId,
      attemptGeneration,
      promptChars: spec.prompt.length,
      tools: spec.tools.length,
      adopted: Boolean(adoptSession),
      dispatchMs: Math.round(performance.now() - started),
    });
    return await result;
  };

  const resume: NonNullable<ClaudeCodeTransport["resume"]> = async (session: ClaudeCodeSessionRef, args) => {
    if (args.held) return { sessionId: args.held };
    if (session.role !== "orchestrator") return {};
    const turn = await host.turn(AbortSignal.timeout(60_000));
    const adoption = await host.adoption(turn).catch(() => null);
    if (!adoption) return {};
    adopting.set(turn.conversationId, adoption);
    host.log("claude_code_session_adopted", { turnId: turn.turnId, deviceId: adoption.deviceId });
    return { sessionId: adoption.sessionId, restored: true };
  };

  const find = (identity: CloudCliTurnIdentity): Attempt | undefined => {
    const attempt = attempts.get(attemptKey(identity));
    return attempt && sameCliTurnIdentity(attempt.identity, identity) && !attempt.finished ? attempt : undefined;
  };

  return {
    runTurn,
    resume,
    takeFailure: (turnId) => {
      const failure = failures.get(turnId);
      failures.delete(turnId);
      return failure;
    },
    tool: async (forward) => {
      const refuse = (code: "turn_inactive" | "unknown_tool" | "conflict", message: string): FrameAnswer => ({
        status: 200,
        body: { ok: false, error: { code, message } } satisfies CloudOrchestratorToolCallResponse,
      });
      const attempt = find(forward);
      if (!attempt) return refuse("turn_inactive", "This chat turn is no longer running.");
      if (!attempt.spec.tools.some((tool) => tool.name === forward.name)) {
        return refuse("unknown_tool", `${forward.name} is not one of this turn's tools.`);
      }
      const args = JSON.stringify(forward.args);
      let call = attempt.calls.get(forward.toolCallId);
      if (call && call.args !== args) {
        return refuse("conflict", "That tool call id was already used with different arguments.");
      }
      if (!call) {
        call = {
          args,
          outcome: attempt.spec.executeTool(forward.toolCallId, forward.name, forward.args, attempt.spec.signal),
        };
        attempt.calls.set(forward.toolCallId, call);
      }
      let outcome: ClaudeCodeToolOutcome;
      try {
        outcome = await call.outcome;
      } catch (error) {
        outcome = { content: [{ type: "text", text: errorText(error) }], isError: true };
      }
      if (attempt.finished) return refuse("turn_inactive", "This chat turn is no longer running.");
      return {
        status: 200,
        body: {
          ok: true,
          result: { content: toolContent(outcome), ...(outcome.isError ? { isError: true } : {}) },
        } satisfies CloudOrchestratorToolCallResponse,
      };
    },
    events: (forward) => {
      const attempt = find(forward);
      if (!attempt) return { status: 409, body: { ok: false, code: "turn_inactive", message: "This chat turn is no longer running." } };
      if (forward.batchSeq <= attempt.appliedBatchSeq) return { status: 200, body: { ok: true, replayed: true } };
      if (forward.batchSeq !== attempt.appliedBatchSeq + 1) {
        return {
          status: 409,
          body: { ok: false, code: "batch_out_of_order", expectedBatchSeq: attempt.appliedBatchSeq + 1 },
        };
      }
      attempt.appliedBatchSeq = forward.batchSeq;
      for (const event of forward.events) {
        if (event.type === "assistant_message") {
          for (const line of streamEventsOf(event.message)) attempt.spec.onEvent(line);
        } else if (event.type === "status") {
          attempt.spec.onStatus({ state: event.state, text: event.text });
        } else if (event.type === "compaction") {
          host.log("claude_code_compaction", { turnId: attempt.turn.turnId, summaryChars: event.summary.length });
          attempt.spec.onCompaction({
            id: event.id,
            summary: event.summary,
            ...(event.preservedMessages !== undefined ? { preservedMessages: event.preservedMessages } : {}),
          });
        }
      }
      return { status: 200, body: { ok: true } };
    },
    terminal: (terminal) => {
      const attempt = find(terminal);
      if (!attempt) {
        host.log("claude_code_terminal_ignored", {
          turnId: terminal.turnId,
          attemptGeneration: terminal.attemptGeneration,
          outcome: terminal.outcome,
        });
        return { status: 200, body: { ok: true, ignored: true } };
      }
      host.log("claude_code_attempt_terminal", {
        turnId: terminal.turnId,
        attemptGeneration: terminal.attemptGeneration,
        outcome: terminal.outcome,
        inputTokens: terminal.usage.inputTokens,
        outputTokens: terminal.usage.outputTokens,
        llmCalls: terminal.usage.llmCalls,
      });
      if (terminal.outcome === "completed") {
        settle(attempt, { ok: true, text: terminal.finalText });
      } else if (terminal.outcome === "canceled") {
        settle(attempt, { ok: false, error: new Error("Stopped.") });
      } else {
        const reason = terminal.error?.trim() || "Claude Code could not finish this turn.";
        failures.set(attempt.turn.turnId, reason);
        const error: Error & { code?: string } = new Error(reason);
        if (claudeUsageLimitOf(reason)) error.code = "CLAUDE_CODE_USAGE_LIMIT";
        settle(attempt, { ok: false, error });
      }
      return { status: 200, body: { ok: true } };
    },
  };
};
