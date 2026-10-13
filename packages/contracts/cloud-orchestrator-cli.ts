/**
 * Wire contract for a cloud orchestrator chat turn run by the real Claude Code
 * CLI. When a conversation's execution engine is `anthropic`, the
 * OrchestratorSession Durable Object runs the turn on pi with its Claude Code
 * engine: each CLI turn is dispatched to a BuildSession as an agent turn with
 * `agentRole: "orchestrator"`, and the container executor runs `claude` with
 * the system prompt and tools pi gives it.
 *
 *   DO --dispatch--> BuildSession --turn-input.json--> executor --> claude
 *   claude --MCP--> executor --broker--> BuildSession --internal--> DO
 *
 * pi stays the single source of tools: the executor only advertises the
 * catalog it was handed and forwards every call back, where pi's own tool
 * task answers it. Identity:
 *   - threadId is `orchestratorCliThreadId(conversationId)`, or
 *     `orchestratorCliCompactThreadId` for a one-off `/compact`;
 *   - turnId is the DO's chat turn id (the dispatch passes it as `turnId`);
 *   - attemptGeneration is the BuildSession attempt for that turn.
 */

/** Which loop a container CLI turn runs. */
export type CloudCliTurnRole = "agent" | "orchestrator";

/** BuildSession thread that runs one conversation's orchestrator CLI turns. */
export const orchestratorCliThreadId = (conversationId: string): string =>
  `orch:${conversationId}`;

/**
 * BuildSession thread that runs the conversation's one-off `/compact` turns
 * (handing it to a model with a smaller window), so they never touch the
 * orchestrator thread's own session.
 */
export const orchestratorCliCompactThreadId = (conversationId: string): string =>
  `orch:${conversationId}:compact`;

export const isOrchestratorCliThreadId = (conversationId: string, threadId: string): boolean =>
  threadId === orchestratorCliThreadId(conversationId) || threadId === orchestratorCliCompactThreadId(conversationId);

/**
 * How an orchestrator CLI turn's error opens when the session the DO resumed
 * is gone from the container: the DO starts it again from the journal.
 */
export const CLOUD_CLI_SESSION_LOST_MARK = "[claude-code/session-lost]";

/**
 * One orchestrator tool as the DO's `createTools()` defines it. `parameters`
 * is the tool's JSON Schema object, the same field the runtime's
 * `ToolMetadata` and `AgentTool` carry, so the executor can hand the entry to
 * the Claude Code MCP host unchanged.
 */
export type CloudOrchestratorToolDescriptor = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/**
 * A Claude Code session another host ran for this conversation and synced
 * (`@stella/contracts/backend/claude-sessions`): a computer whose brain lease
 * the cloud took over, or one it moved from. The container resumes it
 * natively when the cloud's own session is behind, rather than rebuilding
 * from the log.
 */
export type CloudOrchestratorCliAdoptedSession = {
  /** The synced session's thread: the computer's orchestrator thread key. */
  threadId: string;
  sessionId: string;
  /** The computer it ran on, as the user's device list names it. */
  deviceId: string;
};

/** What the DO sends for its CLI turn, and what turn-input.json carries. */
export type CloudOrchestratorCliTurnSpec = {
  /** The DO's full orchestrator system prompt for this turn. */
  systemPrompt: string;
  toolCatalog: CloudOrchestratorToolDescriptor[];
  adoptSession?: CloudOrchestratorCliAdoptedSession;
  /**
   * A session the DO wrote from the conversation's journal, left in backup
   * storage (`claudeHydratedSessionKey`): the CLI resumes it instead of
   * whatever session the thread had.
   */
  hydrateSession?: string;
  /** The DO has no session for the CLI to resume: it starts a new one, whatever the thread had. */
  startFresh?: true;
  /** The prompt is the CLI's own `/compact`: stock Claude Code, no system prompt or tools of Stella's. */
  compact?: true;
  /** No message the user wrote waits for a reply: an empty answer is the turn's reply. */
  quiet?: boolean;
};

