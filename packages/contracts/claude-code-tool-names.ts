/**
 * The names Stella's own tools carry inside Claude Code.
 *
 * Stella serves its tools to Claude Code as an in-process ("sdk") MCP server
 * over the CLI's own stdin/stdout control channel, with
 * `CLAUDE_AGENT_SDK_MCP_NO_PREFIX=1`, so the model sees them under their plain
 * names (`spawn_agent`, `code`, …) beside Claude Code's built-ins, never as
 * `mcp__stella__<name>`. Sessions recorded before that switch still carry the
 * old prefixed names; they read back here, and the CLI maps a call to an old
 * name onto the plain one (`toolAliases`).
 *
 * A plain name must never equal one of Claude Code's own tool names: with the
 * built-in on, the CLI keeps its own definition and silently drops ours. The
 * few Stella tools whose names would collide take the distinct plain name in
 * `RENAMED_FOR_CLAUDE_CODE`.
 */

/** The MCP server name Stella registers with Claude Code. */
export const CLAUDE_CODE_STELLA_SERVER_NAME = "stella";

/** The env var that makes Claude Code list sdk-server tools under their own names. */
export const CLAUDE_CODE_PLAIN_TOOL_NAMES_ENV = "CLAUDE_AGENT_SDK_MCP_NO_PREFIX";

/** How Stella's tools were named in Claude Code before they went plain. */
export const LEGACY_CLAUDE_CODE_STELLA_TOOL_PREFIX = `mcp__${CLAUDE_CODE_STELLA_SERVER_NAME}__`;

/**
 * Claude Code's own tool names, current and earlier (Agent SDK 0.3.325
 * `BUILTIN_TOOL_NAMES` and `LEGACY_TOOL_NAME_ALIASES`). None of Stella's
 * tools may take one of these.
 */
export const CLAUDE_CODE_RESERVED_TOOL_NAMES: ReadonlySet<string> = new Set([
  "Agent",
  "Artifact",
  "AskUserQuestion",
  "Bash",
  "ClaudeDesign",
  "CronCreate",
  "CronDelete",
  "CronList",
  "Edit",
  "EndConversation",
  "EnterPlanMode",
  "EnterWorktree",
  "ExitPlanMode",
  "ExitWorktree",
  "Glob",
  "Grep",
  "ListAgents",
  "ListMcpResourcesTool",
  "LSP",
  "Monitor",
  "MultiEdit",
  "NotebookEdit",
  "NotebookRead",
  "OfferChromeSetup",
  "PowerShell",
  "Projects",
  "propose_skills",
  "ProposeGoal",
  "PushNotification",
  "Read",
  "ReadMcpResourceDirTool",
  "ReadMcpResourceTool",
  "ReadNotifications",
  "RemoteTrigger",
  "ReportFindings",
  "ScheduleWakeup",
  "SendFeedback",
  "SendMessage",
  "SendUserFile",
  "SendUserMessage",
  "ShareOnboardingGuide",
  "ShowOnboardingRolePicker",
  "Skill",
  "SlashCommand",
  "SubagentHandback",
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskOutput",
  "TaskStop",
  "TaskUpdate",
  "TodoWrite",
  "ToolSearch",
  "WaitForMcpServers",
  "WebFetch",
  "WebSearch",
  "Workflow",
  "Write",
  // Earlier names the CLI still resolves.
  "Task",
  "KillShell",
  "KillBash",
  "ListPeers",
  "Brief",
  "ListMcpResources",
  "ReadMcpResource",
  "ReadMcpResourceDir",
  "BashOutput",
]);

/**
 * Stella tools that share a name with one of Claude Code's: Stella's own file
 * and shell tools, served only where Claude Code's built-in is off.
 */
const RENAMED_FOR_CLAUDE_CODE: Readonly<Record<string, string>> = {
  Read: "read_file",
  Edit: "edit_file",
  Write: "write_file",
  Bash: "shell",
  Grep: "search_files",
  Glob: "find_files",
};

const snakeCase = (name: string): string =>
  name
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .toLowerCase();

/** The name a Stella tool carries in Claude Code. */
export const claudeCodeToolName = (stellaName: string): string => {
  if (!CLAUDE_CODE_RESERVED_TOOL_NAMES.has(stellaName)) return stellaName;
  const renamed = RENAMED_FOR_CLAUDE_CODE[stellaName] ?? snakeCase(stellaName);
  return CLAUDE_CODE_RESERVED_TOOL_NAMES.has(renamed) ? `${renamed}_tool` : renamed;
};

const REVERSED: ReadonlyMap<string, string> = new Map(
  Object.entries(RENAMED_FOR_CLAUDE_CODE).map(([stella, plain]) => [plain, stella]),
);

/**
 * The Stella tool a Claude Code tool name refers to, when it is one of
 * Stella's: `stellaNames` is the session's catalog (Stella's own names).
 * Old prefixed names (`mcp__stella__<name>`) read back too. Undefined means
 * the name is Claude Code's own (or another MCP server's) tool.
 */
export const stellaToolNameOf = (
  claudeName: string,
  stellaNames: ReadonlySet<string> | readonly string[],
): string | undefined => {
  const names = stellaNames instanceof Set ? stellaNames : new Set(stellaNames as readonly string[]);
  if (claudeName.startsWith(LEGACY_CLAUDE_CODE_STELLA_TOOL_PREFIX)) {
    return claudeName.slice(LEGACY_CLAUDE_CODE_STELLA_TOOL_PREFIX.length);
  }
  if (CLAUDE_CODE_RESERVED_TOOL_NAMES.has(claudeName)) return undefined;
  for (const name of names) {
    if (claudeCodeToolName(name) === claudeName) return name;
  }
  return undefined;
};

/**
 * Stella's name for a tool call Claude Code made, without the session's
 * catalog: old prefixed names lose the prefix and renamed collisions map back;
 * every other name is already Stella's (or Claude Code's own).
 */
export const stellaToolNameFromClaudeCode = (claudeName: string): string => {
  if (claudeName.startsWith(LEGACY_CLAUDE_CODE_STELLA_TOOL_PREFIX)) {
    return claudeName.slice(LEGACY_CLAUDE_CODE_STELLA_TOOL_PREFIX.length);
  }
  return REVERSED.get(claudeName) ?? claudeName;
};

/**
 * `toolAliases` for Claude Code's initialize request: a call to an old
 * prefixed name (a model copying its history from before the switch) runs the
 * plain-named tool instead of failing as unknown.
 */
export const legacyClaudeCodeToolAliases = (
  stellaNames: readonly string[],
): Record<string, string> =>
  Object.fromEntries(
    stellaNames.map((name) => [`${LEGACY_CLAUDE_CODE_STELLA_TOOL_PREFIX}${name}`, claudeCodeToolName(name)]),
  );

/**
 * Text written for Stella's tool names (a system prompt, a tool description),
 * as Claude Code sees them: a backticked mention of a renamed tool
 * (`` `Bash` `` where Stella's own shell is served as `shell`) takes the name
 * the model has. Only names in `stellaNames` that were renamed change.
 */
export const withClaudeCodeToolNames = (
  text: string,
  stellaNames: readonly string[],
): string => {
  const renamed = stellaNames.filter((name) => claudeCodeToolName(name) !== name);
  if (renamed.length === 0) return text;
  const pattern = new RegExp(
    `\`(${renamed.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\``,
    "g",
  );
  return text.replace(pattern, (_match, name: string) => `\`${claudeCodeToolName(name)}\``);
};
