import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import readline from "node:readline";

import { forkTimeoutFiber } from "./effect-runtime.js";
import {
  ConnectorAuthError,
  McpHttpSession,
  mcpCredentialHeader,
} from "./mcp-http-session.js";
import { loadConnectorAccessToken } from "./oauth.js";
import {
  removeConnectorBridgeProcessRecord,
  stopConnectorBridgeProcess,
  writeConnectorBridgeProcessRecord,
} from "./process-registry.js";
import { resolveStdioLaunch } from "./stdio-launch.js";
import type {
  ConnectorToolCallResult,
  ConnectorCommandConfig,
  ConnectorToolInfo,
} from "./types.js";

export { ConnectorAuthError };

type RpcMessage = {
  jsonrpc?: "2.0";
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string; code?: number; data?: unknown };
};

const resolveSecretPlaceholders = async (
  stellaAppDir: string,
  values: Record<string, string> = {},
) => {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    resolved[key] = await replaceSecretPlaceholders(stellaAppDir, value);
  }
  return resolved;
};

const replaceSecretPlaceholders = async (stellaAppDir: string, value: string) => {
  const parts: string[] = [];
  let cursor = 0;
  for (const match of value.matchAll(/\$\{([a-zA-Z0-9_.-]+)\}/gu)) {
    parts.push(value.slice(cursor, match.index));
    parts.push(
      (await loadConnectorAccessToken(stellaAppDir, match[1])) ?? match[0],
    );
    cursor = match.index + match[0].length;
  }
  parts.push(value.slice(cursor));
  return parts.join("");
};

/**
 * Optional server-provided usage guidance from the MCP `initialize`
 * response (`result.instructions`). Captured so imports can embed it in
 * the generated connector skill.
 */
const readInstructions = (result: unknown): string | undefined => {
  const instructions =
    result && typeof result === "object"
      ? (result as { instructions?: unknown }).instructions
      : undefined;
  return typeof instructions === "string" && instructions.trim()
    ? instructions.trim()
    : undefined;
};

class HttpConnectorBridgeSession extends McpHttpSession {
  constructor(stellaAppDir: string, server: ConnectorCommandConfig) {
    super(server, {
      authHeaders: async () => {
        const token = await loadConnectorAccessToken(
          stellaAppDir,
          server.auth?.tokenKey,
        );
        if (token) return mcpCredentialHeader(token, server.auth);
        if (server.auth?.type && server.auth.type !== "none") {
          throw new ConnectorAuthError(
            0,
            server.displayName,
            server.auth.tokenKey,
            `${server.displayName} has no stored credential for tokenKey "${server.auth.tokenKey}".`,
          );
        }
        return {};
      },
    });
  }
}

class StdioConnectorBridgeSession {
  private child: ChildProcessWithoutNullStreams | null = null;
  private processRecordPromise: Promise<string | null> | null = null;
  /** From the last successful `initialize` (see {@link readInstructions}). */
  instructions: string | undefined;
  private nextId = 1;
  private pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private initialized = false;

  constructor(
    private readonly stellaAppDir: string,
    private readonly server: ConnectorCommandConfig,
  ) {}

  private failChild(child: ChildProcessWithoutNullStreams, error: Error): void {
    // Ignore late events from a child that has already been retired or
    // replaced. Its first failure already removed the matching process record.
    if (this.child !== child) return;
    const recordPromise = this.processRecordPromise;
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
    this.child = null;
    this.processRecordPromise = null;
    this.initialized = false;
    void recordPromise?.then(removeConnectorBridgeProcessRecord);
    try {
      child.kill();
    } catch {
      // The connector already exited.
    }
  }