const ADOPTED_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;

const parseAdoptedSession = (
  value: unknown,
): CloudOrchestratorCliAdoptedSession | undefined => {
  if (!isRecord(value)) return undefined;
  const { threadId, sessionId, deviceId } = value;
  return typeof threadId === "string" &&
    threadId.length > 0 &&
    threadId.length <= 512 &&
    typeof sessionId === "string" &&
    ADOPTED_SESSION_ID.test(sessionId) &&
    typeof deviceId === "string" &&
    deviceId.length > 0 &&
    deviceId.length <= 256
    ? { threadId, sessionId, deviceId }
    : undefined;
};

/**
 * Role fields of turn-input.json. Every turn input carries `role` and the
 * system prompt the worker rendered for it. An orchestrator turn carries the
 * DO's whole prompt and its tool catalog. An agent turn carries
 * `agents/general.md` rendered for the cloud and the executor's tools
 * (`cloudGeneralToolNames`); the executor appends the facts only it knows,
 * such as the drive it just synchronized, and keeps its own tools. Either way
 * a prompt edit reaches the container with the worker deploy, never through
 * the image.
 */
export type CloudCliTurnRoleInput =
  | { role: "agent"; systemPrompt: string; toolCatalog?: never }
  | ({ role: "orchestrator" } & CloudOrchestratorCliTurnSpec);

export const CLOUD_ORCHESTRATOR_SYSTEM_PROMPT_MAX_CHARS = 512 * 1024;

/** The agent role's rendered prompt body, or null when missing or oversized. */
export const parseCloudAgentSystemPrompt = (value: unknown): string | null =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= CLOUD_ORCHESTRATOR_SYSTEM_PROMPT_MAX_CHARS
    ? value
    : null;
export const CLOUD_ORCHESTRATOR_TOOL_CATALOG_MAX_TOOLS = 128;
/** Serialized size of the whole catalog, descriptions and schemas included. */
export const CLOUD_ORCHESTRATOR_TOOL_CATALOG_MAX_BYTES = 512 * 1024;
/** MCP and Anthropic tool-name alphabet; the CLI prefixes `mcp__stella__`. */
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Shared validator for the spec, used by the BuildSession on dispatch and by
 * the executor on turn-input.json. Null on anything malformed or oversized.
 */
