import {
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

