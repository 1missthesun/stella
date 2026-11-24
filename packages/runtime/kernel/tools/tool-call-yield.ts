/**
 * Asks a running tool call to hand back what it has and go on in the
 * background (a `code` cell answers with its cell_id), keyed by call id.
 */
const listeners = new Map<string, Set<() => void>>();

export const onToolCallYield = (callId: string | undefined, listener: () => void): (() => void) => {
  if (!callId) return () => undefined;
  const set = listeners.get(callId) ?? new Set();
  listeners.set(callId, set);
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0 && listeners.get(callId) === set) listeners.delete(callId);
  };
};

/** False when the call doesn't know how to hand back early. */
export const yieldToolCall = (callId: string): boolean => {
  const set = listeners.get(callId);
  if (!set?.size) return false;
  for (const listener of [...set]) listener();
  return true;
};
