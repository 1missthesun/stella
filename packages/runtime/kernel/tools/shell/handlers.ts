import { Effect, Exit } from "effect";
import type { ToolContext, ToolResult, ToolUpdateCallback } from "../types.js";
import { truncate } from "../utils.js";
import { getTerminalRecoveryHint } from "../terminal-hints.js";
import {
  HeadTailOutputBuffer,
  splitUtf8TextByBytes,
} from "../head-tail-output-buffer.js";
import { runToolEffect } from "../effect-runtime.js";
import { isDangerousCommand } from "../command-safety.js";
import { sanitizeToolVisibleText } from "../safety.js";
import { resolveManagedShellCommand } from "./launch.js";
import {
  acquireShellInteraction,
  cleanupShellSessions,
  closeShellStdin,
  drainUnreadOutput,
  pruneAcceptedWriteIds,
  pruneCompletedShellSessions,
  recordAcceptedWriteId,
  resizeShellPty,
  setShellOwner,
  settleCompletedShellEffect,
  shellOwnerMatchesContext,
  startShell,
  waitForShellActivityEffect,
  waitForShellUntilDeadlineEffect,
  writeFingerprint,
  writeToShellStdin,
  type DrainedOutput,
  type ManagedShellRecord,
  type ShellInteractionLease,
  type ShellInteractionOperation,
  type ShellInteractionReceipt,
  type ShellOutputDelta,
  type ShellSessionOwner,
  type ShellState,
} from "./sessions.js";

export const DEFAULT_EXEC_YIELD_MS = 120_000;
export const DEFAULT_WRITE_STDIN_YIELD_MS = 250;
const MAX_EXEC_YIELD_MS = 600_000;
export const BACKGROUND_EXEC_SETTLE_MS = 250;
export const DEFAULT_EMPTY_POLL_YIELD_MS = 30_000;
const MAX_EMPTY_POLL_YIELD_MS = 10 * 60_000;
export const DEFAULT_EXEC_OUTPUT_TOKENS = 10_000;
export const EXEC_UPDATE_MAX_BYTES = 8 * 1024;
const MAX_EXEC_UPDATE_CHUNKS = 10_000;

const APPROX_BYTES_PER_TOKEN = 4;

export const resolveExecOutputTokens = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : DEFAULT_EXEC_OUTPUT_TOKENS;

const invalidExecOutputTokens = (value: unknown): boolean =>
  value !== undefined &&
  value !== null &&
  (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0);

const resolveExecYieldTime = (
  value: unknown,
  defaultMs: number = DEFAULT_EXEC_YIELD_MS,
  maxMs: number = MAX_EXEC_YIELD_MS,
): number => {
  const raw =
    typeof value === "number" && Number.isFinite(value)
      ? Math.floor(value)
      : defaultMs;
  return Math.max(0, Math.min(raw, maxMs));
};

const toolErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

type ExecToolPayload = {
  session_id: string | null;
  shell_session_id: string;
  worker_generation: string;
  session_owner?: ShellSessionOwner;
  interaction_sequence: number;
  chunk_id: string;
  output_cursor: number;
  operation: ShellInteractionOperation;
  write_id?: string;
  write_deduplicated?: boolean;
  terminal_size?: { cols: number; rows: number };
  running: boolean;
  exit_code: number | null;
  output: string;
  wall_time_seconds: number;
  original_token_count: number;
  cwd: string;
  command: string;
  hint?: string;
};

const buildExecToolPayload = (
  state: ShellState,
  record: ManagedShellRecord,
  drained: DrainedOutput,
  callStartedAt: number,
  interactionReceipt?: ShellInteractionReceipt,
): ExecToolPayload => {
  const wallTimeSeconds = (Date.now() - callStartedAt) / 1000;
  const chunkSequence = record.chunkSequence + 1;
  record.chunkSequence = chunkSequence;
  const receipt = interactionReceipt ??
    record.activeInteractionReceipt ?? { operation: "exec" };
  const payload: ExecToolPayload = {
    session_id: record.running ? record.id : null,
    shell_session_id: record.id,
    worker_generation: state.workerGeneration,
    ...(record.owner ? { session_owner: record.owner } : {}),
    interaction_sequence:
      record.activeInteractionSequence ?? record.interactionSequence,
    chunk_id: `${state.workerGeneration}:${record.id}:${chunkSequence}`,
    output_cursor: drained.cursorEnd,
    ...receipt,
    running: record.running,
    exit_code: record.running ? null : record.exitCode,
    output: sanitizeToolVisibleText(drained.text),
    wall_time_seconds: wallTimeSeconds,
    original_token_count: Math.ceil(
      drained.originalLength / APPROX_BYTES_PER_TOKEN,
    ),
    cwd: record.cwd,
    command: record.command,
  };
  if (!record.running && record.exitCode !== 0) {
    const hint = getTerminalRecoveryHint({
      command: record.command,
      exitCode: record.exitCode,
      output: drained.text,
    });
    if (hint) payload.hint = hint;
  }
  return payload;
};

