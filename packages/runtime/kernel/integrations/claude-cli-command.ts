import { spawn } from "node:child_process";
import { buildExternalCliChildEnv } from "./external-cli-resolution.js";

const OUTPUT_TAIL_CHARS = 2_000;

export type CliCommandResult = {
  exitCode: number | null;
  timedOut: boolean;
  /** The program couldn't be started at all (EACCES, ENOENT, ENOEXEC…). */
  spawnError: string | null;
  stdout: string;
  stderr: string;
  /** stdout and stderr as they arrived, last 2,000 characters. */
  output: string;
};

/**
 * Runs a program to completion, keeping the tail of what it printed. Never
 * throws: a program that can't start comes back with `spawnError`.
 */
export const runCliCommand = (
  executable: string,
  args: readonly string[],
  options: {
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    signal?: AbortSignal;
    cwd?: string;
    /** Windows: run through cmd.exe, for `.cmd` programs such as npm. */
    shell?: boolean;
  },
): Promise<CliCommandResult> =>
  new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let output = "";
    let spawnError: string | null = null;
    const startedAt = Date.now();
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(executable, [...args], {
        env: options.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        timeout: options.timeoutMs,
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.shell ? { shell: true } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      resolve({
        exitCode: null,
        timedOut: false,
        spawnError: error instanceof Error ? error.message : String(error),
        stdout: "",
        stderr: "",
        output: "",
      });
      return;
    }
    const tail = (text: string) => text.slice(-OUTPUT_TAIL_CHARS);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = tail(stdout + chunk.toString());
      output = tail(output + chunk.toString());
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = tail(stderr + chunk.toString());
      output = tail(output + chunk.toString());
    });
    let settled = false;
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      resolve({
        exitCode,
        timedOut:
          exitCode === null &&
          spawnError === null &&
          Date.now() - startedAt >= options.timeoutMs,
        spawnError,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        output: output.trim(),
      });
    };
    child.on("error", (error) => {
      // An error after the program started (a kill, an abort) still ends in
      // "close"; one before means it never ran.
      if (child.pid === undefined) {
        spawnError = error.message;
        finish(null);
      } else {
        output = tail(`${output}\n${error.message}`);
      }
    });
    child.on("close", (code) => finish(code));
  });

/**
 * The environment Stella runs the CLI's own commands in (`--version`,
 * `update`, `install`): never a credential, so nothing it does can use or
 * change a login other than the user's own.
 */
export const claudeCliCommandEnv = (
  executable: string,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv => {
  const childEnv = buildExternalCliChildEnv(executable, env);
  delete childEnv.ANTHROPIC_API_KEY;
  delete childEnv.ANTHROPIC_AUTH_TOKEN;
  delete childEnv.CLAUDE_CODE_OAUTH_TOKEN;
  return childEnv;
};
