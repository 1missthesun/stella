import { claudeUsageLimitOf } from "@stella/contracts/claude-usage-limit";
import {
  CLAUDE_CODE_SESSION_LOST,
  type ClaudeCodeSessionRef,
  type ClaudeCodeToolOutcome,
  type ClaudeCodeTransport,
  type ClaudeCodeTurnSpec,
} from "@stella/agent/engine/claude-code";
import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";
import {
  CLOUD_CLI_SESSION_LOST_MARK,
  orchestratorCliCompactThreadId,
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
import { isSlackConversationId } from "../slack/conversation-id.js";

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
  nextAttempt(): Promise<number>;
  adoption(turn: CloudClaudeCodeTurn): Promise<CloudOrchestratorCliAdoptedSession | null>;
  stageSession(turn: CloudClaudeCodeTurn, sessionId: string, transcript: string): Promise<void>;
  models: { read(): Promise<CloudClaudeCodeModels | undefined>; write(models: CloudClaudeCodeModels): Promise<void> };
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  log(event: string, fields: Record<string, unknown>): void;
  /** Stored images back inline: Claude Code's tool results carry bytes, never a URL. */
  inlineImages?<T extends { type: string }>(content: readonly T[]): Promise<readonly T[]>;
};

export type CloudClaudeCodeModels = { resolved: Record<string, string>; windows: Record<string, number> };

type Attempt = {
  identity: CloudCliTurnIdentity;
  turn: CloudClaudeCodeTurn;
  spec: ClaudeCodeTurnSpec;
  adopted: boolean;
  appliedBatchSeq: number;
  calls: Map<string, { args: string; outcome: Promise<ClaudeCodeToolOutcome> }>;
  resolve(result: { text: string; sessionId: string }): void;
  reject(error: Error): void;
  finished: boolean;
};

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