const buildExecToolDetails = (
  payload: ExecToolPayload,
  drained: DrainedOutput,
) => {
  const { output: _modelOutput, ...metadata } = payload;
  return {
    ...metadata,
    original_output_bytes: drained.originalLength,
    raw_output_omitted_bytes: drained.rawOmittedBytes,
    raw_output_truncated: drained.rawOmittedBytes > 0,
    presentation_output_omitted_bytes: drained.presentationOmittedBytes,
    presentation_output_truncated: drained.presentationOmittedBytes > 0,
    chunk_receipt: {
      kind: drained.receiptKind,
      start_byte: drained.cursorStart,
      end_byte: drained.cursorEnd,
      next_cursor: drained.cursorEnd,
      operation: payload.operation,
      ...(payload.write_id ? { write_id: payload.write_id } : {}),
      ...(payload.write_deduplicated !== undefined
        ? { write_deduplicated: payload.write_deduplicated }
        : {}),
      ...(payload.terminal_size
        ? { terminal_size: payload.terminal_size }
        : {}),
    },
  };
};

const formatExecToolResult = (
  payload: ExecToolPayload,
  drained: DrainedOutput,
): string => {
  const status = payload.running
    ? `Process still running with session ID ${payload.session_id}. If your turn ends while it runs, its exit and output are delivered to you automatically; use write_stdin only to interact with it or to wait for it within this turn.`
    : `Process exited with code ${payload.exit_code ?? "unknown"}`;
  return [
    `Wall time: ${payload.wall_time_seconds.toFixed(4)} seconds`,
    status,
    `Original token count: ${payload.original_token_count}`,
    ...(drained.rawOmittedBytes > 0
      ? [
          `Raw process output exceeded the 1 MiB collection cap; ${drained.rawOmittedBytes} omitted bytes remain marked in Output.`,
        ]
      : []),
    ...(drained.presentationOmittedBytes > 0
      ? [
          `This update was limited to ${EXEC_UPDATE_MAX_BYTES} presentation bytes; ${drained.presentationOmittedBytes} bytes remain available in the final interaction result.`,
        ]
      : []),
    "Output:",
    payload.output,
    ...(payload.hint ? [`Hint: ${payload.hint}`] : []),
  ].join("\n");
};

const boundedUpdateOutput = (delta: ShellOutputDelta): DrainedOutput => {
  const buffer = new HeadTailOutputBuffer(EXEC_UPDATE_MAX_BYTES);
  buffer.pushText(delta.text);
  const bounded = buffer.snapshot();
  return {
    text: bounded.text,
    originalLength: delta.cursorEnd - delta.cursorStart,
    rawOmittedBytes: 0,
    presentationOmittedBytes: bounded.omittedBytes,
    cursorStart: delta.cursorStart,
    cursorEnd: delta.cursorEnd,
    receiptKind: "stream_delta",
  };
};

const terminalUpdateOutput = (record: ManagedShellRecord): DrainedOutput => ({
  text: "",
  originalLength: 0,
  rawOmittedBytes: 0,
  presentationOmittedBytes: 0,
  cursorStart: record.outputCursorBytes,
  cursorEnd: record.outputCursorBytes,
  receiptKind: "terminal",
});

const resolveWriteStdinOperation = (
  value: unknown,
  chars: string,
): ShellInteractionOperation | undefined => {
  if (value === undefined || value === null || value === "") {
    return chars ? "write" : "poll";
  }
  return typeof value === "string" &&
    ["write", "poll", "terminate", "close_stdin", "resize"].includes(value)
    ? (value as ShellInteractionOperation)
    : undefined;
};

