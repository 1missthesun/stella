export const SPAWN_AGENT_MODEL_DESCRIPTION =
  "Optional model/engine override. Omit `model` to use the currently configured model and engine. Explicit selectors: `stella/default` for Stella; `openrouter/<provider>/<model>` for a provider model; `codex` for Codex with its configured model or `codex/gpt-6.1-sol` for GPT-6.1 Sol; `claude-code` for Claude Code with its configured model, `claude-code/fable` for Fable, or `claude-code/opus` for Opus. The listed Stella, Codex, and Claude Code selectors accept `:low`, `:medium`, `:high`, `:xhigh`, or `:max` to override reasoning; omit the suffix to use the configured default.";

/**
 * The orchestration tools an agent at the depth limit loses. It keeps
 * agent_status and send_message, so it can still see and message others.
 */
export const AGENT_CONTROL_TOOL_NAMES: readonly string[] = [
  "spawn_agent",
  "pause_agent",
];

