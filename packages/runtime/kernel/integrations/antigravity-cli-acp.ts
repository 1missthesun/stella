import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { ImageContent, ModelThinkingLevel } from "@earendil-works/pi-ai";
import {
  createClaudeCodeToolMcpHost,
  type ClaudeCodeToolMcpHost,
} from "./claude-code-tool-mcp-host.js";
import type { ToolResult } from "../tools/types.js";
import { forkTimeoutFiber } from "../cli/effect-runtime.js";
import { ANTIGRAVITY_NATIVE_TOOLS } from "./antigravity-native-tools.js";
import {
  ANTIGRAVITY_ALLOWED_TOOLS_ENV,
  ANTIGRAVITY_MCP_SERVER_NAME,
  ANTIGRAVITY_MCP_SOCKET_ENV,
  ANTIGRAVITY_MCP_TOKEN_ENV,
  createAntigravityProfile,
} from "./antigravity-profile.js";

/**
 * Google's own Antigravity CLI driven over the Agent Client Protocol
 * (`agy acp`), the way editors such as Zed and T3 Code drive it: Google's
 * binary holds the sign-in and makes every request; Stella only speaks ACP to
 * it and serves its own tools as an MCP server the CLI starts.
 */

const MCP_TOOL_PREFIX = `mcp_${ANTIGRAVITY_MCP_SERVER_NAME}_`;
const NATIVE_PREFIX = "agy_";
const OTHER_NATIVE_TOOL = `${NATIVE_PREFIX}tool`;
/** Arguments Antigravity adds to every call for its own display; Stella's tools never take them. */
const DISPLAY_ARGS = new Set(["toolSummary"]);
export const ANTIGRAVITY_APP_DATA_DIR = "antigravity-acp";
const TOOL_GROUP_SETTLE_MS = 250;
const IDLE_CLOSE_MS = 20 * 60_000;
const START_TIMEOUT_MS = 60_000;

export const ANTIGRAVITY_LOGIN_REQUIRED = "ANTIGRAVITY_CLI_LOGIN_REQUIRED";
export const ANTIGRAVITY_SIGN_IN_NEEDED =
  "This computer isn't signed in to Google Antigravity. Sign in with Google under Google Antigravity in Settings › Claude and ChatGPT. If you used Google Antigravity in Stella before, sign in once more: Stella now runs it through Google's own Antigravity app.";
export const ANTIGRAVITY_NOT_INSTALLED = "ANTIGRAVITY_CLI_NOT_INSTALLED";

export type AntigravityToolSpec = { name: string; description: string; parameters: Record<string, unknown> };
export type AntigravityToolOutcome = ToolResult;

export type AntigravitySessionRef = {
  sessionKey: string;
  role: "orchestrator" | "worker";
};

export type AntigravityTurnRequest = {
  ref: AntigravitySessionRef;
  cwd: string;
  env: Record<string, string>;
  resumeSessionId?: string;
  model: string;
  thinkingLevel: ModelThinkingLevel;
  systemPrompt: string;
  prompt: string;
  images: ImageContent[];
  resumeFallbackPrompt: string;
  tools: AntigravityToolSpec[];
  nativeTools: readonly string[];
  signal: AbortSignal;
  executeTool(toolCallId: string, name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult>;
  onEvent(event: Record<string, unknown>): void;
  onNativeToolEnd(end: { toolCallId: string; result: string; isError: boolean }): void;
  onSessionId(sessionId: string): void;
};

export type AntigravityCliConfig = {
  /** The `agy` executable. */
  binary(): string | undefined;
  /** Antigravity's own folder for this computer's Stella sign-in (its `--gemini-dir`). */
  home(): string;
};

const errorWith = (code: string, message: string) => Object.assign(new Error(message), { code });

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

const withoutDisplayArgs = (args: unknown): Record<string, unknown> => {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  return Object.fromEntries(Object.entries(args as Record<string, unknown>).filter(([key]) => !DISPLAY_ARGS.has(key)));
};

const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);

/** `agy` on PATH, or where Google's installer puts it. */
export const findAntigravityCli = (): string | undefined => {
  const explicit = process.env.STELLA_ANTIGRAVITY_CLI_BIN?.trim();
  if (explicit) return existsSync(explicit) ? explicit : undefined;
  const names = process.platform === "win32" ? ["agy.exe", "agy.cmd", "agy"] : ["agy"];
  const dirs = [
    ...(process.env.PATH ?? "").split(path.delimiter),
    process.platform === "win32"
      ? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "agy", "bin")
      : path.join(os.homedir(), ".local", "bin"),
  ];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
};

