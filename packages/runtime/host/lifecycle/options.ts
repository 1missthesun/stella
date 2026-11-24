import type { Socket } from "node:net";
import type { RuntimePaths } from "@stella/node-shared/worker/runtime-paths.js";
import type { RuntimeServerIdentity } from "../../worker/server-identity.js";

export type LifecycleConnection = {
  socket: Socket;
  pid: number;
  paths: RuntimePaths;
  spawned: boolean;
  identity?: RuntimeServerIdentity | null;
};

export type LifecycleStartOptions = {
  stellaAppDir: string;
  workerEntryPath: string;
  bunBinaryPath?: string;
  idleShutdownMs?: number;
  env?: NodeJS.ProcessEnv;
  expectedProtocolVersion?: string;
  hostExecutablePath?: string;
  verifyIdentity?: { launchEnv: Record<string, string> };
};

export type LifecycleBudgets = {
  startPollIntervalMs: number;
  startTimeoutMs: number;
  socketConnectTimeoutMs: number;
  hostLockTimeoutMs: number;
  staleRetryTimeoutMs: number;
};

export const defaultLifecycleBudgets: LifecycleBudgets = {
  startPollIntervalMs: 50,
  startTimeoutMs: 30_000,
  socketConnectTimeoutMs: 1_000,
  hostLockTimeoutMs: 75_000,
  staleRetryTimeoutMs: 2_000,
};
