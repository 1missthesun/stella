import type { AgentMessage } from "../agent-core/types.js";

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
