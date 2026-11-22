import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { markTurnStep } from "./turn-timing.js";
import * as Effect from "effect/Effect";
import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
  AgentModelReasoningEffort,
  CloudExecutionSelection,
} from "@stella/contracts/agent-engine";
import { normalizeReasoningEffortLevel } from "@stella/contracts/reasoning-effort";
import {
  CLAUDE_CODE_PLAIN_TOOL_NAMES_ENV,
  CLAUDE_CODE_STELLA_SERVER_NAME,
} from "@stella/contracts/claude-code-tool-names";
import {
  CLOUD_ADOPTED_SESSION_DIR,
  CLOUD_CLAUDE_ACCOUNTS_ROOT,
  cloudNativeStateRoot,
  isCloudClaudeAccountKey,
} from "@stella/contracts/cloud-native-state";
import { isClaudeSessionId } from "@stella/contracts/backend/claude-sessions";
import {
  cloudClaudeLoginEndedText,
  isClaudeLoginFailureText,
  readStoredClaudeLogin,
} from "@stella/contracts/claude-login";
import {
  claudeCliCanResume,
  claudeCliResumesAtMessage,
  claudeCliVersion,
  claudeSessionProjectDir,
  resolveClaudeWorkingFolder,
  stripClaudeThinkingFromSessionFile,
} from "@stella/runtime/kernel/integrations/claude-code-session-files.js";
import {
  CLOUD_CLI_SESSION_LOST_MARK,
  type CloudCliTurnRole,
} from "@stella/contracts/cloud-orchestrator-cli";
import type { AgentMessage } from "@stella/runtime/kernel/agent-core/types.js";
import { isolateToolProcessLaunch } from "@stella/runtime/kernel/tools/process-isolation.js";
import type { ToolProcessIdentity } from "@stella/runtime/kernel/tools/types.js";
import {
  CLAUDE_CODE_AGENT_AUTO_COMPACT_WINDOW,
  claudeCodeNativeToolMatcher,
  ClaudeCodeCompactionLoopError,
  claudeCodeSubscriptionLimitOf,
  getClaudeCodeStatusChangeFromStreamEvent,
  isClaudeCodeVisibleOutputNudge,
  isRejectedThinkingSignatureError,
  MAX_COMPACTIONS_PER_TURN,
} from "@stella/runtime/kernel/integrations/claude-code-session-runtime.js";
import { resolveExternalCliPath } from "@stella/node-shared/integrations/external-cli-resolution.js";
import { prepareCloudClaudeCli } from "./claude-cli.js";
import {
  CLOUD_HOST_STATE,
  CLOUD_TOOL_PROCESS_IDENTITY,
} from "./cloud-process-isolation.js";
import {
  prepareClaudeSandbox,
  probeClaudeSandbox,
  restoreNativeStateOwner,
  sandboxedClaudeLaunch,
} from "./claude-sandbox.js";
import { CLOUD_TOOL_HOME, toolStateEnvironment } from "@stella/contracts/cloud-tool-home";
import { WORLD_ROOT } from "./workspace-paths.js";
import {
  parseAuthoritativeAgentHistory,
  type AgentHistoryRow,
} from "./agent-history.js";
import { pruneAgentHistory } from "./prune-history.js";
import { createNativeTranscript } from "./native-transcript.js";
import { claudeCodeTranscript } from "@stella/runtime/kernel/integrations/claude-code-transcript.js";
import { CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT_MS } from "@stella/runtime/kernel/integrations/claude-code-mcp-timeouts.js";
import {
  assertFreshNativeState,
  assertNativeState,
  sealNativeState,
  type NativeStateAttestation,
} from "./native-state-integrity.js";
import type { AgentInbox } from "./agent-inbox.js";
import type { ClaudeKeeperClient } from "./claude-keeper-client.js";
import type { ClaudeKeeperState } from "./claude-keeper-protocol.js";
import type { ClaudeCodeToolMcpHost } from "@stella/runtime/kernel/integrations/claude-code-tool-mcp-host.js";
import { NATIVE_STATE_ATTESTATION_FILE } from "./native-state-integrity.js";
import {
  createNativeTurnCancellation,
  type NativeTurnCancellation,
} from "./turn-cancellation.js";

export type NativeAgentTurnResult = {
  finalText: string;
  error?: string;
  usage: { inputTokens: number; outputTokens: number; llmCalls: number };
  messages: AgentMessage[];
  nativeStateCheckpoint?: Pick<
    NativeStateAttestation,
    "engine" | "sessionId" | "cursor" | "tree" | "mac"
  >;
};

type NativeCliTurnResult = Omit<
  NativeAgentTurnResult,
  "messages" | "nativeStateCheckpoint"
> & {
  sessionId: string;
  steered: string[];
  kept?: KeptClaude;
};

type KeptClaude = {
  release: (mac: string) => Promise<void>;
  discard: () => Promise<void>;
};

export type CloudClaudeKeeperInput = {
  client: ClaudeKeeperClient;
  /** Claude lists the tools once; another catalog needs another process. */
  toolCatalogHash: string;
};

const INBOX_POLL_MS = 500;

const streamJsonUserMessage = (
  sessionId: string,
  text: string,
  uuid?: string,
): string =>
  JSON.stringify({
    type: "user",
    session_id: sessionId,
    message: { role: "user", content: text },
    parent_tool_use_id: null,
    ...(uuid ? { uuid } : {}),
  });

type NativeEvent = (kind: string, payload: unknown) => void;

/** The MCP server name Stella's tools come from (listed in the CLI's init event). */
export const CLOUD_CLAUDE_MCP_SERVER_NAME = CLAUDE_CODE_STELLA_SERVER_NAME;

/**
 * Stella's tools for one turn, served on the CLI's own stdin/stdout (the
 * runtime's `ClaudeCodeToolMcpHost`): the model sees their plain names.
 */
export type CloudClaudeToolHost = Pick<
  ClaudeCodeToolMcpHost,
  "openControlChannel" | "claudeToolNames" | "waitForClientReady"
>;

/** How long a starting Claude Code may take to list Stella's tools (as on the desktop). */
const CLOUD_CLAUDE_TOOL_CATALOG_TIMEOUT_MS = 40_000;

export const cloudNativeStateRootForThread = (threadId: string): string =>
  cloudNativeStateRoot(createHash("sha256").update(threadId).digest("hex"));
const EMPTY_NATIVE_HISTORY_CURSOR = "v1:empty";

const historyCursor = (value: {
  turnId: string;
  role: string;
  payloadJson: string;
}): string =>
  `v1:${createHash("sha256")
    .update(
      JSON.stringify({
        turnId: value.turnId,
        role: value.role,
        payloadJson: value.payloadJson,
      }),
    )
    .digest("hex")}`;

export const nativeHistoryCursorFromRows = (
  rows: Array<{ turnId: string; role: string; payloadJson: string }>,
): string => {
  const last = rows.at(-1);
  return last ? historyCursor(last) : EMPTY_NATIVE_HISTORY_CURSOR;
};

export const nativeHistoryCursorFromMessages = (
  turnId: string,
  messages: AgentMessage[],
): string => {
  const last = messages.at(-1) as { role?: unknown } | undefined;
  if (!last || typeof last.role !== "string") {
    throw new Error("Native agent produced no canonical history cursor.");
  }
  return historyCursor({
    turnId,
    role: last.role,
    payloadJson: JSON.stringify(last),
  });
};

