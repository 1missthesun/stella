/**
 * Tool calls an engine's CLI stopped waiting for. Claude Code can give up on a
 * Stella tool it called (its MCP call timed out or was canceled) while the
 * Stella tool task for that call still runs; left alone, that task holds the
 * conversation's tool round, so every later call waits behind it, and a code
 * cell it started keeps running. The engine marks such a call here and the
 * tool host aborts the matching execution. Call ids are the CLI's own
 * tool_use ids, unique across conversations.
 */

const EARLY_LIMIT = 256;

const live = new Map<string, Set<AbortController>>();
const early = new Map<string, unknown>();

export const abandonToolCall = (callId: string, reason: unknown): void => {
  const controllers = live.get(callId);
  if (controllers?.size) {
    for (const controller of controllers) controller.abort(reason);
    return;
  }
  early.delete(callId);
  early.set(callId, reason);
  while (early.size > EARLY_LIMIT) {
    const oldest = early.keys().next().value;
    if (oldest === undefined) break;
    early.delete(oldest);
  }
};

/** A signal aborted once the CLI abandons `callId`; release it when the call ends. */
export const watchToolCallAbandonment = (callId: string): { signal: AbortSignal; release: () => void } => {
  const controller = new AbortController();
  if (early.has(callId)) {
    const reason = early.get(callId);
    early.delete(callId);
    controller.abort(reason);
    return { signal: controller.signal, release: () => undefined };
  }
  let controllers = live.get(callId);
  if (!controllers) {
    controllers = new Set();
    live.set(callId, controllers);
  }
  controllers.add(controller);
  return {
    signal: controller.signal,
    release: () => {
      const current = live.get(callId);
      if (!current) return;
      current.delete(controller);
      if (current.size === 0) live.delete(callId);
    },
  };
};
