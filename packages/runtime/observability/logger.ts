import {
  chmodSync,
  closeSync,
  fchmodSync,
  mkdirSync,
  openSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import {
  Context,
  Effect,
  Formatter,
  Layer,
  Semaphore,
  type Scope,
} from "effect";

export type LogChannel = "error" | "process";
export type LogLevel = "info" | "warn" | "error" | "fatal";
export type LogFields = Record<string, unknown>;

const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const LOG_FILE_PATTERN = /^(error|process)-\d{4}-\d{2}-\d{2}\.txt$/;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const flattenFields = (
  input: Record<string, unknown>,
  prefix = "",
  seen = new WeakSet<object>(),
): Array<readonly [string, unknown]> => {
  if (seen.has(input)) return [[prefix || "value", "[Circular]"]];
  seen.add(input);
  const entries = Object.entries(input);
  if (entries.length === 0 && prefix) return [[prefix, input]];
  return entries.flatMap(([key, value]) => {
    const field = prefix ? `${prefix}.${key}` : key;
    return isPlainObject(value)
      ? flattenFields(value, field, seen)
      : [[field, value] as const];
  });
};

const formatValue = (input: unknown): string => {
  const value = typeof input === "string" ? input : Formatter.format(input);
  return /^[^\s="\\]+$/u.test(value) ? value : JSON.stringify(value);
};

const dateStamp = (now: Date): string => {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const parsePositiveInt = (
  raw: string | undefined,
  fallback: number,
): number => {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export type FileLoggerOptions = {
  logDir: string;
  component: string;
  retentionDays?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
};

export interface Interface {
  readonly write: (
    channel: LogChannel,
    level: LogLevel,
    event: string,
    fields?: LogFields,
  ) => Effect.Effect<void>;
  readonly process: (event: string, fields?: LogFields) => Effect.Effect<void>;
  readonly warn: (event: string, fields?: LogFields) => Effect.Effect<void>;
  readonly error: (event: string, fields?: LogFields) => Effect.Effect<void>;
  readonly crash: (
    event: string,
    error: unknown,
    fields?: LogFields,
  ) => Effect.Effect<void>;
}

export class ObservabilityLogger extends Context.Service<
  ObservabilityLogger,
  Interface
>()("@stella/runtime/observability/ObservabilityLogger") {}

const make = (
  options: FileLoggerOptions,
): Effect.Effect<Interface, never, Scope.Scope> =>
  Effect.gen(function* () {
    const logDir = options.logDir;
    const component = options.component;
    const retentionDays =
      options.retentionDays ??
      parsePositiveInt(
        process.env.STELLA_LOG_RETENTION_DAYS,
        DEFAULT_RETENTION_DAYS,
      );
    const maxFileBytes =
      options.maxFileBytes ??
      parsePositiveInt(
        process.env.STELLA_LOG_MAX_FILE_BYTES,
        DEFAULT_MAX_FILE_BYTES,
      );
    const maxTotalBytes =
      options.maxTotalBytes ??
      parsePositiveInt(
        process.env.STELLA_LOG_MAX_TOTAL_BYTES,
        DEFAULT_MAX_TOTAL_BYTES,
      );

    const writeLock = yield* Semaphore.make(1);

    let currentStamp = "";
    let dirReady = false;
    const truncatedChannels = new Set<LogChannel>();

    const openFiles = yield* Effect.acquireRelease(
      Effect.sync(() => new Map<LogChannel, number>()),
      (files) =>
        Effect.sync(() => {
          for (const fd of files.values()) {
            try {
              closeSync(fd);
            } catch {
              // Best-effort close on scope end.
            }
          }
          files.clear();
        }),
    );

    const closeAllFiles = (): void => {
      for (const fd of openFiles.values()) {
        try {
          closeSync(fd);
        } catch {
          // Best-effort close before rotation.
        }
      }
      openFiles.clear();
    };

    const ensureDir = (): boolean => {
      if (dirReady) return true;
      try {
        mkdirSync(logDir, { recursive: true, mode: 0o700 });
        if (process.platform !== "win32") chmodSync(logDir, 0o700);
        dirReady = true;
      } catch {
        dirReady = false;
      }
      return dirReady;
    };

    const sweepRetention = (now: Date): void => {
      let remaining: Array<{ filePath: string; size: number; mtimeMs: number }>;
      try {
        const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
        remaining = [];
        for (const name of readdirSync(logDir)) {
          if (!LOG_FILE_PATTERN.test(name)) continue;
          const filePath = path.join(logDir, name);
          try {
            const stat = statSync(filePath);
            if (stat.mtimeMs < cutoff) {
              unlinkSync(filePath);
              continue;
            }
            remaining.push({
              filePath,
              size: stat.size,
              mtimeMs: stat.mtimeMs,
            });
          } catch {
            // Skip files we can't stat/unlink.
          }
        }
      } catch {
        return;
      }

      let total = remaining.reduce((sum, entry) => sum + entry.size, 0);
      if (total <= maxTotalBytes) return;
      remaining.sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (let i = 0; i < remaining.length - 1 && total > maxTotalBytes; i++) {
        const entry = remaining[i];
        if (!entry) continue;
        try {
          unlinkSync(entry.filePath);
          total -= entry.size;
        } catch {
          // Skip files we can't unlink.
        }
      }
    };

    const rollIfNeeded = (now: Date): void => {
      const stamp = dateStamp(now);
      if (stamp === currentStamp) return;
      currentStamp = stamp;
      truncatedChannels.clear();
      closeAllFiles();
      sweepRetention(now);
    };

    const filePathFor = (channel: LogChannel): string =>
      path.join(logDir, `${channel}-${currentStamp}.txt`);

    const currentFileSize = (filePath: string): number | null => {
      try {
        return statSync(filePath).size;
      } catch {
        return null;
      }
    };

    const appendLine = (
      channel: LogChannel,
      filePath: string,
      text: string,
    ): void => {
      let fd = openFiles.get(channel);
      if (fd === undefined) {
        try {
          fd = openSync(filePath, "a", 0o600);
          if (process.platform !== "win32") {
            try {
              fchmodSync(fd, 0o600);
            } catch {
              closeSync(fd);
              return;
            }
          }
        } catch {
          return;
        }
        openFiles.set(channel, fd);
      }
      try {
        writeSync(fd, text);
      } catch {
        // Best-effort diagnostics; never throw from a logging call.
      }
    };

    const format = (
      now: Date,
      level: LogLevel,
      event: string,
      fields?: LogFields,
    ): string => {
      const parts = [
        now.toISOString(),
        `[${level}]`,
        `[${component}]`,
        `event=${formatValue(event)}`,
      ];
      if (fields) {
        for (const [key, value] of flattenFields(fields)) {
          if (value === undefined) continue;
          parts.push(`${key}=${formatValue(value)}`);
        }
      }
      return `${parts.join(" ")}\n`;
    };

    const writeUnsafe = (
      channel: LogChannel,
      level: LogLevel,
      event: string,
      fields?: LogFields,
    ): void => {
      if (!ensureDir()) return;
      const now = new Date();
      rollIfNeeded(now);
      const filePath = filePathFor(channel);

      if (truncatedChannels.has(channel)) return;
      const size = currentFileSize(filePath);
      if (size === null && openFiles.has(channel)) {
        const fd = openFiles.get(channel);
        openFiles.delete(channel);
        if (fd !== undefined) {
          try {
            closeSync(fd);
          } catch {
            // ignore
          }
        }
      }
      if (size !== null && size >= maxFileBytes) {
        truncatedChannels.add(channel);
        appendLine(
          channel,
          filePath,
          `${now.toISOString()} [warn] [${component}] log.truncated reason=size-cap\n`,
        );
        return;
      }

      appendLine(channel, filePath, format(now, level, event, fields));
    };

    const write: Interface["write"] = (channel, level, event, fields) =>
      writeLock.withPermit(
        Effect.sync(() => writeUnsafe(channel, level, event, fields)),
      );

    const crash: Interface["crash"] = (event, error, fields) =>
      Effect.suspend(() => {
        const err = error instanceof Error ? error : new Error(String(error));
        const stack = err.stack;
        return write("error", "fatal", event, {
          ...fields,
          errorName: err.name,
          errorMessage: err.message,
          ...(stack ? { stack } : {}),
        });
      });

    return {
      write,
      process: (event, fields) => write("process", "info", event, fields),
      warn: (event, fields) => write("process", "warn", event, fields),
      error: (event, fields) => write("error", "error", event, fields),
      crash,
    };
  });

export const layer = (
  options: FileLoggerOptions,
): Layer.Layer<ObservabilityLogger> =>
  Layer.effect(ObservabilityLogger, make(options));
