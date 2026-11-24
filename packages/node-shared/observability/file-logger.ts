import { resolveLogPaths } from "./log-paths.js";
import { errorDiagnosticFields, isPeerDisconnectError } from "./error-fields.js";
import {
  createObservabilityLogger,
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
 * Every write lands synchronously so a line is still flushed even if the
 * process is mid-crash. Do NOT route hot-path / per-token / per-frame logging
 * through here.
 */

export type {
  LogFields,
  FileLoggerOptions,
} from "./logger.js";

export class FileLogger {
  private readonly logger: ObservabilityLoggerInterface;

  constructor(options: FileLoggerOptions) {
    this.logger = createObservabilityLogger(options);
  }

  process(event: string, fields?: LogFields): void {
    this.logger.process(event, fields);
  }

  warn(event: string, fields?: LogFields): void {
    this.logger.warn(event, fields);
  }

  error(event: string, fields?: LogFields): void {
    this.logger.error(event, fields);
  }

  crash(event: string, error: unknown, fields?: LogFields): void {
    this.logger.crash(event, error, fields);
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
