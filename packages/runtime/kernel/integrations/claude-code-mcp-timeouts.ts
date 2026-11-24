/**
 * Claude Code aborts an HTTP MCP call that sends neither a response nor a
 * progress notification for `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT` (5 minutes by
 * default; its watchdog checks every 30 s). Every call in flight sends a
 * progress notification at least this often, so a long but healthy call (a
 * code cell, a wait on the user) is never cut off for being quiet. Stella's own
 * deadlines, not the CLI's silence cutoff, end a call that is stuck.
 */
export const CLAUDE_CODE_MCP_PROGRESS_HEARTBEAT_MS = 30_000;

export const CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT_MS = 30 * 60_000;

export const CLAUDE_CODE_STELLA_TOOL_CEILING_MS = 30 * 60_000;

export const stellaToolCeilingText = (toolName: string): string =>
  `${toolName} was stopped after ${CLAUDE_CODE_STELLA_TOOL_CEILING_MS / 60_000} minutes, the longest one call may take, so it is probably stuck. Run long work in the background (Bash with run_in_background, or a code cell you check on later) instead of waiting on it in one call.`;
