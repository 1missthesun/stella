import type { ToolResult } from "../tools/types.js";
import { forkCancelableTimeout } from "./effect-runtime.js";

/**
 * Bound for Stella tools bridged into external engines: a tool that reports
 * no progress for this long is cancelled and the engine gets an error result.
 * `STELLA_TOOL_INACTIVITY_TIMEOUT_MS` overrides it; <= 0 disables it.
 */
export const DEFAULT_TOOL_INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;

const CANCELLATION_GRACE_MS = 5_000;

const configuredInactivityTimeoutMs = (): number => {
  const raw = process.env.STELLA_TOOL_INACTIVITY_TIMEOUT_MS?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed)
    ? parsed
    : DEFAULT_TOOL_INACTIVITY_TIMEOUT_MS;
};

type Settlement =
  | { kind: "result"; result: ToolResult }
  | { kind: "error"; error: unknown };

const settle = (operation: Promise<ToolResult>): Promise<Settlement> =>
  operation.then(
    (result) => ({ kind: "result", result }),
    (error: unknown) => ({ kind: "error", error }),
  );

const abortedPromise = (signal: AbortSignal): Promise<void> =>
  signal.aborted
    ? Promise.resolve()
    : new Promise((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );

/**
 * Run one bridged tool call under the inactivity bound. `run` gets the
 * composed cancellation signal and an `onActivity` callback to call on every
 * progress update. After an inactivity timeout the tool gets a short grace to
 * honour cancellation; if it still has not settled, the error result says its
 * outcome is unknown rather than claiming it stopped.
 */
export const executeToolWithInactivityBound = async (args: {
  toolName: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  run: (
    signal: AbortSignal | undefined,
    onActivity: () => void,
  ) => Promise<ToolResult>;
}): Promise<ToolResult> => {
  const timeoutMs = args.timeoutMs ?? configuredInactivityTimeoutMs();
  const inactivity = new AbortController();
  const signal = args.signal
    ? AbortSignal.any([args.signal, inactivity.signal])
    : inactivity.signal;
  let cancelInactivityTimer: (() => void) | undefined;
  const armInactivityTimer = () => {
    cancelInactivityTimer?.();
    cancelInactivityTimer = undefined;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return;
    cancelInactivityTimer = forkCancelableTimeout(timeoutMs, () =>
      inactivity.abort(
        new Error(
          `Tool ${args.toolName} produced no output for ${Math.round(timeoutMs / 1000)}s and was cancelled.`,
        ),
      ),
    );
  };
  armInactivityTimer();

  try {
    const operation = settle(
      args.run(signal, () => {
        if (!inactivity.signal.aborted) armInactivityTimer();
      }),
    );
    const first = await Promise.race([
      operation,
      abortedPromise(inactivity.signal).then(() => "inactive" as const),
    ]);
    if (first !== "inactive") {
      if (first.kind === "result") return first.result;
      if (!inactivity.signal.aborted) throw first.error;
    }
    const reason = (inactivity.signal.reason as Error).message;
    let cancelGrace: (() => void) | undefined;
    const afterCancel = await Promise.race([
      operation,
      new Promise<"elapsed">((resolve) => {
        cancelGrace = forkCancelableTimeout(CANCELLATION_GRACE_MS, () =>
          resolve("elapsed"),
        );
      }),
    ]);
    cancelGrace?.();
    if (afterCancel !== "elapsed") {
      return { error: `${reason} The agent may retry or continue without it.` };
    }
    void operation.then((late) => {
      console.warn(
        `[tool-inactivity] ${args.toolName} settled after its inactivity timeout (${late.kind}).`,
      );
    });
    return {
      error: `${reason} It did not stop within ${CANCELLATION_GRACE_MS / 1000}s of being cancelled and may still be running, so whatever it was doing may or may not have happened. Check before retrying anything with side effects.`,
    };
  } finally {
    cancelInactivityTimer?.();
  }
};