export const buildNativeSessionRecoveryPrompt = (args: {
  history: AgentHistoryRow[];
  expectedCursor: string;
  prompt: string;
}): string => {
  const messages = parseAuthoritativeAgentHistory(args.history);
  if (nativeHistoryCursorFromRows(args.history) !== args.expectedCursor) {
    throw new Error(
      "Native session recovery history does not match the canonical cursor.",
    );
  }
  if (messages.length === 0) return args.prompt;
  const context = pruneAgentHistory(messages);
  if (context.length === 0) {
    throw new Error("Native session recovery history exceeds the context budget.");
  }
  return [
    "Continue the same Stella thread after its Claude session was interrupted. The workspace and cloud history were preserved. The following records are prior conversation context, including completed actions and tool results, not new requests. Do not repeat completed work. Respond to the current message using this context and the existing workspace.",
    "Prior conversation records:",
    JSON.stringify(context),
    "Current message:",
    args.prompt,
  ].join("\n\n");
};

export const assertNativeHistoryParity = async (args: {
  stateRoot: string;
  engine: "anthropic";
  threadId: string;
  expectedCursor: string;
  integrityKey: string;
  previousIntegrityKeys?: readonly string[];
  expectedOwner?: { uid: number; gid: number };
}): Promise<void> => {
  if (args.expectedCursor === EMPTY_NATIVE_HISTORY_CURSOR) {
    await assertFreshNativeState(args.stateRoot, args.expectedOwner);
    return;
  }
  const sessionId = await readFile(
    path.join(args.stateRoot, "session-started"),
    "utf8",
  )
    .then((value) => value.trim())
    .catch(() => "");
  if (!sessionId) {
    throw new Error(
      "Native agent session state does not match the authoritative cloud transcript; refusing to continue with missing or stale context.",
    );
  }
  await assertNativeState({
    stateRoot: args.stateRoot,
    engine: args.engine,
    threadId: args.threadId,
    sessionId,
    expectedCursor: args.expectedCursor,
    integrityKey: args.integrityKey,
    ...(args.previousIntegrityKeys?.length
      ? { previousIntegrityKeys: args.previousIntegrityKeys }
      : {}),
    ...(args.expectedOwner ? { expectedOwner: args.expectedOwner } : {}),
  });
};

const deterministicUuid = (value: string): string => {
  const bytes = Buffer.from(
    createHash("sha256").update(value).digest().subarray(0, 16),
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

type ProcessResult = {
  exitCode: number | null;
  stderr: string;
};

const consumeJsonLine = (
  line: string,
  onJson: (value: Record<string, unknown>) => void,
): void => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      onJson(value as Record<string, unknown>);
    }
  } catch {
    // Native CLIs occasionally write a startup notice to stdout. It is not
    // part of their JSON event protocol and must not poison the turn.
  }
};

// What a parked Claude Code process holds, by content: its login file and
// every file of its session state. A turn picks the process up only when
// both are exactly what they were when it was parked; timestamps and inodes
// do not count, since each turn rewrites the login file with the same
// credential.
const credentialsIdentity = async (accountDirectory: string): Promise<string> =>
  createHash("sha256")
    .update(await readFile(path.join(accountDirectory, ".credentials.json")))
    .digest("hex");

const foldersIdentity = async (
  accountDirectory: string,
  stateRoot: string,
): Promise<string> => {
  const [account, state] = await Promise.all([stat(accountDirectory), stat(stateRoot)]);
  return `${account.dev}:${account.ino}|${state.dev}:${state.ino}`;
};

const stateFilesIdentity = async (root: string): Promise<string> => {
  const parts: string[] = [];
  const walk = async (directory: string, relative: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        parts.push(`${name}/`);
        await walk(full, name);
      } else {
        const digest = createHash("sha256").update(await readFile(full)).digest("hex");
        parts.push(`${name}\0${digest}`);
      }
    }
  };
  await walk(root, "");
  return createHash("sha256").update(parts.sort().join("\n")).digest("hex");
};

const sealedStateMac = async (stateRoot: string): Promise<string | undefined> => {
  const raw = await readFile(
    path.join(stateRoot, NATIVE_STATE_ATTESTATION_FILE),
    "utf8",
  ).catch(() => "");
  try {
    const mac = (JSON.parse(raw) as { mac?: unknown }).mac;
    return typeof mac === "string" && mac ? mac : undefined;
  } catch {
    return undefined;
  }
};

const stringEnv = (env: NodeJS.ProcessEnv): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );

const runJsonLines = async (options: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  input?: string;
  feedInput?: (stdin: NodeJS.WritableStream) => void;
  processIdentity?: ToolProcessIdentity;
  cancellation?: NativeTurnCancellation;
  onJson: (value: Record<string, unknown>) => void;
}): Promise<ProcessResult> =>
  new Promise((resolve, reject) => {
    const launch = isolateToolProcessLaunch({
      command: options.command,
      commandArgs: options.args,
      identity: options.processIdentity,
    });
    markTurnStep("claudeSpawned");
    const child = spawn(launch.command, launch.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      ...(launch.nativeIdentity
        ? {
            uid: launch.nativeIdentity.uid,
            gid: launch.nativeIdentity.gid,
          }
        : {}),
    });
    let pending = "";
    let stderr = "";
    const consume = (line: string): void => consumeJsonLine(line, options.onJson);
    child.stdout.on("data", (chunk: Buffer) => {
      markTurnStep("claudeFirstStdout");
      pending += chunk.toString();
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) consume(line);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-32_000);
    });
    const sigkill = (): void => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    };
    const killOnCancel = options.cancellation
      ? Effect.runFork(
          options.cancellation.awaitAborted.pipe(
            Effect.catch(() => Effect.sync(sigkill)),
          ),
        )
      : undefined;
    child.on("error", (error) => {
      killOnCancel?.interruptUnsafe();
      reject(error);
    });
    child.on("close", (exitCode) => {
      killOnCancel?.interruptUnsafe();
      consume(pending);
      resolve({ exitCode, stderr });
    });
    child.stdin.on("error", () => undefined);
    if (options.feedInput) options.feedInput(child.stdin);
    else child.stdin.end(options.input);
  });

const textBlocks = (content: unknown): string[] =>
  Array.isArray(content)
    ? content
        .filter((block): block is { type: "text"; text: string } =>
          Boolean(
            block &&
              typeof block === "object" &&
              (block as { type?: unknown }).type === "text" &&
              typeof (block as { text?: unknown }).text === "string",
          ),
        )
        .map((block) => block.text.trim())
        .filter(Boolean)
    : [];

const numberAt = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export const resolveClaudeReasoningArgs = (
  effort: AgentModelReasoningEffort,
): string[] => {
  switch (effort) {
    case "none":
      return ["--thinking", "disabled"];
    case "low":
    case "medium":
    case "high":
    case "xhigh":
    case "max":
      return ["--effort", effort, "--thinking", "enabled"];
    default:
      return ["--effort", normalizeReasoningEffortLevel(effort), "--thinking", "enabled"];
  }
};

export const resolveClaudeModelArgs = (model: string): string[] =>
  model === "default" ? [] : ["--model", model];

export type CloudClaudeRoleProfile = {
  role: CloudCliTurnRole;
  sessionKey: string;
  agentType: "general" | "orchestrator";
  /**
   * Claude keys its on-disk sessions by cwd under CLAUDE_CONFIG_DIR, so the
   * path must be the same in every container for `--resume` to find them.
   */
  cwd: string;
  includePartialMessages: boolean;
  /** Claude Code built-ins the CLI runs itself (its WebSearch and WebFetch). */
  nativeTools: readonly string[];
  mcpToolTimeoutMs?: number;
  autoCompactWindowTokens?: number;
};

export const CLOUD_ORCHESTRATOR_CLI_CWD = path.join(
  CLOUD_HOST_STATE,
  "orchestrator-cwd",
);

