/**
 * With `CLAUDE_AGENT_SDK_MCP_NO_PREFIX=1` Claude Code lists sdk-server tools under
 * their own names. A Stella tool must never share a name with a built-in that is
 * switched on: the CLI keeps its own and drops Stella's.
 */

export const CLAUDE_CODE_STELLA_SERVER_NAME = "stella";

export const CLAUDE_CODE_PLAIN_TOOL_NAMES_ENV = "CLAUDE_AGENT_SDK_MCP_NO_PREFIX";

export const LEGACY_CLAUDE_CODE_STELLA_TOOL_PREFIX = `mcp__${CLAUDE_CODE_STELLA_SERVER_NAME}__`;

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

export const stellaToolNameFromClaudeCode = (claudeName: string): string =>
  claudeName.startsWith(LEGACY_CLAUDE_CODE_STELLA_TOOL_PREFIX)
    ? claudeName.slice(LEGACY_CLAUDE_CODE_STELLA_TOOL_PREFIX.length)
    : claudeName;

export const legacyClaudeCodeToolAliases = (
  stellaNames: readonly string[],
): Record<string, string> =>
  Object.fromEntries(
    stellaNames.map((name) => [`${LEGACY_CLAUDE_CODE_STELLA_TOOL_PREFIX}${name}`, name]),
  );
