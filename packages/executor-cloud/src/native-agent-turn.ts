import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { markTurnStep } from "./turn-timing.js";
import * as Effect from "effect/Effect";
import {
  chmod,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  AgentModelReasoningEffort,
  CloudExecutionSelection,
} from "@stella/contracts/agent-engine";
import { normalizeReasoningEffortLevel } from "@stella/contracts/reasoning-effort";
import {
  CLOUD_ADOPTED_SESSION_DIR,
  CLOUD_CLAUDE_ACCOUNTS_ROOT,
  cloudNativeStateRoot,
  isCloudClaudeAccountKey,
} from "@stella/contracts/cloud-native-state";
import { isClaudeSessionId } from "@stella/contracts/backend/claude-sessions";
import {
  claudeCliCanResume,
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
  ClaudeCodeCompactionLoopError,
  claudeCodeSubscriptionLimitOf,
  getClaudeCodeStatusChangeFromStreamEvent,
  isClaudeCodeVisibleOutputNudge,
  isRejectedThinkingSignatureError,
  MAX_COMPACTIONS_PER_TURN,
} from "@stella/runtime/kernel/integrations/claude-code-session-runtime.js";
import { CLOUD_HOST_STATE } from "./cloud-process-isolation.js";
import { WORLD_ROOT } from "./workspace-paths.js";
import {
  parseAuthoritativeAgentHistory,
  type AgentHistoryRow,
} from "./agent-history.js";
import { pruneAgentHistory } from "./prune-history.js";
import { createNativeTranscript } from "./native-transcript.js";
import { claudeCodeTranscript } from "@stella/runtime/kernel/integrations/claude-code-transcript.js";
import {
  assertFreshNativeState,
  assertNativeState,
  sealNativeState,
  type NativeStateAttestation,
} from "./native-state-integrity.js";
import type { AgentInbox } from "./agent-inbox.js";
import type { ClaudeKeeperClient } from "./claude-keeper-client.js";
import {
  CLAUDE_KEEPER_MCP_CONFIG_PLACEHOLDER,
  type ClaudeKeeperState,
} from "./claude-keeper-protocol.js";
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
  /** Builder checkpoint input for Claude's durable native state. */
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
  /** Inbox messages Claude took during the turn, in the order it took them. */
  steered: string[];
  /** Claude waits stopped in its keeper for this thread's next turn. */
  kept?: KeptClaude;
};

/** A parked process: handed on once its state is sealed, or ended. */
type KeptClaude = {
  release: (mac: string) => Promise<void>;
  discard: () => Promise<void>;
};

/**
 * The keeper that holds this thread's Claude between turns, and what decides
 * whether its parked process may take this turn.
 */
export type CloudClaudeKeeperInput = {
  client: ClaudeKeeperClient;
  /** Claude lists the tools once; another catalog needs another process. */
  toolCatalogHash: string;
};

/** How often a running agent's inbox is checked for new messages. */
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

/** The MCP server name; Claude exposes its tools as `mcp__stella__<name>`. */
export const CLOUD_CLAUDE_MCP_SERVER_NAME = "stella";

export type CloudClaudeMcpServerConfig = {
  type: "http";
  url: string;
  headers: { Authorization: string };
};

export const createCloudClaudeMcpConfig = async (
  serverConfig: CloudClaudeMcpServerConfig,
): Promise<{ path: string; cleanup: () => Promise<void> }> => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "stella-cloud-claude-mcp-"),
  );
  try {
    await chmod(directory, 0o700);
    const configPath = path.join(directory, "mcp.json");
    await writeFile(
      configPath,
      JSON.stringify({
        mcpServers: { [CLOUD_CLAUDE_MCP_SERVER_NAME]: serverConfig },
      }),
      { mode: 0o600 },
    );
    await chmod(configPath, 0o600);
    return {
      path: configPath,
      cleanup: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
};

/** This thread's own native state root; threads share the container, not state. */
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

/** Last canonical row is a stable parity cursor even when old context prunes. */
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
  /** Unit tests may override the production-required root owner. */
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

/** Which login file the CLI holds: replaced by a restore, rewritten by a refresh. */
const credentialsIdentity = async (accountDirectory: string): Promise<string> => {
  const details = await stat(path.join(accountDirectory, ".credentials.json"));
  return `${details.dev}:${details.ino}:${details.size}:${details.mtimeMs}`;
};

/**
 * The state root's files by inode, size and mtime: a restore that rewrote
 * them, even byte for byte, leaves a process holding the old ones.
 */
const stateFilesIdentity = async (root: string): Promise<string> => {
  const parts: string[] = [];
  const walk = async (directory: string, relative: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const details = await stat(full);
      parts.push(`${name}\0${details.ino}\0${details.size}\0${details.mtimeMs}`);
      if (entry.isDirectory()) await walk(full, name);
    }
  };
  await walk(root, "");
  return createHash("sha256").update(parts.sort().join("\n")).digest("hex");
};

