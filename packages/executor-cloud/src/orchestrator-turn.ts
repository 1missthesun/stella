import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import {
  CLOUD_CLI_SESSION_LOST_MARK,
  CLOUD_ORCHESTRATOR_BROKER_PATHS,
  parseCloudOrchestratorCliTurnSpec,
  type CloudCliAssistantMessage,
  type CloudCliUsage,
  type CloudOrchestratorEvent,
  type CloudOrchestratorEventBatch,
  type CloudOrchestratorToolCallRequest,
  type CloudOrchestratorToolResult,
} from "@stella/contracts/cloud-orchestrator-cli";
import {
  buildClaudeCodeNativeToolRuntimePrompt,
  createClaudeNativeToolUseCorrelator,
  getClaudeCodeStatusChangeFromStreamEvent,
} from "@stella/runtime/kernel/integrations/claude-code-session-runtime.js";
import { createClaudeCodeToolMcpHost } from "@stella/runtime/kernel/integrations/claude-code-tool-mcp-host.js";
import { createClaudeCodeCompactionDetector } from "@stella/runtime/kernel/integrations/claude-code-compaction.js";
import {
  TOOL_RESULT_AUTHORIZED_IMAGES,
  type AuthorizedToolImage,
  type ToolResult,
} from "@stella/runtime/kernel/tools/types.js";
import {
  commitTurnStateBeforeTranscript,
  createBuilderFallbackAgentTurnResult,
  previousNativeStateIntegrityKeys,
  type AgentTurnInput,
  type AgentTurnResult,
} from "./agent-turn.js";
import { parseAuthoritativeAgentHistory } from "./agent-history.js";
import {
  CLOUD_CLAUDE_MCP_SERVER_NAME,
  cloudClaudeRoleProfile,
  nativeHistoryCursorFromMessages,
  nativeHistoryCursorFromRows,
  parseCloudClaudeAccountInput,
  runNativeAgentTurn,
  type ClaudeStreamJsonEvent,
} from "./native-agent-turn.js";
import { createNativeTurnCancellation } from "./turn-cancellation.js";
import type { TurnCredentialBrokerClient } from "./turn-credential-broker.js";

export type OrchestratorTurnInput = Extract<
  AgentTurnInput,
  { role: "orchestrator" }
>;

type Usage = AgentTurnResult["usage"];
type Broker = Pick<TurnCredentialBrokerClient, "postJson">;

const EMPTY_USAGE: Usage = { inputTokens: 0, outputTokens: 0, llmCalls: 0 };
export const ORCHESTRATOR_EVENT_BATCH_MS = 500;
const BROKER_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000, 4_000];
const MCP_TOOL_PREFIX = `mcp__${CLOUD_CLAUDE_MCP_SERVER_NAME}__`;

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const numberAt = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export class OrchestratorTurnInactiveError extends Error {
  constructor(message = "This chat turn is no longer active.") {
    super(message);
    this.name = "OrchestratorTurnInactiveError";
  }
}

export const postToBrokerWithRetry = async (
  broker: Broker,
  target: string,
  body: unknown,
  sleep: (ms: number) => Promise<void> = (ms) =>
    Effect.runPromise(Effect.sleep(ms)),
): Promise<Response> => {
  for (let attempt = 0; ; attempt += 1) {
    const response = await broker.postJson(target, body);
    const retryable = response.status === 503 || response.status === 429;
    const delay = BROKER_RETRY_DELAYS_MS[attempt];
    if (!retryable || delay === undefined) return response;
    await response.body?.cancel().catch(() => undefined);
    await sleep(delay);
  }
};

const isTurnOverStatus = (status: number): boolean =>
  status === 410 || status === 409;

export class OrchestratorEventLane {
  #pending: CloudOrchestratorEvent[] = [];
  #batchSeq = 0;
  #chain: Promise<void> = Promise.resolve();
  #batchWindow: Fiber.Fiber<void> | undefined;
  #failure: Error | undefined;

  constructor(
    private readonly broker: Broker,
    private readonly onFatal: (error: Error) => void,
    private readonly batchMs = ORCHESTRATOR_EVENT_BATCH_MS,
  ) {}

