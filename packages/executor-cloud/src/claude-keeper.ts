/**
 * Keeps one thread's `claude` process between that thread's turns in a warm
 * container (see `claude-keeper-protocol.ts`). Started detached by the turn's
 * executor with its socket path as the only argument; the executor that
 * attaches drives the process, and between turns it waits stopped (SIGSTOP),
 * so nothing it holds can change the native state the turn sealed.
 *
 * Claude's MCP client is pointed at this process, which forwards to the
 * attached turn's own tool host. A follow-up turn brings a new host, and the
 * proxy opens a new MCP session on it before Claude runs again; Claude keeps
 * its own session id.
 *
 * Any doubt ends the process instead of reusing it: an executor that goes
 * away mid-turn, a process that exits, an idle timeout. The executor then
 * starts a fresh one, exactly as a cold turn does.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { Effect } from "effect";
import { forkAbortTimer, runToolEffect } from "@stella/runtime/kernel/tools/effect-runtime.js";
import {
  CLAUDE_KEEPER_IDLE_MS,
  CLAUDE_KEEPER_MCP_CONFIG_PLACEHOLDER,
  type ClaudeKeeperEvent,
  type ClaudeKeeperFreshReason,
  type ClaudeKeeperRequest,
  type ClaudeKeeperState,
  type ClaudeKeeperUpstream,
} from "./claude-keeper-protocol.js";

const socketPath = process.argv[2];
if (!socketPath || !path.isAbsolute(socketPath)) {
  console.error("claude keeper requires an absolute socket path");
  process.exit(2);
}
const configDirectory = `${socketPath}.mcp`;
const log = (event: string, fields: Record<string, unknown> = {}): void => {
  console.error(JSON.stringify({ at: Date.now(), event, ...fields }));
};

const sameSecret = (left: string | undefined, right: string): boolean => {
  if (typeof left !== "string") return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

// ---- MCP proxy --------------------------------------------------------------

const proxyBearer = `Bearer ${randomBytes(32).toString("base64url")}`;
const proxyPath = `/mcp/${randomBytes(32).toString("base64url")}`;
let upstream: (ClaudeKeeperUpstream & { session?: string }) | undefined;
let clientSession: string | undefined;
let initializeParams: unknown;
let protocolVersion: string | undefined;

const readBody = async (request: http.IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
};

const jsonRpcMethod = (body: Buffer): string | undefined => {
  try {
    const value = JSON.parse(body.toString("utf8")) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const method = (value as { method?: unknown }).method;
      if (method === "initialize") {
        initializeParams = (value as { params?: unknown }).params;
      }
      return typeof method === "string" ? method : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
};

const forward = async (
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> => {
  const target = upstream;
  if (!target) {
    response.writeHead(503).end();
    return;
  }
  const body = request.method === "POST" ? await readBody(request) : undefined;
  const initializing =
    body !== undefined &&
    request.headers["mcp-session-id"] === undefined &&
    jsonRpcMethod(body) === "initialize";
  const headers: Record<string, string> = { authorization: target.authorization };
  for (const name of ["content-type", "accept", "mcp-protocol-version", "last-event-id"]) {
    const value = request.headers[name];
    if (typeof value === "string") headers[name] = value;
  }
  if (typeof request.headers["mcp-protocol-version"] === "string") {
    protocolVersion = request.headers["mcp-protocol-version"];
  }
  if (!initializing && target.session) headers["mcp-session-id"] = target.session;
  const upstreamResponse = await fetch(target.url, {
    method: request.method ?? "POST",
    headers,
    ...(body !== undefined ? { body } : {}),
  });
  const session = upstreamResponse.headers.get("mcp-session-id");
  const out: Record<string, string> = {};
  const contentType = upstreamResponse.headers.get("content-type");
  if (contentType) out["content-type"] = contentType;
  if (session) {
    target.session = session;
    if (initializing || !clientSession) clientSession = session;
    out["mcp-session-id"] = clientSession;
  }
  response.writeHead(upstreamResponse.status, out);
  if (!upstreamResponse.body) {
    response.end();
    return;
  }
  const reader = upstreamResponse.body.getReader();
  response.once("close", () => void reader.cancel().catch(() => undefined));
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    response.write(value);
  }
  response.end();
};

const proxy = http.createServer((request, response) => {
  if (request.url !== proxyPath) {
    response.writeHead(404).end();
    return;
  }
  if (!sameSecret(request.headers.authorization, proxyBearer)) {
    response.writeHead(401).end();
    return;
  }
  // No server-initiated stream: the host never needs one, and a stream held
  // open across a stopped process would only break.
  if (request.method === "GET") {
    response.writeHead(405, { allow: "POST, DELETE" }).end();
    return;
  }
  void forward(request, response).catch((error: unknown) => {
    log("proxy_failed", { message: String((error as Error)?.message ?? error) });
    if (!response.headersSent) response.writeHead(502);
    if (!response.writableEnded) response.end();
  });
});

const rpcResult = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const payloads = contentType.includes("text/event-stream")
    ? text
        .split(/\r?\n/u)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
    : [text];
  for (const payload of payloads) {
    if (!payload) continue;
    const value = JSON.parse(payload) as { result?: unknown; error?: { message?: string } };
    if (value.error) throw new Error(value.error.message ?? "MCP request failed");
    if (value.result !== undefined) return value.result;
  }
  throw new Error("MCP response carried no result");
};

/**
 * A new turn's tool host has never seen this Claude: open a session on it as
 * Claude first did, and list its tools, which is what tells the host that
 * Claude is ready.
 */
