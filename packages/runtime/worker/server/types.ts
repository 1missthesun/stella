import type { createStellaHostRunner } from "../../kernel/runner.js";

/**
 * Host-pushed worker configuration. `INTERNAL_WORKER_INITIALIZE` carries the
 * full record; `INTERNAL_WORKER_CONFIGURE` carries partial patches.
 */
export type WorkerInitializationState = {
  protocolVersion?: string;
  clientVersion?: string;
  isDev?: boolean;
  stellaAppDir: string;
  stellaDataDirPath: string;
  stellaWorkspacePath: string;
  authToken: string | null;
  backendUrl: string | null;
  hasConnectedAccount: boolean;
  cloudSyncEnabled: boolean;
  localLlmCredentialsUpdatedAt: number | null;
};

export type RuntimeRunner = ReturnType<typeof createStellaHostRunner>;

export type ConnectCardOutcome =
  | { ok: true; status: "connected" | "already_connected" }
  | {
      ok: false;
      reason: "declined" | "cancelled" | "timeout" | "unsupported" | string;
    };
