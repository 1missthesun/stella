import type { Context } from "@earendil-works/chord";
import {
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  getCurrentTools,
  parseStreamingJson,
  Type,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type ImageContent,
  type Message,
  type Model,
  type ModelThinkingLevel,
  type SimpleStreamOptions,
  type StreamOptions,
  type TextContent,
  type ThinkingContent,
  type ToolCall,
  type TranscriptContext,
  type Usage,
} from "@earendil-works/pi-ai";
import { createProvider, type Provider } from "@earendil-works/pi-ai/models";
import {
  AgentDoc,
  CompactionTask,
  defineExtension,
  defineTool,
  GenerationTask,
  hook,
  ProviderDoc,
  ToolTask,
  wrapTool,
  type Extension,
  type ModelRef,
  type ToolExecutionApi,
  type ToolExecutionResult,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import { createHash } from "node:crypto";
import {
  CLAUDE_CODE_SERVED_SEARCH_TOOLS,
  claudeCodeServedSearchCall,
  resolveClaudeCodeToolSet,
  type ClaudeCodeServedSearchToolName,
} from "@stella/runtime/kernel/integrations/claude-code-native-tools";
import { StellaAgentDoc } from "../stella/agent-doc.ts";
import { placementOf, StellaPlacementDoc } from "../stella/placement.ts";
import { CLAUDE_CODE_ENGINE_EXTENSION, CLAUDE_CODE_PROVIDER_ID } from "./selection.ts";

export { CLAUDE_CODE_ENGINE_EXTENSION, CLAUDE_CODE_PROVIDER_ID, engineExtensionChange } from "./selection.ts";
export const CLAUDE_CODE_API = "claude-code-cli";

export const CLAUDE_CODE_BUILTIN_TOOLS = ["Read", "Edit", "Write", "Bash", "Grep", "Glob"] as const;
const ENGINE_ONLY_TOOLS = ["Grep", "Glob"] as const;
const WRAPPED_TOOLS = ["Read", "Edit", "Write", "Bash"] as const;
const MCP_PREFIX = "mcp__stella__";

export const CLAUDE_CODE_MODEL_ALIASES = [
  "default",
  "best",
  "fable",
  "opus",
  "sonnet",
  "haiku",
  "opusplan",
  "sonnet[1m]",
  "opus[1m]",
] as const;

const CLAUDE_CODE_CONTEXT_WINDOW = 100_000_000;
const CLAUDE_CODE_MAX_TOKENS = 128_000;
const SEEN_LIMIT = 400;
const REBUILD_MAX_CHARS = 48_000;
const UPDATE_MAX_MESSAGE_CHARS = 12_000;
/** How long a new turn waits for the stopped one it replaces to end. */
const SUPERSEDED_SETTLE_MS = 10_000;

export type ClaudeCodeRole = "orchestrator" | "worker";

export type ClaudeCodeSessionRef = {
  conversationId: string;
  threadId?: string;
  role: ClaudeCodeRole;
  sessionKey: string;
  cwd?: string;
};

export type ClaudeCodeToolSpec = { name: string; description: string; parameters: Record<string, unknown> };
export type ClaudeCodeToolOutcome = { content: (TextContent | ImageContent)[]; isError?: boolean };
export type ClaudeCodeStatus =
  | { state: "running" | "compacting" | "model-fallback"; text: string }
  | { state: "usage-limit"; text: string; until?: number }
  | { state: "usage-limit-end"; text: string; resumed: boolean };

/** Background commands the CLI ran that finished while it waited for no one; it started a query about them itself. */
export type ClaudeCodeBackgroundWake = {
  id: string;
  tasks: { summary: string; status?: string; outputFile?: string }[];
};

export type ClaudeCodeTurnSpec = {
  session: ClaudeCodeSessionRef;
  resumeSessionId?: string;
  model: string;
  thinkingLevel: ModelThinkingLevel;
  systemPrompt: string;
  prompt: string;
  images: ImageContent[];
  resumeFallbackPrompt: string;
  tools: ClaudeCodeToolSpec[];
  nativeTools: readonly string[];
  signal: AbortSignal;
  executeTool(toolUseId: string, name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ClaudeCodeToolOutcome>;
  onEvent(event: Record<string, unknown>): void;
  onNativeToolEnd(end: { toolUseId: string; result: string; isError: boolean }): void;
  onStatus(status: ClaudeCodeStatus): void;
  onSessionId(sessionId: string): void;
  control(turn: {
    /** Steer the running CLI; `onConsumed` once it took the input in, `onDropped` if the step ended before it did. */
    inject(input: { text: string; images: ImageContent[]; onConsumed?: () => void; onDropped?: () => void }): boolean;
    /** End the CLI's step at this tool boundary, unanswered; `toolSetAfterStep` then carries the turn on. */
    endStep(): boolean;
  }): void;
  toolSetAfterStep(): { tools: ClaudeCodeToolSpec[]; nativeTools: readonly string[]; prompt: string } | undefined;
  /** The session's CLI started a query of its own about finished background commands: the agent is woken for it. */
  onBackgroundWake(wake: ClaudeCodeBackgroundWake): void;
  /** This turn was woken for that query and takes it over; its prompt need not reach a CLI that already knows. */
  backgroundWake: boolean;
};

export type ClaudeCodeTransport = {
  runTurn(spec: ClaudeCodeTurnSpec): Promise<{ text: string; sessionId: string }>;
  preflight?(session: ClaudeCodeSessionRef): Promise<void>;
  resume?(session: ClaudeCodeSessionRef, args: { held?: string; lastReply?: string }): Promise<{ sessionId?: string; restored?: boolean }>;
  close?(session: ClaudeCodeSessionRef): void;
};

/**
 * `seen`: messages the CLI has, by key. `undelivered`: messages that reached
 * Stella's transcript but never the CLI (a stop or pause ended its step
 * before it took them in); the next turn carries them.
 */
export type ClaudeCodeSessionRecord = { cliSessionId?: string; seen: string[]; undelivered?: string[] };
export type ClaudeCodeSessionStore = {
  read(piSessionId: string): Promise<ClaudeCodeSessionRecord | undefined>;
  write(piSessionId: string, record: ClaudeCodeSessionRecord): Promise<void>;
};

type Binding = {
  session: ClaudeCodeSessionRef;
  toolsRemote: boolean;
  /** The host runs a served Grep and Glob where the tools are (`ClaudeCodeExtensionOptions.searchElsewhere`). */
  servesSearch: boolean;
  piConversationId: number;
};

/**
 * What the host gives one conversation's engine extension: a served Grep or
 * Glob, as the device `Grep`, run where the conversation's tools run now;
 * undefined when they run on this computer.
 */
export type ClaudeCodeExtensionOptions = {
  searchElsewhere?(
    call: { toolName: "Grep"; params: Record<string, unknown> },
    api: ToolExecutionApi,
    context: Context,
  ): Promise<ToolExecutionResult | undefined>;
};

type QueueItem = { kind: "event"; event: Record<string, any> } | { kind: "end" };

type CallRecord = {
  turn: Turn;
  name: string;
  native: boolean;
  truncated?: string;
};

type NativeResult = { text: string; isError: boolean };

type Turn = {
  id: string;
  session: Session;
  abort: AbortController;
  done: boolean;
  /** Resolves once `done`: its CLI step ended and said what it never took in. */
  settled: Promise<void>;
  settle: () => void;
  outcome?: { ok: true; text: string } | { ok: false; error: unknown };
  queue: QueueItem[];
  wake?: () => void;
  callIds: Set<string>;
  prompted?: Message[];
  unsent: Message[];
  waiting: Map<string, (outcome: ClaudeCodeToolOutcome) => void>;
  early: Map<string, ClaudeCodeToolOutcome>;
  inject?: (input: { text: string; images: ImageContent[]; onConsumed?: () => void; onDropped?: () => void }) => boolean;
  endStep?: () => boolean;
  toolSet: { tools: ClaudeCodeToolSpec[]; nativeTools: readonly string[] };
  nextToolSet?: { tools: ClaudeCodeToolSpec[]; nativeTools: readonly string[] };
  /** Tool results the CLI's ended step never read; the next step is told them. */
  carried?: Message[];
};

type TurnRequest = {
  model: Model<Api>;
  messages: Message[];
  systemPrompt: string;
  tools: ClaudeCodeToolSpec[];
  nativeTools: readonly string[];
  thinkingLevel: ModelThinkingLevel;
  prompt?: { text: string; images: ImageContent[] };
  /** The messages `prompt` carries. */
  steered?: Message[];
};

type Session = {
  piSessionId: string;
  binding: Binding;
  request?: TurnRequest;
  record?: ClaudeCodeSessionRecord;
  turn?: Turn;
  cliSessionId?: string;
  /** Wake messages sent to the agent for its CLI's own queries, not yet taken in. */
  wakes?: Set<string>;
};

const ZERO_USAGE = (): Usage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

const asRecord = (value: unknown): Record<string, any> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : undefined;

const errorText = (error: unknown): string =>
  error instanceof Error && error.message.trim() ? error.message.trim() : String(error ?? "Claude Code failed.");

export const CLAUDE_CODE_ERROR_MARK = /^\[claude-code\/([a-z-]+)\]\s*/;

const markedError = (error: unknown): string => {
  const code = (error as { code?: unknown })?.code;
  const message = errorText(error);
  if (code === "CLAUDE_CODE_AUTH_REAUTH_REQUIRED") return `[claude-code/login-required] ${message}`;
  if (code === "CLAUDE_CODE_USAGE_LIMIT") return `[claude-code/usage-limit] ${message}`;
  return message;
};

const textOf = (content: string | readonly (TextContent | ImageContent | ThinkingContent | ToolCall)[]): string =>
  typeof content === "string"
    ? content
    : content
        .map((part) => (part.type === "text" ? part.text : ""))
        .filter((text) => text.length > 0)
        .join("\n\n");

const imagesOf = (content: Message["content"]): ImageContent[] =>
  typeof content === "string" ? [] : (content as { type: string }[]).filter((part): part is ImageContent => part.type === "image");

const hash = (value: string): string => createHash("sha256").update(value).digest("hex").slice(0, 32);

const messageKey = (message: Message): string | undefined => {
  switch (message.role) {
    case "system":
      return undefined;
    case "toolResult":
      return hash(`toolResult\0${message.toolCallId}`);
    case "user":
      return hash(`user\0${message.timestamp}\0${textOf(message.content)}\0${imagesOf(message.content).length}`);
    case "assistant": {
      if (message.responseId) return hash(`assistant\0${message.responseId}`);
      const calls = message.content.filter((part): part is ToolCall => part.type === "toolCall").map((call) => call.id);
      return hash(`assistant\0${message.timestamp}\0${textOf(message.content)}\0${calls.join(",")}`);
    }
  }
};

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}\n[...truncated]` : text);

const backgroundWakeText = (wake: ClaudeCodeBackgroundWake): string =>
  [
    wake.tasks.length === 1
      ? "[wake: a command you left running in the background has finished.]"
      : `[wake: ${wake.tasks.length} commands you left running in the background have finished.]`,
    "",
    ...wake.tasks.map((task) => `- ${task.summary}${task.outputFile ? `\n  Output: ${task.outputFile}` : ""}`),
    "",
    "You were resumed for this. Continue the work that was waiting on it, or say what you found.",
  ].join("\n");

const toolSetKey = (set: { tools: readonly ClaudeCodeToolSpec[]; nativeTools: readonly string[] }): string =>
  JSON.stringify([set.nativeTools, set.tools.map((tool) => tool.name)]);

const TOOLS_MOVED_PROMPT = "Your file and shell tools changed where they run; use the tools you have now and carry on with the task.";

const movedPrompt = (carried: readonly Message[] | undefined): string => {
  const results = carried ? renderBounded(carried, REBUILD_MAX_CHARS) : "";
  return results
    ? `${TOOLS_MOVED_PROMPT}\n\n<tool_results>\nWhat the calls you just made returned. They finished before the switch; do not repeat them:\n\n${results}\n</tool_results>`
    : TOOLS_MOVED_PROMPT;
};

const renderMessage = (message: Message): string | undefined => {
  switch (message.role) {
    case "system":
      return undefined;
    case "user": {
      const text = textOf(message.content).trim();
      const images = imagesOf(message.content).length;
      if (!text && images === 0) return undefined;
      return `[user]\n${clip(text, UPDATE_MAX_MESSAGE_CHARS)}${images ? `\n[${images} image(s)]` : ""}`;
    }
    case "assistant": {
      const text = textOf(message.content).trim();
      const calls = message.content.filter((part): part is ToolCall => part.type === "toolCall");
      const lines = [
        ...(text ? [clip(text, UPDATE_MAX_MESSAGE_CHARS)] : []),
        ...calls.map((call) => `(called ${call.name} ${clip(JSON.stringify(call.arguments), 2_000)})`),
      ];
      return lines.length > 0 ? `[assistant]\n${lines.join("\n")}` : undefined;
    }
    case "toolResult":
      return `[${message.toolName} result${message.isError ? ", failed" : ""}]\n${clip(textOf(message.content), 4_000)}`;
  }
};

const renderBounded = (messages: readonly Message[], max: number): string => {
  const out: string[] = [];
  let size = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const rendered = renderMessage(messages[index]!);
    if (!rendered) continue;
    if (size + rendered.length > max && out.length > 0) {
      out.push("[earlier conversation omitted]");
      break;
    }
    out.push(rendered);
    size += rendered.length;
  }
  return out.reverse().join("\n\n");
};

const trailingUsers = (messages: readonly Message[]): { start: number; users: Message[] } => {
  let start = messages.length;
  while (start > 0 && messages[start - 1]!.role === "user") start -= 1;
  return { start, users: messages.slice(start) };
};

const userPrompt = (users: readonly Message[]): { text: string; images: ImageContent[] } => ({
  text: users
    .map((message) => textOf(message.content).trim())
    .filter(Boolean)
    .join("\n\n"),
  images: users.flatMap((message) => imagesOf(message.content)),
});

const rebuildPrompt = (messages: readonly Message[]): { text: string; images: ImageContent[] } => {
  const { start, users } = trailingUsers(messages);
  const history = renderBounded(messages.slice(0, start), REBUILD_MAX_CHARS);
  const request = userPrompt(users);
  const text = [
    history
      ? `<conversation_history>\nThe conversation so far, for reference; it already happened.\n\n${history}\n</conversation_history>`
      : "",
    request.text || (users.length === 0 ? "Continue from where the conversation left off." : ""),
  ]
    .filter(Boolean)
    .join("\n\n");
  return { text, images: request.images };
};

const deltaPrompt = (delta: readonly Message[]): { text: string; images: ImageContent[] } => {
  const { start, users } = trailingUsers(delta);
  const before = delta.slice(0, start);
  const request = userPrompt(users);
  const interrupted = before.some((message) => message.role === "toolResult");
  const update = before.length > 0 ? renderBounded(before, REBUILD_MAX_CHARS) : "";
  const text = [
    update
      ? `<conversation_updates>\n${
          interrupted
            ? "Your previous step was interrupted (stopped, paused, or Stella restarted). What happened since, including the results of the tool calls you made; do not repeat them:"
            : "What happened in this conversation since you last saw it:"
        }\n\n${update}\n</conversation_updates>`
      : "",
    request.text || (users.length === 0 ? "Continue the task from here." : ""),
  ]
    .filter(Boolean)
    .join("\n\n");
  return { text, images: request.images };
};

const toolSpec = (tool: { name: string; description: string; parameters: unknown }): ClaudeCodeToolSpec => ({
  name: tool.name,
  description: tool.description,
  parameters: (asRecord(tool.parameters) ?? { type: "object", properties: {} }) as Record<string, unknown>,
});

const thinkingLevelOf = (options: SimpleStreamOptions | undefined): ModelThinkingLevel =>
  (options?.reasoning as ModelThinkingLevel | undefined) ?? "off";

export type ClaudeCodeEngineOptions = {
  transport: ClaudeCodeTransport;
  sessions: ClaudeCodeSessionStore;
  /**
   * `never`: the CLI keeps none of its built-ins, so every file and shell
   * call is a Stella tool that runs where the conversation's tools run (the
   * cloud's CLI runs apart from them). Default `here`: built-ins run where
   * the CLI does while the tools are local.
   */
  builtins?: "here" | "never";
  report?(error: unknown): void;
};

export type ClaudeCodeEngine = ReturnType<typeof createClaudeCodeEngine>;

export function createClaudeCodeEngine(options: ClaudeCodeEngineOptions) {
  const report = options.report ?? ((error: unknown) => console.error("[claude-code-engine]", error));
  const sessions = new Map<string, Session>();
  const calls = new Map<string, CallRecord>();
  const nativeResults = new Map<string, NativeResult>();
  const nativeWaiters = new Map<string, Set<(result: NativeResult) => void>>();
  const statusListeners = new Set<(session: ClaudeCodeSessionRef, status: ClaudeCodeStatus) => void>();
  const wakeListeners = new Set<(session: ClaudeCodeSessionRef, wake: { key: string; text: string }) => void>();
  const modelIds = new Set<string>(CLAUDE_CODE_MODEL_ALIASES);
  let providerListener: ((provider: Provider) => void) | undefined;

  const model = (id: string): Model<Api> =>
    ({
      id,
      name: id === "default" ? "Claude Code" : `Claude Code · ${id}`,
      api: CLAUDE_CODE_API,
      provider: CLAUDE_CODE_PROVIDER_ID,
      baseUrl: "",
      reasoning: true,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: CLAUDE_CODE_CONTEXT_WINDOW,
      maxTokens: CLAUDE_CODE_MAX_TOKENS,
    }) as Model<Api>;

  const settleNative = (toolUseId: string, result: NativeResult) => {
    const waiters = nativeWaiters.get(toolUseId);
    if (waiters) {
      nativeWaiters.delete(toolUseId);
      for (const resolve of waiters) resolve(result);
      return;
    }
    nativeResults.set(toolUseId, result);
  };

  const push = (turn: Turn, item: QueueItem) => {
    turn.queue.push(item);
    const wake = turn.wake;
    turn.wake = undefined;
    wake?.();
  };

  const saveRecord = async (session: Session) => {
    const record = session.record;
    if (!record) return;
    if (record.seen.length > SEEN_LIMIT) record.seen.splice(0, record.seen.length - SEEN_LIMIT);
    await options.sessions.write(session.piSessionId, record).catch(report);
  };

  const noteSeen = (session: Session, messages: readonly Message[]) => {
    const record = (session.record ??= { seen: [] });
    for (const message of messages) {
      const key = messageKey(message);
      if (key && !record.seen.includes(key)) record.seen.push(key);
      const undelivered = key ? (record.undelivered?.indexOf(key) ?? -1) : -1;
      if (undelivered >= 0) record.undelivered!.splice(undelivered, 1);
    }
    if (record.undelivered?.length === 0) delete record.undelivered;
  };

  /** Messages the CLI never took in: the next turn carries them. */
  const holdUndelivered = (session: Session, messages: readonly Message[]) => {
    if (messages.length === 0) return;
    const record = (session.record ??= { seen: [] });
    for (const message of messages) {
      const key = messageKey(message);
      if (!key) continue;
      const seenAt = record.seen.indexOf(key);
      if (seenAt >= 0) record.seen.splice(seenAt, 1);
      if (!record.undelivered?.includes(key)) (record.undelivered ??= []).push(key);
    }
    void saveRecord(session);
  };

  const finish = (turn: Turn, outcome: Turn["outcome"]) => {
    if (turn.done) return;
    turn.done = true;
    turn.outcome = outcome;
    turn.settle();
    for (const [id, record] of calls) {
      if (record.turn !== turn) continue;
      if (record.native) {
        if (!nativeResults.has(id)) settleNative(id, { text: "Claude Code stopped before this call finished.", isError: true });
        continue;
      }
      calls.delete(id);
    }
    turn.waiting.clear();
    push(turn, { kind: "end" });
  };

  const abortTurn = (turn: Turn | undefined, reason: string) => {
    if (!turn || turn.done) return;
    turn.abort.abort(new Error(reason));
  };

  const toolSetFor = (binding: Binding, tools: readonly { name: string; description: string; parameters: unknown }[]) => {
    const offered = new Set(tools.map((tool) => tool.name));
    const catalog = [
      ...tools.filter((tool) => !(ENGINE_ONLY_TOOLS as readonly string[]).includes(tool.name)).map(toolSpec),
      ...(binding.toolsRemote && binding.servesSearch
        ? CLAUDE_CODE_SERVED_SEARCH_TOOLS.filter((tool) => offered.has(tool.name)).map(
            (tool): ClaudeCodeToolSpec => ({ name: tool.name, description: tool.description, parameters: structuredClone(tool.parameters) }),
          )
        : []),
    ];
    const set = resolveClaudeCodeToolSet({
      role: binding.session.role,
      catalog,
      toolsAway: binding.toolsRemote,
    });
    const nativeTools = set.nativeTools.filter((name) => offered.has(name));
    return { tools: set.tools, nativeTools };
  };

  const startTurn = async (
    session: Session,
    request: TurnRequest,
  ): Promise<Turn> => {
    const binding = session.binding;
    await options.transport.preflight?.(binding.session);
    session.record ??= (await options.sessions.read(session.piSessionId).catch(() => undefined)) ?? { seen: [] };
    const record = session.record;
    const conversation = request.messages.filter((message) => message.role !== "system");
    const held = session.cliSessionId ?? record.cliSessionId;
    let lastReplyAt = -1;
    for (let index = conversation.length - 1; index >= 0; index -= 1) {
      const message = conversation[index]!;
      if (message.role === "assistant" && textOf(message.content).trim()) {
        lastReplyAt = index;
        break;
      }
    }
    const lastReply = lastReplyAt >= 0 ? textOf(conversation[lastReplyAt]!.content) : undefined;
    const resumed: { sessionId?: string; restored?: boolean } = options.transport.resume
      ? await options.transport
          .resume(binding.session, { ...(held ? { held } : {}), ...(lastReply !== undefined ? { lastReply } : {}) })
          .catch((error: unknown) => {
            report(error);
            return held ? { sessionId: held } : {};
          })
      : held
        ? { sessionId: held }
        : {};
    const resumeSessionId = resumed.sessionId;
    if (resumeSessionId && resumed.restored) {
      record.seen = [];
      noteSeen(session, conversation.slice(0, lastReplyAt + 1));
    }
    let seenAt = -1;
    if (resumeSessionId) {
      const seen = new Set(record.seen);
      for (let index = conversation.length - 1; index >= 0; index -= 1) {
        const key = messageKey(conversation[index]!);
        if (key && seen.has(key)) {
          seenAt = index;
          break;
        }
      }
    }
    const { users: arrived } = trailingUsers(conversation);
    const wakes = session.wakes;
    const backgroundWake =
      !request.prompt && arrived.length > 0 && arrived.every((message) => wakes?.has(textOf(message.content).trim()) === true);
    if (backgroundWake) for (const message of arrived) wakes?.delete(textOf(message.content).trim());
    const rebuild = rebuildPrompt(conversation);
    const steering = request.prompt && resumeSessionId;
    const delta = !steering && resumeSessionId && seenAt >= 0 ? conversation.slice(seenAt + 1) : undefined;
    const given = steering ? (request.steered ?? []) : (delta ?? trailingUsers(conversation).users);
    const givenKeys = new Set(given.map(messageKey));
    const undelivered = new Set(record.undelivered ?? []);
    const carried = conversation.filter((message) => {
      const key = messageKey(message);
      return message.role === "user" && key !== undefined && undelivered.has(key) && !givenKeys.has(key);
    });
    const asked = steering ? request.prompt! : delta ? deltaPrompt(delta) : rebuild;
    const before = userPrompt(carried);
    const prompt =
      carried.length > 0
        ? { text: [before.text, asked.text].filter(Boolean).join("\n\n"), images: [...before.images, ...asked.images] }
        : asked;
    const abort = new AbortController();
    let settle = () => {};
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const turn: Turn = {
      id: crypto.randomUUID(),
      session,
      abort,
      done: false,
      settled,
      settle,
      queue: [],
      callIds: new Set(),
      prompted: conversation,
      unsent: [],
      waiting: new Map(),
      early: new Map(),
      toolSet: { tools: request.tools, nativeTools: request.nativeTools },
    };
    session.turn = turn;
    const answered = () => {
      if (!turn.prompted) return;
      noteSeen(session, turn.prompted);
      turn.prompted = undefined;
      void saveRecord(session);
    };
    void options.transport
      .runTurn({
        session: binding.session,
        ...(resumeSessionId ? { resumeSessionId } : {}),
        model: request.model.id,
        thinkingLevel: request.thinkingLevel,
        systemPrompt: request.systemPrompt,
        prompt: prompt.text,
        images: prompt.images,
        resumeFallbackPrompt: rebuild.text,
        tools: request.tools,
        nativeTools: request.nativeTools,
        signal: abort.signal,
        backgroundWake,
        onBackgroundWake: (wake) => {
          const text = backgroundWakeText(wake);
          (session.wakes ??= new Set()).add(text.trim());
          const ref = session.binding.session;
          for (const listener of wakeListeners) {
            try {
              listener(ref, { key: `${ref.sessionKey}:${wake.id}`, text });
            } catch (error) {
              report(error);
            }
          }
        },
        executeTool: (toolUseId, _name, _args, signal) =>
          new Promise<ClaudeCodeToolOutcome>((resolve) => {
            const early = turn.early.get(toolUseId);
            if (early) {
              turn.early.delete(toolUseId);
              resolve(early);
              return;
            }
            turn.waiting.set(toolUseId, resolve);
            signal?.addEventListener(
              "abort",
              () => {
                if (turn.waiting.get(toolUseId) !== resolve) return;
                turn.waiting.delete(toolUseId);
                resolve({ content: [{ type: "text", text: "The call was canceled." }], isError: true });
              },
              { once: true },
            );
          }),
        onEvent: (event) => {
          if (turn.done) return;
          if (event.type === "stream_event") answered();
          push(turn, { kind: "event", event: event as Record<string, any> });
        },
        onNativeToolEnd: ({ toolUseId, result, isError }) => settleNative(toolUseId, { text: result, isError }),
        onStatus: (status) => {
          for (const listener of statusListeners) {
            try {
              listener(binding.session, status);
            } catch (error) {
              report(error);
            }
          }
        },
        onSessionId: (sessionId) => {
          session.cliSessionId = sessionId;
          if (record.cliSessionId !== sessionId) {
            record.cliSessionId = sessionId;
            void saveRecord(session);
          }
        },
        control: ({ inject, endStep }) => {
          turn.inject = inject;
          turn.endStep = endStep;
        },
        toolSetAfterStep: () => {
          const next = turn.nextToolSet;
          if (!next) return undefined;
          const carried = turn.carried;
          turn.nextToolSet = undefined;
          turn.carried = undefined;
          turn.toolSet = next;
          return { ...next, prompt: movedPrompt(carried) };
        },
      })
      .then(
        (result) => {
          answered();
          session.cliSessionId = result.sessionId;
          record.cliSessionId = result.sessionId;
          void saveRecord(session);
          finish(turn, { ok: true, text: result.text });
        },
        (error: unknown) => finish(turn, { ok: false, error }),
      );
    return turn;
  };

  const consumeRound = async (
    first: Turn,
    out: AssistantMessageEventStream,
    modelInfo: Model<Api>,
    signal: AbortSignal | undefined,
  ): Promise<void> => {
    let turn = first;
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: modelInfo.api,
      provider: modelInfo.provider,
      model: modelInfo.id,
      responseId: `claude-code:${turn.id}:${crypto.randomUUID()}`,
      usage: ZERO_USAGE(),
      stopReason: "stop",
      timestamp: Date.now(),
    };
    out.push({ type: "start", partial: output });
    type Block = { index: number; kind: "text" | "thinking" | "tool"; json?: string };
    let blocks = new Map<number, Block>();
    let messageStop: string | undefined;
    let messageTools = 0;
    const usage = output.usage;
    const addUsage = (raw: Record<string, any> | undefined) => {
      if (!raw) return;
      const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
      const input = number(raw.input_tokens);
      const cacheRead = number(raw.cache_read_input_tokens);
      const cacheWrite = number(raw.cache_creation_input_tokens);
      const outputTokens = number(raw.output_tokens);
      if (input !== undefined) usage.input = input;
      if (cacheRead !== undefined) usage.cacheRead = cacheRead;
      if (cacheWrite !== undefined) usage.cacheWrite = cacheWrite;
      if (outputTokens !== undefined) usage.output = outputTokens;
      usage.totalTokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    };
    const roundUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const closeMessageUsage = () => {
      roundUsage.input += usage.input;
      roundUsage.output += usage.output;
      roundUsage.cacheRead += usage.cacheRead;
      roundUsage.cacheWrite += usage.cacheWrite;
    };
    const finalUsage = () => {
      Object.assign(usage, roundUsage, { totalTokens: roundUsage.input + roundUsage.output + roundUsage.cacheRead + roundUsage.cacheWrite });
    };
    const fail = (reason: "aborted" | "error", message: string) => {
      finalUsage();
      output.stopReason = reason;
      output.errorMessage = message;
      out.push({ type: "error", reason, error: output });
      out.end(output);
    };
    const stop = (reason: "stop" | "toolUse") => {
      finalUsage();
      output.stopReason = reason;
      out.push({ type: "done", reason, message: output });
      out.end(output);
    };
    const onAbort = () => {
      abortTurn(turn, "Stopped.");
      const wake = turn.wake;
      turn.wake = undefined;
      wake?.();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      for (;;) {
        if (signal?.aborted) {
          fail("aborted", "Stopped.");
          return;
        }
        const item = turn.queue.shift();
        if (!item) {
          await new Promise<void>((resolve) => {
            turn.wake = resolve;
          });
          continue;
        }
        if (item.kind === "end") {
          const outcome = turn.outcome;
          if (!outcome || !outcome.ok) {
            if (signal?.aborted || turn.abort.signal.aborted) fail("aborted", "Stopped.");
            else fail("error", markedError(outcome?.error));
            return;
          }
          const request = turn.session.request;
          if (turn.unsent.length > 0 && request) {
            const steer = userPrompt(turn.unsent);
            try {
              turn = await startTurn(turn.session, { ...request, prompt: steer, steered: turn.unsent });
            } catch (error) {
              fail("error", markedError(error));
              return;
            }
            continue;
          }
          if (!output.content.some((part) => part.type === "text" && part.text.trim()) && outcome.text.trim()) {
            output.content.push({ type: "text", text: outcome.text });
            const index = output.content.length - 1;
            out.push({ type: "text_start", contentIndex: index, partial: output });
            out.push({ type: "text_delta", contentIndex: index, delta: outcome.text, partial: output });
            out.push({ type: "text_end", contentIndex: index, content: outcome.text, partial: output });
          }
          stop("stop");
          return;
        }
        const event = item.event;
        if (event.type !== "stream_event") continue;
        const source = asRecord(event.event);
        if (!source) continue;
        switch (source.type) {
          case "message_start": {
            blocks = new Map();
            messageStop = undefined;
            messageTools = 0;
            Object.assign(usage, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
            addUsage(asRecord(asRecord(source.message)?.usage));
            break;
          }
          case "content_block_start": {
            const block = asRecord(source.content_block);
            const cliIndex = typeof source.index === "number" ? source.index : -1;
            if (!block) break;
            if (block.type === "text") {
              output.content.push({ type: "text", text: "" });
              const index = output.content.length - 1;
              blocks.set(cliIndex, { index, kind: "text" });
              out.push({ type: "text_start", contentIndex: index, partial: output });
            } else if (block.type === "thinking" || block.type === "redacted_thinking") {
              const thinking: ThinkingContent =
                block.type === "redacted_thinking"
                  ? { type: "thinking", thinking: "", redacted: true, ...(typeof block.data === "string" ? { thinkingSignature: block.data } : {}) }
                  : { type: "thinking", thinking: "" };
              output.content.push(thinking);
              const index = output.content.length - 1;
              blocks.set(cliIndex, { index, kind: "thinking" });
              out.push({ type: "thinking_start", contentIndex: index, partial: output });
            } else if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
              const native = !block.name.startsWith("mcp__");
              const name = native ? block.name : block.name.startsWith(MCP_PREFIX) ? block.name.slice(MCP_PREFIX.length) : block.name;
              const call: ToolCall = { type: "toolCall", id: block.id, name, arguments: {} };
              output.content.push(call);
              const index = output.content.length - 1;
              blocks.set(cliIndex, { index, kind: "tool", json: "" });
              calls.set(block.id, { turn, name, native });
              turn.callIds.add(block.id);
              messageTools += 1;
              out.push({ type: "toolcall_start", contentIndex: index, partial: output });
            }
            break;
          }
          case "content_block_delta": {
            const block = blocks.get(typeof source.index === "number" ? source.index : -1);
            const delta = asRecord(source.delta);
            if (!block || !delta) break;
            const part = output.content[block.index]!;
            if (block.kind === "text" && part.type === "text" && typeof delta.text === "string") {
              part.text += delta.text;
              out.push({ type: "text_delta", contentIndex: block.index, delta: delta.text, partial: output });
            } else if (block.kind === "thinking" && part.type === "thinking") {
              if (typeof delta.thinking === "string") {
                part.thinking += delta.thinking;
                out.push({ type: "thinking_delta", contentIndex: block.index, delta: delta.thinking, partial: output });
              } else if (typeof delta.signature === "string") {
                part.thinkingSignature = (part.thinkingSignature ?? "") + delta.signature;
              }
            } else if (block.kind === "tool" && part.type === "toolCall" && typeof delta.partial_json === "string") {
              block.json = (block.json ?? "") + delta.partial_json;
              part.arguments = parseStreamingJson(block.json);
              out.push({ type: "toolcall_delta", contentIndex: block.index, delta: delta.partial_json, partial: output });
            }
            break;
          }
          case "content_block_stop": {
            const block = blocks.get(typeof source.index === "number" ? source.index : -1);
            if (!block) break;
            const part = output.content[block.index]!;
            if (part.type === "text") out.push({ type: "text_end", contentIndex: block.index, content: part.text, partial: output });
            else if (part.type === "thinking") out.push({ type: "thinking_end", contentIndex: block.index, content: part.thinking, partial: output });
            else if (part.type === "toolCall") {
              part.arguments = parseStreamingJson(block.json ?? "");
              out.push({ type: "toolcall_end", contentIndex: block.index, toolCall: part, partial: output });
            }
            break;
          }
          case "message_delta": {
            const delta = asRecord(source.delta);
            if (typeof delta?.stop_reason === "string") messageStop = delta.stop_reason;
            addUsage(asRecord(source.usage));
            break;
          }
          case "message_stop": {
            closeMessageUsage();
            if (messageTools === 0) break;
            if (messageStop === "refusal" || messageStop === "max_tokens") {
              const last = output.content.at(-1);
              const record = last?.type === "toolCall" ? calls.get(last.id) : undefined;
              if (record && last?.type === "toolCall") {
                record.truncated = `Refusing ${last.name}: your stream ended with stop_reason "${messageStop}" while these arguments were still being written, so they are cut off mid-value and were NOT executed. Reissue the call with complete arguments.`;
              }
            }
            stop("toolUse");
            return;
          }
        }
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  };

  const streamRound = async (
    modelInfo: Model<Api>,
    context: TranscriptContext,
    streamOptions: SimpleStreamOptions | undefined,
    out: AssistantMessageEventStream,
  ): Promise<void> => {
    const fail = (message: string) => {
      const output: AssistantMessage = {
        role: "assistant",
        content: [],
        api: modelInfo.api,
        provider: modelInfo.provider,
        model: modelInfo.id,
        usage: ZERO_USAGE(),
        stopReason: "error",
        errorMessage: message,
        timestamp: Date.now(),
      };
      out.push({ type: "error", reason: "error", error: output });
      out.end(output);
    };
    const piSessionId = streamOptions?.sessionId;
    const session = piSessionId ? sessions.get(piSessionId) : undefined;
    if (!session) {
      fail("Claude Code can't run this conversation here: it was not opened on the Claude Code engine.");
      return;
    }
    const messages = context.messages;
    const systemPrompt = getCurrentSystemPrompt(messages);
    const toolSet = toolSetFor(session.binding, getCurrentTools(messages));
    const conversation = messages.filter((message) => message.role !== "system");
    let turn = session.turn;
    let superseded: Turn | undefined;
    if (turn) {
      const lastAssistant = conversation.findLastIndex((message) => message.role === "assistant");
      const tail = conversation.slice(lastAssistant + 1);
      const results = tail.filter((message) => message.role === "toolResult");
      const current = turn;
      const ours = results.length > 0 && results.every((message) => message.role === "toolResult" && current.callIds.has(message.toolCallId));
      const stopped = turn.abort.signal.aborted;
      if (!ours || stopped || (turn.done && turn.queue.length === 0)) {
        holdUndelivered(session, turn.unsent);
        turn.unsent = [];
        abortTurn(turn, "Superseded.");
        superseded = turn;
        turn = undefined;
      } else {
        const { users } = trailingUsers(tail);
        const unseen = users.filter((message) => {
          const key = messageKey(message);
          return key !== undefined && !session.record?.seen.includes(key);
        });
        // A wake for the CLI's own query is news only to Stella: the running CLI told itself.
        const told = unseen.filter((message) => session.wakes?.delete(textOf(message.content).trim()) === true);
        if (told.length > 0) noteSeen(session, told);
        const fresh = unseen.filter((message) => !told.includes(message));
        const held = new Set(turn.unsent.map(messageKey));
        const waiting = [...turn.unsent, ...fresh.filter((message) => !held.has(messageKey(message)))];
        const moved = !turn.done && toolSetKey(turn.toolSet) !== toolSetKey(toolSet);
        if (moved) {
          turn.nextToolSet = toolSet;
          turn.carried = results;
        }
        const restarted = moved && turn.endStep?.() === true;
        if (!restarted) turn.carried = undefined;
        if (waiting.length > 0) {
          const prompt = userPrompt(waiting);
          const steered = turn;
          const injected =
            !restarted &&
            !turn.done &&
            prompt.text &&
            turn.inject?.({
              text: prompt.text,
              images: prompt.images,
              onConsumed: () => {
                noteSeen(session, waiting);
                void saveRecord(session);
              },
              onDropped: () => {
                if (steered.done || steered.abort.signal.aborted) {
                  holdUndelivered(session, waiting);
                  return;
                }
                const queued = new Set(steered.unsent.map(messageKey));
                steered.unsent = [...waiting.filter((message) => !queued.has(messageKey(message))), ...steered.unsent];
              },
            });
          if (injected) {
            turn.unsent = [];
          } else {
            turn.unsent = waiting;
          }
        }
        noteSeen(session, results);
        if (!turn.done) {
          for (const message of results) {
            if (message.role !== "toolResult") continue;
            const record = calls.get(message.toolCallId);
            if (!record || record.native) continue;
            calls.delete(message.toolCallId);
            if (restarted) continue;
            const outcome: ClaudeCodeToolOutcome = {
              content: typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content,
              ...(message.isError ? { isError: true } : {}),
            };
            const waiting = turn.waiting.get(message.toolCallId);
            if (waiting) {
              turn.waiting.delete(message.toolCallId);
              waiting(outcome);
            } else {
              turn.early.set(message.toolCallId, outcome);
            }
          }
        }
      }
    }
    const request: TurnRequest = {
      model: modelInfo,
      messages,
      systemPrompt,
      tools: toolSet.tools,
      nativeTools: toolSet.nativeTools,
      thinkingLevel: thinkingLevelOf(streamOptions),
    };
    session.request = request;
    if (!turn) {
      // What the replaced turn's CLI never took in is known once its step
      // ended; the new turn carries it. It waits for that CLI anyway.
      if (superseded && !superseded.done) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          superseded.settled,
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, SUPERSEDED_SETTLE_MS);
          }),
        ]);
        clearTimeout(timer);
      }
      try {
        turn = await startTurn(session, request);
      } catch (error) {
        fail(markedError(error));
        return;
      }
    }
    await consumeRound(turn, out, modelInfo, streamOptions?.signal);
    const stored = out as unknown as { result(): Promise<AssistantMessage> };
    const message = await stored.result().catch(() => undefined);
    if (message && message.stopReason !== "error" && message.stopReason !== "aborted") {
      noteSeen(session, [message]);
      void saveRecord(session);
    }
  };

  const stream = (modelInfo: Model<Api>, context: TranscriptContext, streamOptions?: StreamOptions | SimpleStreamOptions) => {
    const out = createAssistantMessageEventStream();
    void streamRound(modelInfo, context, streamOptions as SimpleStreamOptions | undefined, out).catch((error: unknown) => {
      report(error);
    });
    return out;
  };

  const buildProvider = (): Provider =>
    createProvider({
      id: CLAUDE_CODE_PROVIDER_ID,
      name: "Claude Code",
      auth: {
        apiKey: {
          name: "Claude Code login",
          resolve: async () => ({ auth: { apiKey: CLAUDE_CODE_PROVIDER_ID }, source: "Claude Code on this computer" }),
        },
      },
      models: [...modelIds].map(model),
      api: { stream, streamSimple: stream },
    });

  const nativeResult = (toolUseId: string, context: Context): Promise<NativeResult> => {
    const known = nativeResults.get(toolUseId);
    if (known) {
      nativeResults.delete(toolUseId);
      return Promise.resolve(known);
    }
    return new Promise<NativeResult>((resolve) => {
      const waiters = nativeWaiters.get(toolUseId) ?? new Set();
      const settle = (result: NativeResult) => {
        context.abortSignal?.removeEventListener("abort", onAbort);
        resolve(result);
      };
      const onAbort = () => {
        waiters.delete(settle);
        const record = calls.get(toolUseId);
        abortTurn(record?.turn, "Stopped.");
        resolve({ text: "Stopped.", isError: true });
      };
      waiters.add(settle);
      nativeWaiters.set(toolUseId, waiters);
      if (context.abortSignal?.aborted) onAbort();
      else context.abortSignal?.addEventListener("abort", onAbort, { once: true });
    });
  };

  const INTERRUPTED: ToolExecutionResult = {
    content: [{ type: "text", text: "This call was interrupted: Stella restarted before Claude Code finished it." }],
    isError: true,
  };

  const isNativeCall = (callId: string): boolean => calls.get(callId)?.native === true || nativeResults.has(callId);

  const nativeOutcome = async (api: ToolExecutionApi, context: Context): Promise<ToolExecutionResult> => {
    const result = await nativeResult(api.callId, context);
    calls.delete(api.callId);
    return { content: [{ type: "text", text: result.text || "(no output)" }], ...(result.isError ? { isError: true } : {}) };
  };

  const asInnerArguments = (inner: ToolRegistration, args: unknown): unknown => {
    const value = asRecord(args);
    const properties = asRecord(asRecord(inner.parameters)?.properties) ?? {};
    if (!value || typeof value.file_path !== "string" || "path" in value || !("path" in properties)) return args;
    const { file_path, old_string, new_string, replace_all: _replaceAll, ...rest } = value;
    return {
      ...rest,
      path: file_path,
      ...("edits" in properties && typeof old_string === "string"
        ? { edits: [{ oldText: old_string, newText: typeof new_string === "string" ? new_string : "" }] }
        : {}),
    };
  };

  const wrapBuiltin = (name: (typeof WRAPPED_TOOLS)[number]) =>
    wrapTool({ name } as ToolRegistration, (inner) => ({
      ...inner,
      prepareArguments: (args: unknown) => {
        const shaped = asInnerArguments(inner, args);
        return (inner.prepareArguments ? inner.prepareArguments(shaped) : shaped) as never;
      },
      async execute(args, api, context) {
        if (isNativeCall(api.callId)) return await nativeOutcome(api, context);
        if (calls.has(api.callId)) return await inner.execute(args, api, context);
        return INTERRUPTED;
      },
    }));

  /**
   * Claude Code's Grep and Glob: a built-in's result as the CLI reported it,
   * or, while the tools run elsewhere, Stella's served one run there.
   */
  const engineOnly = (name: ClaudeCodeServedSearchToolName, extensionOptions: ClaudeCodeExtensionOptions) =>
    defineTool({
      name,
      description: `Claude Code's ${name}.`,
      parameters: Type.Object({}, { additionalProperties: true }),
      async execute(args, api, context) {
        if (isNativeCall(api.callId)) return await nativeOutcome(api, context);
        if (!calls.has(api.callId)) return INTERRUPTED;
        const ran = await extensionOptions.searchElsewhere?.(
          claudeCodeServedSearchCall(name, (asRecord(args) ?? {}) as Record<string, unknown>),
          api,
          context,
        );
        return (
          ran ?? {
            content: [{ type: "text", text: `Your file and shell tools run on this computer again: use your built-in ${name}.` }],
            isError: true,
          }
        );
      },
    });

  return {
    provider: buildProvider,
    onProviderChange(listener: (provider: Provider) => void) {
      providerListener = listener;
    },
    ensureModel(id: string): ModelRef {
      const modelId = id.trim() || "default";
      if (!modelIds.has(modelId)) {
        modelIds.add(modelId);
        providerListener?.(buildProvider());
      }
      return { provider: CLAUDE_CODE_PROVIDER_ID, modelId };
    },
    extension(conversationId: string, extensionOptions: ClaudeCodeExtensionOptions = {}): Extension {
      return defineExtension({
        name: CLAUDE_CODE_ENGINE_EXTENSION,
        tools: ENGINE_ONLY_TOOLS.map((name) => engineOnly(name, extensionOptions)),
        wraps: WRAPPED_TOOLS.map(wrapBuiltin),
        hooks: [
          hook(GenerationTask, {
            beforeRequest: async (_request, api, context) => {
              const agent = await api.snapshot(AgentDoc, api.conversationId, context);
              if (agent?.model?.provider !== CLAUDE_CODE_PROVIDER_ID) return undefined;
              const identity = await api.snapshot(ProviderDoc, api.conversationId, context);
              if (!identity?.sessionId) return undefined;
              const role = await api.snapshot(StellaAgentDoc, api.conversationId, context);
              const placement = placementOf(await api.snapshot(StellaPlacementDoc, api.conversationId, context));
              const threadId = role?.agentType === "general" ? role.threadId : undefined;
              const binding: Binding = {
                session: {
                  conversationId,
                  ...(threadId ? { threadId } : {}),
                  role: role?.agentType === "general" ? "worker" : "orchestrator",
                  sessionKey: threadId ? `${conversationId}:${threadId}` : conversationId,
                  ...(agent.cwd ? { cwd: agent.cwd } : {}),
                },
                toolsRemote: options.builtins === "never" || (placement !== undefined && placement.kind !== "local"),
                servesSearch: extensionOptions.searchElsewhere !== undefined,
                piConversationId: api.conversationId,
              };
              const known = sessions.get(identity.sessionId);
              if (known) known.binding = binding;
              else sessions.set(identity.sessionId, { piSessionId: identity.sessionId, binding });
              return undefined;
            },
          }),
          hook(CompactionTask, { beforeCompact: () => ({ decline: true }) }),
          hook(ToolTask, {
            beforeTool: (call) => {
              const truncated = calls.get(call.id)?.truncated;
              return truncated ? { block: truncated } : undefined;
            },
          }),
        ],
      });
    },
    /**
     * An agent's CLI started a query of its own because a background command
     * it ran finished: deliver `text` to the agent as a message (once per
     * `key`), and its next turn takes that query over.
     */
    onBackgroundWake(listener: (session: ClaudeCodeSessionRef, wake: { key: string; text: string }) => void): () => void {
      wakeListeners.add(listener);
      return () => wakeListeners.delete(listener);
    },
    onStatus(listener: (session: ClaudeCodeSessionRef, status: ClaudeCodeStatus) => void): () => void {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    abort(conversationId: string, scope: { agents?: boolean; threadId?: string } = {}) {
      for (const session of sessions.values()) {
        const ref = session.binding.session;
        if (ref.conversationId !== conversationId) continue;
        if (scope.threadId !== undefined ? ref.threadId !== scope.threadId : ref.threadId !== undefined && !scope.agents) continue;
        abortTurn(session.turn, "Stopped.");
      }
    },
    running(conversationId: string): boolean {
      for (const session of sessions.values()) {
        if (session.binding.session.conversationId === conversationId && session.turn && !session.turn.done) return true;
      }
      return false;
    },
    close(conversationId: string) {
      for (const [id, session] of sessions) {
        if (session.binding.session.conversationId !== conversationId) continue;
        abortTurn(session.turn, "Closed.");
        options.transport.close?.(session.binding.session);
        sessions.delete(id);
      }
    },
  };
}