const openUpstreamSession = async (): Promise<void> => {
  const target = upstream;
  if (!target || initializeParams === undefined) {
    throw new Error("No MCP session to carry over");
  }
  const signal = AbortSignal.timeout(5_000);
  const base = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: target.authorization,
  };
  const initialized = await fetch(target.url, {
    method: "POST",
    headers: base,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "stella-keeper-initialize",
      method: "initialize",
      params: initializeParams,
    }),
    signal,
  });
  if (!initialized.ok) throw new Error(`MCP initialize returned ${initialized.status}`);
  const session = initialized.headers.get("mcp-session-id");
  if (!session) throw new Error("MCP initialize returned no session");
  const result = (await rpcResult(initialized)) as { protocolVersion?: unknown };
  if (typeof result?.protocolVersion === "string") protocolVersion = result.protocolVersion;
  target.session = session;
  const headers = {
    ...base,
    "mcp-session-id": session,
    ...(protocolVersion ? { "mcp-protocol-version": protocolVersion } : {}),
  };
  const notified = await fetch(target.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    signal,
  });
  await notified.body?.cancel().catch(() => undefined);
  if (!notified.ok) throw new Error(`MCP initialized returned ${notified.status}`);
  const listed = await fetch(target.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: "stella-keeper-tools", method: "tools/list" }),
    signal,
  });
  if (!listed.ok) throw new Error(`MCP tools/list returned ${listed.status}`);
  await rpcResult(listed);
};

// ---- the claude process -----------------------------------------------------

type Child = {
  process: ChildProcessWithoutNullStreams;
  key: string;
  exited: boolean;
  parked: boolean;
  /** Set once the parked turn sealed its state; null while a turn holds it. */
  released: ClaudeKeeperState | null;
  stderr: string;
  exitedPromise: Promise<void>;
};

let child: Child | undefined;
let attached: net.Socket | undefined;
let cancelIdleTimer: (() => void) | undefined;

const send = (socket: net.Socket | undefined, event: ClaudeKeeperEvent): void => {
  if (socket && !socket.destroyed) socket.write(`${JSON.stringify(event)}\n`);
};

const shutdown = (reason: string): never => {
  log("shutdown", { reason });
  if (child && !child.exited) child.process.kill("SIGKILL");
  void rm(configDirectory, { recursive: true, force: true }).catch(() => undefined);
  void rm(socketPath, { force: true }).catch(() => undefined);
  void rm(`${socketPath}.pid`, { force: true }).catch(() => undefined);
  process.exit(0);
};

const killChild = async (): Promise<Child | undefined> => {
  const current = child;
  if (!current) return undefined;
  child = undefined;
  if (!current.exited) current.process.kill("SIGKILL");
  await current.exitedPromise;
  return current;
};