/** The environment every `agy` Stella starts gets: its own profile, file-stored sign-in, no self-update, no browser. */
export const antigravityCliEnv = (home: string): Record<string, string> => ({
  GEMINI_HOME: home,
  AGY_ACP_FORCE_FILE_STORAGE: "1",
  AGY_CLI_DISABLE_AUTO_UPDATE: "1",
  SSH_CONNECTION: process.env.SSH_CONNECTION || "127.0.0.1 0 127.0.0.1 0",
  BROWSER: process.platform === "win32" ? "rem" : "true",
});

const allowedToolsOf = (request: { nativeTools: readonly string[] }): string => request.nativeTools.join(",");

/** Where `agy` keeps its sign-in. Stella checks that it exists and removes it on sign-out; it never reads it. */
export const antigravityTokenFile = (home: string): string => path.join(home, ANTIGRAVITY_APP_DATA_DIR, "antigravity-oauth-token");

export const antigravityCliSignedIn = (home: string): boolean => existsSync(antigravityTokenFile(home));

export const antigravityCliProblem = (config: AntigravityCliConfig): string | undefined => {
  if (!config.binary()) return "Google Antigravity isn't set up on this computer yet. Sign in with Google under Google Antigravity in Settings › Claude and ChatGPT.";
  if (!antigravityCliSignedIn(config.home())) return ANTIGRAVITY_SIGN_IN_NEEDED;
  return undefined;
};

type Rpc = {
  request(method: string, params: unknown): Promise<any>;
  notify(method: string, params: unknown): void;
};

type ToolCallState = { id: string; name: string; stella: boolean; argsKey: string; claimed: boolean; ended: boolean };

type TurnState = {
  request: AntigravityTurnRequest;
  messageOpen: boolean;
  blockIndex: number;
  blockKind: "text" | "thinking" | undefined;
  toolsInMessage: number;
  closeTimer: (() => void) | undefined;
  finalText: string;
  calls: Map<string, ToolCallState>;
  claimWaiters: Set<() => void>;
};

type Proc = {
  key: string;
  role: "orchestrator" | "worker";
  child: ChildProcess;
  rpc: Rpc;
  ready: Promise<{ models: string[] }>;
  sessionId?: string;
  sessionShape?: string;
  models: string[];
  currentModel?: string;
  cwd: string;
  agent: string;
  allowedTools: string;
  mcp: { host: ClaudeCodeToolMcpHost; catalogKey: string; socketPath: string; token: string; server: net.Server };
  turn?: TurnState;
  idle?: () => void;
  exited: boolean;
  stderr: string;
};

const thinkingTier = (level: ModelThinkingLevel): string => {
  switch (level) {
    case "off":
    case "minimal":
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    default:
      return "xhigh";
  }
};

/** `gemini-4-neon` at `high` → `gemini-4-neon-high`, falling back to the nearest tier the account offers. */
export const antigravityWireModel = (available: readonly string[], model: string, level: ModelThinkingLevel): string | undefined => {
  if (!model || model === "default") return undefined;
  if (available.includes(model)) return model;
  const order = ["xhigh", "high", "medium", "low"];
  const wanted = thinkingTier(level);
  for (const tier of [wanted, ...order.slice(order.indexOf(wanted) + 1), ...order]) {
    const candidate = `${model}-${tier}`;
    if (available.includes(candidate)) return candidate;
  }
  return available.find((id) => id.startsWith(model));
};

const withoutTimes = (text: string): string => text.replace(/^Created At: .*\r?\n(?:Completed At: .*\r?\n)?/u, "").replaceAll("\r\n", "\n");

const resultText = (update: Record<string, any>): string => {
  const output = update.rawOutput;
  if (output && typeof output === "object" && typeof output.output === "string") return withoutTimes(output.output);
  if (typeof output === "string") return output;
  const content = Array.isArray(update.content) ? update.content : [];
  const texts = content
    .map((part: any) => (part?.type === "content" && part.content?.type === "text" ? part.content.text : part?.type === "diff" ? `Edited ${part.path}` : ""))
    .filter((text: string) => text);
  if (texts.length > 0) return texts.join("\n");
  if (output === undefined && update.status !== "failed") {
    // The CLI gives its model a file's text or the search results, and tells its client only that the call finished.
    const paths = (Array.isArray(update.locations) ? update.locations : []).map((location: any) => location?.path).filter(Boolean);
    return update.kind === "read" && paths.length > 0
      ? `Read ${paths.join(", ")}. Its text stayed in Antigravity; read it again to see it.`
      : "Done. The result stayed in Antigravity.";
  }
  return output === undefined ? "" : JSON.stringify(output);
};

