/**
 * One thread's `claude` process outlives the executor that started it, so a
 * follow-up turn in the same warm container can hand it the next message
 * instead of starting a new one. The keeper (`claude-keeper.ts`) owns that
 * process; each turn's executor talks to it over a root-only Unix socket in
 * newline-delimited JSON.
 *
 * Only node builtins here: the keeper loads this file, and it has to start
 * fast.
 */

/** Root-only (0700): only the executor, never a tool process, reaches it. */
export const CLAUDE_KEEPER_DIRECTORY = "/home/stella-host-state/claude-keepers";

/** Where the keeper writes the mcp-config path in the spawn arguments. */
export const CLAUDE_KEEPER_MCP_CONFIG_PLACEHOLDER = "\u0000stella-mcp-config\u0000";

/** A parked process nobody attaches to again is killed after this long. */
export const CLAUDE_KEEPER_IDLE_MS = 120_000;

/**
 * What a parked process must still match to take the next turn: the same
 * spawn (`key`), the same sealed native state on disk, the very files it
 * has open, and the same login file the CLI was holding.
 */
export type ClaudeKeeperState = {
  mac: string;
  credentials: string;
  /** Every file of the state root as the process left it, by inode. */
  files: string;
};

export type ClaudeKeeperSpawn = {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
};

export type ClaudeKeeperUpstream = { url: string; authorization: string };

export type ClaudeKeeperRequest =
  | {
      t: "attach";
      key: string;
      /** False when this turn must not reuse a process (recovery, adoption). */
      reusable: boolean;
      state: ClaudeKeeperState | null;
      upstream: ClaudeKeeperUpstream;
      spawn: ClaudeKeeperSpawn;
    }
  | { t: "write"; data: string }
  | { t: "park"; stateRoot: string }
  | { t: "release"; state: ClaudeKeeperState }
  | { t: "kill" };

export type ClaudeKeeperFreshReason =
  | "none"
  | "unreusable"
  | "key"
  | "state"
  | "exited";

export type ClaudeKeeperEvent =
  | { t: "attached"; reused: boolean; fresh: ClaudeKeeperFreshReason }
  | { t: "line"; line: string }
  | { t: "exit"; code: number | null; signal: string | null; stderr: string }
  | { t: "parked" }
  | { t: "released" }
  | { t: "error"; message: string };
