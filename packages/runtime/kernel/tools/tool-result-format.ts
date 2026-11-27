import { shownCallArgs, type CodeShownCall } from "@stella/contracts/code-nested-tools";
import { textFromUnknown } from "../agent-runtime/shared.js";
import { sanitizeToolError, sanitizeToolResult, sanitizeToolVisibleText } from "./safety.js";
import type { ToolResult } from "./types.js";

/** The text a model sees for a tool result and the details kept beside it; the result itself stands in for absent details unless `resultAsDetails` is off. */
export const formatToolResult = (
  toolResult: ToolResult,
  resultAsDetails: boolean,
): { text: string; details: unknown } => {
  if (toolResult.error) {
    const error = sanitizeToolError(toolResult.error);
    return {
      text: `Error: ${error}`,
      details: sanitizeToolResult(toolResult.details ?? { error }),
    };
  }
  const result = sanitizeToolResult(toolResult.result);
  return {
    text: sanitizeToolVisibleText(textFromUnknown(result)),
    details: sanitizeToolResult(toolResult.details ?? (resultAsDetails ? result : undefined)),
  };
};

/** A chat-shown call made inside `code`, recorded as the chat would have recorded it as a call of its own. */
export const codeShownCall = (
  id: string,
  toolName: string,
  args: Record<string, unknown>,
  toolResult: ToolResult,
): CodeShownCall => {
  const { text, details } = formatToolResult(toolResult, true);
  return {
    id,
    toolName,
    args: sanitizeToolResult(shownCallArgs(toolName, args)),
    text,
    ...(details !== undefined ? { details } : {}),
    ...(toolResult.error ? { isError: true as const } : {}),
  };
};
