export type ClaudeCodeNativeToolRole = "orchestrator" | "worker";

export const CLAUDE_CODE_ORCHESTRATOR_NATIVE_TOOLS: readonly string[] = [
  "Read",
];

export const CLAUDE_CODE_WORKER_NATIVE_TOOLS: readonly string[] = [
  "Read",
  "Edit",
  "Write",
  "Bash",
  "Grep",
  "Glob",
];

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

export const CLAUDE_CODE_ORCHESTRATOR_WITHHELD_TOOLS: readonly string[] = [
  "Write",
  "Edit",
  "apply_patch",
  "Bash",
  "exec_command",
  "write_stdin",
  "Grep",
  "Glob",
];

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

export const resolveClaudeCodeToolSet = <
  T extends { name: string },
>(args: {
  role: ClaudeCodeNativeToolRole;
  toolsAllowlist?: readonly string[];
  catalog: readonly T[];
  builtinsOff: boolean;
}): { nativeTools: readonly string[]; tools: T[] } => {
  const nativeTools = args.builtinsOff
    ? []
    : resolveClaudeCodeNativeTools(args.role, args.toolsAllowlist);
  return {
    nativeTools,
    tools: withoutToolsReplacedByNative(args.catalog, nativeTools, args.role),
  };
};