/** The sealed state's MAC, once the parity check has accepted the root. */
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
  /** Writes stdin and ends it itself, instead of `input` then end. */
  feedInput?: (stdin: NodeJS.WritableStream) => void;
  processIdentity?: ToolProcessIdentity;
  /** SIGKILLs the child; the promise still resolves once it has closed. */
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
    // The latch is awaited on its own fiber rather than polled; an already
    // settled latch kills the child on the next tick.
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

/**
 * What differs between the two cloud CLI roles. Everything else (flags,
 * gateway wiring, native state, compaction guard) is one shared runner.
 */
export type CloudClaudeRoleProfile = {
  role: CloudCliTurnRole;
  /** Seed of the deterministic Claude session id (`--session-id`/`--resume`). */
  sessionKey: string;
  /** Gateway agent type; the turn capability's `agentTypes` must allow it. */
  agentType: "general" | "orchestrator";
  /**
   * Claude keys its on-disk sessions by cwd under CLAUDE_CONFIG_DIR, so the
   * path must be the same in every container for `--resume` to find them.
   */
  cwd: string;
  /** Stream `stream_event` deltas (live text, tool-use correlation). */
  includePartialMessages: boolean;
  /** Hard and idle MCP tool-call bound; unset keeps the CLI defaults. */
  mcpToolTimeoutMs?: number;
  /** `CLAUDE_CODE_AUTO_COMPACT_WINDOW`; unset keeps the CLI default. */
  autoCompactWindowTokens?: number;
};

/**
 * Root-only (inside the 0700 host-state directory) and always empty: an
 * orchestrator turn has no workspace, and no model-authored process can plant
 * a CLAUDE.md or `.claude` directory anywhere on its lookup path.
 */
export const CLOUD_ORCHESTRATOR_CLI_CWD = path.join(
  CLOUD_HOST_STATE,
  "orchestrator-cwd",
);

/**
 * An orchestrator tool call is one held broker request (BuildSession -> DO)
 * that sends no MCP progress while the DO runs the tool, which may wait on a
 * user approval. Claude Code aborts a silent HTTP MCP call after 5
 * minutes (`CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` default 300000) and has a
 * ~28 h hard cap (`MCP_TOOL_TIMEOUT` default 1e8). Both are set to 30
 * minutes: the turn's broker capability (TURN_BROKER_MAX_TTL_MS) and gateway
 * capability expire by then anyway, so the CLI never gives up on a tool the
 * DO is still running and journaling, and the turn's own bounds (DO watchdog,
 * BuildSession cancel ladder) stay the ones that end a wedged call.
 */
export const CLOUD_ORCHESTRATOR_MCP_TOOL_TIMEOUT_MS = 30 * 60_000;

export const cloudClaudeRoleProfile = (args: {
  role: CloudCliTurnRole;
  threadId: string;
  conversationId: string;
}): CloudClaudeRoleProfile =>
  args.role === "orchestrator"
    ? {
        role: "orchestrator",
        sessionKey: `stella-cloud:claude:orch:${args.conversationId}`,
        agentType: "orchestrator",
        cwd: CLOUD_ORCHESTRATOR_CLI_CWD,
        includePartialMessages: true,
        mcpToolTimeoutMs: CLOUD_ORCHESTRATOR_MCP_TOOL_TIMEOUT_MS,
      }
    : {
        role: "agent",
        sessionKey: `stella-cloud:claude:${args.threadId}`,
        agentType: "general",
        cwd: WORLD_ROOT,
        includePartialMessages: false,
        autoCompactWindowTokens: CLAUDE_CODE_AGENT_AUTO_COMPACT_WINDOW,
      };