  get failure(): Error | undefined {
    return this.#failure;
  }

  emit(event: CloudOrchestratorEvent): void {
    if (this.#failure) return;
    const last = this.#pending.at(-1);
    if (event.type === "usage" && last?.type === "usage") {
      this.#pending[this.#pending.length - 1] = event;
    } else {
      this.#pending.push(event);
    }
    this.#batchWindow ??= Effect.runFork(
      Effect.sleep(this.batchMs).pipe(
        Effect.flatMap(() =>
          Effect.sync(() => {
            this.#batchWindow = undefined;
            void this.flush();
          }),
        ),
      ),
    );
  }

  flush(): Promise<void> {
    if (this.#batchWindow) {
      const window = this.#batchWindow;
      this.#batchWindow = undefined;
      window.interruptUnsafe();
    }
    if (this.#pending.length > 0 && !this.#failure) {
      const batch: CloudOrchestratorEventBatch = {
        batchSeq: ++this.#batchSeq,
        events: this.#pending,
      };
      this.#pending = [];
      this.#chain = this.#chain.then(() => this.#post(batch));
    }
    return this.#chain;
  }

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    void this.flush();
    const run = this.#chain.then(() => {
      if (this.#failure) throw this.#failure;
      return task();
    });
    this.#chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  #fail(error: Error): void {
    if (this.#failure) return;
    this.#failure = error;
    this.#pending = [];
    this.onFatal(error);
  }

  async #post(batch: CloudOrchestratorEventBatch): Promise<void> {
    if (this.#failure) return;
    let response: Response;
    try {
      response = await postToBrokerWithRetry(
        this.broker,
        CLOUD_ORCHESTRATOR_BROKER_PATHS.events,
        batch,
      );
    } catch (error) {
      this.#fail(
        new Error(
          `Stella lost this chat turn's event stream: ${asError(error).message}`,
        ),
      );
      return;
    }
    await response.body?.cancel().catch(() => undefined);
    if (response.ok) return;
    this.#fail(
      response.status === 410
        ? new OrchestratorTurnInactiveError()
        : new Error(
            `Stella couldn't deliver this chat turn's events (${response.status}).`,
          ),
    );
  }
}

type OpenAssistantMessage = {
  id: string;
  model: string;
  content: CloudCliAssistantMessage["content"];
  toolUseIds: string[];
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  stopReason?: string;
};

const mergeUsage = (
  target: OpenAssistantMessage["usage"],
  value: unknown,
): void => {
  const usage = asRecord(value);
  if (!usage) return;
  target.input = numberAt(usage.input_tokens) ?? target.input;
  target.output = numberAt(usage.output_tokens) ?? target.output;
  target.cacheRead =
    numberAt(usage.cache_read_input_tokens) ?? target.cacheRead;
  target.cacheWrite =
    numberAt(usage.cache_creation_input_tokens) ?? target.cacheWrite;
};

const stopReasonOf = (
  value: string | undefined,
): Pick<CloudCliAssistantMessage, "stopReason" | "errorMessage"> => {
  switch (value) {
    case "end_turn":
    case "stop_sequence":
    case "pause_turn":
      return { stopReason: "stop" };
    case "tool_use":
      return { stopReason: "toolUse" };
    case "max_tokens":
    case "model_context_window_exceeded":
      return { stopReason: "length" };
    case "refusal":
      return {
        stopReason: "error",
        errorMessage: "The model stopped this response.",
      };
    default:
      return { stopReason: "aborted" };
  }
};

export class CliAssistantAssembler {
  #open: OpenAssistantMessage | undefined;
  #journaled = new Set<string>();
  #waiters = new Map<string, Array<() => void>>();
  #closed = false;
  #inputTokens = 0;
  #outputTokens = 0;
  #llmCalls = 0;

  constructor(
    private readonly emit: (event: CloudOrchestratorEvent) => void,
    private readonly fallbackModel: string,
  ) {}

  readonly #compaction = createClaudeCodeCompactionDetector();