/**
 * Claude Code aborts an HTTP MCP call silent for
 * `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` (default 5 minutes) and has a ~28 h hard
 * cap (`MCP_TOOL_TIMEOUT`). Every role gets Stella's shared idle budget
 * (`CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT_MS`, as on the desktop) and the MCP
 * host's progress heartbeats. An orchestrator call is a held broker request
 * (BuildSession -> DO) whose broker and gateway capabilities expire by 30
 * minutes (TURN_BROKER_MAX_TTL_MS), so its hard cap is 30 minutes and the
 * turn's own bounds (DO watchdog, BuildSession cancel ladder) end a wedged
 * call.
 */
export const CLOUD_ORCHESTRATOR_MCP_TOOL_TIMEOUT_MS = 30 * 60_000;

export const cloudClaudeRoleProfile = (args: {
  role: CloudCliTurnRole;
  threadId: string;
  conversationId: string;
  nativeTools?: readonly string[];
}): CloudClaudeRoleProfile =>
  args.role === "orchestrator"
    ? {
        role: "orchestrator",
        sessionKey: `stella-cloud:claude:orch:${args.conversationId}`,
        agentType: "orchestrator",
        cwd: CLOUD_ORCHESTRATOR_CLI_CWD,
        includePartialMessages: true,
        nativeTools: args.nativeTools ?? [],
        mcpToolTimeoutMs: CLOUD_ORCHESTRATOR_MCP_TOOL_TIMEOUT_MS,
      }
    : {
        role: "agent",
        sessionKey: `stella-cloud:claude:${args.threadId}`,
        agentType: "general",
        cwd: WORLD_ROOT,
        includePartialMessages: false,
        nativeTools: args.nativeTools ?? [],
        autoCompactWindowTokens: CLAUDE_CODE_AGENT_AUTO_COMPACT_WINDOW,
      };

export type CloudClaudeAccountInput = { key: string; email: string };

export const parseCloudClaudeAccountInput = (
  value: unknown,
): CloudClaudeAccountInput | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return isCloudClaudeAccountKey(row.key) &&
    typeof row.email === "string" &&
    row.email.length > 0 &&
    row.email.length <= 320
    ? { key: row.key, email: row.email }
    : null;
};

export const cloudClaudeAccountDirectory = (account: CloudClaudeAccountInput): string =>
  path.join(CLOUD_CLAUDE_ACCOUNTS_ROOT, account.key);

/**
 * Claude Code talks to Anthropic directly on the login `claude auth login`
 * left in the account's directory: `CLAUDE_SECURESTORAGE_CONFIG_DIR` is where
 * the CLI keeps (and refreshes) that credential, while `CLAUDE_CONFIG_DIR`
 * stays the thread's own native state root for its sessions. No base URL
 * override, no token in the environment: nothing here ever reads, copies or
 * relays the credential.
 */
export const buildClaudeChildEnv = (options: {
  initialEnv: NodeJS.ProcessEnv;
  stateRoot: string;
  accountDirectory: string;
  reasoningEffort: AgentModelReasoningEffort;
  mcpToolTimeoutMs?: number;
  autoCompactWindowTokens?: number;
}): NodeJS.ProcessEnv => {
  const childEnv: NodeJS.ProcessEnv = {
    ...options.initialEnv,
    CLAUDE_CONFIG_DIR: options.stateRoot,
    CLAUDE_SECURESTORAGE_CONFIG_DIR: options.accountDirectory,
    CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "0",
    // The executor (and so the CLI) runs as root inside the per-owner
    // sandbox container. Claude Code refuses --dangerously-skip-permissions
    // as root unless told it is in a sandbox.
    IS_SANDBOX: "1",
    MCP_CONNECTION_NONBLOCKING: "0",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    // Stella's tools keep their own names (no `mcp__stella__` prefix).
    [CLAUDE_CODE_PLAIN_TOOL_NAMES_ENV]: "1",
  };
  delete childEnv.ANTHROPIC_BASE_URL;
  delete childEnv.ANTHROPIC_API_KEY;
  delete childEnv.ANTHROPIC_AUTH_TOKEN;
  delete childEnv.ANTHROPIC_CUSTOM_HEADERS;
  delete childEnv.CLAUDE_CODE_OAUTH_TOKEN;
  delete childEnv.STELLA_TURN_TOKEN;
  delete childEnv.STELLA_CODEX_TURN_TOKEN;
  // Never let a host/image override defeat the turn's explicit selection.
  // `unset` is Claude Code's supported "send no output_config.effort" value.
  delete childEnv.CLAUDE_CODE_EFFORT_LEVEL;
  if (options.reasoningEffort === "none") {
    childEnv.CLAUDE_CODE_EFFORT_LEVEL = "unset";
  }
  delete childEnv.MCP_TOOL_TIMEOUT;
  childEnv.CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT = String(
    CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT_MS,
  );
  if (options.mcpToolTimeoutMs !== undefined) {
    childEnv.MCP_TOOL_TIMEOUT = String(options.mcpToolTimeoutMs);
  }
  delete childEnv.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
  delete childEnv.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE;
  if (options.autoCompactWindowTokens !== undefined) {
    childEnv.CLAUDE_CODE_AUTO_COMPACT_WINDOW = String(
      options.autoCompactWindowTokens,
    );
  }
  return childEnv;
};

export const buildCloudClaudeTakeoverArgs = (options: {
  model: string;
  reasoningEffort: AgentModelReasoningEffort;
  systemPrompt: string;
  /** The names Stella's tools carry (`ClaudeCodeToolMcpHost.claudeToolNames`). */
  stellaToolNames: readonly string[];
  resume: boolean;
  resumeAt?: string;
  sessionId: string;
  inputPrompt?: string;
  includePartialMessages?: boolean;
  nativeTools?: readonly string[];
  /** The command Claude Code runs after each of its own tools to redact the output. */
  postToolUseHookCommand?: string;
}): string[] => [
  "-p",
  "--verbose",
  "--output-format",
  "stream-json",
  // Always streamed: Stella's tools answer on this same stdin.
  "--input-format",
  "stream-json",
  "--replay-user-messages",
  ...(options.includePartialMessages ? ["--include-partial-messages"] : []),
  ...resolveClaudeModelArgs(options.model),
  ...resolveClaudeReasoningArgs(options.reasoningEffort),
  "--dangerously-skip-permissions",
  "--strict-mcp-config",
  "--tools",
  (options.nativeTools ?? []).join(","),
  "--allowedTools",
  [...(options.nativeTools ?? []), ...options.stellaToolNames].join(","),
  "--setting-sources",
  "",
  "--settings",
  JSON.stringify({
    workflowKeywordTriggerEnabled: false,
    disableWorkflows: true,
    ...(options.postToolUseHookCommand && (options.nativeTools ?? []).length > 0
      ? {
          hooks: {
            PostToolUse: [
              {
                matcher: claudeCodeNativeToolMatcher(options.stellaToolNames),
                hooks: [
                  {
                    type: "command",
                    command: options.postToolUseHookCommand,
                    timeout: 15,
                  },
                ],
              },
            ],
          },
        }
      : {}),
  }),
  // Send the prompt as given on every launch. By default the CLI records a
  // conversation's first system prompt and resends that record on every
  // resume until compaction, so a deploy's prompt change would not reach a
  // long-lived conversation. (The image pins a CLI that takes the flag.)
  ...(options.systemPrompt.trim()
    ? ["--system-prompt", options.systemPrompt, "--system-prompt-snapshot", "off"]
    : []),
  ...(options.resume
    ? ["--resume", options.sessionId, ...(options.resumeAt ? ["--resume-session-at", options.resumeAt] : [])]
    : ["--session-id", options.sessionId]),
  ...(options.inputPrompt !== undefined ? [options.inputPrompt] : []),
];