/**
 * The owner's cloud Claude Code login a turn runs on: which account directory
 * under the root-only accounts root (a key, never a credential).
 */
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
    // Claude spawns no subprocess here: built-in tools are off (`--tools ""`),
    // Stella's tools arrive over loopback HTTP MCP and run in the ToolHost's
    // own isolation, and settings sources (hooks) are empty. Scrubbing would
    // only demand bubblewrap, which the image cannot run (no user
    // namespaces), and the CLI then exits before it starts.
    CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "0",
    // The executor (and so the CLI) runs as root inside the per-owner
    // sandbox container. Claude Code refuses --dangerously-skip-permissions
    // as root unless told it is in a sandbox.
    IS_SANDBOX: "1",
    MCP_CONNECTION_NONBLOCKING: "0",
    // No telemetry, error reporting or update check: nothing the turn needs
    // goes out before its first model request.
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    // claude.ai's own connectors are never this turn's tools
    // (`--strict-mcp-config`), and with blocking MCP connections their fetch
    // held every start for about half a second.
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
  };
  // Nothing may point the CLI at another endpoint or another credential.
  delete childEnv.ANTHROPIC_BASE_URL;
  delete childEnv.ANTHROPIC_API_KEY;
  delete childEnv.ANTHROPIC_AUTH_TOKEN;
  delete childEnv.ANTHROPIC_CUSTOM_HEADERS;
  delete childEnv.CLAUDE_CODE_OAUTH_TOKEN;
  // These are forbidden legacy executor credentials, not Claude credentials.
  // Neither name may enter Claude's environment and reach a tool subprocess.
  delete childEnv.STELLA_TURN_TOKEN;
  delete childEnv.STELLA_CODEX_TURN_TOKEN;
  // Never let a host/image override defeat the turn's explicit selection.
  // `unset` is Claude Code's supported "send no output_config.effort" value.
  delete childEnv.CLAUDE_CODE_EFFORT_LEVEL;
  if (options.reasoningEffort === "none") {
    childEnv.CLAUDE_CODE_EFFORT_LEVEL = "unset";
  }
  delete childEnv.MCP_TOOL_TIMEOUT;
  delete childEnv.CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT;
  if (options.mcpToolTimeoutMs !== undefined) {
    childEnv.MCP_TOOL_TIMEOUT = String(options.mcpToolTimeoutMs);
    childEnv.CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT = String(
      options.mcpToolTimeoutMs,
    );
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
  mcpConfigPath: string;
  resume: boolean;
  sessionId: string;
  inputPrompt?: string;
  includePartialMessages?: boolean;
  /** Input as stream-json messages, each echoed back once Claude takes it. */
  streamInput?: boolean;
}): string[] => [
  "-p",
  "--verbose",
  "--output-format",
  "stream-json",
  ...(options.streamInput
    ? ["--input-format", "stream-json", "--replay-user-messages"]
    : []),
  ...(options.includePartialMessages ? ["--include-partial-messages"] : []),
  ...resolveClaudeModelArgs(options.model),
  ...resolveClaudeReasoningArgs(options.reasoningEffort),
  "--dangerously-skip-permissions",
  // Match the desktop's configured Claude engine takeover: Claude owns the
  // native loop, but Stella owns its entire capability surface. Ambient MCP
  // servers and built-ins stay out; the CLI's own commands (`/compact`) run
  // as on the desktop.
  "--strict-mcp-config",
  "--mcp-config",
  options.mcpConfigPath,
  "--tools",
  "",
  // Stella's server is the only tool surface; allow it explicitly too, so a
  // permission mode that overrides the bypass can't deny it.
  "--allowedTools",
  `mcp__${CLOUD_CLAUDE_MCP_SERVER_NAME}`,
  // CLAUDE_CONFIG_DIR persists only conversation state. Never let a prior
  // turn or project file turn that persistence into executable hooks,
  // plugins, permissions, or other settings outside Stella's ToolHost.
  "--setting-sources",
  "",
  "--settings",
  JSON.stringify({
    // Match the configured desktop engine: keyword-triggered workflows must
    // not hijack an ordinary Stella task.
    workflowKeywordTriggerEnabled: false,
    disableWorkflows: true,
  }),
  // Send the prompt as given on every launch. By default the CLI records a
  // conversation's first system prompt and resends that record on every
  // resume until compaction, so a deploy's prompt change would not reach a
  // long-lived conversation. (The image pins a CLI that takes the flag.)
  ...(options.systemPrompt.trim()
    ? ["--system-prompt", options.systemPrompt, "--system-prompt-snapshot", "off"]
    : []),
  ...(options.resume
    ? ["--resume", options.sessionId]
    : ["--session-id", options.sessionId]),
  ...(options.inputPrompt !== undefined ? [options.inputPrompt] : []),
];

