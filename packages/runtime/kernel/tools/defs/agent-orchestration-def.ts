/**
 * The orchestration tools an agent at the depth limit loses. It keeps
 * agent_status and send_message, so it can still see and message others.
 */
export const AGENT_CONTROL_TOOL_NAMES: readonly string[] = [
  "spawn_agent",
  "stop_agent",
];