export const parseCloudOrchestratorCliTurnSpec = (
  value: unknown,
): CloudOrchestratorCliTurnSpec | null => {
  if (!isRecord(value)) return null;
  const { systemPrompt, toolCatalog } = value;
  const compact = value.compact === true;
  if (
    typeof systemPrompt !== "string" ||
    (!compact && !systemPrompt.trim()) ||
    systemPrompt.length > CLOUD_ORCHESTRATOR_SYSTEM_PROMPT_MAX_CHARS ||
    !Array.isArray(toolCatalog) ||
    toolCatalog.length > CLOUD_ORCHESTRATOR_TOOL_CATALOG_MAX_TOOLS
  ) {
    return null;
  }
  const names = new Set<string>();
  const catalog: CloudOrchestratorToolDescriptor[] = [];
  for (const entry of toolCatalog) {
    if (
      !isRecord(entry) ||
      typeof entry.name !== "string" ||
      !TOOL_NAME_PATTERN.test(entry.name) ||
      names.has(entry.name) ||
      typeof entry.description !== "string" ||
      !isRecord(entry.parameters)
    ) {
      return null;
    }
    names.add(entry.name);
    catalog.push({
      name: entry.name,
      description: entry.description,
      parameters: entry.parameters,
    });
  }
  if (
    new TextEncoder().encode(JSON.stringify(catalog)).byteLength >
    CLOUD_ORCHESTRATOR_TOOL_CATALOG_MAX_BYTES
  ) {
    return null;
  }
  const adoptSession = parseAdoptedSession(value.adoptSession);
  const hydrateSession =
    typeof value.hydrateSession === "string" && ADOPTED_SESSION_ID.test(value.hydrateSession)
      ? value.hydrateSession
      : undefined;
  return {
    systemPrompt,
    toolCatalog: catalog,
    ...(adoptSession ? { adoptSession } : {}),
    ...(hydrateSession ? { hydrateSession } : {}),
    ...(value.startFresh === true ? { startFresh: true } : {}),
    ...(compact ? { compact: true } : {}),
    ...(value.quiet === true ? { quiet: true } : {}),
  };
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** Executor -> BuildSession turn-broker targets (bodies below). */
export const CLOUD_ORCHESTRATOR_BROKER_PATHS = {
  tool: "/api/cloud/orchestrator-tool",
  events: "/api/cloud/orchestrator-events",
} as const;

/**
 * BuildSession -> OrchestratorSession DO routes. Internal Durable Object
 * fetches only; never reachable from the public router.
 */
export const CLOUD_CLI_TURN_DO_PATHS = {
  tool: "/internal/cli-turn/tool",
  events: "/internal/cli-turn/events",
  terminal: "/internal/cli-turn/terminal",
} as const;

/** Broker body limits (the broker's per-target `maxBodyBytes`). */
export const CLOUD_ORCHESTRATOR_TOOL_REQUEST_MAX_BYTES = 1024 * 1024;
export const CLOUD_ORCHESTRATOR_EVENTS_REQUEST_MAX_BYTES = 1024 * 1024;

/**
 * The exact turn a forwarded frame belongs to. The BuildSession fills it from
 * its own claimed broker identity and turn record, never from the executor's
 * body; the DO answers 409 when it no longer names the DO's active turn.
 */
export type CloudCliTurnIdentity = {
  conversationId: string;
  threadId: string;
  turnId: string;
  attemptGeneration: number;
};

// ---------------------------------------------------------------------------
// Tool calls: claude -> MCP host -> broker -> DO -> AgentTool.execute
// ---------------------------------------------------------------------------

/** Executor -> broker body for `CLOUD_ORCHESTRATOR_BROKER_PATHS.tool`. */
export type CloudOrchestratorToolCallRequest = {
  /**
   * The CLI's own `tool_use` id (resolved through the native tool-use
   * correlator), so the journaled assistant call and its result match.
   */
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
};

/** BuildSession -> DO body for `CLOUD_CLI_TURN_DO_PATHS.tool`. */
export type CloudCliTurnToolForward = CloudCliTurnIdentity &
  CloudOrchestratorToolCallRequest;

export type CloudOrchestratorToolContent =
  | { type: "text"; text: string }
  /** Base64 image bytes, as the runtime's `ImageContent`. */
  | { type: "image"; data: string; mimeType: string };

/**
 * The runtime's `AgentToolResult`, serialized. A tool that throws is still a
 * result: the DO journals and returns `{ content: [text error], isError:
 * true }`, exactly as Stella's Agent loop would.
 */
export type CloudOrchestratorToolResult = {
  content: CloudOrchestratorToolContent[];
  details?: unknown;
  isError?: boolean;
};

/**
 * Refusals where the DO ran nothing and journaled nothing. The executor
 * surfaces them to the CLI as an MCP tool error.
 *   - `turn_inactive`: the identity is not the DO's active CLI turn.
 *   - `unknown_tool`: the name is not in the catalog the DO handed out.
 *   - `conflict`: the toolCallId was already used with different args.
 */
export type CloudOrchestratorToolCallRefusal = {
  code: "turn_inactive" | "unknown_tool" | "conflict";
  message: string;
};

/**
 * DO -> BuildSession -> executor response body (HTTP 200 for both arms). A
 * replayed toolCallId with identical args returns the recorded result.
 */
export type CloudOrchestratorToolCallResponse =
  | { ok: true; result: CloudOrchestratorToolResult }
  | { ok: false; error: CloudOrchestratorToolCallRefusal };

// ---------------------------------------------------------------------------
// Event batches: claude stream-json -> executor -> broker -> DO journal/hub
// ---------------------------------------------------------------------------

/**
 * Usage in the runtime's `Usage` shape. The gateway meters spend; the cost
 * fields stay zero here.
 */
export type CloudCliUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
};

