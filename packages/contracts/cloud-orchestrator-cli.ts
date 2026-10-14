export type CloudCliTurnRole = "agent" | "orchestrator";

export const orchestratorCliThreadId = (conversationId: string): string =>
  `orch:${conversationId}`;

export const orchestratorCliCompactThreadId = (conversationId: string): string =>
  `orch:${conversationId}:compact`;

export const isOrchestratorCliThreadId = (conversationId: string, threadId: string): boolean =>
  threadId === orchestratorCliThreadId(conversationId) || threadId === orchestratorCliCompactThreadId(conversationId);

export const CLOUD_CLI_SESSION_LOST_MARK = "[claude-code/session-lost]";

export type CloudOrchestratorToolDescriptor = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type CloudOrchestratorCliAdoptedSession = {
  threadId: string;
  sessionId: string;
  deviceId: string;
};

export type CloudOrchestratorCliTurnSpec = {
  systemPrompt: string;
  toolCatalog: CloudOrchestratorToolDescriptor[];
  adoptSession?: CloudOrchestratorCliAdoptedSession;
  hydrateSession?: string;
  startFresh?: true;
  compact?: true;
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

export type CloudCliTurnRoleInput =
  | { role: "agent"; systemPrompt: string; toolCatalog?: never }
  | ({ role: "orchestrator" } & CloudOrchestratorCliTurnSpec);

export const CLOUD_ORCHESTRATOR_SYSTEM_PROMPT_MAX_CHARS = 512 * 1024;

export const parseCloudAgentSystemPrompt = (value: unknown): string | null =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= CLOUD_ORCHESTRATOR_SYSTEM_PROMPT_MAX_CHARS
    ? value
    : null;
export const CLOUD_ORCHESTRATOR_TOOL_CATALOG_MAX_TOOLS = 128;
export const CLOUD_ORCHESTRATOR_TOOL_CATALOG_MAX_BYTES = 512 * 1024;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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

export const CLOUD_ORCHESTRATOR_BROKER_PATHS = {
  tool: "/api/cloud/orchestrator-tool",
  events: "/api/cloud/orchestrator-events",
} as const;

export const CLOUD_CLI_TURN_DO_PATHS = {
  tool: "/internal/cli-turn/tool",
  events: "/internal/cli-turn/events",
  terminal: "/internal/cli-turn/terminal",
} as const;

export const CLOUD_ORCHESTRATOR_TOOL_REQUEST_MAX_BYTES = 1024 * 1024;
export const CLOUD_ORCHESTRATOR_EVENTS_REQUEST_MAX_BYTES = 1024 * 1024;

export type CloudCliTurnIdentity = {
  conversationId: string;
  threadId: string;
  turnId: string;
  attemptGeneration: number;
};

export type CloudOrchestratorToolCallRequest = {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
};

export type CloudCliTurnToolForward = CloudCliTurnIdentity &
  CloudOrchestratorToolCallRequest;

export type CloudOrchestratorToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export type CloudOrchestratorToolResult = {
  content: CloudOrchestratorToolContent[];
  details?: unknown;
  isError?: boolean;
};

export type CloudOrchestratorToolCallRefusal = {
  code: "turn_inactive" | "unknown_tool" | "conflict";
  message: string;
};

export type CloudOrchestratorToolCallResponse =
  | { ok: true; result: CloudOrchestratorToolResult }
  | { ok: false; error: CloudOrchestratorToolCallRefusal };

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
  | { type: "text_delta"; text: string }
  | { type: "status"; state: "running" | "compacting"; text: string }
  | { type: "compaction"; id: string; summary: string; preservedMessages?: number }
  | { type: "assistant_message"; message: CloudCliAssistantMessage }
  | { type: "models"; alias?: string; resolved?: string; windows?: Record<string, number> }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      llmCalls: number;
    };

export type CloudOrchestratorEventBatch = {
  batchSeq: number;
  events: CloudOrchestratorEvent[];
};

export type CloudCliTurnEventsForward = CloudCliTurnIdentity &
  CloudOrchestratorEventBatch;

export type CloudCliTurnTerminal = CloudCliTurnIdentity & {
  outcome: "completed" | "failed" | "canceled";
  finalText: string;
  error?: string;
  usage: { inputTokens: number; outputTokens: number; llmCalls: number };
};
