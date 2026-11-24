import { IMAGE_CONTEXT_TOKEN_ESTIMATE } from "@stella/runtime/kernel/shared/image-caps.js";

export const CLOUD_HISTORY_TOKEN_BUDGET = 48_000;

/**
 * ~4 chars/token holds for ASCII text, but CJK and most non-Latin scripts
 * tokenize near 1 token/char.
 */
export const estimateTokens = (message: unknown): number => {
  let images = 0;
  const serialized = JSON.stringify(message, (_key, value: unknown) => {
    if (
      value !== null &&
      typeof value === "object" &&
      (value as { type?: unknown }).type === "image" &&
      typeof (value as { data?: unknown }).data === "string"
    ) {
      images += 1;
      return { ...(value as object), data: "" };
    }
    return value;
  });
  let nonAscii = 0;
  for (let index = 0; index < serialized.length; index += 1) {
    if (serialized.charCodeAt(index) > 0x7f) nonAscii += 1;
  }
  return (
    Math.ceil((serialized.length - nonAscii) / 4) +
    nonAscii +
    images * IMAGE_CONTEXT_TOKEN_ESTIMATE
  );
};

/**
 * Providers reject a window that opens with a toolResult orphaned from its
 * toolCall, so the cut lands only at a plain `user` message.
 */
export const pruneAgentHistory = <T extends { role?: string }>(
  messages: T[],
  budgetTokens: number = CLOUD_HISTORY_TOKEN_BUDGET,
): T[] => {
  if (messages.length === 0) return messages;
  let start = messages.length;
  let used = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    used += estimateTokens(messages[index]);
    if (used > budgetTokens) break;
    start = index;
  }
  if (start === 0) return messages;
  while (start < messages.length && messages[start]?.role !== "user") {
    start += 1;
  }
  return messages.slice(start);
};
