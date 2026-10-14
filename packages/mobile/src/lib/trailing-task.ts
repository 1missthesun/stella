export type TrailingTaskClock = {
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  now: () => number;
};

const systemClock: TrailingTaskClock = {
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export class TrailingTask {
  private pending: (() => void) | null = null;
  private firstHeldAt = 0;
  private timer: unknown = null;

  constructor(
    private readonly settleMs: number,
    private readonly maxDelayMs: number,
    private readonly clock: TrailingTaskClock = systemClock,
  ) {}

  schedule(task: () => void): void {
    const now = this.clock.now();
    if (!this.pending) this.firstHeldAt = now;
    this.pending = task;
    this.clearTimer();
    const wait = Math.max(
      0,
      Math.min(this.settleMs, this.firstHeldAt + this.maxDelayMs - now),
    );
    this.timer = this.clock.setTimeout(() => this.flush(), wait);
  }

  flush(): void {
    this.clearTimer();
    const task = this.pending;
    this.pending = null;
    task?.();
  }

  cancel(): void {
    this.clearTimer();
    this.pending = null;
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    this.clock.clearTimeout(this.timer);
    this.timer = null;
  }
}