const streamEventsOf = (message: CloudCliAssistantMessage): Record<string, unknown>[] => {
  const event = (inner: Record<string, unknown>) => ({ type: "stream_event", event: inner });
  const events: Record<string, unknown>[] = [
    event({
      type: "message_start",
      message: {
        model: message.model,
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
    } else if (part.type === "thinking" && part.redacted) {
      events.push(
        event({ type: "content_block_start", index, content_block: { type: "redacted_thinking", data: part.thinkingSignature ?? "" } }),
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
  tool(forward: CloudCliTurnToolForward): Promise<FrameAnswer>;
  events(forward: CloudCliTurnEventsForward): FrameAnswer;
  terminal(terminal: CloudCliTurnTerminal): FrameAnswer;
  resolvedModel(alias: string): string | undefined;
  contextWindow(model: string): number | undefined;
  takeFailure(turnId: string): string | undefined;
};

export const createCloudClaudeCodeTransport = (host: CloudClaudeCodeHost): CloudClaudeCodeTransport => {
  const attempts = new Map<string, Attempt>();
  const failures = new Map<string, string>();
  const adopting = new Map<string, CloudOrchestratorCliAdoptedSession>();
  const adoptionFailed = new Set<string>();
  const hydrated = new Map<string, string>();
  let models: CloudClaudeCodeModels = { resolved: {}, windows: {} };
  void host.models
    .read()
    .then((saved) => {
      if (saved) models = { resolved: { ...saved.resolved, ...models.resolved }, windows: { ...saved.windows, ...models.windows } };
    })
    .catch(() => undefined);
  const noteModels = (event: { alias?: string; resolved?: string; windows?: Record<string, number> }) => {
    const resolved = event.alias && event.resolved ? { ...models.resolved, [event.alias]: event.resolved } : models.resolved;
    const windows = event.windows ? { ...models.windows, ...event.windows } : models.windows;
    if (JSON.stringify({ resolved, windows }) === JSON.stringify(models)) return;
    models = { resolved, windows };
    void host.models.write(models).catch(() => undefined);
  };

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
      threadId: spec.compact ? orchestratorCliCompactThreadId(turn.conversationId) : orchestratorCliThreadId(turn.conversationId),
      turnId: `${turn.turnId}.cc${attemptGeneration}`,
      attemptGeneration,
    };
    const staged = hydrated.get(spec.session.sessionKey);
    const hydrateSession = staged !== undefined && staged === spec.resumeSessionId ? staged : undefined;
    const adoptSession = spec.compact || hydrateSession ? undefined : adopting.get(turn.conversationId);
    const result = new Promise<{ text: string; sessionId: string }>((resolve, reject) => {
      attempts.set(attemptKey(identity), {
        identity,
        turn,
        spec,
        adopted: adoptSession !== undefined,
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
    const startFresh = !spec.resumeSessionId && !adoptSession && !hydrateSession;
    const prompt = isSlackConversationId(turn.conversationId) && spec.prompt.startsWith("/") ? ` ${spec.prompt}` : spec.prompt;
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
            execution: spec.compact ? { ...turn.execution, model: spec.model } : turn.execution,
            prompt,
            spec: {
              systemPrompt: spec.compact ? "" : spec.systemPrompt,
              toolCatalog: spec.compact
                ? []
                : spec.tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                  })),
              ...(adoptSession ? { adoptSession } : {}),
              ...(hydrateSession ? { hydrateSession } : {}),
              ...(startFresh ? { startFresh: true as const } : {}),
              ...(spec.compact ? { compact: true as const } : {}),
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
    if (hydrateSession) hydrated.delete(spec.session.sessionKey);
    if (!spec.session.ephemeral) spec.onSessionId(identity.threadId);
    host.log("claude_code_attempt_dispatched", {
      turnId: turn.turnId,
      attemptGeneration,
      threadId: identity.threadId,
      promptChars: spec.prompt.length,
      tools: spec.tools.length,
      adopted: Boolean(adoptSession),
      hydrated: Boolean(hydrateSession),
      startFresh,
      compact: Boolean(spec.compact),
      dispatchMs: Math.round(performance.now() - started),
    });
    return await result;
  };

  const resume: NonNullable<ClaudeCodeTransport["resume"]> = async (session: ClaudeCodeSessionRef, args) => {
    if (args.held) return { sessionId: args.held };
    if (session.role !== "orchestrator" || session.ephemeral) return {};
    const turn = await host.turn(AbortSignal.timeout(60_000));
    if (adoptionFailed.has(turn.conversationId)) return {};
    const adoption = await host.adoption(turn).catch(() => null);
    if (!adoption) return {};
    adopting.set(turn.conversationId, adoption);
    host.log("claude_code_session_adopted", { turnId: turn.turnId, deviceId: adoption.deviceId });
    return { sessionId: adoption.sessionId, restored: true };
  };

  const hydrate: NonNullable<ClaudeCodeTransport["hydrate"]> = async (session, transcript) => {
    if (session.role !== "orchestrator") {
      throw new Error("In the cloud, Claude Code runs only Stella's own turns; her agents run in containers of their own.");
    }
    const turn = await host.turn(AbortSignal.timeout(60_000));
    const sessionId = crypto.randomUUID();
    const text = transcript({ sessionId, cwd: "/", version: "unknown" });
    await host.stageSession(turn, sessionId, text);
    hydrated.set(session.sessionKey, sessionId);
    host.log("claude_code_session_hydrated", {
      turnId: turn.turnId,
      sessionId,
      bytes: text.length,
      compact: Boolean(session.ephemeral),
    });
    return sessionId;
  };

  const find = (identity: CloudCliTurnIdentity): Attempt | undefined => {
    const attempt = attempts.get(attemptKey(identity));
    return attempt && sameCliTurnIdentity(attempt.identity, identity) && !attempt.finished ? attempt : undefined;
  };

  return {
    runTurn,
    resume,
    hydrate,
    resolvedModel: (alias) => models.resolved[alias],
    contextWindow: (model) => models.windows[model],
    close: (session) => {
      hydrated.delete(session.sessionKey);
    },
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
      if (host.inlineImages) {
        outcome = { ...outcome, content: [...(await host.inlineImages(outcome.content))] };
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
        } else if (event.type === "models") {
          noteModels(event);
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
      } else if (terminal.error?.startsWith(CLOUD_CLI_SESSION_LOST_MARK)) {
        if (attempt.adopted) adoptionFailed.add(attempt.turn.conversationId);
        host.log("claude_code_session_lost", { turnId: attempt.turn.turnId, detail: terminal.error.slice(0, 500) });
        const error: Error & { code?: string } = new Error(terminal.error.slice(CLOUD_CLI_SESSION_LOST_MARK.length).trim());
        error.code = CLAUDE_CODE_SESSION_LOST;
        settle(attempt, { ok: false, error });
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
