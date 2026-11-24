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

export const takeNativeToolCall = (callId: string): boolean => native.delete(callId);
