import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmod, readdir, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { Effect } from "effect";
import { forkAbortTimer, runToolEffect } from "@stella/runtime/kernel/tools/effect-runtime.js";
import {
  CLAUDE_KEEPER_IDLE_MS,
  type ClaudeKeeperEvent,
  type ClaudeKeeperFreshReason,
  type ClaudeKeeperRequest,
  type ClaudeKeeperState,
} from "./claude-keeper-protocol.js";

const socketPath = process.argv[2];
if (!socketPath || !path.isAbsolute(socketPath)) {
  console.error("claude keeper requires an absolute socket path");
  process.exit(2);
}
const log = (event: string, fields: Record<string, unknown> = {}): void => {
  console.error(JSON.stringify({ at: Date.now(), event, ...fields }));
};

type Child = {
  process: ChildProcessWithoutNullStreams;
  key: string;
  exited: boolean;
  parked: boolean;
  released: ClaudeKeeperState | null;
  stderr: string;
  exitedPromise: Promise<void>;
};

let child: Child | undefined;

/**
 * Claude Code runs under its sandbox launcher (claude-sandbox.ts), in a
 * process group of its own: parking, continuing and killing reach the CLI and
 * the launcher together.
 */
const signal = (current: Child, name: NodeJS.Signals): void => {
  const pid = current.process.pid;
  try {
    if (pid) {
      process.kill(-pid, name);
      return;
    }
  } catch {
    // The group is gone; signal the launcher itself.
  }
  current.process.kill(name);
};
let attached: net.Socket | undefined;
let cancelIdleTimer: (() => void) | undefined;

const send = (socket: net.Socket | undefined, event: ClaudeKeeperEvent): void => {
  if (socket && !socket.destroyed) socket.write(`${JSON.stringify(event)}\n`);
};

const shutdown = (reason: string): never => {
  log("shutdown", { reason });
  if (child && !child.exited) signal(child, "SIGKILL");
  void rm(socketPath, { force: true }).catch(() => undefined);
  void rm(`${socketPath}.pid`, { force: true }).catch(() => undefined);
  process.exit(0);
};

const killChild = async (): Promise<Child | undefined> => {
  const current = child;
  if (!current) return undefined;
  child = undefined;
  if (!current.exited) signal(current, "SIGKILL");
  await current.exitedPromise;
  return current;
};

const startChild = async (
  spec: Extract<ClaudeKeeperRequest, { t: "attach" }>,
): Promise<void> => {
  // Stella's tools travel on the process's own stdin/stdout, so whichever
  // turn is attached answers them; a picked-up process needs nothing redone.
  const processHandle = spawn(spec.spawn.command, spec.spawn.args, {
    cwd: spec.spawn.cwd,
    env: spec.spawn.env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });
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
  processHandle.stdout.on("data", (chunk: Buffer) => {
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

const stateDifferences = (
  released: ClaudeKeeperState,
  requested: ClaudeKeeperState | null,
): string[] => {
  if (!requested) return ["noState"];
  const differs: string[] = [];
  if (released.mac !== requested.mac) differs.push("mac");
  if (released.credentials !== requested.credentials) differs.push("credentials");
  if (released.files !== requested.files) differs.push("files");
  return differs;
};

const attach = async (
  socket: net.Socket,
  request: Extract<ClaudeKeeperRequest, { t: "attach" }>,
): Promise<void> => {
  cancelIdleTimer?.();
  cancelIdleTimer = undefined;
  if (attached && attached !== socket) {
    const previous = attached;
    attached = undefined;
    await killChild();
    previous.destroy();
  }
  attached = socket;
  const current = child;
  let fresh: ClaudeKeeperFreshReason = "none";
  let differs: string[] | undefined;
  if (current && !current.exited && current.parked && current.released) {
    if (!request.reusable) fresh = "unreusable";
    else if (current.key !== request.key) fresh = "key";
    else if (!sameState(current.released, request.state)) {
      fresh = "state";
      differs = stateDifferences(current.released, request.state);
    }
  } else if (current) {
    fresh = "exited";
  }
  if (current && !current.exited && fresh === "none") {
    current.parked = false;
    current.released = null;
    signal(current, "SIGCONT");
    log("claude_reused", { pid: current.process.pid });
    send(socket, { t: "attached", reused: true, fresh });
    return;
  }
  await killChild();
  if (attached !== socket) return;
  await startChild(request);
  send(socket, { t: "attached", reused: false, fresh, ...(differs ? { differs } : {}) });
};

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
  signal(current, "SIGSTOP");
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
    const current = child;
    if (!current || current.exited || !current.parked || !current.released) {
      shutdown("executor left mid-turn");
    }
    cancelIdleTimer = forkAbortTimer(CLAUDE_KEEPER_IDLE_MS, () => shutdown("idle"));
  });
});

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGHUP", () => undefined);

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
