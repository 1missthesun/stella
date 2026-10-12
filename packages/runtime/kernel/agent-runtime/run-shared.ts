/**
 * Transcript helpers shared by the desktop runtime and the cloud
 * orchestrator DO (workerd). This module must stay importable from workerd —
 * no node builtins, no filesystem, no desktop stores — so that cloud hosts
 * reuse these behaviors instead of forking them. `shared.ts` and
 * `thread-memory.ts` re-export everything here for their existing callers.
 */

import type { AgentMessage } from "../agent-core/types.js";

/**
 * True when an assistant message carries something the conversation can use:
 * a tool call, or text with non-whitespace in it. A message that fails this
 * is not an answer — it is a burnt provider call (an empty completion, or a
 * thinking-only reply that hit the output cap while reasoning).
 *
 * A host that persists messages as a run produces them applies this before
 * writing, so the durable transcript never rebuilds a history with two
 * consecutive assistant messages, one of them empty.
 */
export const assistantMessageHasUsableOutput = (
  message: AgentMessage,
): boolean => {
  if (message.role !== "assistant") return true;
  const blocks = Array.isArray(message.content) ? message.content : [];
  return blocks.some(
    (block) =>
      block.type === "toolCall" ||
      (block.type === "text" && block.text.trim().length > 0),
  );
};
