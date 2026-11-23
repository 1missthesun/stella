/**
 * Which of Google Antigravity's own tools Stella's agents get (`agy` 1.5), by
 * role. Everything else comes from Stella: Antigravity's subagents, schedules,
 * browser, image generation and messaging would do work Stella can't track,
 * and its shell moves any command past ten seconds to the background and then
 * runs the model by itself, outside any Stella turn, when the command ends.
 */
export type AntigravityRole = "orchestrator" | "worker";

const ORCHESTRATOR_TOOLS = ["read_file", "search_web"] as const;
const WORKER_TOOLS = ["read_file", "write_file", "edit_file", "search_web"] as const;
export const ANTIGRAVITY_NATIVE_TOOLS = WORKER_TOOLS;

/** Antigravity tools that stay declared or could appear, and that a Stella agent may only use when it is in its set. */
export const ANTIGRAVITY_GATED_TOOLS = [
  ...ANTIGRAVITY_NATIVE_TOOLS,
  "run_command",
  "manage_task",
  "view_file",
  "write_to_file",
  "replace_file_content",
  "multi_replace_file_content",
  "list_dir",
  "grep_search",
  "find_by_name",
  "read_url_content",
  "call_mcp_tool",
  "list_resources",
  "read_resource",
  "list_permissions",
  "ask_permission",
  "ask_question",
  "schedule",
  "invoke_subagent",
  "define_subagent",
  "manage_subagents",
  "manage_inbox",
  "send_message",
  "run_workflow",
  "swarm",
  "generate_image",
  "browser_subagent",
] as const;

const STELLA_TOOLS_REPLACED: Readonly<Record<string, readonly string[]>> = {
  read_file: ["Read"],
  write_file: ["Write"],
  edit_file: ["Edit", "apply_patch"],
  search_web: ["web"],
};

/** Stella's own file and shell tools, which its orchestrator delegates instead of using. */
const ORCHESTRATOR_WITHHELD = ["Write", "Edit", "apply_patch", "Bash", "exec_command", "write_stdin", "Grep", "Glob"];

export const resolveAntigravityToolSet = <T extends { name: string }>(args: {
  role: AntigravityRole;
  catalog: readonly T[];
  builtinsOff: boolean;
}): { nativeTools: readonly string[]; tools: T[] } => {
  const offersWeb = args.catalog.some((tool) => tool.name === "web");
  const native: string[] = (args.role === "orchestrator" ? ORCHESTRATOR_TOOLS : WORKER_TOOLS).filter((name) =>
    name === "search_web" ? offersWeb : !args.builtinsOff,
  );
  const replaced = new Set<string>(args.role === "orchestrator" ? ORCHESTRATOR_WITHHELD : []);
  for (const name of native) for (const stellaName of STELLA_TOOLS_REPLACED[name] ?? []) replaced.add(stellaName);
  return { nativeTools: native, tools: args.catalog.filter((tool) => !replaced.has(tool.name)) };
};