export const handleExecCommand = async (
  state: ShellState,
  args: Record<string, unknown>,
  context?: ToolContext,
  signal?: AbortSignal,
  onUpdate?: ToolUpdateCallback,
): Promise<ToolResult> => {
  const callStartedAt = Date.now();
  if (invalidExecOutputTokens(args.max_output_tokens)) {
    return { error: "max_output_tokens must be a non-negative safe integer." };
  }
  const modelOutputTokens = resolveExecOutputTokens(args.max_output_tokens);
  const runInBackground = args.run_in_background === true;
  const timeoutMs = resolveExecYieldTime(
    args.timeout_ms ?? args.yield_time_ms,
    DEFAULT_EXEC_YIELD_MS,
  );
  const yieldTimeMs = runInBackground
    ? Math.min(timeoutMs, BACKGROUND_EXEC_SETTLE_MS)
    : timeoutMs;
  const deadlineAt = callStartedAt + yieldTimeMs;
  if (signal?.aborted) {
    return { error: toolErrorMessage(signal.reason ?? new Error("Aborted")) };
  }
  const prepared = resolveManagedShellCommand(state, args, context);
  const dangerReason = isDangerousCommand(prepared.command, prepared.cwd);
  if (dangerReason) {
    return {
      error: `Command blocked: this operation is potentially destructive and has been denied for safety. (${dangerReason})`,
    };
  }
  if (!prepared.command.trim()) {
    return { error: "cmd is required." };
  }
  let emittedUpdateChunks = 0;
  const emitOneUpdate = (
    record: ManagedShellRecord,
    drained: DrainedOutput,
  ) => {
    if (!onUpdate) return;
    if (emittedUpdateChunks >= MAX_EXEC_UPDATE_CHUNKS) return;
    emittedUpdateChunks += 1;
    const payload = buildExecToolPayload(state, record, drained, callStartedAt);
    try {
      onUpdate({
        result: formatExecToolResult(payload, drained),
        details: buildExecToolDetails(payload, drained),
        modelOutputTokens,
      });
    } catch {
      // Progress consumers must not break process I/O or teardown.
    }
  };
  const emitUpdate = (record: ManagedShellRecord, delta?: ShellOutputDelta) => {
    if (!onUpdate) return;
    if (!delta) {
      if (!record.running) emitOneUpdate(record, terminalUpdateOutput(record));
      return;
    }
    let cursorStart = delta.cursorStart;
    for (const text of splitUtf8TextByBytes(
      delta.text,
      EXEC_UPDATE_MAX_BYTES,
    )) {
      const cursorEnd = cursorStart + Buffer.byteLength(text, "utf8");
      emitOneUpdate(
        record,
        boundedUpdateOutput({ text, cursorStart, cursorEnd }),
      );
      cursorStart = cursorEnd;
    }
  };
  const record = startShell(
    state,
    prepared.command,
    prepared.cwd,
    prepared.envOverrides,
    undefined,
    emitUpdate,
    prepared.launchOptions,
    prepared.processIdentity,
  );
  setShellOwner(record, context);
  let interaction: ShellInteractionLease;
  try {
    interaction = await acquireShellInteraction(state, record, signal);
  } catch (error) {
    if (record.running) {
      try {
        record.kill();
      } catch {
        // Best effort; the process may already be exiting.
      }
    }
    return { error: toolErrorMessage(error) };
  }
  try {
    try {
      await runToolEffect(
        Effect.scoped(
          Effect.gen(function* () {
            yield* Effect.acquireRelease(Effect.void, (_, exit) =>
              Effect.sync(() => {
                if (Exit.isFailure(exit) && record.running) {
                  try {
                    record.kill();
                  } catch {
                    // Best effort; the process may already be exiting.
                  }
                }
              }),
            );
            yield* waitForShellUntilDeadlineEffect(record, deadlineAt, signal);
            yield* settleCompletedShellEffect(record, signal, deadlineAt);
          }),
        ),
      );
    } catch (error) {
      return { error: toolErrorMessage(error) };
    }

    const drained = drainUnreadOutput(record);
    const payload = buildExecToolPayload(state, record, drained, callStartedAt);
    return {
      result: formatExecToolResult(payload, drained),
      details: buildExecToolDetails(payload, drained),
      modelOutputTokens,
    };
  } finally {
    interaction.release();
  }
};

