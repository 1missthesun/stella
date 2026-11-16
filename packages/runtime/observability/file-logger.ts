import { Context, Effect, Layer, ManagedRuntime, Scope } from "effect";
import { resolveLogPaths } from "./log-paths.js";
import { errorDiagnosticFields, isPeerDisconnectError } from "./error-fields.js";
import {
  ObservabilityLogger,
  layer as observabilityLoggerLayer,
  type FileLoggerOptions,
  type Interface as ObservabilityLoggerInterface,
  type LogFields,
} from "./logger.js";

/**
 * Local debug logger shared by every Stella
 * process (Electron main and the Bun runtime worker).
 *
 * Goals:
 *   - Capture errors/crashes and process lifecycle (workers + native
 *     helpers starting / being cleaned up) to plain `.txt` files.
 *   - Daily rotation with automatic retention cleanup.
 *   - Preserve the complete diagnostic context supplied by call sites,
 *     including nested values, paths, URLs, and error stacks.
 *
 * This file is the plain synchronous facade over the Effect-native
 * `ObservabilityLogger` service in `logger.ts` — same exported names,
 * signatures, and behavior as the pre-Effect implementation; Effect types
 * never cross this boundary. Each `FileLogger` builds the scoped logger
 * resource onto its own never-closed scope (process lifetime, exactly the
 * old semantics) and runs every write synchronously on the one
 * module-level ManagedRuntime, so a line still lands on disk even if the
 * process is mid-crash — which is exactly when these logs matter most.
 * Do NOT route hot-path / per-token / per-frame logging through here.
 */

export type {
  LogFields,
  FileLoggerOptions,
} from "./logger.js";

const observabilityRuntime = ManagedRuntime.make(Layer.empty);

/**
 * Build the scoped ObservabilityLogger resource. The scope is intentionally
 * never closed: the logger lives for the whole process (the pre-Effect
 * logger had no dispose either), and its descriptors are closed/reopened by
 * the daily rotation inside the write effect.
 */
const buildLogger = (
  options: FileLoggerOptions,
): ObservabilityLoggerInterface =>
  observabilityRuntime.runSync(
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        observabilityLoggerLayer(options),
        scope,
      );
      return Context.get(context, ObservabilityLogger);
    }),
  );

export class FileLogger {
  private readonly logger: ObservabilityLoggerInterface;

  constructor(options: FileLoggerOptions) {
    this.logger = buildLogger(options);
  }

  process(event: string, fields?: LogFields): void {
    this.run(this.logger.process(event, fields));
  }

  warn(event: string, fields?: LogFields): void {
    this.run(this.logger.warn(event, fields));
  }

  error(event: string, fields?: LogFields): void {
    this.run(this.logger.error(event, fields));
  }

  crash(event: string, error: unknown, fields?: LogFields): void {
    this.run(this.logger.crash(event, error, fields));
  }

  private run(effect: Effect.Effect<void>): void {
    try {
      observabilityRuntime.runSync(effect);
    } catch {
      // Best-effort diagnostics; never throw from a logging call.
    }
  }
}

let sharedLogger: FileLogger | null = null;

export const initFileLogger = (
  stellaAppDir: string,
  component: string,
  options?: { retentionDays?: number; runtimeStateDir?: string },
): FileLogger => {
  if (sharedLogger) return sharedLogger;
  const { logDir } = resolveLogPaths(stellaAppDir, {
    ...(options?.runtimeStateDir
      ? { runtimeStateDir: options.runtimeStateDir }
      : {}),
  });
  sharedLogger = new FileLogger({
    logDir,
    component,
    ...(options?.retentionDays != null
      ? { retentionDays: options.retentionDays }
      : {}),
  });
  return sharedLogger;
};

export const getFileLogger = (): FileLogger | null => sharedLogger;

/**
 * Electron main's crash policy. Electron shows "A JavaScript error occurred
 * in the main process" for an uncaught exception and keeps running; its own
 * handler stands aside once any other `uncaughtException` listener exists,
 * so `showUncaught` shows that same dialog for everything this does not
 * survive.
 *
 * An error that only says a peer hung up (EPIPE, ECONNRESET: a caller,
 * child or client that closed its end) is logged with its full context and
 * survived without a dialog, as the runtime worker does: the stream it came
 * from is already destroyed, and the user can do nothing about it. Every
 * other uncaught exception is recorded and shown as before.
 *
 * Unhandled rejections are logged and swallowed (the process keeps running
 * with only a log line), as before.
 */
export const installMainCrashHandling = (
  logger: FileLogger,
  options: { showUncaught: (error: Error) => void },
): void => {
  process.on("unhandledRejection", (reason) => {
    logger.crash("process.unhandledRejection", reason);
  });
  process.on("uncaughtException", (error) => {
    if (isPeerDisconnectError(error)) {
      logger.warn(
        "process.peer-disconnect-survived",
        errorDiagnosticFields(error),
      );
      console.warn(
        "[main] A peer closed its end of a pipe or socket; Stella keeps running:",
        error,
      );
      return;
    }
    logger.crash("process.uncaughtException", error);
    options.showUncaught(error);
  });
};

/**
 * The detached runtime worker's crash policy. It hosts every agent, so an
 * error that only says one peer hung up (EPIPE, ECONNRESET: a child or
 * client that closed its end) is logged with its full context and survived.
 * Anything else stays fatal, as before, but the worker first runs
 * `beforeFatalExit` so nothing it started outlives it.
 */
export const installWorkerCrashHandling = (
  logger: FileLogger,
  options: { context: () => LogFields; beforeFatalExit: () => void },
): void => {
  const context = (): LogFields => {
    try {
      return options.context();
    } catch {
      return {};
    }
  };
  process.on("unhandledRejection", (reason) => {
    logger.crash("process.unhandledRejection", reason, {
      ...errorDiagnosticFields(reason),
      ...context(),
    });
  });
  process.on("uncaughtException", (error) => {
    const fields = { ...errorDiagnosticFields(error), ...context() };
    if (isPeerDisconnectError(error)) {
      logger.warn("process.peer-disconnect-survived", fields);
      console.warn(
        "[runtime-worker] A peer closed its end of a pipe or socket; the worker keeps running:",
        error,
      );
      return;
    }
    logger.crash("process.uncaughtException", error, fields);
    console.error(error);
    try {
      options.beforeFatalExit();
    } finally {
      process.exit(1);
    }
  });
};