/**
 * One finalized CLI assistant message (a stream-json `assistant` event),
 * converted into the runtime's `AssistantMessage` shape so the DO journals it
 * as-is. `tool_use` blocks become `toolCall` content with the CLI's ids.
 */
export type CloudCliAssistantMessage = {
  role: "assistant";
  content: Array<
    | { type: "text"; text: string }
    | { type: "thinking"; thinking: string; thinkingSignature?: string; redacted?: boolean }
    | {
        type: "toolCall";
        id: string;
        name: string;
        arguments: Record<string, unknown>;
      }
  >;
  api: "claude-code";
  provider: "anthropic";
  model: string;
  responseId?: string;
  usage: CloudCliUsage;
  stopReason: "stop" | "length" | "toolUse" | "error" | "aborted";
  errorMessage?: string;
  timestamp: number;
};

export type CloudOrchestratorEvent =
  /** Streamed reply text since the previous batch (`--include-partial-messages`). */
  | { type: "text_delta"; text: string }
  /** The CLI's own status changes, e.g. while it compacts its session. */
  | { type: "status"; state: "running" | "compacting"; text: string }
  /** The CLI compacted its session; `summary` now stands in for everything before. */
  | { type: "compaction"; id: string; summary: string; preservedMessages?: number }
  /**
   * Journal this message. A batch carrying a message with `toolCall` blocks
   * is acknowledged before the executor forwards any of those calls.
   */
  | { type: "assistant_message"; message: CloudCliAssistantMessage }
  /**
   * What the CLI reported about its models, as the desktop keeps it: the
   * model `alias` runs on (`init`), and each model's context window
   * (`result.modelUsage`).
   */
  | { type: "models"; alias?: string; resolved?: string; windows?: Record<string, number> }
  /** Cumulative totals for this attempt so far; the latest one wins. */
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      llmCalls: number;
    };

/**
 * Executor -> broker body for `CLOUD_ORCHESTRATOR_BROKER_PATHS.events`, sent
 * about every 100 ms while events are pending. Batches are posted strictly in
 * order and each waits for the previous acknowledgement; the executor flushes
 * the last batch before it writes its turn result. There is no terminal
 * event: the stream ends with the terminal frame below.
 */
export type CloudOrchestratorEventBatch = {
  /** 1, 2, 3... per attempt. The DO applies `lastApplied + 1` and acks a replay. */
  batchSeq: number;
  events: CloudOrchestratorEvent[];
};

/** BuildSession -> DO body for `CLOUD_CLI_TURN_DO_PATHS.events`. */
export type CloudCliTurnEventsForward = CloudCliTurnIdentity &
  CloudOrchestratorEventBatch;

/**
 * BuildSession -> DO body for `CLOUD_CLI_TURN_DO_PATHS.terminal`, sent once
 * the attempt is terminal (executor result read, executor lost, or canceled)
 * instead of the agent wake in terminal-delivery. Retried until the DO acks;
 * the DO treats a repeat for an already-finished turn as a no-op.
 */
export type CloudCliTurnTerminal = CloudCliTurnIdentity & {
  outcome: "completed" | "failed" | "canceled";
  /**
   * The CLI's final reply text. Lets the DO repair the journal when the last
   * `assistant_message` batch never arrived.
   */
  finalText: string;
  /** User-safe failure text for `failed`. */
  error?: string;
  usage: { inputTokens: number; outputTokens: number; llmCalls: number };
};
