// desktop-ui's `@/platform/ui-state` inside the media page: the values the host's UI holds, pushed
// before each operation that reads them (speaker, microphone, mic enabled).

const memory = new Map<string, string>();

export function applyUiState(values: Record<string, string | null>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === null) memory.delete(key);
    else memory.set(key, value);
  }
}

export const uiState = {
  getItem(key: string): string | null {
    return memory.get(key) ?? null;
  },
  setItem(key: string, value: string): void {
    memory.set(key, String(value));
  },
  removeItem(key: string): void {
    memory.delete(key);
  },
  keys(): string[] {
    return [...memory.keys()];
  },
  flush(): void {},
  onExternalChange(): () => void {
    return () => {};
  },
};
