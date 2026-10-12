import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { constants, setPriority } from "node:os";

export type GitResult = { code: number; stdout: string; stderr: string };

const gitBinary = () => process.env.STELLA_GIT_BIN?.trim() || "git";

export type RunOptions = {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /**
   * Work nobody is waiting on (preparing an update before it is offered):
   * lowest CPU priority, and idle disk priority where the system has a way to
   * ask for it (`ionice` on Linux, `taskpolicy` on macOS). What it spawns
   * inherits both.
   */
  background?: boolean;
  /** Stops the command; the run then rejects. */
  signal?: AbortSignal;
  /** Written to the command's stdin, which is then closed. */
  input?: string;
};

const IONICE = "/usr/bin/ionice";
const TASKPOLICY = "/usr/sbin/taskpolicy";

/** The command line a background run starts with. */
const backgroundCommand = (file: string, args: string[]): [string, string[]] => {
  if (process.platform === "linux" && existsSync(IONICE)) {
    return [IONICE, ["-c", "3", file, ...args]];
  }
  if (process.platform === "darwin" && existsSync(TASKPOLICY)) {
    return [TASKPOLICY, ["-b", file, ...args]];
  }
  return [file, args];
};

/** Run a command without a shell; resolves with its exit code, never throws on one. */
export const run = (
  file: string,
  args: string[],
  options: RunOptions,
): Promise<GitResult> =>
  new Promise((resolve, reject) => {
    const [command, commandArgs] = options.background
      ? backgroundCommand(file, args)
      : [file, args];
    const child = execFile(
      command,
      commandArgs,
      {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        maxBuffer: 16 * 1024 * 1024,
        timeout: options.timeoutMs ?? 60_000,
        windowsHide: true,
        ...(options.signal ? { signal: options.signal } : {}),
      },
      (error, stdout, stderr) => {
        const code =
          error == null
            ? 0
            : typeof error.code === "number"
              ? error.code
              : null;
        if (code === null) {
          reject(error);
          return;
        }
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
    if (options.input !== undefined) child.stdin?.end(options.input);
    if (options.background && child.pid) {
      try {
        setPriority(child.pid, constants.priority.PRIORITY_LOW);
      } catch {
        // It runs at normal priority.
      }
    }
  });

type GitOptions = {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  background?: boolean;
  signal?: AbortSignal;
  input?: string;
};

export const gitRaw = (cwd: string, args: string[], options: GitOptions = {}) =>
  run(gitBinary(), args, {
    cwd,
    // Never prompt: a missing credential must fail, not hang main.
    env: { GIT_TERMINAL_PROMPT: "0", ...options.env },
    timeoutMs: options.timeoutMs,
    background: options.background,
    signal: options.signal,
    input: options.input,
  });

/** Run git and return trimmed stdout; throws with git's message on failure. */
export const git = async (cwd: string, args: string[], options: GitOptions = {}) => {
  const result = await gitRaw(cwd, args, options);
  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim() || result.stdout.trim() || `git ${args[0]} failed`,
    );
  }
  return result.stdout.trim();
};

/** `git merge-base --is-ancestor`: exit 0 yes, 1 no. */
export const isAncestor = async (
  cwd: string,
  ancestor: string,
  descendant: string,
) =>
  (await gitRaw(cwd, ["merge-base", "--is-ancestor", ancestor, descendant]))
    .code === 0;

export type Worktree = { path: string; head: string; branch: string | null };

export const listWorktrees = async (cwd: string): Promise<Worktree[]> => {
  const output = await git(cwd, ["worktree", "list", "--porcelain"]);
  return output
    .split(/\n\n+/)
    .map((block) => {
      const fields = new Map<string, string>();
      for (const line of block.split("\n")) {
        const space = line.indexOf(" ");
        fields.set(
          space < 0 ? line : line.slice(0, space),
          space < 0 ? "" : line.slice(space + 1),
        );
      }
      return {
        path: fields.get("worktree") ?? "",
        head: fields.get("HEAD") ?? "",
        branch: fields.get("branch") ?? null,
      };
    })
    .filter((worktree) => worktree.path);
};

export const DRAFT_REF_PREFIX = "refs/heads/draft/";

/** Draft names are one path segment: they name a branch and a directory. */
export const isDraftName = (name: string) =>
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name) && !name.endsWith(".lock");
