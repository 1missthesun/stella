/**
 * Shell processes: spawning a pipe or PTY shell, the TERM→1s→KILL ladders
 * that tear down a whole process group, and `runShell`, the one-shot
 * foreground runner.
 */

import { spawn } from "child_process";
import type { ToolProcessIdentity } from "../types.js";
import { terminateProcessTree } from "../../shared/process-tree.js";
import { isolateToolProcessLaunch } from "../process-isolation.js";

export type SpawnedShell = ReturnType<typeof spawn>;

export type SpawnedPtyShell = {
  process: Bun.Subprocess;
  terminal: Bun.Terminal;
  write: (chars: string) => Promise<void>;
  resize: (cols: number, rows: number) => void;
  close: () => void;
};

export const spawnShellProcess = (
  shell: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  windowsVerbatimArguments = false,
  processIdentity?: ToolProcessIdentity,
) => {
  const launch = isolateToolProcessLaunch({
    command: shell,
    commandArgs: args,
    identity: processIdentity,
  });
  return spawn(launch.command, launch.args, {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    windowsVerbatimArguments,
    // On Unix, make the shell the leader of its own process group so timeouts
    // and manual kills can terminate the entire command tree.
    detached: process.platform !== "win32",
    ...(launch.nativeIdentity
      ? {
          uid: launch.nativeIdentity.uid,
          gid: launch.nativeIdentity.gid,
        }
      : {}),
  });
};

const DEFAULT_PTY_COLUMNS = 80;
const DEFAULT_PTY_ROWS = 24;
export const PTY_OUTPUT_SETTLE_MS = 15;
export const PTY_OUTPUT_MAX_SETTLE_MS = 100;

type PtyShellCallbacks = {
  onData: (data: string) => void;
  onExit: (
    exitCode: number | null,
    signalCode: number | null,
    error?: Error,
  ) => void;
  onTerminalExit: (exitCode: number) => void;
};

/**
 * Spawn a shell through Bun's native terminal transport. Bun maps this to
 * openpty(3) on macOS/Linux and CreatePseudoConsole (ConPTY) on Windows.
 *
 * Bun may invoke spawn callbacks before `Bun.spawn` returns, so every callback
 * crosses a microtask boundary. That guarantees startShell has installed the
 * returned transport on its managed record before lifecycle events arrive.
 */
export const spawnPtyShellProcess = (
  shell: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  windowsVerbatimArguments: boolean,
  callbacks: PtyShellCallbacks,
  processIdentity?: ToolProcessIdentity,
): SpawnedPtyShell => {
  const bunRuntime = (globalThis as typeof globalThis & { Bun?: typeof Bun })
    .Bun;
  if (!bunRuntime || typeof bunRuntime.Terminal !== "function") {
    throw new Error(
      "PTY execution requires Stella's bundled Bun runtime with Bun.Terminal support.",
    );
  }

  const drainWaiters = new Set<() => void>();
  const outputDecoder = new TextDecoder();
  const terminal = new bunRuntime.Terminal({
    cols: DEFAULT_PTY_COLUMNS,
    rows: DEFAULT_PTY_ROWS,
    name: "xterm-256color",
    data: (_terminal, data) => {
      const chunk = outputDecoder.decode(data, { stream: true });
      if (chunk) queueMicrotask(() => callbacks.onData(chunk));
    },
    drain: () => {
      const waiters = [...drainWaiters];
      drainWaiters.clear();
      for (const waiter of waiters) waiter();
    },
    exit: (_terminal, exitCode) => {
      const finalChunk = outputDecoder.decode();
      queueMicrotask(() => {
        if (finalChunk) callbacks.onData(finalChunk);
        callbacks.onTerminalExit(exitCode);
      });
    },
  });

  const launch = isolateToolProcessLaunch({
    command: shell,
    commandArgs: args,
    identity: processIdentity,
  });
  let subprocess: Bun.Subprocess;
  try {
    subprocess = bunRuntime.spawn([launch.command, ...launch.args], {
      cwd,
      env: {
        ...env,
        TERM: env.TERM?.trim() || "xterm-256color",
      },
      terminal,
      windowsHide: true,
      windowsVerbatimArguments,
      detached: process.platform !== "win32",
      ...(launch.nativeIdentity
        ? {
            uid: launch.nativeIdentity.uid,
            gid: launch.nativeIdentity.gid,
          }
        : {}),
      onExit: (_subprocess, exitCode, signalCode, error) => {
        const normalizedError = error
          ? error instanceof Error
            ? error
            : new Error(String(error))
          : undefined;
        queueMicrotask(() =>
          callbacks.onExit(exitCode, signalCode, normalizedError),
        );
      },
    });
  } catch (error) {
    terminal.close();
    throw error;
  }

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    const waiters = [...drainWaiters];
    drainWaiters.clear();
    for (const waiter of waiters) waiter();
    if (!terminal.closed) terminal.close();
  };

  const write = async (chars: string): Promise<void> => {
    if (closed || terminal.closed) {
      throw new Error("PTY stdin is closed.");
    }
    const normalized =
      process.platform === "win32" ? chars.replace(/\r?\n/g, "\r") : chars;
    const bytes = new TextEncoder().encode(normalized);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const written = terminal.write(bytes.subarray(offset));
      if (written > 0) {
        offset += Math.min(written, bytes.byteLength - offset);
        continue;
      }
      await new Promise<void>((resolve) => {
        drainWaiters.add(resolve);
      });
      if (closed || terminal.closed) {
        throw new Error("PTY stdin closed before all input was written.");
      }
    }
  };

  const resize = (cols: number, rows: number) => terminal.resize(cols, rows);

  return { process: subprocess, terminal, write, resize, close };
};

const shellTerminations = new WeakMap<object, Promise<void>>();

/**
 * TERM→1s→KILL for the shell's whole tree. Single-flight per process so
 * repeated kills join the teardown already in progress. The returned promise
 * settles once the shell, its process group and any escaped descendants are
 * gone, or SIGKILL has been dispatched to the survivors.
 */
const terminateShellTree = (
  key: object,
  pid: number | undefined,
  isRootRunning: () => boolean,
): Promise<void> => {
  const existing = shellTerminations.get(key);
  if (existing) return existing;
  const termination = terminateProcessTree(pid, {
    isRootRunning,
    forceAfterMs: 1_000,
  }).finally(() => {
    shellTerminations.delete(key);
  });
  shellTerminations.set(key, termination);
  return termination;
};

export const terminateShellProcess = (child: SpawnedShell): Promise<void> =>
  terminateShellTree(
    child,
    child.pid,
    () => child.exitCode === null && child.signalCode === null,
  );

export const terminatePtyShellProcess = (
  pty: SpawnedPtyShell,
): Promise<void> => {
  const isRootRunning = () =>
    pty.process.exitCode === null && pty.process.signalCode === null;
  // On pre-24H2 Windows, ClosePseudoConsole can block while a live child is
  // flushing. Kill the process first and close the terminal only after exit.
  if (!isRootRunning()) pty.close();
  return terminateShellTree(pty.process, pty.process.pid, isRootRunning).then(
    () => {
      if (!isRootRunning()) pty.close();
    },
  );
};

