/**
 * Tool calls an engine's CLI ran itself: its model already has their results,
 * so nothing added to them here reaches it. Call ids are the CLI's own
 * tool_use ids, unique across conversations.
 */

const LIMIT = 1024;

const native = new Set<string>();

export const noteNativeToolCall = (callId: string): void => {
  native.add(callId);
  while (native.size > LIMIT) {
    const oldest = native.values().next().value;
    if (oldest === undefined) break;
    native.delete(oldest);
  }
};

/** Whether the CLI ran this call itself; asked once, when the call ends. */
export const takeNativeToolCall = (callId: string): boolean => native.delete(callId);