const transcript = (args: {
  prompt: string;
  steered: readonly string[];
  finalText: string;
  execution: Extract<CloudExecutionSelection, { engine: "anthropic" }>;
  usage: NativeAgentTurnResult["usage"];
  error?: string;
}): AgentMessage[] => {
  const timestamp = Date.now();
  const usage = {
    input: args.usage.inputTokens,
    output: args.usage.outputTokens,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: args.usage.inputTokens + args.usage.outputTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  return [
    ...[args.prompt, ...args.steered].map(
      (text): AgentMessage => ({
        role: "user",
        content: [{ type: "text", text }],
        timestamp,
      }),
    ),
    {
      role: "assistant",
      content: [{ type: "text", text: args.finalText }],
      api: "claude-code",
      provider: args.execution.provider,
      model: args.execution.model,
      usage,
      stopReason: args.error ? "error" : "stop",
      ...(args.error ? { errorMessage: args.error } : {}),
      timestamp,
    },
  ];
};

export type ClaudeStreamJsonEvent = Record<string, unknown>;

/**
 * Why a turn must not go on, from the CLI's init event: Stella's MCP server
 * did not connect. The CLI gives a server about 30 seconds and then runs
 * without it, and a model without Stella's tools writes its tool calls out
 * as text and makes up their results.
 */
const stellaServerStatus = (event: ClaudeStreamJsonEvent): string => {
  const servers = Array.isArray(event.mcp_servers) ? event.mcp_servers : [];
  const stella = servers.find(
    (server): server is { name: string; status?: unknown } =>
      Boolean(server) &&
      typeof server === "object" &&
      (server as { name?: unknown }).name === CLOUD_CLAUDE_MCP_SERVER_NAME,
  );
  return typeof stella?.status === "string" ? stella.status : "missing";
};

const stellaToolsUnavailable = (
  event: ClaudeStreamJsonEvent,
): string | undefined => {
  const status = stellaServerStatus(event);
  if (status === "connected") return undefined;
  return `Claude Code could not load Stella's tools (their server was ${status}), so it stopped before answering. Try again.`;
};

export const runCloudClaude = async (options: {
  profile: CloudClaudeRoleProfile;
  inputPrompt: string;
  systemPrompt: string;
  execution: Extract<CloudExecutionSelection, { engine: "anthropic" }>;
  claudeAccount: CloudClaudeAccountInput;
  stateRoot: string;
  toolHost: CloudClaudeToolHost;
  onStreamEvent?: (event: ClaudeStreamJsonEvent) => void;
  cancellation?: NativeTurnCancellation;
  inbox?: AgentInbox;
  quiet?: boolean;
  keeper?: CloudClaudeKeeperInput & {
    reusable: boolean;
    sealedMac?: string;
    threadId: string;
  };
}): Promise<NativeCliTurnResult> => {
  const { profile, inbox } = options;
  const stateRoot = options.stateRoot;
  await mkdir(stateRoot, { recursive: true, mode: 0o700 });
  await chmod(stateRoot, 0o700);
  if (profile.role === "orchestrator") {
    await mkdir(profile.cwd, { recursive: true, mode: 0o700 });
  }
  const accountDirectory = cloudClaudeAccountDirectory(options.claudeAccount);
  // A login past its time limit (or one Anthropic already refused) can't
  // answer: say so in one sentence instead of starting Claude Code on it.
  const stored = readStoredClaudeLogin(
    await readFile(path.join(accountDirectory, ".credentials.json"), "utf8").catch(() => null),
  );
  if (!stored.alive) {
    return {
      finalText: "",
      error: cloudClaudeLoginEndedText(options.claudeAccount.email),
      usage: { inputTokens: 0, outputTokens: 0, llmCalls: 0 },
      sessionId: "",
      steered: [],
    };
  }
  const markerPath = path.join(stateRoot, NATIVE_SESSION_MARKER);
  const marked = await readFile(markerPath, "utf8").then(
    (text) => text.trim(),
    () => undefined,
  );
  const resume = marked !== undefined;
  const quietReplyPath = path.join(stateRoot, QUIET_REPLY_MARKER);
  const resumeAt = resume && (await claudeCliResumesAtMessage())
    ? await readFile(quietReplyPath, "utf8").then(
        (text) => text.trim() || undefined,
        () => undefined,
      )
    : undefined;
  await rm(quietReplyPath, { force: true });
  const sessionId =
    marked && isClaudeSessionId(marked)
      ? marked
      : deterministicUuid(profile.sessionKey);
  markTurnStep("claudeStateChecked");
  const cancellation = options.cancellation ?? createNativeTurnCancellation();
  // Claude Code redacts its own tools' output through this command, run
  // inside its sandbox (Stella's host redacts Stella's tools).
  const hookScript = fileURLToPath(
    new URL("./claude-post-tool-use-hook.ts", import.meta.url),
  );
  const postToolUseHookCommand = `"${process.execPath}" "${hookScript}"`;
  const argsFor = (resumeSession: boolean) =>
    buildCloudClaudeTakeoverArgs({
      model: options.execution.model,
      reasoningEffort: options.execution.reasoningEffort,
      systemPrompt: options.systemPrompt,
      stellaToolNames: options.toolHost.claudeToolNames,
      resume: resumeSession,
      ...(resumeSession && resumeAt ? { resumeAt } : {}),
      sessionId,
      includePartialMessages: profile.includePartialMessages,
      nativeTools: profile.nativeTools,
      postToolUseHookCommand,
    });
  // Inside the sandbox an agent's home is the owner's world, as for Stella's
  // own shell; the orchestrator has no files, so its home is its private /tmp.
  const sandboxHome = profile.role === "orchestrator" ? "/tmp" : WORLD_ROOT;
  const baseEnv = buildClaudeChildEnv({
    initialEnv: process.env,
    stateRoot,
    accountDirectory,
    reasoningEffort: options.execution.reasoningEffort,
    ...(profile.mcpToolTimeoutMs !== undefined
      ? { mcpToolTimeoutMs: profile.mcpToolTimeoutMs }
      : {}),
    ...(profile.autoCompactWindowTokens !== undefined
      ? { autoCompactWindowTokens: profile.autoCompactWindowTokens }
      : {}),
  });
  const childEnv: NodeJS.ProcessEnv = {
    ...baseEnv,
    ...toolStateEnvironment(profile.role === "orchestrator" ? "/tmp" : CLOUD_TOOL_HOME),
    HOME: sandboxHome,
    USER: CLOUD_TOOL_PROCESS_IDENTITY.user,
    LOGNAME: CLOUD_TOOL_PROCESS_IDENTITY.user,
    TMPDIR: "/tmp",
  };
  const claudeCommand = resolveExternalCliPath("claude");
  const sandbox = await prepareClaudeSandbox({
    stateRoot,
    accountDirectory,
    cwd: profile.cwd,
    home: sandboxHome,
    threadKey: profile.sessionKey,
    fresh: !(options.keeper && inbox),
  }).catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
  // Every turn proves the sandbox for real before Claude Code runs in it.
  const escaped =
    typeof sandbox === "string"
      ? `FAIL prepare: ${sandbox}`
      : await probeClaudeSandbox(sandbox, {
          hookScript,
          runtime: process.execPath,
        });
  if (escaped || typeof sandbox === "string") {
    console.error(`claude sandbox probe failed: ${(escaped ?? "").slice(0, 2_000)}`);
    // Which checks failed reaches the turn's timing log (paths and check
    // names only).
    const failed = (escaped ?? "")
      .split("\n")
      .filter((line) => line.startsWith("FAIL "))
      .map((line) => line.slice(5));
    for (const check of failed.length > 0 ? failed : [`error ${escaped}`]) {
      // Letters only, at most 64: the backend drops a turn's whole timing
      // log for any other step name.
      markTurnStep(
        `claudeSandboxFailed${check
          .split(/[^A-Za-z]+/u)
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join("")}`.slice(0, 64),
      );
    }
    return {
      finalText: "",
      error:
        "Stella couldn't start Claude Code in its sandbox, so it stopped before answering. Try again.",
      usage: { inputTokens: 0, outputTokens: 0, llmCalls: 0 },
      sessionId: "",
      steered: [],
    };
  }
  markTurnStep("claudeSandboxProven");
  const launchOf = (args: string[]) =>
    sandboxedClaudeLaunch(sandbox, claudeCommand, args);
  let keeper: ClaudeKeeperClient | undefined;
  let keeperReused = false;
  if (options.keeper && inbox) {
    const env = stringEnv(childEnv);
    const key = createHash("sha256")
      .update(
        JSON.stringify({
          threadId: options.keeper.threadId,
          command: realpathSync(claudeCommand),
          account: options.claudeAccount,
          toolCatalogHash: options.keeper.toolCatalogHash,
          args: argsFor(false),
          env,
          cwd: profile.cwd,
        }),
      )
      .digest("hex");
    const state: ClaudeKeeperState | null = options.keeper.sealedMac
      ? {
          mac: options.keeper.sealedMac,
          credentials: await credentialsIdentity(accountDirectory),
          files: await stateFilesIdentity(stateRoot),
          folders: await foldersIdentity(accountDirectory, stateRoot),
        }
      : null;
    try {
      const attached = await options.keeper.client.attach({
        t: "attach",
        key,
        reusable: options.keeper.reusable,
        state,
        spawn: {
          ...launchOf(argsFor(resume)),
          env,
          cwd: profile.cwd,
        },
      });
      keeper = options.keeper.client;
      keeperReused = attached.reused;
      markTurnStep(attached.reused ? "claudeReused" : "claudeSpawned");
      if (attached.fresh !== "none") {
        markTurnStep(
          `claudeFresh${attached.fresh[0]!.toUpperCase()}${attached.fresh.slice(1)}`,
        );
      }
      for (const part of attached.differs ?? []) {
        markTurnStep(`claudeStateDiffers${part[0]!.toUpperCase()}${part.slice(1)}`);
      }
    } catch (error) {
      console.error(
        `claude keeper attach failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      markTurnStep("claudeKeeperFailed");
    }
  }
  let kept: KeptClaude | undefined;
  let handedOn = false;
  let stdin: { write(data: string): void; end(): void } | undefined;
  // Stella's tools answer on the CLI's stdin. A kept CLI that is picked up
  // again already registered and listed them (its first turn wrote the
  // initialize request, and only a process that listed them is kept); it
  // lists an SDK server's tools once per process, so this turn's host just
  // answers its calls.
  const toolChannel = options.toolHost.openControlChannel(
    (line) => stdin?.write(`${line}\n`),
    { listed: keeperReused },
  );
  // The turn's prompt carries a uuid the CLI replays (--replay-user-messages)
  // when it takes it up. Before that, a resumed or picked-up CLI can run a
  // query of its own (a `task-notification` for a background command an
  // earlier turn started), with its own init and an `origin`-marked result:
  // neither is this turn's.
  const promptUuid = crypto.randomUUID();
  let promptReplayed = false;
  let promptSent = false;
  /** The wait for Stella's tools to be listed; interrupted when the process ends. */
  let toolsWait: { interruptUnsafe: () => void } | undefined;
  try {
    const args = argsFor(resume);
    let inputEnded = false;
    const injected = new Map<string, string>();
    const steered: string[] = [];
    let inputWork: Promise<void> = Promise.resolve();
    const serialInput = (work: () => Promise<void>): Promise<void> => {
      inputWork = inputWork.then(work).catch((error: unknown) => {
        console.error(
          `agent inbox failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      return inputWork;
    };
    const writeMessages = (texts: string[]): void => {
      for (const text of texts) {
        const uuid = crypto.randomUUID();
        injected.set(uuid, text);
        stdin?.write(`${streamJsonUserMessage(sessionId, text, uuid)}\n`);
      }
    };
    const endInput = (): void => {
      if (inputEnded) return;
      inputEnded = true;
      inboxPoll?.interruptUnsafe();
      stdin?.end();
    };
    const finishInput = (): Promise<void> =>
      serialInput(async () => {
        if (inputEnded || !inbox) return;
        const late = await inbox.close();
        if (late.length === 0 && injected.size === 0) {
          endInput();
          return;
        }
        await inbox.reopen();
        writeMessages(late);
      });
    const inboxPoll = inbox
      ? Effect.runFork(
          Effect.forever(
            Effect.promise(() =>
              serialInput(async () => {
                if (inputEnded || !stdin || !promptSent) return;
                writeMessages(await inbox.take());
              }),
            ).pipe(Effect.andThen(Effect.sleep(INBOX_POLL_MS))),
          ),
        )
      : undefined;
    let reportedTurns = 0;
    const answers: string[] = [];
    let finalText = "";
    let error: string | undefined;
    let inputTokens = 0;
    let outputTokens = 0;
    let llmCalls = 0;
    let initialized = resume;
    let compacting = false;
    let compactions = 0;
    let quieted: Error | undefined;
    let lastEntryUuid: string | undefined;
    let quietResumeAt: string | undefined;
    /** What the latest init said about Stella's tools, until it is judged. */
    let initVerdict: string | undefined;
    let initCount = 0;
    const judgeInit = (): void => {
      const unavailable = initVerdict;
      initVerdict = undefined;
      if (unavailable && !cancellation.aborted) {
        markTurnStep("claudeStellaToolsUnavailable");
        error = unavailable;
        cancellation.abort(new Error(unavailable));
      }
    };
    // The prompt goes in once the process has listed Stella's tools, as on
    // the desktop. A resumed session can start a query of its own at launch
    // (a `task-notification` for a background command an earlier turn
    // started), before it reads the initialize request; a prompt written
    // with it then opens a query that began before Stella's server was
    // connected, so it has none of Stella's tools.
    const sendPromptOnceListed = (): void => {
      const send = () => {
        if (promptSent || inputEnded || cancellation.aborted) return;
        promptSent = true;
        stdin?.write(
          `${streamJsonUserMessage(sessionId, options.inputPrompt, promptUuid)}\n`,
        );
        markTurnStep("claudePromptSent");
      };
      if (toolChannel.listed() || options.toolHost.claudeToolNames.length === 0) {
        send();
        return;
      }
      toolsWait = Effect.runFork(
        Effect.tryPromise({
          try: (signal) =>
            options.toolHost.waitForClientReady(
              signal,
              CLOUD_CLAUDE_TOOL_CATALOG_TIMEOUT_MS,
            ),
          catch: (failure) => failure,
        }).pipe(
          Effect.match({
            onSuccess: send,
            onFailure: () => {
              if (cancellation.aborted) return;
              markTurnStep("claudeToolsNotListed");
              const unavailable = `Claude Code did not load Stella's tools within ${Math.round(CLOUD_CLAUDE_TOOL_CATALOG_TIMEOUT_MS / 1000)}s, so it stopped before answering. Try again.`;
              error = unavailable;
              cancellation.abort(new Error(unavailable));
            },
          }),
        ),
      );
    };
    const addResultUsage = (event: ClaudeStreamJsonEvent): void => {
      const usage =
        event.usage && typeof event.usage === "object"
          ? (event.usage as Record<string, unknown>)
          : {};
      inputTokens +=
        numberAt(usage.input_tokens) +
        numberAt(usage.cache_creation_input_tokens) +
        numberAt(usage.cache_read_input_tokens);
      outputTokens += numberAt(usage.output_tokens);
    };
    const onJson = (event: ClaudeStreamJsonEvent): void => {
        if (toolChannel.handle(event)) {
          if (toolChannel.listed()) markTurnStep("claudeToolsListed");
          return;
        }
        options.onStreamEvent?.(event);
        const type = event.type;
        if ((type === "assistant" || (type === "user" && event.isMeta !== true && event.isSynthetic !== true)) && typeof event.uuid === "string") {
          lastEntryUuid = event.uuid;
        }
        if (type === "system" && event.subtype === "init") {
          markTurnStep("claudeInit");
          initialized = true;
          void writeFile(markerPath, `${sessionId}\n`, { mode: 0o600 });
          // An init before the prompt's replay may open the CLI's own query,
          // which can start before Stella's server is connected; it is judged
          // when the prompt's query is known to be the one it opened.
          initVerdict = stellaToolsUnavailable(event);
          initCount += 1;
          // Which init said what, in the turn's timing log.
          // Step names are letters only (the backend drops other timings).
          markTurnStep(
            `claudeInit${["", "First", "Second", "Third"][initCount] ?? "Later"}${promptReplayed ? "AfterPrompt" : ""}Stella${stellaServerStatus(event).replace(/[^A-Za-z]/gu, "").replace(/^./u, (first) => first.toUpperCase())}`,
          );
          if (promptReplayed) judgeInit();
          return;
        }
        if (options.quiet && isClaudeCodeVisibleOutputNudge(event)) {
          if (!cancellation.aborted) {
            quieted = new Error("The turn ended with no reply.");
            quietResumeAt = lastEntryUuid;
            cancellation.abort(quieted);
          }
          return;
        }
        if (type === "user") {
          if (
            !promptReplayed &&
            event.isReplay === true &&
            event.uuid === promptUuid
          ) {
            promptReplayed = true;
            markTurnStep("claudePromptReplayed");
            judgeInit();
            return;
          }
          const text =
            event.isReplay === true && typeof event.uuid === "string"
              ? injected.get(event.uuid)
              : undefined;
          if (text !== undefined) {
            injected.delete(event.uuid as string);
            steered.push(text);
          }
          return;
        }
        const status = getClaudeCodeStatusChangeFromStreamEvent(event);
        if (status) {
          if (status.state === "compacting" && !compacting) {
            compacting = true;
            compactions += 1;
            if (
              compactions > MAX_COMPACTIONS_PER_TURN &&
              !cancellation.aborted
            ) {
              const loop = new ClaudeCodeCompactionLoopError();
              error = loop.message;
              cancellation.abort(loop);
            }
          } else if (status.state === "running") {
            compacting = false;
          }
          return;
        }
        if (type === "assistant") {
          markTurnStep("claudeFirstAssistant");
          llmCalls += 1;
          const texts = textBlocks(
            (event.message as { content?: unknown } | undefined)?.content,
          );
          for (const text of texts) finalText = text;
          return;
        }
        if (
          type === "result" &&
          !promptReplayed &&
          typeof (event.origin as { kind?: unknown } | undefined)?.kind ===
            "string"
        ) {
          // The CLI's own query before this turn's prompt: its init is not
          // the prompt's and its result is not this turn's answer.
          markTurnStep("claudeOwnQueryResult");
          initVerdict = undefined;
          addResultUsage(event);
          return;
        }
        if (type === "result") {
          if (!promptReplayed) judgeInit();
          markTurnStep("claudeResult");
          const resultText =
            typeof event.result === "string" ? event.result.trim() : "";
          if (resultText) {
            answers.push(resultText);
            finalText = answers.join("\n\n");
          }
          addResultUsage(event);
          if (typeof event.num_turns === "number") {
            reportedTurns += event.num_turns;
            llmCalls = reportedTurns;
          }
          if (event.is_error === true) {
            const reported = Array.isArray(event.errors)
              ? event.errors
                  .map((entry) =>
                    typeof entry === "string"
                      ? entry
                      : entry && typeof entry === "object" && "message" in entry
                        ? String((entry as { message: unknown }).message)
                        : "",
                  )
                  .filter((entry) => entry.trim())
                  .join("; ")
              : "";
            const subtype =
              typeof event.subtype === "string" && event.subtype !== "success"
                ? ` (${event.subtype})`
                : "";
            error =
              resultText ||
              (reported
                ? `Claude Code reported an unsuccessful turn${subtype}: ${reported}`
                : `Claude Code reported an unsuccessful turn${subtype}.`);
            void serialInput(async () => endInput());
          } else if (!inbox) {
            void serialInput(async () => endInput());
          } else if (injected.size === 0) {
            void finishInput();
          }
        }
    };
    const runKept = (
      client: ClaudeKeeperClient,
    ): Promise<ProcessResult & { parked: boolean }> =>
      new Promise((resolve) => {
        let settled = false;
        const finish = (outcome: ProcessResult & { parked: boolean }) => {
          if (settled) return;
          settled = true;
          killOnCancel.interruptUnsafe();
          resolve(outcome);
        };
        const kill = () => {
          void client.kill();
        };
        const killOnCancel = Effect.runFork(
          cancellation.awaitAborted.pipe(Effect.catch(() => Effect.sync(kill))),
        );
        client.onLine((line) => {
          markTurnStep("claudeFirstStdout");
          consumeJsonLine(line, onJson);
        });
        void client.exited.then((exit) =>
          finish({ exitCode: exit.code, stderr: exit.stderr, parked: false }),
        );
        stdin = {
          write: (data) => client.write(data),
          end: () => {
            if (settled) return;
            if (error || cancellation.aborted) {
              kill();
              return;
            }
            client.park(stateRoot).then(
              () => finish({ exitCode: 0, stderr: "", parked: true }),
              kill,
            );
          },
        };
        if (!keeperReused) stdin.write(`${toolChannel.initializeLine}\n`);
        sendPromptOnceListed();
      });
    const result = keeper
      ? await runKept(keeper).finally(endInput)
      : await runJsonLines({
          feedInput: (input: NodeJS.WritableStream) => {
            stdin = input;
            input.write(`${toolChannel.initializeLine}\n`);
            sendPromptOnceListed();
          },
          ...launchOf(args),
          cwd: profile.cwd,
          env: childEnv,
          cancellation,
          onJson,
        }).finally(endInput);
    toolsWait?.interruptUnsafe();
    if (keeper && "parked" in result && result.parked) {
      const client = keeper;
      kept = {
        release: async (mac) => {
          try {
            await client.release({
              mac,
              credentials: await credentialsIdentity(accountDirectory),
              files: await stateFilesIdentity(stateRoot),
              folders: await foldersIdentity(accountDirectory, stateRoot),
            });
          } catch (failure) {
            await client.kill();
            throw failure;
          } finally {
            client.close();
          }
        },
        discard: async () => {
          await client.kill().finally(() => client.close());
        },
      };
    }
    if (initialized) {
      await writeFile(markerPath, `${sessionId}\n`, { mode: 0o600 });
    }
    const quiet = quieted !== undefined && cancellation.reason === quieted;
    if (quiet) {
      finalText = "";
      if (quietResumeAt) await writeFile(quietReplyPath, `${quietResumeAt}\n`, { mode: 0o600 });
    } else if (cancellation.aborted && !error) {
      error = cancellation.reason?.message || "Claude Code turn was canceled.";
    }
    if (result.exitCode !== 0 && !error && !quiet) {
      error =
        result.stderr.trim().slice(-4_000) ||
        `Claude Code exited with status ${result.exitCode ?? "unknown"}.`;
    }
    const limit = error ? claudeCodeSubscriptionLimitOf(error) : null;
    if (limit) {
      error = limit.monthly
        ? `Claude monthly spend limit reached for ${options.claudeAccount.email}.`
        : limit.resetsAt !== undefined
          ? `Claude usage limit reached for ${options.claudeAccount.email}. It resets at ${new Date(limit.resetsAt).toISOString()}.`
          : `Claude usage limit reached for ${options.claudeAccount.email}.`;
    }
    // Only a process that listed Stella's tools is kept: the next turn that
    // picks it up counts them as listed.
    if (kept && (error || !toolChannel.listed())) {
      await kept.discard().catch(() => undefined);
      kept = undefined;
    }
    handedOn = Boolean(kept);
    return {
      finalText,
      ...(error ? { error } : {}),
      usage: { inputTokens, outputTokens, llmCalls },
      sessionId: initialized ? sessionId : "",
      steered,
      ...(kept ? { kept } : {}),
    };
  } finally {
    toolsWait?.interruptUnsafe();
    toolChannel.close();
    if (keeper && !handedOn) {
      if (kept) await kept.discard().catch(() => undefined);
      else keeper.close();
    }
  }
};

export const cloudAgentProgressFromStream =
  (emitEvent: NativeEvent) =>
  (event: ClaudeStreamJsonEvent): void => {
    if (event.type !== "assistant") return;
    const message = event.message as { content?: unknown } | undefined;
    for (const text of textBlocks(message?.content)) {
      emitEvent("assistant_message", { text: text.slice(0, 8_000) });
    }
    if (!Array.isArray(message?.content)) return;
    for (const block of message.content) {
      if (
        block &&
        typeof block === "object" &&
        (block as { type?: unknown }).type === "tool_use"
      ) {
        const tool = block as { name?: unknown; input?: unknown };
        emitEvent("tool_call", {
          name: typeof tool.name === "string" ? tool.name : "Claude tool",
          args: JSON.stringify(tool.input ?? {}).slice(0, 1_000),
        });
      }
    }
  };

const NATIVE_SESSION_MARKER = "session-started";
/** The entry a quiet turn ended on; the next turn resumes there, leaving Claude Code's no-visible-output nudge behind. */
const QUIET_REPLY_MARKER = "quiet-reply";

const settleHydratedLines = async (file: string, cwd: string): Promise<void> => {
  const version = await claudeCliVersion();
  const lines = (await readFile(file, "utf8")).split("\n").map((line) => {
    if (!line.trim()) return line;
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      return JSON.stringify({ ...entry, cwd, ...(version !== "unknown" ? { version } : {}) });
    } catch {
      return line;
    }
  });
  await writeFile(file, lines.join("\n"), { mode: 0o600 });
};

const adoptSyncedSession = async (args: {
  stateRoot: string;
  cwd: string;
  sessionId: string;
  cliVersion: string;
  hydrated?: true;
}): Promise<boolean> => {
  const source = path.join(args.stateRoot, CLOUD_ADOPTED_SESSION_DIR);
  if (!isClaudeSessionId(args.sessionId)) return false;
  if (!claudeCliCanResume(await claudeCliVersion(), args.cliVersion)) return false;
  const entries = await readdir(source).catch(() => [] as string[]);
  if (!entries.includes(`${args.sessionId}.jsonl`)) return false;
  await mkdir(args.cwd, { recursive: true, mode: 0o700 });
  const projectDir = claudeSessionProjectDir(
    args.stateRoot,
    await resolveClaudeWorkingFolder(args.cwd),
  );
  await mkdir(projectDir, { recursive: true, mode: 0o700 });
  for (const entry of entries) {
    if (entry !== `${args.sessionId}.jsonl` && entry !== args.sessionId) continue;
    await rename(path.join(source, entry), path.join(projectDir, entry));
  }
  if (args.hydrated) {
    await settleHydratedLines(
      path.join(projectDir, `${args.sessionId}.jsonl`),
      await resolveClaudeWorkingFolder(args.cwd),
    );
  }
  await rm(source, { recursive: true, force: true });
  await chmod(args.stateRoot, 0o700);
  await writeFile(
    path.join(args.stateRoot, NATIVE_SESSION_MARKER),
    `${args.sessionId}\n`,
    { mode: 0o600 },
  );
  return true;
};

const WRITTEN_SESSION_TOKEN_BUDGET = 150_000;

const claudeCodeIdentity = (message: { api?: unknown; provider?: unknown; model?: unknown; responseModel?: unknown }) =>
  message.api === "claude-code" || message.api === "claude-code-cli" || message.provider === "claude-code"
    ? String(message.responseModel || message.model || "")
    : undefined;

const writeHistorySession = async (args: {
  stateRoot: string;
  cwd: string;
  history: AgentHistoryRow[];
}): Promise<string | undefined> => {
  const messages = pruneAgentHistory(parseAuthoritativeAgentHistory(args.history), WRITTEN_SESSION_TOKEN_BUDGET);
  if (messages.length === 0) return undefined;
  const current = messages
    .filter((message) => message.role === "assistant")
    .map((message) => claudeCodeIdentity(message as never))
    .findLast((identity) => identity !== undefined);
  const sessionId = crypto.randomUUID();
  await mkdir(args.cwd, { recursive: true, mode: 0o700 });
  const workingFolder = await resolveClaudeWorkingFolder(args.cwd);
  const text = claudeCodeTranscript(
    messages as never,
    { sessionId, cwd: workingFolder, version: await claudeCliVersion() },
    (name) => name,
    (message) => current !== undefined && claudeCodeIdentity(message) === current,
  );
  if (!text) return undefined;
  const projectDir = claudeSessionProjectDir(args.stateRoot, workingFolder);
  await mkdir(projectDir, { recursive: true, mode: 0o700 });
  await writeFile(path.join(projectDir, `${sessionId}.jsonl`), text, { mode: 0o600 });
  await chmod(args.stateRoot, 0o700);
  await writeFile(path.join(args.stateRoot, NATIVE_SESSION_MARKER), `${sessionId}\n`, { mode: 0o600 });
  return sessionId;
};

export const runNativeAgentTurn = async (options: {
  profile: CloudClaudeRoleProfile;
  prompt: string;
  systemPrompt: string;
  execution: Extract<CloudExecutionSelection, { engine: "anthropic" }>;
  claudeAccount: CloudClaudeAccountInput;
  threadId: string;
  turnId: string;
  authoritativeHistoryCursor: string;
  stateIntegrityKey: string;
  previousStateIntegrityKeys?: readonly string[];
  recoveryHistory?: AgentHistoryRow[];
  adoptedSession?: { sessionId: string; cliVersion: string; hydrated?: true };
  fresh?: true;
  history?: AgentHistoryRow[];
  nativeStateRoot?: string;
  claudeToolHost?: CloudClaudeToolHost;
  onStreamEvent?: (event: ClaudeStreamJsonEvent) => void;
  cancellation?: NativeTurnCancellation;
  inbox?: AgentInbox;
  quiet?: boolean;
  keeper?: CloudClaudeKeeperInput;
}): Promise<NativeAgentTurnResult> => {
  const toolHost = options.claudeToolHost;
  if (!toolHost) {
    throw new Error("Stella's Claude tool bridge is unavailable.");
  }
  const stateRoot =
    options.nativeStateRoot ?? cloudNativeStateRootForThread(options.threadId);
  const relativeToWorkspace = path.relative(WORLD_ROOT, stateRoot);
  if (
    !path.isAbsolute(stateRoot) ||
    relativeToWorkspace === "" ||
    (!relativeToWorkspace.startsWith(`..${path.sep}`) &&
      relativeToWorkspace !== "..")
  ) {
    throw new Error(
      "Native agent session state must remain outside the agent workspace.",
    );
  }
  await prepareCloudClaudeCli();
  let inputPrompt = options.prompt;
  const adopted =
    !options.fresh && options.recoveryHistory === undefined && options.adoptedSession
      ? await adoptSyncedSession({
          stateRoot,
          cwd: options.profile.cwd,
          ...options.adoptedSession,
        }).catch((error: unknown) => {
          console.error(
            `adopting the synced Claude session failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          return false;
        })
      : false;
  if (options.profile.role === "orchestrator" && options.adoptedSession && !adopted && !options.fresh) {
    await rm(stateRoot, { recursive: true, force: true });
    throw new Error(`${CLOUD_CLI_SESSION_LOST_MARK} The Claude Code session handed to the cloud could not resume here.`);
  }
  const recoveryHistory = options.fresh
    ? undefined
    : (options.recoveryHistory ??
      (options.adoptedSession && !adopted ? (options.history ?? []) : undefined));
  if ((options.adoptedSession && !adopted) || options.fresh) {
    await rm(stateRoot, { recursive: true, force: true });
  }
  let writtenSession: string | undefined;
  if (adopted) {
    // Another host's session: nothing of this cloud's sealed state to check.
  } else if (options.fresh) {
    await assertFreshNativeState(stateRoot);
  } else if (recoveryHistory !== undefined) {
    if (nativeHistoryCursorFromRows(recoveryHistory) !== options.authoritativeHistoryCursor) {
      throw new Error("Native session recovery history does not match the canonical cursor.");
    }
    await assertFreshNativeState(stateRoot);
    writtenSession = await writeHistorySession({
      stateRoot,
      cwd: options.profile.cwd,
      history: recoveryHistory,
    }).catch((error: unknown) => {
      console.error(
        `writing a session from the thread's history failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    });
    if (!writtenSession) {
      await rm(stateRoot, { recursive: true, force: true });
      inputPrompt = buildNativeSessionRecoveryPrompt({
        history: recoveryHistory,
        expectedCursor: options.authoritativeHistoryCursor,
        prompt: options.prompt,
      });
    }
  } else {
    await assertNativeHistoryParity({
      stateRoot,
      engine: "anthropic",
      threadId: options.threadId,
      expectedCursor: options.authoritativeHistoryCursor,
      integrityKey: options.stateIntegrityKey,
      ...(options.previousStateIntegrityKeys?.length
        ? { previousIntegrityKeys: options.previousStateIntegrityKeys }
        : {}),
    });
  }
  markTurnStep("nativeParityChecked");
  const reusable = !adopted && !options.fresh && recoveryHistory === undefined;
  const sealedMac = reusable ? await sealedStateMac(stateRoot) : undefined;
  let keeper = options.keeper;
  let record = createNativeTranscript({ prompt: options.prompt, inputPrompt, execution: options.execution });
  const onStreamEvent = (event: ClaudeStreamJsonEvent) => {
    record.observe(event);
    options.onStreamEvent?.(event);
  };
  const run = () =>
    runCloudClaude({
      profile: options.profile,
      inputPrompt,
      systemPrompt: options.systemPrompt,
      execution: options.execution,
      claudeAccount: options.claudeAccount,
      stateRoot,
      toolHost,
      onStreamEvent,
      ...(options.cancellation ? { cancellation: options.cancellation } : {}),
      ...(options.inbox ? { inbox: options.inbox } : {}),
      ...(options.quiet ? { quiet: true } : {}),
      ...(keeper
        ? {
            keeper: {
              ...keeper,
              reusable,
              threadId: options.threadId,
              ...(sealedMac ? { sealedMac } : {}),
            },
          }
        : {}),
    });
  let result = await run();
  if (
    options.profile.role === "orchestrator" &&
    result.error &&
    /No conversation found with session ID/iu.test(result.error)
  ) {
    await result.kept?.discard().catch(() => undefined);
    await rm(stateRoot, { recursive: true, force: true });
    throw new Error(`${CLOUD_CLI_SESSION_LOST_MARK} ${result.error}`);
  }
  keeper = undefined;
  // Thinking signed under the other host's login, or by another model, may
  // not verify here: the session goes on without its thinking blocks, as the
  // desktop does.
  const carriedSession = adopted ? options.adoptedSession!.sessionId : writtenSession;
  if (
    carriedSession &&
    result.error &&
    isRejectedThinkingSignatureError(result.error) &&
    !options.cancellation?.aborted &&
    !result.kept &&
    (await stripClaudeThinkingFromSessionFile(
      path.join(
        claudeSessionProjectDir(
          stateRoot,
          await resolveClaudeWorkingFolder(options.profile.cwd),
        ),
        `${carriedSession}.jsonl`,
      ),
    )) > 0
  ) {
    record = createNativeTranscript({ prompt: options.prompt, inputPrompt, execution: options.execution });
    result = await run();
  }
  if (result.error && isClaudeLoginFailureText(result.error)) {
    console.warn(`[cloud-claude] Anthropic refused the Claude login: ${result.error.slice(0, 400)}`);
    result = { ...result, error: cloudClaudeLoginEndedText(options.claudeAccount.email) };
  }
  const recorded =
    options.profile.role === "agent"
      ? record.messages({
          finalText: result.finalText,
          ...(result.error ? { error: result.error } : {}),
          usage: result.usage,
        })
      : undefined;
  const messages =
    recorded ??
    transcript({
      prompt: options.prompt,
      steered: result.steered,
      finalText: result.finalText || result.error || "",
      execution: options.execution,
      usage: result.usage,
      ...(result.error ? { error: result.error } : {}),
    });
  const kept = result.kept;
  // The CLI ran as the tool user and left its session folder owned by it.
  // Give it back to root before the executor seals and archives it, so the
  // native-state machinery sees the root-owned tree it requires.
  await restoreNativeStateOwner(stateRoot);
  let checkpoint: Awaited<ReturnType<typeof sealNativeState>>;
  try {
    if (!result.sessionId) {
      throw new Error(
        result.error
          ? `Claude Code did not start: ${result.error.slice(-1_000)}`
          : "Claude did not establish durable native session state.",
      );
    }
    checkpoint = await sealNativeState({
      stateRoot,
      engine: "anthropic",
      threadId: options.threadId,
      sessionId: result.sessionId,
      cursor: nativeHistoryCursorFromMessages(options.turnId, messages),
      integrityKey: options.stateIntegrityKey,
    });
  } catch (error) {
    await kept?.discard().catch(() => undefined);
    throw error;
  }
  await kept?.release(checkpoint.mac).catch((error: unknown) => {
    console.error(
      `keeping Claude for the next turn failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  const {
    sessionId: _sessionId,
    steered: _steered,
    kept: _kept,
    ...publicResult
  } = result;
  return {
    ...publicResult,
    messages,
    nativeStateCheckpoint: {
      engine: checkpoint.engine,
      sessionId: checkpoint.sessionId,
      cursor: checkpoint.cursor,
      tree: checkpoint.tree,
      mac: checkpoint.mac,
    },
  };
};