export const handleWriteStdin = async (
  state: ShellState,
  args: Record<string, unknown>,
  context?: ToolContext,
  signal?: AbortSignal,
): Promise<ToolResult> => {
  const callStartedAt = Date.now();
  if (invalidExecOutputTokens(args.max_output_tokens)) {
    return { error: "max_output_tokens must be a non-negative safe integer." };
  }
  const modelOutputTokens = resolveExecOutputTokens(args.max_output_tokens);
  const sessionId = String(args.session_id ?? "").trim();
  if (!sessionId) {
    return { error: "session_id is required." };
  }
  if (
    args.write_id !== undefined &&
    args.write_id !== null &&
    typeof args.write_id !== "string"
  ) {
    return { error: "write_id must be a string when provided." };
  }
  const writeId =
    typeof args.write_id === "string" ? args.write_id.trim() : undefined;
  if (typeof args.write_id === "string" && !writeId) {
    return { error: "write_id must not be empty." };
  }
  if (writeId && writeId.length > 256) {
    return { error: "write_id must be at most 256 characters." };
  }
  const chars = typeof args.chars === "string" ? args.chars : "";
  const operation = resolveWriteStdinOperation(args.operation, chars);
  if (!operation || operation === "exec") {
    return {
      error:
        "operation must be one of write, poll, terminate, close_stdin, or resize.",
    };
  }
  if (operation !== "write" && chars) {
    return { error: `chars is only valid with the write operation.` };
  }
  if (writeId && operation !== "write") {
    return { error: "write_id is only valid with the write operation." };
  }
  const cols = Number(args.cols);
  const rows = Number(args.rows);
  if (
    operation === "resize" &&
    (!Number.isSafeInteger(cols) ||
      !Number.isSafeInteger(rows) ||
      cols < 1 ||
      rows < 1 ||
      cols > 1_000 ||
      rows > 1_000)
  ) {
    return {
      error: "resize requires integer cols and rows between 1 and 1000.",
    };
  }
  const interactionYieldTimeMs =
    operation === "poll"
      ? resolveExecYieldTime(
          args.yield_time_ms,
          DEFAULT_EMPTY_POLL_YIELD_MS,
          MAX_EMPTY_POLL_YIELD_MS,
        )
      : resolveExecYieldTime(args.yield_time_ms, DEFAULT_WRITE_STDIN_YIELD_MS);
  const passivePollDeadlineAt = callStartedAt + interactionYieldTimeMs;
  cleanupShellSessions(state);
  const record = state.shells.get(sessionId);
  if (!record || !shellOwnerMatchesContext(record.owner, context)) {
    const pruned = state.prunedSessions.get(sessionId);
    const known = [...state.shells.values()]
      .filter((entry) => shellOwnerMatchesContext(entry.owner, context))
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 5)
      .map(
        (entry) =>
          `${entry.id}${entry.running ? " (running)" : " (completed)"}`,
      );
    return {
      error:
        pruned && shellOwnerMatchesContext(pruned.owner, context)
          ? `Session ${sessionId} completed with exit code ${pruned.exitCode ?? "unknown"} and was pruned from runtime worker generation ${state.workerGeneration}.`
          : `Session not found in runtime worker generation ${state.workerGeneration} (runtime_pid=${process.pid}): ${sessionId}.${known.length > 0 ? ` Recent sessions: ${known.join(", ")}.` : " No sessions are registered; the runtime may have restarted or the id may belong to an earlier worker generation."}`,
    };
  }

  let releasePassivePollRetention: (() => void) | undefined;
  if (
    operation === "poll" &&
    record.outputCursorBytes === record.unreadCursorStart
  ) {
    record.pendingInteractions += 1;
    let released = false;
    releasePassivePollRetention = () => {
      if (released) return;
      released = true;
      record.pendingInteractions -= 1;
      pruneCompletedShellSessions(state);
    };
    try {
      await runToolEffect(
        waitForShellActivityEffect(
          record,
          record.outputVersion,
          Math.max(0, passivePollDeadlineAt - Date.now()),
          signal,
        ),
      );
    } catch (error) {
      releasePassivePollRetention();
      return { error: toolErrorMessage(error) };
    }
  }

  let interaction: ShellInteractionLease;
  try {
    interaction = await acquireShellInteraction(state, record, signal);
  } catch (error) {
    releasePassivePollRetention?.();
    return { error: toolErrorMessage(error) };
  }
  releasePassivePollRetention?.();
  const interactionDeadlineAt =
    operation === "poll"
      ? passivePollDeadlineAt
      : Date.now() + interactionYieldTimeMs;
  const receipt: ShellInteractionReceipt = {
    operation,
    ...(writeId ? { write_id: writeId } : {}),
    ...(operation === "resize" ? { terminal_size: { cols, rows } } : {}),
  };
  record.activeInteractionReceipt = receipt;
  try {
    let deduplicated = false;
    if (operation === "write" && writeId) {
      pruneAcceptedWriteIds(record);
      const fingerprint = writeFingerprint(chars);
      const accepted = record.acceptedWriteIds.get(writeId);
      if (accepted && accepted.fingerprint !== fingerprint) {
        return {
          error: `write_id ${JSON.stringify(writeId)} was already accepted with different characters for session ${sessionId}.`,
        };
      }
      deduplicated = Boolean(accepted);
      receipt.write_deduplicated = deduplicated;
      if (accepted) {
        recordAcceptedWriteId(record, writeId, accepted.fingerprint);
      }
    }

    try {
      if (operation === "write" && !deduplicated) {
        await writeToShellStdin(record, chars);
        if (writeId) {
          recordAcceptedWriteId(record, writeId, writeFingerprint(chars));
        }
      } else if (operation === "terminate" && record.running) {
        record.kill();
      } else if (operation === "close_stdin") {
        await closeShellStdin(record);
      } else if (operation === "resize") {
        resizeShellPty(record, cols, rows);
      }
    } catch (error) {
      if (record.running || operation !== "write") {
        return { error: toolErrorMessage(error) };
      }
    }

    try {
      if (operation !== "poll") {
        await runToolEffect(
          Effect.gen(function* () {
            yield* waitForShellUntilDeadlineEffect(
              record,
              interactionDeadlineAt,
              signal,
            );
            yield* settleCompletedShellEffect(record, signal);
          }),
        );
      } else if (signal?.aborted) {
        throw signal.reason ?? new Error("Aborted");
      }
    } catch (error) {
      return { error: toolErrorMessage(error) };
    }
    if (signal?.aborted) {
      return {
        error: toolErrorMessage(signal.reason ?? new Error("Aborted")),
      };
    }

    const drained = drainUnreadOutput(record);
    const payload = buildExecToolPayload(
      state,
      record,
      drained,
      callStartedAt,
      receipt,
    );
    return {
      result: formatExecToolResult(payload, drained),
      details: buildExecToolDetails(payload, drained),
      modelOutputTokens,
    };
  } finally {
    record.activeInteractionReceipt = undefined;
    interaction.release();
  }
};

