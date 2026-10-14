import { performance } from "node:perf_hooks";
import type { AppPerformanceTelemetry } from "@stella/contracts/telemetry";

export type BootOutcome = "success" | "failure" | "canceled";

export type BootTimingValue = number | string | boolean;

export type WorkerReadyTiming = {
  readonly outcome: BootOutcome;
  readonly totalMs: number;
  readonly uptimeAtInitializeMs: number;
  readonly maxEventLoopStallMs: number;
} & Readonly<Record<string, BootTimingValue>>;

const round = (ms: number): number => Math.round(ms * 10) / 10;

export class BootTimeline {
  private readonly startedAt: number;
  private readonly uptimeAtStartMs: number;
  private readonly steps = new Map<string, number>();
  private readonly fields = new Map<string, BootTimingValue>();
  private maxStallMs = 0;
  private finished = false;

  constructor(
    private readonly now: () => number = () => performance.now(),
    uptimeMs: () => number = () => process.uptime() * 1000,
  ) {
    this.startedAt = now();
    this.uptimeAtStartMs = uptimeMs();
  }

  elapsed(): number {
    return this.now() - this.startedAt;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  step(name: string, ms: number): void {
    if (this.finished || !Number.isFinite(ms)) return;
    this.steps.set(name, (this.steps.get(name) ?? 0) + Math.max(0, ms));
  }

  mark(name: string): void {
    if (this.finished) return;
    this.fields.set(`${name}AtMs`, round(this.elapsed()));
  }

  set(name: string, value: BootTimingValue): void {
    if (this.finished) return;
    this.fields.set(name, value);
  }

  time<T>(name: string, fn: () => T): T {
    const startedAt = this.now();
    try {
      return fn();
    } finally {
      this.step(name, this.now() - startedAt);
    }
  }

  async timeAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const startedAt = this.now();
    try {
      return await fn();
    } finally {
      this.step(name, this.now() - startedAt);
    }
  }

  noteEventLoopStall(ms: number): void {
    if (ms > this.maxStallMs) this.maxStallMs = ms;
  }

  finish(outcome: BootOutcome): WorkerReadyTiming | null {
    if (this.finished) return null;
    const totalMs = round(this.elapsed());
    this.finished = true;
    const out: Record<string, BootTimingValue> = {
      outcome,
      totalMs,
      uptimeAtInitializeMs: round(this.uptimeAtStartMs),
      maxEventLoopStallMs: round(this.maxStallMs),
    };
    for (const [name, ms] of this.steps) out[`${name}Ms`] = round(ms);
    for (const [name, value] of this.fields) out[name] = value;
    return out as WorkerReadyTiming;
  }
}

export const workerReadyTelemetry = (
  timing: WorkerReadyTiming,
): AppPerformanceTelemetry => ({
  type: "app.performance",
  component: "runtime-worker",
  metric: "worker-ready",
  durationMs: Math.max(0, Math.round(timing.totalMs)),
  outcome: timing.outcome,
});

let activeTimeline: BootTimeline | null = null;

export const setActiveBootTimeline = (timeline: BootTimeline | null): void => {
  activeTimeline = timeline;
};

export const getActiveBootTimeline = (): BootTimeline | null =>
  activeTimeline && !activeTimeline.isFinished ? activeTimeline : null;

export const recordBootStep = (name: string, ms: number): void => {
  getActiveBootTimeline()?.step(name, ms);
};

export const recordBootField = (name: string, value: BootTimingValue): void => {
  getActiveBootTimeline()?.set(name, value);
};
