/**
 * Which Claude Code built-in tools a Stella-driven Claude Code session keeps.
 *
 * Stella used to disable every built-in and serve its own Read/Write/Edit/
 * shell clones over a private MCP server. Each of those calls then paid an
 * HTTP round trip plus the host's correlation gate (a measured ~2s for a
 * file read that native Read does in-process). The built-ins listed here run
 * inside the CLI; the Stella tools they supersede are dropped from the MCP
 * catalog so the model never sees two spellings of the same operation.
 *
 * The orchestrator coordinates rather than works: it may look (Read, Grep,
 * Glob) but never gets a native shell or file writer. Workers get the full
 * file and shell set.
 *
 * Built-ins run where the CLI runs. While a session's file and shell tools
 * are set to run elsewhere (another of the owner's computers, or a cloud
 * container), every built-in is off and Stella's own Read/Write/Edit/Bash/
 * Grep come back over MCP, where the host routes them there
 * (`@stella/agent/host/remote-tools`), with a served Grep and Glob that run
 * there as the device Grep (`CLAUDE_CODE_SERVED_SEARCH_TOOLS`). Back where
 * the CLI runs, the built-ins return: the fast path whenever tools are local.
 */
import { isDeviceToolName } from "@stella/contracts/turn-plane/device-tools";

export type ClaudeCodeNativeToolRole = "orchestrator" | "worker";

export const CLAUDE_CODE_ORCHESTRATOR_NATIVE_TOOLS: readonly string[] = [
  "Read",
  "Grep",
  "Glob",
];

export const CLAUDE_CODE_WORKER_NATIVE_TOOLS: readonly string[] = [
  "Read",
  "Edit",
  "Write",
  "Bash",
  "Grep",
  "Glob",
];

/**
 * Stella tools each built-in replaces. Anything not listed (apply_patch,
 * code, html, web, browser, computer, agents, images, ...) stays on MCP.
 */
const STELLA_TOOLS_REPLACED_BY_NATIVE: Readonly<
  Record<string, readonly string[]>
> = {
  Read: ["Read"],
  Edit: ["Edit"],
  Write: ["Write"],
  Bash: ["Bash", "exec_command", "write_stdin"],
  Grep: ["Grep"],
  Glob: ["Glob"],
};

/**
 * The orchestrator never writes files, natively or over MCP: its memory
 * goes through the `memory` client inside `code`, and every other change is
 * delegated to an agent. Withheld even when an agent definition lists them,
 * so a prompt override cannot hand them back.
 */
export const CLAUDE_CODE_ORCHESTRATOR_WITHHELD_TOOLS: readonly string[] = [
  "Write",
  "Edit",
  "apply_patch",
  "Bash",
  "exec_command",
  "write_stdin",
];

/**
 * Stella tool names that grant each built-in when an agent has a tools
 * allowlist. A built-in is granted when the allowlist names it or any
 * Stella tool it stands in for (shell -> Bash, apply_patch -> Write/Edit);
 * Glob, read-only, rides on Read or Grep.
 */
const STELLA_TOOLS_GRANTING_NATIVE: Readonly<
  Record<string, readonly string[]>
> = {
  Read: ["Read"],
  Edit: ["Edit", "apply_patch"],
  Write: ["Write", "apply_patch"],
  Bash: ["Bash", "exec_command", "write_stdin"],
  Grep: ["Grep"],
  Glob: ["Glob", "Grep", "Read"],
};

/**
 * The built-ins a role keeps, narrowed to the agent's tools allowlist when
 * it has one (an absent or empty allowlist means the role's full set, the
 * same default Stella's own tool resolution uses).
 */
export const resolveClaudeCodeNativeTools = (
  role: ClaudeCodeNativeToolRole,
  toolsAllowlist?: readonly string[],
): readonly string[] => {
  const roleTools =
    role === "orchestrator"
      ? CLAUDE_CODE_ORCHESTRATOR_NATIVE_TOOLS
      : CLAUDE_CODE_WORKER_NATIVE_TOOLS;
  if (!Array.isArray(toolsAllowlist) || toolsAllowlist.length === 0) {
    return roleTools;
  }
  const allowed = new Set(toolsAllowlist);
  return roleTools.filter((nativeTool) =>
    (STELLA_TOOLS_GRANTING_NATIVE[nativeTool] ?? [nativeTool]).some((name) =>
      allowed.has(name),
    ),
  );
};

/**
 * Drop the Stella MCP tools that an enabled built-in supersedes, plus the
 * ones the role must never hold.
 */
export const withoutToolsReplacedByNative = <
  T extends { name: string },
>(
  tools: readonly T[],
  nativeTools: readonly string[],
  role: ClaudeCodeNativeToolRole = "worker",
): T[] => {
  const replaced = new Set<string>(
    role === "orchestrator" ? CLAUDE_CODE_ORCHESTRATOR_WITHHELD_TOOLS : [],
  );
  for (const nativeTool of nativeTools) {
    for (const name of STELLA_TOOLS_REPLACED_BY_NATIVE[nativeTool] ?? []) {
      replaced.add(name);
    }
  }
  if (replaced.size === 0) return [...tools];
  return tools.filter((tool) => !replaced.has(tool.name));
};