export const handleShellStatus = async (
  state: ShellState,
  args: Record<string, unknown>,
  context?: ToolContext,
): Promise<ToolResult> => {
  cleanupShellSessions(state);
  const shellId = String(args.shell_id ?? "");

  if (!shellId) {
    const shells = [...state.shells.entries()]
      .filter(([, record]) => shellOwnerMatchesContext(record.owner, context))
      .map(([id, r]) => ({
        id,
        command: r.command.slice(0, 100),
        running: r.running,
        exitCode: r.exitCode,
        elapsed: r.running
          ? `${Math.round((Date.now() - r.startedAt) / 1000)}s`
          : undefined,
      }));
    if (shells.length === 0) return { result: "No active shells." };
    return { result: JSON.stringify(shells) };
  }

  const record = state.shells.get(shellId);
  if (!record || !shellOwnerMatchesContext(record.owner, context)) {
    return { error: `Shell not found: ${shellId}` };
  }

  const tail_lines = Number(args.tail_lines ?? 50);
  const output = sanitizeToolVisibleText(record.output || "(no output yet)");
  const lines = output.split("\n");
  const tail = truncate(lines.slice(-tail_lines).join("\n"));

  const status = record.running ? "running" : "completed";
  const elapsed = Math.round(
    ((record.completedAt ?? Date.now()) - record.startedAt) / 1000,
  );

  let result = `Shell ${shellId}: ${status}`;
  if (!record.running) result += ` (exit code: ${record.exitCode ?? "?"})`;
  result += ` | elapsed: ${elapsed}s`;
  result += `\nCommand: ${record.command.slice(0, 200)}`;
  result += `\n\n--- Output (last ${Math.min(tail_lines, lines.length)} lines) ---\n${tail}`;

  return { result };
};
