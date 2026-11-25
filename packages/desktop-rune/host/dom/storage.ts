// Web Storage: sessionStorage in memory, localStorage over Stella's ui-state store (the same
// persisted key/value desktop-ui's platform/ui-state uses), so values survive restarts.

export type UiStateBackend = {
  snapshot(): Record<string, string>;
  apply(changes: Record<string, string | null>): void;
  clear(): void;
  onChanged(listener: (changes: Record<string, string | null>) => void): () => void;
};

export class MemoryStorage {
  protected readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(String(key)) ?? null; }
  setItem(key: string, value: string) { this.values.set(String(key), String(value)); }
  removeItem(key: string) { this.values.delete(String(key)); }
  clear() { this.values.clear(); }
}

const FLUSH_DELAY_MS = 10;

export class UiStateStorage extends MemoryStorage {
  private pending: Record<string, string | null> = {};
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly backend: UiStateBackend) {
    super();
    for (const [key, value] of Object.entries(backend.snapshot() ?? {})) this.values.set(key, value);
    backend.onChanged((changes) => {
      for (const [key, value] of Object.entries(changes ?? {})) {
        const old = this.values.get(key) ?? null;
        if (old === value) continue;
        if (value === null) this.values.delete(key); else this.values.set(key, value);
        globalThis.dispatchEvent(Object.assign(new Event("storage"), { key, oldValue: old, newValue: value, storageArea: this, url: "" }));
      }
    });
  }

  override setItem(key: string, value: string) {
    super.setItem(key, value);
    this.queue(String(key), String(value));
  }

  override removeItem(key: string) {
    super.removeItem(key);
    this.queue(String(key), null);
  }

  override clear() {
    super.clear();
    this.pending = {};
    this.backend.clear();
  }

  private queue(key: string, value: string | null) {
    this.pending[key] = value;
    this.timer ??= setTimeout(() => {
      this.timer = null;
      const changes = this.pending;
      this.pending = {};
      this.backend.apply(changes);
    }, FLUSH_DELAY_MS);
  }
}
