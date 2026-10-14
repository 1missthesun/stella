import type { SseFrame } from "./sse.js";

export type AssembleOutcome =
  | { ok: true; body: Record<string, unknown> }
  | {
      ok: false;
      message: string;
      detail?: unknown;
    };

export type Assembler = {
  push(frame: SseFrame): void;
  finish(): AssembleOutcome;
};

export const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;