  private async start() {
    if (this.child) return;
    if (!this.server.command) {
      throw new Error(`${this.server.displayName} does not have a command.`);
    }
    const bridgeSessionId = randomUUID();
    const workerPid = Number.parseInt(
      process.env.STELLA_RUNTIME_WORKER_PID ?? "",
      10,
    );
    const env = {
      ...process.env,
      ...(await resolveSecretPlaceholders(this.stellaAppDir, this.server.env)),
      STELLA_CONNECTOR_BRIDGE: "1",
      STELLA_CONNECTOR_ID: this.server.id,
      STELLA_CONNECTOR_SESSION: bridgeSessionId,
    };
    const launch = resolveStdioLaunch(this.server.command, this.server.args ?? [], {
      env,
      ...(this.server.cwd ? { cwd: this.server.cwd } : {}),
    });
    this.child = spawn(launch.command, launch.args, {
      cwd: this.server.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
      ...(launch.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    });
    const child = this.child;
    this.processRecordPromise = child.pid
      ? writeConnectorBridgeProcessRecord(this.stellaAppDir, {
          sessionId: bridgeSessionId,
          pid: child.pid,
          ownerPid: process.pid,
          ...(Number.isInteger(workerPid) && workerPid > 0 ? { workerPid } : {}),
          connectorId: this.server.id,
          displayName: this.server.displayName,
          command: this.server.command,
          args: this.server.args ?? [],
          ...(this.server.cwd ? { cwd: this.server.cwd } : {}),
          startedAt: Date.now(),
          processGroup: process.platform !== "win32",
        })
      : Promise.resolve(null);
    this.child.stderr.on("data", () => {
      // Drain diagnostics so verbose connector commands cannot block on a full pipe.
    });
    this.child.on("exit", () => {
      this.failChild(child, new Error(`${this.server.displayName} exited.`));
    });
    this.child.on("error", (error) => {
      this.failChild(child, error);
    });
    // stdin has its own error channel; child.on("error") only covers process
    // spawn failures. Own EPIPE/ECONNRESET before sending any MCP messages.
    this.child.stdin.on("error", (error) => this.failChild(child, error));
    const rl = readline.createInterface({ input: this.child.stdout });
    rl.on("line", (line) => {
      let message: RpcMessage;
      try {
        message = JSON.parse(line) as RpcMessage;
      } catch {
        return;
      }
      if (message.id === undefined) return;
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      this.pending.delete(String(message.id));
      if (message.error) {
        pending.reject(
          new Error(message.error.message ?? "connector request failed."),
        );
      } else {
        pending.resolve(message.result);
      }
    });
  }

  private async request(method: string, params?: unknown): Promise<unknown> {
    await this.start();
    const child = this.child;
    if (!child) throw new Error(`${this.server.displayName} is not running.`);
    const id = String(this.nextId++);
    const payload = `${JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
    })}\n`;
    return new Promise((resolve, reject) => {
      // Effect timer fiber instead of setTimeout; interrupted (the old
      // clearTimeout) when the pending entry settles from the stdout reader
      // or the exit/error handlers.
      const cancelTimeout = forkTimeoutFiber(60_000, () => {
        if (this.pending.delete(id)) {
          reject(
            new Error(
              `${this.server.displayName} timed out waiting for ${method}.`,
            ),
          );
        }
      });
      this.pending.set(id, {
        resolve: (value) => {
          cancelTimeout();
          resolve(value);
        },
        reject: (error) => {
          cancelTimeout();
          reject(error);
        },
      });
      // Register the request before writing. A connector can respond in the
      // same turn, and response dispatch must never race pending registration.
      try {
        child.stdin.write(payload, (error) => {
          if (error) this.failChild(child, error);
        });
      } catch (error) {
        this.failChild(
          child,
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    });
  }

  private async notify(method: string, params?: unknown) {
    await this.start();
    const child = this.child;
    if (!child) throw new Error(`${this.server.displayName} is not running.`);
    const payload = `${JSON.stringify({
      jsonrpc: "2.0",
      method,
      ...(params === undefined ? {} : { params }),
    })}\n`;
    await new Promise<void>((resolve, reject) => {
      try {
        child.stdin.write(payload, (error) => {
          if (!error) {
            resolve();
            return;
          }
          this.failChild(child, error);
          reject(error);
        });
      } catch (error) {
        const normalized =
          error instanceof Error ? error : new Error(String(error));
        this.failChild(child, normalized);
        reject(normalized);
      }
    });
  }

  async initialize() {
    if (this.initialized) return;
    const result = await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "stella", version: "0" },
    });
    this.instructions = readInstructions(result) ?? this.instructions;
    await this.notify("notifications/initialized");
    this.initialized = true;
  }

  async listTools(): Promise<ConnectorToolInfo[]> {
    await this.initialize();
    const result = await this.request("tools/list");
    const tools = (result as { tools?: unknown[] })?.tools;
    return Array.isArray(tools) ? (tools as ConnectorToolInfo[]) : [];
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ConnectorToolCallResult> {
    await this.initialize();
    const result = await this.request("tools/call", {
      name,
      arguments: args,
    });
    return result as ConnectorToolCallResult;
  }

  async close() {
    for (const pending of this.pending.values()) {
      pending.reject(new Error(`${this.server.displayName} was disconnected.`));
    }
    this.pending.clear();
    const child = this.child;
    const recordPromise = this.processRecordPromise;
    this.child = null;
    this.processRecordPromise = null;
    this.initialized = false;
    if (child) {
      await stopConnectorBridgeProcess(child.pid, {
        processGroup: process.platform !== "win32",
      });
    }
    await recordPromise?.then(removeConnectorBridgeProcessRecord);
  }
}

const sessions = new Map<
  string,
  HttpConnectorBridgeSession | StdioConnectorBridgeSession
>();

const getSession = (stellaAppDir: string, server: ConnectorCommandConfig) => {
  const key = `${stellaAppDir}:${server.id}`;
  const existing = sessions.get(key);
  if (existing) return existing;
  const session =
    server.transport === "stdio"
      ? new StdioConnectorBridgeSession(stellaAppDir, server)
      : new HttpConnectorBridgeSession(stellaAppDir, server);
  sessions.set(key, session);
  return session;
};

export type ConnectorBridgeProbe = {
  tools: ConnectorToolInfo[];
  /** Server-provided usage guidance from the MCP `initialize` response. */
  instructions?: string;
};

/**
 * `tools/list` plus the `instructions` string the server volunteered
 * during `initialize` — the shape MCP imports need to generate a skill.
 */
export const probeConnectorBridgeTools = async (
  stellaAppDir: string,
  server: ConnectorCommandConfig,
): Promise<ConnectorBridgeProbe> => {
  const session = getSession(stellaAppDir, server);
  const tools = await session.listTools();
  return {
    tools,
    ...(session.instructions ? { instructions: session.instructions } : {}),
  };
};

export const callConnectorBridgeTool = async (
  stellaAppDir: string,
  server: ConnectorCommandConfig,
  toolName: string,
  args: Record<string, unknown>,
) => getSession(stellaAppDir, server).callTool(toolName, args);

export const closeConnectorBridgeSessions = async (
  stellaAppDir: string,
  serverIds: Iterable<string>,
) => {
  for (const serverId of serverIds) {
    const key = `${stellaAppDir}:${serverId}`;
    const session = sessions.get(key);
    await session?.close();
    sessions.delete(key);
  }
};
