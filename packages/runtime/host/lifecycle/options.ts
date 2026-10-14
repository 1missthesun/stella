import type { Socket } from "node:net";
import type { RuntimePaths } from "../../worker/runtime-paths.js";
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

// The Bun worker cold-starts by loading the bundled kernel entry, which on
// low-end Windows machines has been observed at ~9.5s (worker startupMs≈9466).
// A 10s budget left effectively no margin, so a slightly slower boot timed out
// and triggered a spawn-retry cascade (worker not "ready" until ~40s, plus a
// failed startup source-history record that waits on it). 30s gives ample
// headroom on slow machines while still surfacing a genuinely stuck worker.
export const defaultLifecycleBudgets: LifecycleBudgets = {
  startPollIntervalMs: 50,
  startTimeoutMs: 30_000,
  socketConnectTimeoutMs: 1_000,
  hostLockTimeoutMs: 75_000,
  staleRetryTimeoutMs: 2_000,
};
