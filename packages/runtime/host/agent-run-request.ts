import { METHOD_NAMES } from "@stella/contracts/protocol";
import type { RpcRequestOptions } from "@stella/contracts/protocol/rpc-peer";

export const AGENT_RUN_LIVENESS_INTERVAL_MS = 60_000;
export const AGENT_RUN_UNRESPONSIVE_MS = 5 * 60_000;

const WORKER_LIVENESS: NonNullable<RpcRequestOptions["liveness"]> = {
  method: METHOD_NAMES.INTERNAL_WORKER_HEALTH,
  intervalMs: AGENT_RUN_LIVENESS_INTERVAL_MS,
  unresponsiveMs: AGENT_RUN_UNRESPONSIVE_MS,
};

export const AGENT_RUN_RPC_OPTIONS: RpcRequestOptions = {
  timeoutMs: null,
  liveness: WORKER_LIVENESS,
};

/**
 * A placed chat turn is bounded like a cloud turn (its broker capability
 * lasts 30 minutes) and fails sooner when the worker stops answering.
 */
export const PLACED_CHAT_TURN_DEADLINE_MS = 30 * 60_000;

export const PLACED_CHAT_TURN_RPC_OPTIONS: RpcRequestOptions = {
  timeoutMs: PLACED_CHAT_TURN_DEADLINE_MS,
  liveness: WORKER_LIVENESS,
};