/** MCP tools are `mcp__<server>__<name>`; everything else is a CLI built-in. */
export const isClaudeCodeNativeToolName = (toolName: string): boolean =>
  !toolName.startsWith("mcp__");

/**
 * A session's built-ins and Stella MCP tools for where its file and shell
 * tools run: native where the CLI runs, Stella's routed ones (`toolsAway`)
 * anywhere else.
 */
export const resolveClaudeCodeToolSet = <
  T extends { name: string },
>(args: {
  role: ClaudeCodeNativeToolRole;
  toolsAllowlist?: readonly string[];
  catalog: readonly T[];
  toolsAway: boolean;
}): { nativeTools: readonly string[]; tools: T[] } => {
  const nativeTools = args.toolsAway
    ? []
    : resolveClaudeCodeNativeTools(args.role, args.toolsAllowlist);
  return {
    nativeTools,
    tools: withoutToolsReplacedByNative(args.catalog, nativeTools, args.role),
  };
};

/** Stella tools that run where a session's file and shell tools run, wherever that is. */
export const isClaudeCodeEnvironmentToolName = (toolName: string): boolean =>
  isDeviceToolName(toolName);

const GLOB_CHARACTERS = /[*?[\]{}]/u;

/**
 * Claude Code's Grep and Glob as Stella serves them while a session's tools
 * run elsewhere: the same names and the arguments the built-ins take, run
 * there as the device `Grep` (a Glob is a file listing: every file whose
 * path matches, by ripgrep's globs).
 */
export const CLAUDE_CODE_SERVED_SEARCH_TOOLS = [
  {
    name: "Grep",
    description:
      "Search file contents with ripgrep where your file and shell tools run. output_mode files_with_matches (default) lists matching files, content shows matching lines with line numbers, count counts matches per file. Filter files with glob (e.g. \"*.ts\") or type (e.g. \"py\").",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "The regular expression to search for." },
        path: { type: "string", description: "File or directory to search in; defaults to the working directory there." },
        glob: { type: "string", description: "Only search files matching this glob." },
        type: { type: "string", description: "Only search files of this ripgrep type." },
        output_mode: { type: "string", enum: ["content", "files_with_matches", "count"] },
        "-i": { type: "boolean", description: "Case insensitive search." },
        "-C": { type: "number", description: "Lines of context around each match (output_mode content)." },
        head_limit: { type: "number", description: "Most matches per file to report." },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  {
    name: "Glob",
    description:
      "Find files by path pattern where your file and shell tools run, such as \"**/*.ts\" or \"src/**/*.tsx\". A pattern without a slash matches file names at any depth. Ignored, hidden and empty files are left out.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "The glob pattern to match file paths against." },
        path: { type: "string", description: "Directory to search in; defaults to the working directory there." },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
] as const satisfies readonly { name: string; description: string; parameters: Record<string, unknown> }[];

export type ClaudeCodeServedSearchToolName = (typeof CLAUDE_CODE_SERVED_SEARCH_TOOLS)[number]["name"];

export const isClaudeCodeServedSearchToolName = (toolName: string): toolName is ClaudeCodeServedSearchToolName =>
  CLAUDE_CODE_SERVED_SEARCH_TOOLS.some((tool) => tool.name === toolName);

const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value : undefined);

/** A glob's fixed leading directories, searched as the path, and the rest as ripgrep's glob. */
const splitGlob = (pattern: string, base: string | undefined): { path?: string; glob: string } => {
  const segments = pattern.replace(/\\/gu, "/").split("/");
  const fixed: string[] = [];
  while (segments.length > 1 && !GLOB_CHARACTERS.test(segments[0]!)) fixed.push(segments.shift()!);
  const glob = segments.join("/");
  if (fixed.length === 0) return { ...(base ? { path: base } : {}), glob };
  const prefix = fixed.join("/") || "/";
  const path = base && !prefix.startsWith("/") && !/^[A-Za-z]:$/u.test(fixed[0]!) ? `${base.replace(/[\\/]+$/u, "")}/${prefix}` : prefix;
  return { path, glob };
};

/** A served Grep or Glob call as the device `Grep` takes it. */
export const claudeCodeServedSearchCall = (
  toolName: ClaudeCodeServedSearchToolName,
  args: Record<string, unknown>,
): { toolName: "Grep"; params: Record<string, unknown> } => {
  if (toolName === "Glob") {
    const { path, glob } = splitGlob(text(args.pattern) ?? "**/*", text(args.path));
    return {
      toolName: "Grep",
      params: { pattern: "", glob, output_mode: "files_with_matches", ...(path ? { path } : {}) },
    };
  }
  const contextLines = args["-C"] ?? args.context;
  return {
    toolName: "Grep",
    params: {
      pattern: typeof args.pattern === "string" ? args.pattern : "",
      ...(text(args.path) ? { path: args.path } : {}),
      ...(text(args.glob) ? { glob: args.glob } : {}),
      ...(text(args.type) ? { type: args.type } : {}),
      ...(text(args.output_mode) ? { output_mode: args.output_mode } : {}),
      ...(args["-i"] === true || args.case_insensitive === true ? { case_insensitive: true } : {}),
      ...(typeof contextLines === "number" && contextLines > 0 ? { context_lines: contextLines } : {}),
      ...(typeof args.head_limit === "number" && args.head_limit > 0 ? { max_results: args.head_limit } : {}),
    },
  };
};
