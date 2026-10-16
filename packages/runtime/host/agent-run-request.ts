import { METHOD_NAMES } from "@stella/contracts/protocol";
import type { RpcRequestOptions } from "@stella/contracts/protocol/rpc-peer";

export const AGENT_RUN_LIVENESS_INTERVAL_MS = 60_000;
export const AGENT_RUN_UNRESPONSIVE_MS = 5 * 60_000;

/**
 * A worker run (an agent, or a whole placed or automation turn) lasts as long
 * as its work, which has its own bounds. The request fails only when the
 * worker stops answering health checks, never on a wall-clock cap that would
 * call a healthy long turn failed while the worker keeps running it.
 */
export const AGENT_RUN_RPC_OPTIONS: RpcRequestOptions = {
  timeoutMs: null,
  liveness: {
    method: METHOD_NAMES.INTERNAL_WORKER_HEALTH,
    intervalMs: AGENT_RUN_LIVENESS_INTERVAL_MS,
    unresponsiveMs: AGENT_RUN_UNRESPONSIVE_MS,
  },
};