const transcript = (args: {
  prompt: string;
  /** Messages the agent took while it worked, after the prompt. */
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

/** One stream-json event from the CLI, as parsed from its stdout. */
export type ClaudeStreamJsonEvent = Record<string, unknown>;

/**
 * Why a turn must not go on, from the CLI's init event: Stella's MCP server
 * did not connect. The CLI gives a server about 30 seconds and then runs
 * without it, and a model without Stella's tools writes its tool calls out
 * as text and makes up their results.
 */
const stellaToolsUnavailable = (
  event: ClaudeStreamJsonEvent,
): string | undefined => {
  const servers = Array.isArray(event.mcp_servers) ? event.mcp_servers : [];
  const stella = servers.find(
    (server): server is { name: string; status?: unknown } =>
      Boolean(server) &&
      typeof server === "object" &&
      (server as { name?: unknown }).name === CLOUD_CLAUDE_MCP_SERVER_NAME,
  );
  if (stella?.status === "connected") return undefined;
  const status = typeof stella?.status === "string" ? stella.status : "missing";
  return `Claude Code could not load Stella's tools (their server was ${status}), so it stopped before answering. Try again.`;
};

/**
 * Runs one `claude -p` turn for either role and returns its outcome. Callers
 * observe the raw stream through `onStreamEvent`; this owns the session
 * marker, final text, usage, the compaction-loop breaker, and cancellation.
 */
export const runCloudClaude = async (options: {
  profile: CloudClaudeRoleProfile;
  inputPrompt: string;
  systemPrompt: string;
  execution: Extract<CloudExecutionSelection, { engine: "anthropic" }>;
  claudeAccount: CloudClaudeAccountInput;
  stateRoot: string;
  mcpServerConfig: CloudClaudeMcpServerConfig;
  onStreamEvent?: (event: ClaudeStreamJsonEvent) => void;
  /** Kills the CLI; the turn then fails with the abort reason. */
  cancellation?: NativeTurnCancellation;
  /** Messages for the agent while it works (an agent turn's inbox). */
  inbox?: AgentInbox;
  /** No message the user wrote waits for a reply: the CLI's nudge for a visible answer ends the turn, empty. */
  quiet?: boolean;
  /**
   * Run Claude in this thread's keeper, which keeps it for the next turn.
   * `reusable` is false when this turn must start a new process, and
   * `sealedMac` names the sealed state the parity check accepted.
   */
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
  const signedIn = await stat(path.join(accountDirectory, ".credentials.json")).then(
    (details) => details.isFile(),
    () => false,
  );
  if (!signedIn) {
    // Only whether the CLI's credential file exists; its contents are the
    // CLI's alone. A new container image starts without the old login.
    return {
      finalText: "",
      error: `Claude isn't signed in to ${options.claudeAccount.email} in your cloud anymore. Sign in again under Settings > Account > Claude.`,
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
  // The marker names the session the root holds: this thread's own, or
  // another host's synced session it adopted.
  const sessionId =
    marked && isClaudeSessionId(marked)
      ? marked
      : deterministicUuid(profile.sessionKey);
  markTurnStep("claudeStateChecked");
  // One latch, two sources: the caller's cancellation and our own
  // compaction-loop verdict both have to reach one child process. A turn
  // without a caller latch still owns one for the verdict.
  const cancellation = options.cancellation ?? createNativeTurnCancellation();
  const argsFor = (mcpConfigPath: string, resumeSession: boolean) =>
    buildCloudClaudeTakeoverArgs({
      model: options.execution.model,
      reasoningEffort: options.execution.reasoningEffort,
      systemPrompt: options.systemPrompt,
      mcpConfigPath,
      resume: resumeSession,
      sessionId,
      includePartialMessages: profile.includePartialMessages,
      streamInput: Boolean(inbox),
    });
  const childEnv = buildClaudeChildEnv({
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
  // The keeper runs Claude when it answers; anything short of an attached
  // process runs it here, as every turn did before.
  let keeper: ClaudeKeeperClient | undefined;
  if (options.keeper && inbox) {
    const env = stringEnv(childEnv);
    // Everything the process was started with, except whether it resumed:
    // a kept process has its session in memory either way.
    const key = createHash("sha256")
      .update(
        JSON.stringify({
          threadId: options.keeper.threadId,
          account: options.claudeAccount,
          toolCatalogHash: options.keeper.toolCatalogHash,
          args: argsFor(CLAUDE_KEEPER_MCP_CONFIG_PLACEHOLDER, false),
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
        }
      : null;
    try {
      const attached = await options.keeper.client.attach({
        t: "attach",
        key,
        reusable: options.keeper.reusable,
        state,
        upstream: {
          url: options.mcpServerConfig.url,
          authorization: options.mcpServerConfig.headers.Authorization,
        },
        spawn: {
          command: "claude",
          args: argsFor(CLAUDE_KEEPER_MCP_CONFIG_PLACEHOLDER, resume),
          env,
          cwd: profile.cwd,
        },
      });
      keeper = options.keeper.client;
      markTurnStep(attached.reused ? "claudeReused" : "claudeSpawned");
      if (attached.fresh !== "none") {
        markTurnStep(
          `claudeFresh${attached.fresh[0]!.toUpperCase()}${attached.fresh.slice(1)}`,
        );
      }
    } catch (error) {
      console.error(
        `claude keeper attach failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      markTurnStep("claudeKeeperFailed");
    }
  }
  const mcpConfig = keeper
    ? undefined
    : await createCloudClaudeMcpConfig(options.mcpServerConfig);
  let kept: KeptClaude | undefined;
  let handedOn = false;
  try {
    const args = argsFor(mcpConfig?.path ?? "", resume);
    // With an inbox, the prompt is the first stream-json message and stdin
    // stays open while Claude works: a message that arrives is written after
    // it, Claude folds it in at its next tool boundary (or answers it as one
    // more query) and echoes it back by uuid once it has. Input ends after a
    // result that leaves nothing unanswered and an inbox that closes empty.
    let stdin: { write(data: string): void; end(): void } | undefined;
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
                if (inputEnded || !stdin) return;
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
    const onJson = (event: ClaudeStreamJsonEvent): void => {
        options.onStreamEvent?.(event);
        const type = event.type;
        if (type === "system" && event.subtype === "init") {
          markTurnStep("claudeInit");
          initialized = true;
          void writeFile(markerPath, `${sessionId}\n`, { mode: 0o600 });
          const unavailable = stellaToolsUnavailable(event);
          if (unavailable && !cancellation.aborted) {
            error = unavailable;
            cancellation.abort(new Error(unavailable));
          }
          return;
        }
        if (options.quiet && isClaudeCodeVisibleOutputNudge(event)) {
          if (!cancellation.aborted) {
            quieted = new Error("The turn ended with no reply.");
            cancellation.abort(quieted);
          }
          return;
        }
        if (type === "user") {
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
          // Count discrete compactions, as the desktop runtime does. A turn
          // that keeps re-compacting can no longer fit its context.
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
        if (type === "result") {
          markTurnStep("claudeResult");
          const resultText =
            typeof event.result === "string" ? event.result.trim() : "";
          // A message Claude answered as one more query adds its answer to
          // the report instead of replacing the task's.
          if (resultText) {
            answers.push(resultText);
            finalText = answers.join("\n\n");
          }
          const usage =
            event.usage && typeof event.usage === "object"
              ? (event.usage as Record<string, unknown>)
              : {};
          // Each query on the stream reports its own usage.
          inputTokens +=
            numberAt(usage.input_tokens) +
            numberAt(usage.cache_creation_input_tokens) +
            numberAt(usage.cache_read_input_tokens);
          outputTokens += numberAt(usage.output_tokens);
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
          } else if (inbox && injected.size === 0) {
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
          // A turn that ended cleanly leaves Claude parked for the next one;
          // any other end takes the process with it.
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
        stdin.write(`${streamJsonUserMessage(sessionId, options.inputPrompt)}\n`);
        markTurnStep("claudePromptSent");
      });
    const result = keeper
      ? await runKept(keeper).finally(endInput)
      : await runJsonLines({
          ...(inbox
            ? {
                feedInput: (input: NodeJS.WritableStream) => {
                  stdin = input;
                  input.write(
                    `${streamJsonUserMessage(sessionId, options.inputPrompt)}\n`,
                  );
                },
              }
            : { input: options.inputPrompt }),
          command: "claude",
          args,
          cwd: profile.cwd,
          env: childEnv,
          cancellation,
          onJson,
        }).finally(endInput);
    if (keeper && "parked" in result && result.parked) {
      const client = keeper;
      kept = {
        release: async (mac) => {
          try {
            await client.release({
              mac,
              credentials: await credentialsIdentity(accountDirectory),
              files: await stateFilesIdentity(stateRoot),
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
      // Say so, with the exact reset instant when the CLI gave one, so the
      // cloud can hold the work until then. Nothing switches.
      error =
        limit.resetsAt !== undefined
          ? `Claude usage limit reached for ${options.claudeAccount.email}. It resets at ${new Date(limit.resetsAt).toISOString()}.`
          : `Claude usage limit reached for ${options.claudeAccount.email}.`;
    }
    if (kept && error) {
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
    // This directory contains the private loopback MCP bearer. It lives
    // outside every checkpoint root and exists only while Claude is alive.
    await mcpConfig?.cleanup();
    if (keeper && !handedOn) {
      if (kept) await kept.discard().catch(() => undefined);
      else keeper.close();
    }
  }
};

/**
 * The general agent's coarse progress events (`/api/cloud/events`): one per
 * assistant text and one per tool call, as the agent loop reports them.
 */
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

/**
 * Move another host's synced session (written by the BuildSession under
 * `CLOUD_ADOPTED_SESSION_DIR`) under this CLI's working folder and mark it
 * as the session to resume. False when it can't resume here: this CLI is
 * older than the one that wrote it, or the transcript is missing.
 */
/**
 * A session written from the conversation's journal names no CLI: each line
 * gets this one's version and working folder, as the CLI's own would have.
 */
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

/** How much of a thread's history a session written from it holds, in tokens. */
const WRITTEN_SESSION_TOKEN_BUDGET = 150_000;

const claudeCodeIdentity = (message: { api?: unknown; provider?: unknown; model?: unknown; responseModel?: unknown }) =>
  message.api === "claude-code" || message.api === "claude-code-cli" || message.provider === "claude-code"
    ? String(message.responseModel || message.model || "")
    : undefined;

/**
 * A session the CLI resumes, written from the thread's history (an agent
 * that moved here, or a thread whose session is gone): every turn and tool
 * call as it happened, and the thinking of the model that runs on, rather
 * than a replay of it all in one prompt. Undefined with nothing to write.
 */
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
    (name) => `mcp__${CLOUD_CLAUDE_MCP_SERVER_NAME}__${name}`,
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
  /** The owner's cloud Claude Code login this turn runs on. */
  claudeAccount: CloudClaudeAccountInput;
  threadId: string;
  turnId: string;
  authoritativeHistoryCursor: string;
  stateIntegrityKey: string;
  recoveryHistory?: AgentHistoryRow[];
  /**
   * Another host's synced session the BuildSession wrote into the root, or
   * one written from the conversation's journal (`hydrated`), to resume
   * natively; `history` rebuilds instead when it can't resume here.
   */
  adoptedSession?: { sessionId: string; cliVersion: string; hydrated?: true };
  /** A new session, whatever history the thread has: the prompt carries what it needs. */
  fresh?: true;
  history?: AgentHistoryRow[];
  /** Test-only override; production always uses the root-only image path. */
  nativeStateRoot?: string;
  claudeMcpServerConfig?: CloudClaudeMcpServerConfig;
  onStreamEvent?: (event: ClaudeStreamJsonEvent) => void;
  cancellation?: NativeTurnCancellation;
  inbox?: AgentInbox;
  quiet?: boolean;
  /** This thread's Claude keeper; without one each turn starts Claude. */
  keeper?: CloudClaudeKeeperInput;
}): Promise<NativeAgentTurnResult> => {
  const mcpServerConfig = options.claudeMcpServerConfig;
  if (!mcpServerConfig) {
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
  // The orchestrator's history is the conversation's journal, which only its
  // DO holds: a session it handed over that can't resume here goes back.
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
    });
  }
  markTurnStep("nativeParityChecked");
  // A kept process holds the session as this thread's last sealed state
  // left it; only a root the parity check accepted as that state may
  // continue in it. Recovery and adoption rewrite the session first.
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
      mcpServerConfig,
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
  // The orchestrator's history is the conversation's journal: a session the
  // CLI can't find goes back to its DO, which writes it again from there.
  if (
    options.profile.role === "orchestrator" &&
    result.error &&
    /No conversation found with session ID/iu.test(result.error)
  ) {
    await result.kept?.discard().catch(() => undefined);
    await rm(stateRoot, { recursive: true, force: true });
    throw new Error(`${CLOUD_CLI_SESSION_LOST_MARK} ${result.error}`);
  }
  // A second run of this turn starts its own process.
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
  let checkpoint: Awaited<ReturnType<typeof sealNativeState>>;
  try {
    if (!result.sessionId) {
      // The CLI exited before its init event; its own error says why.
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
  // The sealed state is what the parked process holds; the next turn's
  // parity check has to accept exactly it before it continues there.
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