export const createAntigravityCliRuntime = (config: AntigravityCliConfig) => {
  const procs = new Map<string, Proc>();
  const profile = createAntigravityProfile(config.home);

  const kill = (proc: Proc, reason: string) => {
    if (procs.get(proc.key) === proc) procs.delete(proc.key);
    proc.idle?.();
    proc.mcp.server.close();
    void rm(proc.mcp.socketPath, { force: true }).catch(() => undefined);
    void proc.mcp.host.close().catch(() => undefined);
    if (!proc.exited) {
      try {
        proc.child.stdin?.end();
      } catch {}
      const child = proc.child;
      forkTimeoutFiber(2_000, () => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      });
    }
    if (proc.turn) failTurn(proc, new Error(reason));
  };

  const emit = (turn: TurnState, event: Record<string, unknown>) => turn.request.onEvent({ type: "stream_event", event });

  const openMessage = (turn: TurnState, model: string | undefined) => {
    if (turn.messageOpen) return;
    turn.messageOpen = true;
    turn.blockIndex = -1;
    turn.blockKind = undefined;
    turn.toolsInMessage = 0;
    emit(turn, { type: "message_start", message: { model: model ?? "", usage: {} } });
  };

  const closeBlock = (turn: TurnState) => {
    if (!turn.blockKind) return;
    emit(turn, { type: "content_block_stop", index: turn.blockIndex });
    turn.blockKind = undefined;
  };

  const closeMessage = (turn: TurnState, stopReason: string, usage?: Record<string, number>) => {
    turn.closeTimer?.();
    turn.closeTimer = undefined;
    if (!turn.messageOpen) return;
    closeBlock(turn);
    emit(turn, { type: "message_delta", delta: { stop_reason: stopReason }, ...(usage ? { usage } : {}) });
    emit(turn, { type: "message_stop" });
    turn.messageOpen = false;
  };

  const chunk = (proc: Proc, turn: TurnState, kind: "text" | "thinking", text: string) => {
    if (!text) return;
    if (turn.toolsInMessage > 0) closeMessage(turn, "tool_use");
    openMessage(turn, proc.currentModel);
    if (turn.blockKind !== kind) {
      closeBlock(turn);
      turn.blockIndex += 1;
      turn.blockKind = kind;
      emit(turn, {
        type: "content_block_start",
        index: turn.blockIndex,
        content_block: kind === "text" ? { type: "text", text: "" } : { type: "thinking", thinking: "" },
      });
    }
    emit(turn, {
      type: "content_block_delta",
      index: turn.blockIndex,
      delta: kind === "text" ? { type: "text_delta", text } : { type: "thinking_delta", thinking: text },
    });
    if (kind === "text") turn.finalText += text;
  };

  const toolCall = (proc: Proc, turn: TurnState, update: Record<string, any>) => {
    const id = typeof update.toolCallId === "string" ? update.toolCallId : undefined;
    if (!id || turn.calls.has(id)) return;
    const wire = typeof update.name === "string" && update.name ? update.name : typeof update.title === "string" ? update.title : "tool";
    const args = (update.args ?? update.rawInput ?? {}) as Record<string, unknown>;
    const stella = wire.startsWith(MCP_TOOL_PREFIX) && turn.request.tools.some((tool) => tool.name === wire.slice(MCP_TOOL_PREFIX.length));
    const name = stella
      ? wire.slice(MCP_TOOL_PREFIX.length)
      : (ANTIGRAVITY_NATIVE_TOOLS as readonly string[]).includes(wire)
        ? `${NATIVE_PREFIX}${wire}`
        : OTHER_NATIVE_TOOL;
    const input = stella ? withoutDisplayArgs(args) : name === OTHER_NATIVE_TOOL ? { tool: wire, ...args } : args;
    turn.calls.set(id, { id, name, stella, argsKey: stableJson(withoutDisplayArgs(args)), claimed: false, ended: false });
    turn.finalText = "";
    openMessage(turn, proc.currentModel);
    closeBlock(turn);
    turn.blockIndex += 1;
    const index = turn.blockIndex;
    emit(turn, { type: "content_block_start", index, content_block: { type: "tool_use", id, name, input: {} } });
    emit(turn, { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } });
    emit(turn, { type: "content_block_stop", index });
    turn.toolsInMessage += 1;
    turn.closeTimer?.();
    turn.closeTimer = forkTimeoutFiber(TOOL_GROUP_SETTLE_MS, () => closeMessage(turn, "tool_use"));
    for (const wake of [...turn.claimWaiters]) wake();
    if (!stella && (update.status === "completed" || update.status === "failed")) toolEnded(turn, update);
  };

  const toolEnded = (turn: TurnState, update: Record<string, any>) => {
    const call = turn.calls.get(update.toolCallId);
    if (!call || call.stella || call.ended) return;
    if (update.status !== "completed" && update.status !== "failed") return;
    call.ended = true;
    turn.request.onNativeToolEnd({ toolCallId: call.id, result: resultText(update), isError: update.status === "failed" });
  };

  /** Stella's MCP server got a call: find the ACP tool call it belongs to, waiting for its notification if it is late. */
  const claim = (proc: Proc, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<string> =>
    new Promise((resolve, reject) => {
      const key = stableJson(withoutDisplayArgs(args));
      const attempt = (): boolean => {
        const turn = proc.turn;
        if (!turn) return false;
        const candidates = [...turn.calls.values()].filter((call) => call.stella && !call.claimed && call.name === name);
        const call = candidates.find((candidate) => candidate.argsKey === key) ?? candidates[0];
        if (!call) return false;
        call.claimed = true;
        closeMessage(turn, "tool_use");
        resolve(call.id);
        return true;
      };
      if (attempt()) return;
      const turn = proc.turn;
      if (!turn) {
        reject(new Error("No Stella turn is active for this tool call."));
        return;
      }
      const cancelTimer = forkTimeoutFiber(30_000, () => finish(new Error(`Antigravity called ${name} without announcing it.`)));
      const finish = (error?: Error) => {
        cancelTimer();
        turn.claimWaiters.delete(wake);
        signal.removeEventListener("abort", onAbort);
        if (error) reject(error);
      };
      const wake = () => {
        if (attempt()) finish();
      };
      const onAbort = () => finish(signal.reason instanceof Error ? signal.reason : new Error("Tool call aborted"));
      turn.claimWaiters.add(wake);
      signal.addEventListener("abort", onAbort, { once: true });
    });

  const failTurn = (proc: Proc, error: Error) => {
    const turn = proc.turn;
    if (!turn) return;
    proc.turn = undefined;
    turn.closeTimer?.();
    (turn as TurnState & { reject?: (error: Error) => void }).reject?.(error);
  };

  const startMcp = async (key: string, tools: AntigravityToolSpec[], getProc: () => Proc | undefined) => {
    const host = await createClaudeCodeToolMcpHost({
      tools,
      identityScope: key,
      progressHeartbeatMs: 0,
      getActiveTurn: () => {
        const proc = getProc();
        const turn = proc?.turn;
        if (!proc || !turn) return undefined;
        return {
          identityScope: key,
          nativeToolCallIds: true,
          claimNativeToolUseId: (name: string, args: Record<string, unknown>, signal: AbortSignal) => claim(proc, name, args, signal),
          executeTool: (toolCallId: string, name: string, args: Record<string, unknown>, signal?: AbortSignal) =>
            turn.request.executeTool(toolCallId, name, args, signal),
        };
      },
    });
    const token = crypto.randomBytes(24).toString("base64url");
    const socketPath =
      process.platform === "win32"
        ? `\\\\.\\pipe\\stella-agy-${crypto.randomBytes(8).toString("hex")}`
        : path.join(os.tmpdir(), `stella-agy-${crypto.randomBytes(8).toString("hex")}.sock`);
    const server = net.createServer((socket) => {
      let buffer = "";
      let authed = false;
      let channel: ReturnType<ClaudeCodeToolMcpHost["openJsonRpcChannel"]> | undefined;
      socket.setEncoding("utf8");
      socket.on("data", (data: string) => {
        buffer += data;
        for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!authed) {
            if (line !== token) {
              socket.destroy();
              return;
            }
            authed = true;
            channel = host.openJsonRpcChannel((message) => {
              if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
            });
            continue;
          }
          if (!line) continue;
          try {
            channel?.handle(JSON.parse(line) as JSONRPCMessage);
          } catch {}
        }
      });
      socket.on("close", () => channel?.close());
      socket.on("error", () => channel?.close());
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => resolve());
    });
    return { host, catalogKey: hash(stableJson(tools.map((tool) => [tool.name, tool.description, tool.parameters]))), socketPath, token, server };
  };

  const spawnProc = async (request: AntigravityTurnRequest): Promise<Proc> => {
    const binary = config.binary();
    if (!binary) throw errorWith(ANTIGRAVITY_NOT_INSTALLED, "Google Antigravity CLI (agy) isn't installed on this computer.");
    const home = config.home();
    if (!antigravityCliSignedIn(home)) {
      throw errorWith(ANTIGRAVITY_LOGIN_REQUIRED, ANTIGRAVITY_SIGN_IN_NEEDED);
    }
    const key = request.ref.sessionKey;
    let current: Proc | undefined;
    const agent = await profile.prepare(request.nativeTools, request.tools.map((tool) => tool.name));
    const mcp = await startMcp(key, request.tools, () => current);
    const allowedTools = allowedToolsOf(request);
    const child = spawn(
      binary,
      ["acp", "--gemini-dir", home, "--app-data-dir", ANTIGRAVITY_APP_DATA_DIR, "--agent", agent, "--disable-telemetry", ...(request.ref.role === "worker" ? ["--dangerously-skip-permissions"] : [])],
      {
        cwd: request.cwd,
        env: {
          ...request.env,
          ...antigravityCliEnv(home),
          [ANTIGRAVITY_MCP_SOCKET_ENV]: mcp.socketPath,
          [ANTIGRAVITY_MCP_TOKEN_ENV]: mcp.token,
          [ANTIGRAVITY_ALLOWED_TOOLS_ENV]: allowedTools,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let nextId = 0;
    const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
    const write = (message: Record<string, unknown>) => {
      if (!child.stdin?.writable) return;
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
    };
    const rpc: Rpc = {
      request: (method, params) =>
        new Promise((resolve, reject) => {
          const id = ++nextId;
          pending.set(id, { resolve, reject });
          write({ id, method, params });
        }),
      notify: (method, params) => write({ method, params }),
    };
    const proc: Proc = {
      key,
      role: request.ref.role,
      child,
      rpc,
      ready: Promise.resolve({ models: [] }),
      models: [],
      cwd: request.cwd,
      agent,
      allowedTools,
      mcp,
      exited: false,
      stderr: "",
    };
    current = proc;
    let buffer = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (data: string) => {
      buffer += data;
      for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message: Record<string, any>;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id !== undefined && message.method) {
          answerRequest(proc, message);
        } else if (message.id !== undefined) {
          const waiting = pending.get(message.id);
          if (!waiting) continue;
          pending.delete(message.id);
          if (message.error) {
            waiting.reject(errorWith(String(message.error.code ?? "ACP_ERROR"), String(message.error.message ?? "Antigravity failed.")));
          } else waiting.resolve(message.result);
        } else if (message.method === "session/update") {
          onUpdate(proc, message.params?.update ?? {});
        }
      }
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (data: string) => {
      proc.stderr = `${proc.stderr}${data}`.slice(-4_000);
    });
    const exited = (detail: string) => {
      if (proc.exited) return;
      proc.exited = true;
      for (const waiting of pending.values()) waiting.reject(new Error(`Antigravity CLI exited (${detail}).`));
      pending.clear();
      kill(proc, `Antigravity CLI exited (${detail}).${proc.stderr.trim() ? ` ${proc.stderr.trim().slice(-500)}` : ""}`);
    };
    child.on("exit", (code, signal) => exited(signal ?? String(code)));
    child.on("error", (error) => exited(error.message));
    proc.ready = (async () => {
      const cancelStartTimeout = forkTimeoutFiber(START_TIMEOUT_MS, () => exited("did not start"));
      try {
        await rpc.request("initialize", {
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: { name: "stella", title: "Stella", version: "1.0.0" },
        });
      } finally {
        cancelStartTimeout();
      }
      return { models: [] };
    })();
    procs.set(key, proc);
    return proc;
  };

  const answerRequest = (proc: Proc, message: Record<string, any>) => {
    const reply = (result: unknown) =>
      proc.child.stdin?.writable && proc.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
    if (message.method === "session/request_permission") {
      const options: { optionId: string; kind?: string }[] = message.params?.options ?? [];
      // Stella's orchestrator delegates work: like Claude Code's, it reads and looks things up but runs no commands and changes no files.
      const kind = String(message.params?.toolCall?.kind ?? "");
      const allow = proc.role === "worker" || !["execute", "edit", "delete", "move"].includes(kind);
      const choice = allow
        ? (options.find((option) => option.kind === "allow_once") ?? options.find((option) => option.kind?.startsWith("allow")))
        : (options.find((option) => option.kind === "reject_once") ?? options.find((option) => option.kind?.startsWith("reject")));
      reply(choice ? { outcome: { outcome: "selected", optionId: choice.optionId } } : { outcome: { outcome: "cancelled" } });
      return;
    }
    proc.child.stdin?.writable &&
      proc.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Not supported by Stella." } })}\n`);
  };

  /** A model run Stella started no turn for: nothing would record it or answer its tool calls, so it stops. */
  const endStray = (proc: Proc) => {
    if (proc.sessionId) proc.rpc.notify("session/cancel", { sessionId: proc.sessionId });
  };

  const onUpdate = (proc: Proc, update: Record<string, any>) => {
    const turn = proc.turn;
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        if (!turn) return endStray(proc);
        if ( update.content?.type === "text") chunk(proc, turn, "text", update.content.text ?? "");
        return;
      case "agent_thought_chunk":
        if (!turn) return endStray(proc);
        if ( update.content?.type === "text") chunk(proc, turn, "thinking", update.content.text ?? "");
        return;
      case "tool_call":
        if (!turn) return endStray(proc);
        toolCall(proc, turn, update);
        return;
      case "tool_call_update":
        if (turn) toolEnded(turn, update);
        return;
      case "config_option_update": {
        const model = (update.configOptions as any[] | undefined)?.find((option) => option?.id === "model");
        if (typeof model?.currentValue === "string") proc.currentModel = model.currentValue;
        return;
      }
      default:
        return;
    }
  };

  const sessionMeta = (systemPrompt: string) => (systemPrompt.trim() ? { _meta: { antigravity: { systemPrompt: { append: systemPrompt } } } } : {});

  const noteModels = (proc: Proc, result: any) => {
    const available = result?.models?.availableModels;
    if (Array.isArray(available)) proc.models = available.map((model: any) => String(model?.modelId ?? "")).filter(Boolean);
    if (typeof result?.models?.currentModelId === "string") proc.currentModel = result.models.currentModelId;
  };

  /** Opens (or reopens, when the prompt or tools changed) this process's ACP session. Returns whether its history carried over. */
  const ensureSession = async (proc: Proc, request: AntigravityTurnRequest): Promise<boolean> => {
    const shape = hash(`${proc.mcp.catalogKey}\0${request.systemPrompt}`);
    const wanted = proc.sessionId ?? request.resumeSessionId;
    if (proc.sessionId && proc.sessionShape === shape) return true;
    if (proc.sessionId) await proc.rpc.request("session/close", { sessionId: proc.sessionId }).catch(() => undefined);
    const base = { cwd: request.cwd, mcpServers: [], ...sessionMeta(request.systemPrompt) };
    if (wanted) {
      try {
        const result = await proc.rpc.request("session/resume", { sessionId: wanted, ...base });
        noteModels(proc, result);
        proc.sessionId = wanted;
        proc.sessionShape = shape;
        return true;
      } catch (error) {
        console.warn("[antigravity-cli] session did not resume; starting a new one", { sessionKey: proc.key, error: String(error) });
      }
    }
    const result = await proc.rpc.request("session/new", base);
    noteModels(proc, result);
    proc.sessionId = String(result?.sessionId ?? "");
    proc.sessionShape = shape;
    if (!proc.sessionId) throw new Error("Antigravity did not open a session.");
    return false;
  };

  const runTurn = async (request: AntigravityTurnRequest): Promise<{ text: string; sessionId: string }> => {
    if (request.signal.aborted) throw new Error("Stopped.");
    const key = request.ref.sessionKey;
    let proc = procs.get(key);
    if (proc && !antigravityCliSignedIn(config.home())) {
      kill(proc, "Signed out.");
      proc = undefined;
    }
    if (proc && (proc.exited || proc.turn || proc.cwd !== request.cwd)) {
      kill(proc, "Replaced.");
      proc = undefined;
    }
    if (proc && proc.allowedTools !== allowedToolsOf(request)) {
      kill(proc, "Stella's tools changed.");
      proc = undefined;
    }
    if (proc && proc.mcp.catalogKey !== hash(stableJson(request.tools.map((tool) => [tool.name, tool.description, tool.parameters])))) {
      kill(proc, "Stella's tools changed.");
      proc = undefined;
    }
    proc ??= await spawnProc(request);
    proc.idle?.();
    await proc.ready;
    const resumed = await ensureSession(proc, request);
    const sessionId = proc.sessionId!;
    request.onSessionId(sessionId);
    const wire = antigravityWireModel(proc.models, request.model, request.thinkingLevel);
    if (wire && wire !== proc.currentModel) {
      await proc.rpc.request("session/set_model", { sessionId, modelId: wire });
      proc.currentModel = wire;
    }
    const text = resumed || !request.resumeSessionId ? request.prompt : request.resumeFallbackPrompt;
    const prompt = [
      ...(text ? [{ type: "text", text }] : []),
      ...request.images.map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType })),
    ];
    const live = proc;
    const turn: TurnState & { reject?: (error: Error) => void } = {
      request,
      messageOpen: false,
      blockIndex: -1,
      blockKind: undefined,
      toolsInMessage: 0,
      closeTimer: undefined,
      finalText: "",
      calls: new Map(),
      claimWaiters: new Set(),
    };
    live.turn = turn;
    const onAbort = () => live.rpc.notify("session/cancel", { sessionId });
    request.signal.addEventListener("abort", onAbort, { once: true });
    try {
      const result = await new Promise<any>((resolve, reject) => {
        turn.reject = reject;
        live.rpc.request("session/prompt", { sessionId, prompt: prompt.length > 0 ? prompt : [{ type: "text", text: "Continue." }] }).then(resolve, reject);
      });
      const usage = result?.usage;
      closeMessage(
        turn,
        result?.stopReason === "max_tokens" ? "max_tokens" : result?.stopReason === "refusal" ? "refusal" : "end_turn",
        usage
          ? {
              input_tokens: Math.max(0, Number(usage.inputTokens ?? 0) - Number(usage.cachedReadTokens ?? 0)),
              output_tokens: Number(usage.outputTokens ?? 0),
              cache_read_input_tokens: Number(usage.cachedReadTokens ?? 0),
            }
          : undefined,
      );
      if (result?.stopReason === "cancelled" || request.signal.aborted) throw new Error("Stopped.");
      request.onEvent({ type: "result", subtype: "success", result: turn.finalText, session_id: sessionId });
      return { text: turn.finalText, sessionId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/authentication required/i.test(message)) {
        throw errorWith(ANTIGRAVITY_LOGIN_REQUIRED, ANTIGRAVITY_SIGN_IN_NEEDED);
      }
      throw error;
    } finally {
      request.signal.removeEventListener("abort", onAbort);
      if (live.turn === turn) live.turn = undefined;
      turn.closeTimer?.();
      if (procs.get(key) === live && !live.exited) {
        live.idle = forkTimeoutFiber(IDLE_CLOSE_MS, () => kill(live, "Idle."));
      }
    }
  };

  return {
    runTurn,
    close(sessionKey: string) {
      const proc = procs.get(sessionKey);
      if (!proc) return;
      if (proc.turn) {
        proc.rpc.notify("session/cancel", { sessionId: proc.sessionId });
      }
      void proc.rpc.request("session/close", { sessionId: proc.sessionId }).catch(() => undefined);
      kill(proc, "Closed.");
    },
    closeAll() {
      for (const proc of [...procs.values()]) kill(proc, "Closed.");
    },
    liveSessionId(sessionKey: string): string | undefined {
      const proc = procs.get(sessionKey);
      return proc && !proc.exited ? proc.sessionId : undefined;
    },
  };
};

export type AntigravityCliRuntime = ReturnType<typeof createAntigravityCliRuntime>;

export const antigravityHomeFor = (dataDir: string): string =>
  process.env.STELLA_ANTIGRAVITY_CLI_HOME?.trim() || path.join(dataDir, "antigravity-cli", "default");
