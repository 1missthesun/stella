let current = "";
let hydrated = false;
let unsubscribeIpc: (() => void) | null = null;
const listeners = new Set<() => void>();

const emit = (next: string): void => {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
};

const ensureAttached = (): void => {
  const api = window.electronAPI?.voice;
  if (!api) return;
  if (!unsubscribeIpc) {
    unsubscribeIpc =
      api.onSessionErrorState?.((message) => {
        emit(typeof message === "string" ? message.trim() : "");
      }) ?? null;
  }
  if (!hydrated && api.getSessionErrorState) {
    hydrated = true;
    void api
      .getSessionErrorState()
      .then((message) => {
        emit(typeof message === "string" ? message.trim() : "");
      })
      .catch(() => undefined);
  }
};

export const voiceSessionErrorStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    ensureAttached();
    return () => {
      listeners.delete(listener);
      if (listeners.size > 0) return;
      unsubscribeIpc?.();
      unsubscribeIpc = null;
    };
  },
  getSnapshot(): string {
    return current;
  },
  getServerSnapshot(): string {
    return "";
  },
};