const startChild = async (
  spec: Extract<ClaudeKeeperRequest, { t: "attach" }>,
): Promise<void> => {
  await mkdir(configDirectory, { recursive: true, mode: 0o700 });
  await chmod(configDirectory, 0o700);
  const configPath = path.join(configDirectory, "mcp.json");
  await writeFile(
    configPath,
    JSON.stringify({
      mcpServers: {
        stella: {
          type: "http",
          url: `http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}${proxyPath}`,
          headers: { Authorization: proxyBearer },
        },
      },
    }),
    { mode: 0o600 },
  );
  clientSession = undefined;
  initializeParams = undefined;
  const processHandle = spawn(
    spec.spawn.command,
    spec.spawn.args.map((arg) =>
      arg === CLAUDE_KEEPER_MCP_CONFIG_PLACEHOLDER ? configPath : arg,
    ),
    { cwd: spec.spawn.cwd, env: spec.spawn.env, stdio: ["pipe", "pipe", "pipe"] },
  );
  let resolveExit!: () => void;
  const current: Child = {
    process: processHandle,
    key: spec.key,
    exited: false,
    parked: false,
    released: null,
    stderr: "",
    exitedPromise: new Promise<void>((resolve) => {
      resolveExit = resolve;
    }),
  };
  child = current;
  let pending = "";
  let configRemoved = false;
  processHandle.stdout.on("data", (chunk: Buffer) => {
    // Claude reads its MCP config once, before it writes anything.
    if (!configRemoved) {
      configRemoved = true;
      void rm(configDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/u);
    pending = lines.pop() ?? "";
    if (child !== current) return;
    for (const line of lines) {
      if (line.trim()) send(attached, { t: "line", line });
    }
  });
  processHandle.stderr.on("data", (chunk: Buffer) => {
    current.stderr = `${current.stderr}${chunk.toString()}`.slice(-32_000);
  });
  processHandle.stdin.on("error", () => undefined);
  const exited = (code: number | null, signal: string | null) => {
    if (current.exited) return;
    current.exited = true;
    if (pending.trim() && child === current) send(attached, { t: "line", line: pending });
    pending = "";
    resolveExit();
    log("claude_exited", { code, signal, pid: processHandle.pid });
    if (child !== current) return;
    send(attached, { t: "exit", code, signal, stderr: current.stderr });
    child = undefined;
    if (!attached) shutdown("claude exited while parked");
  };
  processHandle.on("close", exited);
  processHandle.on("error", (error) => {
    current.stderr = `${current.stderr}${error.message}`.slice(-32_000);
    exited(null, null);
  });
  log("claude_spawned", { pid: processHandle.pid });
};

const sameState = (
  left: ClaudeKeeperState | null,
  right: ClaudeKeeperState | null,
): boolean =>
  Boolean(
    left &&
      right &&
      left.mac === right.mac &&
      left.credentials === right.credentials &&
      left.files === right.files,
  );

const attach = async (
  socket: net.Socket,
  request: Extract<ClaudeKeeperRequest, { t: "attach" }>,
): Promise<void> => {
  cancelIdleTimer?.();
  cancelIdleTimer = undefined;
  if (attached && attached !== socket) {
    // A newer attempt of this thread's turn supersedes whatever still holds
    // the process.
    const previous = attached;
    attached = undefined;
    await killChild();
    previous.destroy();
  }
  attached = socket;
  upstream = { ...request.upstream };
  const current = child;
  let fresh: ClaudeKeeperFreshReason = "none";
  if (current && !current.exited && current.parked && current.released) {
    if (!request.reusable) fresh = "unreusable";
    else if (current.key !== request.key) fresh = "key";
    else if (!sameState(current.released, request.state)) fresh = "state";
  } else if (current) {
    fresh = "exited";
  }
  if (current && !current.exited && fresh === "none") {
    try {
      await openUpstreamSession();
      current.parked = false;
      current.released = null;
      current.process.kill("SIGCONT");
      log("claude_reused", { pid: current.process.pid });
      send(socket, { t: "attached", reused: true, fresh });
      return;
    } catch (error) {
      log("mcp_carry_over_failed", { message: String((error as Error)?.message ?? error) });
      fresh = "exited";
    }
  }
  await killChild();
  if (attached !== socket) return;
  await startChild(request);
  send(socket, { t: "attached", reused: false, fresh });
};

/** The tree Claude writes: path, size and mtime of every entry. */
const fingerprint = async (root: string): Promise<string> => {
  const parts: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      const details = await stat(full).catch(() => undefined);
      if (!details) continue;
      parts.push(`${full}\0${details.size}\0${details.mtimeMs}`);
      if (entry.isDirectory()) await walk(full);
    }
  };
  await walk(root);
  return parts.sort().join("\n");
};

