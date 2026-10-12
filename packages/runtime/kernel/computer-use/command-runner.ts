import {
  executeStellaComputerCommand,
  type StellaComputerExecutionOptions,
  type StellaComputerExecutionResult,
} from "./stella-computer-executor.js";

export type ComputerCommandRequest = {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs: number;
  maxOutputBytes?: number;
};

export type ComputerCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type ComputerCommandRunner = (
  request: ComputerCommandRequest,
) => Promise<ComputerCommandResult>;

export type StellaComputerExecutor = (
  argv: string[],
  options?: StellaComputerExecutionOptions,
) => Promise<StellaComputerExecutionResult>;

export const createInProcessComputerCommandRunner =
  (
    executor: StellaComputerExecutor = executeStellaComputerCommand,
  ): ComputerCommandRunner =>
  async (request) => {
    if (request.signal?.aborted) {
      throw request.signal.reason instanceof Error
        ? request.signal.reason
        : new Error("Computer command aborted.");
    }
    if (request.command !== process.execPath) {
      throw new Error(
        `In-process computer runner only accepts process.execPath requests, received ${request.command}.`,
      );
    }
    if (request.args.length === 0) {
      throw new Error(
        "In-process computer runner requires a CLI adapter path.",
      );
    }
    return await executor(request.args.slice(1), {
      cwd: request.cwd,
      cliPath: request.args[0],
      env: request.env,
      signal: request.signal,
      timeoutMs: request.timeoutMs,
      maxOutputBytes: request.maxOutputBytes,
    });
  };

