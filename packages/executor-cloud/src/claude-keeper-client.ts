import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync, statSync, truncateSync } from "node:fs";
import { chmod, mkdir, readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { runToolEffect } from "@stella/runtime/kernel/tools/effect-runtime.js";
import {
  CLAUDE_KEEPER_DIRECTORY,
  type ClaudeKeeperEvent,
  type ClaudeKeeperFreshReason,
  type ClaudeKeeperRequest,
  type ClaudeKeeperState,
} from "./claude-keeper-protocol.js";

const KEEPER_ENTRY = fileURLToPath(new URL("./claude-keeper.ts", import.meta.url));
const KEEPER_LOG_MAX_BYTES = 256 * 1024;

export const claudeKeeperSocketPath = (threadId: string): string =>
  path.join(
    CLAUDE_KEEPER_DIRECTORY,
    `${createHash("sha256").update(threadId).digest("hex").slice(0, 32)}.sock`,
  );

type Exit = { code: number | null; signal: string | null; stderr: string };

export type ClaudeKeeperClient = {
  attach(
    request: Extract<ClaudeKeeperRequest, { t: "attach" }>,
  ): Promise<{ reused: boolean; fresh: ClaudeKeeperFreshReason }>;
  write(data: string): void;
  park(stateRoot: string): Promise<void>;
  release(state: ClaudeKeeperState): Promise<void>;
  kill(): Promise<Exit>;
  onLine(listener: (line: string) => void): void;
  readonly exited: Promise<Exit>;
  close(): void;
};

const connect = (socketPath: string): Promise<net.Socket> =>
  new Promise((resolve, reject) => {
    const socket = net.connect(socketPath);
    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    socket.once("error", fail);
    socket.once("connect", () => {
      socket.off("error", fail);
      resolve(socket);
    });
  });

const withTimeout = <T>(promise: Promise<T>, ms: number, message: string): Promise<T> =>
  runToolEffect(
    Effect.raceFirst(
      Effect.tryPromise({ try: () => promise, catch: (error) => error }),
      Effect.sleep(ms).pipe(Effect.flatMap(() => Effect.fail(new Error(message)))),
    ),
  );

const killKeeper = async (socketPath: string): Promise<void> => {
  const pid = Number(
    (await readFile(`${socketPath}.pid`, "utf8").catch(() => "")).trim(),
  );
  if (!Number.isSafeInteger(pid) || pid <= 1) return;
  const commandLine = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "");
  if (!commandLine.includes(KEEPER_ENTRY) || !commandLine.includes(socketPath)) {
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
};

const startKeeper = (socketPath: string): void => {
  const logPath = `${socketPath}.log`;
  try {
    if (statSync(logPath).size > KEEPER_LOG_MAX_BYTES) truncateSync(logPath, 0);
  } catch {
    // No log yet.
  }
  closeSync(openSync(logPath, "a", 0o600));
  const launcher = spawn(
    "/bin/sh",
    [
      "-c",
      'setsid "$@" </dev/null >/dev/null 2>>"$0" &',
      logPath,
      process.execPath,
      KEEPER_ENTRY,
      socketPath,
    ],
    { cwd: CLAUDE_KEEPER_DIRECTORY, env: process.env, stdio: "ignore" },
  );
  launcher.on("error", () => undefined);
  launcher.unref();
};

const client = (socket: net.Socket, socketPath: string): ClaudeKeeperClient => {
  const lineListeners: Array<(line: string) => void> = [];
  let waiter:
    | { accept: (event: ClaudeKeeperEvent) => boolean }
    | undefined;
  let resolveExit!: (exit: Exit) => void;
  let exitSettled = false;
  const exited = new Promise<Exit>((resolve) => {
    resolveExit = (exit) => {
      if (exitSettled) return;
      exitSettled = true;
      resolve(exit);
    };
  });
  const dispatch = (event: ClaudeKeeperEvent): void => {
    if (event.t === "line") {
      for (const listener of lineListeners) listener(event.line);
      return;
    }
    if (event.t === "exit") resolveExit(event);
    if (waiter?.accept(event)) waiter = undefined;
  };
  let buffered = "";
  socket.on("data", (chunk: Buffer) => {
    buffered += chunk.toString();
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        dispatch(JSON.parse(line) as ClaudeKeeperEvent);
      } catch {
        socket.destroy();
      }
    }
  });
  socket.on("error", () => undefined);
  socket.on("close", () => {
    const gone: Exit = { code: null, signal: null, stderr: "Claude's keeper stopped." };
    resolveExit(gone);
    waiter?.accept({ t: "error", message: gone.stderr });
    waiter = undefined;
  });
  const send = (request: ClaudeKeeperRequest): void => {
    if (!socket.destroyed) socket.write(`${JSON.stringify(request)}\n`);
  };
  const expect = <T>(
    request: ClaudeKeeperRequest,
    pick: (event: ClaudeKeeperEvent) => { value: T } | { error: string } | undefined,
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (socket.destroyed) {
        reject(new Error("Claude's keeper stopped."));
        return;
      }
      waiter = {
        accept: (event) => {
          const picked = pick(event);
          if (!picked) return false;
          if ("error" in picked) reject(new Error(picked.error));
          else resolve(picked.value);
          return true;
        },
      };
      send(request);
    });
  return {
    attach: (request) =>
      withTimeout(
        expect<{ reused: boolean; fresh: ClaudeKeeperFreshReason }>(request, (event) =>
          event.t === "attached"
            ? { value: { reused: event.reused, fresh: event.fresh } }
            : event.t === "error"
              ? { error: event.message }
              : undefined,
        ),
        10_000,
        "Claude's keeper did not answer.",
      ).catch(async (error: unknown): Promise<never> => {
        socket.destroy();
        await killKeeper(socketPath);
        throw error;
      }),
    write: (data) => send({ t: "write", data }),
    park: (stateRoot) =>
      withTimeout(
        expect<void>({ t: "park", stateRoot }, (event) =>
          event.t === "parked"
            ? { value: undefined }
            : event.t === "error" || event.t === "exit"
              ? { error: event.t === "error" ? event.message : "Claude exited." }
              : undefined,
        ),
        5_000,
        "Claude did not stop in time.",
      ),
    release: (state) =>
      withTimeout(
        expect<void>({ t: "release", state }, (event) =>
          event.t === "released"
            ? { value: undefined }
            : event.t === "error" || event.t === "exit"
              ? { error: event.t === "error" ? event.message : "Claude exited." }
              : undefined,
        ),
        2_000,
        "Claude's keeper did not answer.",
      ),
    kill: async () => {
      send({ t: "kill" });
      return await withTimeout(exited, 5_000, "Claude did not exit.").catch(
        async () => {
          socket.destroy();
          await killKeeper(socketPath);
          return { code: null, signal: "SIGKILL", stderr: "" };
        },
      );
    },
    onLine: (listener) => {
      lineListeners.push(listener);
    },
    exited,
    close: () => {
      socket.end();
    },
  };
};

export const openClaudeKeeper = async (
  threadId: string,
): Promise<ClaudeKeeperClient | undefined> => {
  if (process.platform !== "linux") return undefined;
  const socketPath = claudeKeeperSocketPath(threadId);
  try {
    await mkdir(CLAUDE_KEEPER_DIRECTORY, { recursive: true, mode: 0o700 });
    await chmod(CLAUDE_KEEPER_DIRECTORY, 0o700);
    const existing = await connect(socketPath).catch(() => undefined);
    if (existing) return client(existing, socketPath);
    startKeeper(socketPath);
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const socket = await connect(socketPath).catch(() => undefined);
      if (socket) return client(socket, socketPath);
      await runToolEffect(Effect.sleep(20));
    }
    await killKeeper(socketPath);
  } catch (error) {
    console.error(
      `claude keeper unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return undefined;
};
