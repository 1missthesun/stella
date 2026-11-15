/**
 * The names Stella's own tools carry inside Claude Code.
 *
 * Stella serves its tools to Claude Code as an in-process ("sdk") MCP server
 * over the CLI's own stdin/stdout control channel, with
 * `CLAUDE_AGENT_SDK_MCP_NO_PREFIX=1`, so the model sees them under their own
 * names (`spawn_agent`, `code`, …) beside Claude Code's built-ins, never as
 * `mcp__stella__<name>`. Sessions recorded before that switch still carry the
 * old prefixed names; they read back here, and the CLI maps a call to an old
 * name onto the plain one (`toolAliases`).
 *
 * A Stella tool never shares a name with a built-in that is switched on: the
 * CLI would keep its own and drop Stella's. Every place that turns built-ins
 * on withholds Stella's same-named tool (`resolveClaudeCodeToolSet`); with the
 * built-in off, Stella's tool serves under that name (the cloud
 * orchestrator's `Read`, which reads the owner's cloud files).
 */

/** The MCP server name Stella registers with Claude Code. */
export const CLAUDE_CODE_STELLA_SERVER_NAME = "stella";

/** The env var that makes Claude Code list sdk-server tools under their own names. */
export const CLAUDE_CODE_PLAIN_TOOL_NAMES_ENV = "CLAUDE_AGENT_SDK_MCP_NO_PREFIX";

/** How Stella's tools were named in Claude Code before they went plain. */
export const LEGACY_CLAUDE_CODE_STELLA_TOOL_PREFIX = `mcp__${CLAUDE_CODE_STELLA_SERVER_NAME}__`;

/**
 * The Stella tool a Claude Code tool call refers to, when it is one of
 * Stella's: `stellaNames` is the tool set Stella served to the session. Old
 * prefixed names (`mcp__stella__<name>`) read back too. Undefined means the
 * call went to Claude Code's own tool (or another MCP server's).
 */
export const stellaToolNameOf = (
  claudeName: string,
  stellaNames: ReadonlySet<string> | readonly string[],
): string | undefined => {
  if (claudeName.startsWith(LEGACY_CLAUDE_CODE_STELLA_TOOL_PREFIX)) {
    return claudeName.slice(LEGACY_CLAUDE_CODE_STELLA_TOOL_PREFIX.length);
  }
  const names = stellaNames instanceof Set ? stellaNames : new Set(stellaNames as readonly string[]);
  return names.has(claudeName) ? claudeName : undefined;
};

/**
 * Stella's name for a tool call Claude Code made, without the session's tool
 * set: an old prefixed name loses the prefix; every other name is already
 * Stella's (or Claude Code's own).
 */
export const stellaToolNameFromClaudeCode = (claudeName: string): string =>
  claudeName.startsWith(LEGACY_CLAUDE_CODE_STELLA_TOOL_PREFIX)
    ? claudeName.slice(LEGACY_CLAUDE_CODE_STELLA_TOOL_PREFIX.length)
    : claudeName;

/**
 * `toolAliases` for Claude Code's initialize request: a call to an old
 * prefixed name (a model copying its history from before the switch) runs the
 * plain-named tool instead of failing as unknown.
 */
export const legacyClaudeCodeToolAliases = (
  stellaNames: readonly string[],
): Record<string, string> =>
  Object.fromEntries(
    stellaNames.map((name) => [`${LEGACY_CLAUDE_CODE_STELLA_TOOL_PREFIX}${name}`, name]),
  );
