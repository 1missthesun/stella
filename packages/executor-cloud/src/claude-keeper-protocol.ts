export const CLAUDE_KEEPER_DIRECTORY = "/home/stella-host-state/claude-keepers";

export const CLAUDE_KEEPER_MCP_CONFIG_PLACEHOLDER = "\u0000stella-mcp-config\u0000";

export const CLAUDE_KEEPER_IDLE_MS = 120_000;

export type ClaudeKeeperState = {
  mac: string;
  credentials: string;
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