/**
 * Stop the process once its session files have settled: what the turn
 * seals next is then exactly what the process holds, and nothing changes it
 * until the next turn continues it.
 */
const park = async (socket: net.Socket, stateRoot: string): Promise<void> => {
  const current = child;
  if (!current || current.exited) {
    send(socket, { t: "error", message: "Claude is not running." });
    return;
  }
  const deadline = Date.now() + 2_000;
  let previous = await fingerprint(stateRoot);
  let stableSince = Date.now();
  while (Date.now() < deadline && Date.now() - stableSince < 150) {
    await runToolEffect(Effect.sleep(50));
    const next = await fingerprint(stateRoot);
    if (next !== previous) {
      previous = next;
      stableSince = Date.now();
    }
  }
  if (current.exited || child !== current) {
    send(socket, { t: "error", message: "Claude exited before it could wait." });
    return;
  }
  current.process.kill("SIGSTOP");
  current.parked = true;
  send(socket, { t: "parked" });
};

const handle = async (socket: net.Socket, request: ClaudeKeeperRequest): Promise<void> => {
  if (request.t === "attach") {
    await attach(socket, request);
    return;
  }
  if (attached !== socket) {
    send(socket, { t: "error", message: "Not attached." });
    return;
  }
  const current = child;
  switch (request.t) {
    case "write":
      if (current && !current.exited) current.process.stdin.write(request.data);
      return;
    case "park":
      await park(socket, request.stateRoot);
      return;
    case "release":
      if (!current || current.exited || !current.parked) {
        send(socket, { t: "error", message: "Claude is not parked." });
        return;
      }
      current.released = request.state;
      send(socket, { t: "released" });
      return;
    case "kill": {
      const killed = await killChild();
      send(socket, {
        t: "exit",
        code: null,
        signal: "SIGKILL",
        stderr: killed?.stderr ?? "",
      });
      return;
    }
  }
};

const server = net.createServer((socket) => {
  let buffered = "";
  let queue: Promise<void> = Promise.resolve();
  socket.on("data", (chunk: Buffer) => {
    buffered += chunk.toString();
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let request: ClaudeKeeperRequest;
      try {
        request = JSON.parse(line) as ClaudeKeeperRequest;
      } catch {
        socket.destroy();
        return;
      }
      queue = queue
        .then(() => handle(socket, request))
        .catch((error: unknown) => {
          log("request_failed", { message: String((error as Error)?.message ?? error) });
          send(socket, { t: "error", message: String((error as Error)?.message ?? error) });
        });
    }
  });
  socket.on("error", () => undefined);
  socket.on("close", () => {
    if (attached !== socket) return;
    attached = undefined;
    upstream = undefined;
    const current = child;
    // Only a turn that parked and sealed hands the process on; an executor
    // gone any other way (stopped, crashed, killed) takes Claude with it.
    if (!current || current.exited || !current.parked || !current.released) {
      shutdown("executor left mid-turn");
    }
    cancelIdleTimer = forkAbortTimer(CLAUDE_KEEPER_IDLE_MS, () => shutdown("idle"));
  });
});

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGHUP", () => undefined);

await new Promise<void>((resolve, reject) => {
  proxy.once("error", reject);
  proxy.listen(0, "127.0.0.1", () => resolve());
});
await rm(socketPath, { force: true });
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(socketPath, () => resolve());
});
await chmod(socketPath, 0o600);
await writeFile(`${socketPath}.pid`, `${process.pid}\n`, { mode: 0o600 });
cancelIdleTimer = forkAbortTimer(30_000, () => {
  if (!attached) shutdown("never attached");
});
log("listening", { pid: process.pid });