  observe(event: ClaudeStreamJsonEvent): void {
    if (
      event.type === "system" &&
      event.subtype === "init" &&
      typeof event.model === "string" &&
      event.model
    ) {
      this.emit({ type: "models", alias: this.fallbackModel, resolved: event.model });
    }
    if (event.type === "result") {
      const usage = asRecord(event.modelUsage);
      const windows = Object.fromEntries(
        Object.entries(usage ?? {}).flatMap(([model, entry]) => {
          const window = numberAt(asRecord(entry)?.contextWindow);
          return window && window > 0 ? [[model, window]] : [];
        }),
      );
      if (Object.keys(windows).length > 0) this.emit({ type: "models", windows });
    }
    const compaction = this.#compaction(event as Record<string, unknown>);
    if (compaction) {
      this.emit({
        type: "compaction",
        id: compaction.id,
        summary: compaction.summary,
        ...(compaction.preservedMessages !== undefined
          ? { preservedMessages: compaction.preservedMessages }
          : {}),
      });
    }
    const status = getClaudeCodeStatusChangeFromStreamEvent(event);
    if (status) {
      this.emit({
        type: "status",
        state: status.state === "compacting" ? "compacting" : "running",
        text: status.text,
      });
      return;
    }
    if (event.type === "stream_event") {
      const source = asRecord(event.event);
      if (source?.type === "message_start") {
        const message = asRecord(source.message);
        this.#start(message);
      } else if (source?.type === "message_delta" && this.#open) {
        const delta = asRecord(source.delta);
        if (typeof delta?.stop_reason === "string") {
          this.#open.stopReason = delta.stop_reason;
        }
        mergeUsage(this.#open.usage, source.usage);
      } else if (source?.type === "message_stop") {
        this.#finalize();
      }
      return;
    }
    if (event.type === "assistant") {
      const message = asRecord(event.message);
      const id = typeof message?.id === "string" ? message.id : "";
      if (!this.#open || this.#open.id !== id) this.#start(message);
      const open = this.#open!;
      if (!Array.isArray(message?.content)) return;
      for (const raw of message.content) {
        const block = asRecord(raw);
        if (block?.type === "text" && typeof block.text === "string") {
          open.content.push({ type: "text", text: block.text });
        } else if (
          block?.type === "thinking" &&
          typeof block.thinking === "string"
        ) {
          open.content.push({
            type: "thinking",
            thinking: block.thinking,
            ...(typeof block.signature === "string"
              ? { thinkingSignature: block.signature }
              : {}),
          });
        } else if (
          block?.type === "redacted_thinking" &&
          typeof block.data === "string"
        ) {
          open.content.push({
            type: "thinking",
            thinking: "",
            thinkingSignature: block.data,
            redacted: true,
          });
        } else if (
          block?.type === "tool_use" &&
          typeof block.id === "string" &&
          typeof block.name === "string"
        ) {
          open.toolUseIds.push(block.id);
          open.content.push({
            type: "toolCall",
            id: block.id,
            name: block.name.startsWith(MCP_TOOL_PREFIX)
              ? block.name.slice(MCP_TOOL_PREFIX.length)
              : block.name,
            arguments: asRecord(block.input) ?? {},
          });
        }
      }
      return;
    }
    if (event.type === "result") this.#finalize();
  }

  waitForToolUse(toolUseId: string, signal?: AbortSignal): Promise<void> {
    if (this.#closed || this.#journaled.has(toolUseId)) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const entries = this.#waiters.get(toolUseId) ?? [];
      const onAbort = () => {
        const index = entries.indexOf(done);
        if (index >= 0) entries.splice(index, 1);
        reject(signal?.reason ?? new Error("Tool call aborted."));
      };
      const done = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      entries.push(done);
      this.#waiters.set(toolUseId, entries);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }

  get usage(): Usage {
    return {
      inputTokens: this.#inputTokens,
      outputTokens: this.#outputTokens,
      llmCalls: this.#llmCalls,
    };
  }

  close(): void {
    this.#finalize();
    this.#closed = true;
    for (const entries of this.#waiters.values()) {
      for (const resolve of entries.splice(0)) resolve();
    }
    this.#waiters.clear();
  }

  #start(message: Record<string, unknown> | null): void {
    this.#finalize();
    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    mergeUsage(usage, message?.usage);
    this.#open = {
      id: typeof message?.id === "string" ? message.id : "",
      model:
        typeof message?.model === "string" && message.model
          ? message.model
          : this.fallbackModel,
      content: [],
      toolUseIds: [],
      usage,
    };
  }

  #finalize(): void {
    const open = this.#open;
    this.#open = undefined;
    if (!open || open.content.length === 0) return;
    const usage: CloudCliUsage = {
      input: open.usage.input,
      output: open.usage.output,
      cacheRead: open.usage.cacheRead,
      cacheWrite: open.usage.cacheWrite,
      totalTokens:
        open.usage.input +
        open.usage.output +
        open.usage.cacheRead +
        open.usage.cacheWrite,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    this.emit({
      type: "assistant_message",
      message: {
        role: "assistant",
        content: open.content,
        api: "claude-code",
        provider: "anthropic",
        model: open.model,
        ...(open.id ? { responseId: open.id } : {}),
        usage,
        ...stopReasonOf(open.stopReason),
        timestamp: Date.now(),
      },
    });
    this.#llmCalls += 1;
    this.#inputTokens += usage.input + usage.cacheRead + usage.cacheWrite;
    this.#outputTokens += usage.output;
    this.emit({
      type: "usage",
      inputTokens: this.#inputTokens,
      outputTokens: this.#outputTokens,
      llmCalls: this.#llmCalls,
    });
    for (const id of open.toolUseIds) {
      this.#journaled.add(id);
      const entries = this.#waiters.get(id);
      this.#waiters.delete(id);
      for (const resolve of entries ?? []) resolve();
    }
  }
}

const AUTHORIZED_IMAGE_TYPES = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export const toolResultFromOrchestrator = (
  result: CloudOrchestratorToolResult,
): ToolResult => {
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .flatMap((block) =>
      block?.type === "text" && typeof block.text === "string"
        ? [block.text]
        : [],
    )
    .join("\n");
  if (result.isError) {
    return { error: text || "The tool failed." };
  }
  const images: AuthorizedToolImage[] = content.flatMap((block) =>
    block?.type === "image" &&
    typeof block.data === "string" &&
    AUTHORIZED_IMAGE_TYPES.has(block.mimeType)
      ? [
          {
            data: Buffer.from(block.data, "base64"),
            mimeType: block.mimeType as AuthorizedToolImage["mimeType"],
            sourcePath: "stella-orchestrator-tool",
          },
        ]
      : [],
  );
  return {
    result: text,
    ...(images.length > 0 ? { [TOOL_RESULT_AUTHORIZED_IMAGES]: images } : {}),
  };
};

export const readOrchestratorToolResponse = async (
  response: Response,
  toolName: string,
): Promise<ToolResult> => {
  if (isTurnOverStatus(response.status)) {
    await response.body?.cancel().catch(() => undefined);
    throw new OrchestratorTurnInactiveError();
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Stella couldn't run ${toolName} (${response.status}).`);
  }
  const body = asRecord(await response.json().catch(() => null));
  if (body?.ok === true) {
    const result = asRecord(body.result);
    if (result && Array.isArray(result.content)) {
      return toolResultFromOrchestrator(
        result as unknown as CloudOrchestratorToolResult,
      );
    }
  } else if (body?.ok === false) {
    const error = asRecord(body.error);
    const message =
      typeof error?.message === "string" && error.message
        ? error.message
        : `Stella refused ${toolName}.`;
    if (error?.code === "turn_inactive") {
      throw new OrchestratorTurnInactiveError(message);
    }
    throw new Error(message);
  }
  throw new Error(`Stella returned an unreadable result for ${toolName}.`);
};

const failed = (error: string): AgentTurnResult => ({
  ok: false,
  finalText: "",
  error,
  usage: EMPTY_USAGE,
  checkpointPolicy: "preserve_prior",
});

export const runOrchestratorTurn = async (args: {
  input: OrchestratorTurnInput;
  broker: TurnCredentialBrokerClient;
}): Promise<AgentTurnResult> => {
  const { input, broker } = args;
  const spec = parseCloudOrchestratorCliTurnSpec({
    systemPrompt: input.systemPrompt,
    toolCatalog: input.toolCatalog,
    quiet: input.quiet,
    startFresh: input.startFresh,
    compact: input.compact,
  });
  if (!spec) {
    return failed(
      "Stella couldn't validate this chat turn's tools. Try again.",
    );
  }
  const claudeAccount = parseCloudClaudeAccountInput(input.claudeAccount);
  const execution = input.execution;
  if (!claudeAccount || execution.engine !== "anthropic") {
    return failed(
      "Stella couldn't validate this chat turn's Claude access. Try again.",
    );
  }
  if (!/^[0-9a-f]{64}$/.test(input.nativeStateIntegrityKey)) {
    return failed(
      "Stella couldn't validate this chat's Claude session state. Try again.",
    );
  }
  try {
    parseAuthoritativeAgentHistory(input.history ?? []);
  } catch (error) {
    console.error(
      `authoritative orchestrator history rejected: ${asError(error).message}`,
    );
    return failed("Stella couldn't validate this chat's history. Try again.");
  }
  if (
    input.rebuildNativeSession === true &&
    !input.adoptedNativeSession &&
    !spec.startFresh &&
    (input.history?.length ?? 0) > 0
  ) {
    return failed(
      `${CLOUD_CLI_SESSION_LOST_MARK} This chat's Claude Code session is not in the cloud any more.`,
    );
  }

  const turnCancellation = createNativeTurnCancellation();
  const abortTurn = (error: Error): void => {
    turnCancellation.abort(error);
  };
  const lane = new OrchestratorEventLane(broker, abortTurn);
  const assembler = new CliAssistantAssembler(
    (event) => lane.emit(event),
    execution.model,
  );
  const correlator = createClaudeNativeToolUseCorrelator();
  const identityScope = `${input.threadId}:${input.turnId}`;

  const executeTool = async (
    toolCallId: string,
    name: string,
    toolArgs: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<ToolResult> => {
    await assembler.waitForToolUse(toolCallId, signal);
    const request: CloudOrchestratorToolCallRequest = {
      toolCallId,
      name,
      args: toolArgs,
    };
    let response: Response;
    try {
      response = await lane.enqueue(() =>
        postToBrokerWithRetry(
          broker,
          CLOUD_ORCHESTRATOR_BROKER_PATHS.tool,
          request,
        ),
      );
    } catch (error) {
      const lost =
        lane.failure ??
        new Error(
          `Stella lost this chat turn's tool channel: ${asError(error).message}`,
        );
      abortTurn(lost);
      throw lost;
    }
    try {
      return await readOrchestratorToolResponse(response, name);
    } catch (error) {
      if (error instanceof OrchestratorTurnInactiveError) abortTurn(error);
      throw error;
    }
  };

  let mcpHost: Awaited<ReturnType<typeof createClaudeCodeToolMcpHost>>;
  try {
    mcpHost = await createClaudeCodeToolMcpHost({
      tools: spec.toolCatalog,
      identityScope,
      allowLegacyImagePathReopen: false,
      getActiveTurn: () => ({
        identityScope,
        nativeToolCallIds: true,
        claimNativeToolUseId: (toolName, toolArgs, signal) =>
          correlator.claim(toolName, toolArgs, signal),
        checkToolUseIntegrity: (toolName, toolArgs, signal) =>
          correlator.resolveToolUseIntegrity(toolName, toolArgs, signal),
        executeTool,
      }),
    });
  } catch (error) {
    return failed(
      `Stella couldn't prepare this chat turn's tools: ${asError(error).message}`,
    );
  }

  let finalText = "";
  let error: string | undefined;
  let usage: Usage = EMPTY_USAGE;
  let historyCursor: string;
  let transcriptRows: Array<{
    ordinal: number;
    role: string;
    payloadJson: string;
  }>;
  let nativeCheckpoint:
    | Awaited<ReturnType<typeof runNativeAgentTurn>>["nativeStateCheckpoint"]
    | undefined;
  try {
    let native: Awaited<ReturnType<typeof runNativeAgentTurn>>;
    try {
      native = await runNativeAgentTurn({
        profile: cloudClaudeRoleProfile({
          role: "orchestrator",
          threadId: input.threadId,
          conversationId: input.conversationId,
        }),
        prompt: input.prompt,
        systemPrompt: spec.compact
          ? ""
          : buildClaudeCodeNativeToolRuntimePrompt(spec.systemPrompt),
        execution,
        claudeAccount,
        threadId: input.threadId,
        turnId: input.turnId,
        authoritativeHistoryCursor: nativeHistoryCursorFromRows(
          input.history ?? [],
        ),
        stateIntegrityKey: input.nativeStateIntegrityKey,
        previousStateIntegrityKeys: previousNativeStateIntegrityKeys(input),
        ...(spec.startFresh
          ? { fresh: true }
          : input.rebuildNativeSession === true
            ? { recoveryHistory: input.history ?? [] }
            : {}),
        ...(!spec.startFresh &&
        input.rebuildNativeSession !== true &&
        input.adoptedNativeSession
          ? {
              adoptedSession: input.adoptedNativeSession,
              history: input.history ?? [],
            }
          : {}),
        claudeMcpServerConfig: mcpHost.mcpServerConfig,
        cancellation: turnCancellation,
        ...(spec.quiet ? { quiet: true } : {}),
        onStreamEvent: (event) => {
          correlator.observeStreamEvent(event);
          if (event.type === "assistant") {
            correlator.observeAssistantMessage(event);
            const content = asRecord(event.message)?.content;
            for (const raw of Array.isArray(content) ? content : []) {
              const block = asRecord(raw);
              if (
                block?.type === "tool_use" &&
                typeof block.id === "string" &&
                typeof block.name === "string"
              ) {
                correlator.observe({
                  toolCallId: block.id,
                  toolName: block.name,
                  toolArgs: asRecord(block.input) ?? {},
                });
              }
            }
          }
          assembler.observe(event);
        },
      });
    } catch (runError) {
      assembler.close();
      await lane.flush();
      return failed(asError(runError).message);
    }
    if (!native.error && !spec.compact) {
      try {
        await mcpHost.waitForClientReady(undefined, 1_000);
      } catch (readyError) {
        error = asError(readyError).message;
      }
    }
    finalText = native.finalText.trim();
    error = native.error ?? error;
    assembler.close();
    usage =
      native.usage.inputTokens + native.usage.outputTokens > 0
        ? native.usage
        : assembler.usage;
    nativeCheckpoint = native.nativeStateCheckpoint;
    historyCursor = nativeHistoryCursorFromMessages(
      input.turnId,
      native.messages,
    );
    transcriptRows = native.messages.map((message, ordinal) => ({
      ordinal,
      role: (message as { role: string }).role,
      payloadJson: JSON.stringify(message),
    }));
  } finally {
    await mcpHost.close().catch((closeError) => {
      console.error(
        `orchestrator MCP close failed: ${asError(closeError).message}`,
      );
    });
  }

  assembler.close();
  lane.emit({ type: "usage", ...usage });
  await lane.flush();
  if (lane.failure && !error) error = lane.failure.message;

  let checkpointMs = 0;
  const started = performance.now();
  try {
    const receipt = await commitTurnStateBeforeTranscript({
      historyCursor,
      ...(nativeCheckpoint ? { nativeCheckpoint } : {}),
      broker,
      appendTranscript: async () => {
        const body = {
          conversationId: input.threadId,
          turnId: input.turnId,
          messages: transcriptRows,
        };
        let response = await broker.postJson("/api/cloud/messages", body);
        if (!response.ok) {
          response = await broker.postJson("/api/cloud/messages", body);
        }
        if (!response.ok) {
          throw new Error(
            `Thread transcript persist failed (${response.status}).`,
          );
        }
      },
    });
    checkpointMs = Math.round(performance.now() - started);
    return {
      ok: !error,
      finalText,
      ...(error ? { error } : {}),
      usage,
      checkpointMs,
      turnStateCheckpoint: receipt,
    };
  } catch (checkpointError) {
    console.error(
      `orchestrator checkpoint failed: ${asError(checkpointError).message}`,
    );
    return createBuilderFallbackAgentTurnResult({
      finalText,
      ...(error ? { error } : {}),
      usage,
      historyCursor,
      messages: transcriptRows,
      ...(nativeCheckpoint ? { nativeCheckpoint } : {}),
    });
  }
};
