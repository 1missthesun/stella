/**
 * How the orchestrator's conversation compacts, on every host. The desktop
 * thread runtime and the cloud orchestrator both use this module: when to
 * compact, where to cut, what the summarizer is asked, and what survives the
 * checkpoint verbatim. Each host only loads its messages, calls its own
 * model, and stores the result.
 *
 * Pure; no I/O.
 */

import type {
  AssistantMessage,
  ImageContent,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@earendil-works/pi-ai";
import { estimateModelVisibleImageTokens } from "./image-tokens.js";

/** Tokens held back from the window for the summary request's own output. */
export const COMPACTION_RESERVE_TOKENS = 49_152;
export const MIN_TAIL_MESSAGES = 2;
export const MIN_TRIGGER_TOKENS = 8_000;
const MAX_BLOCK_CHARS = 100_000;

export const THREAD_CHECKPOINT_MARKER = "[[THREAD_CHECKPOINT]]";

/** The checkpoint message that stands in for a summarized span. */
export const formatCheckpointText = (summary: string): string =>
  [THREAD_CHECKPOINT_MARKER, "", summary.trim()].join("\n");

export const truncateForSummary = (value: string, maxChars: number): string =>
  value.length <= maxChars
    ? value
    : `${value.slice(0, maxChars)}\n\n[... ${value.length - maxChars} more characters truncated]`;

export const ellipsize = (value: string): string => {
  const trimmed = value.trim();
  return trimmed.length <= MAX_BLOCK_CHARS
    ? trimmed
    : `${trimmed.slice(0, MAX_BLOCK_CHARS)}...(truncated)`;
};

/** A conversation message as both hosts store it. */
export type CompactionPayload =
  | UserMessage
  | Pick<AssistantMessage, "role" | "content" | "stopReason">
  | Pick<ToolResultMessage, "role" | "content" | "toolCallId">;

const textTokens = (text: string): number =>
  Math.max(1, Math.ceil(text.length / 4));

export const estimatePayloadTokens = (payload: CompactionPayload): number => {
  const content = payload.content;
  if (typeof content === "string") return textTokens(content);
  let tokens = 0;
  for (const block of content as ReadonlyArray<
    TextContent | ThinkingContent | ImageContent | ToolCall
  >) {
    if (block.type === "text") tokens += textTokens(block.text);
    else if (block.type === "thinking") tokens += textTokens(block.thinking);
    else if (block.type === "image")
      tokens += estimateModelVisibleImageTokens(block);
    else
      tokens += textTokens(
        `${block.name}${JSON.stringify(block.arguments ?? {})}`,
      );
  }
  return tokens;
};

/** What the cut planner needs to know about one message. */
export type CompactionMessageView = {
  role: string;
  /** Tool call ids an assistant message makes. */
  toolCallIds: readonly string[];
  /** The call a tool result answers. */
  toolResultId?: string;
  tokens: number;
};

/**
 * The assistant tool-call group a message belongs to: the assistant message
 * and everything up to its last result. Live steering and runtime notices can
 * land between a call and its result, so only a newer assistant message ends
 * the group.
 */
const containingToolCallGroup = (
  messages: readonly CompactionMessageView[],
  messageIndex: number,
): { startIndex: number; endIndex: number } | null => {
  for (let startIndex = messageIndex; startIndex >= 0; startIndex -= 1) {
    const assistant = messages[startIndex];
    if (!assistant) return null;
    if (assistant.role !== "assistant") continue;
    if (assistant.toolCallIds.length === 0) return null;
    const callIds = new Set(assistant.toolCallIds);
    const matched = new Set<string>();
    let endIndex = startIndex;
    for (let index = startIndex + 1; index < messages.length; index += 1) {
      const message = messages[index]!;
      if (message.role === "assistant") break;
      endIndex = index;
      if (message.toolResultId && callIds.has(message.toolResultId)) {
        matched.add(message.toolResultId);
        if (matched.size === callIds.size) break;
      }
    }
    return messageIndex <= endIndex ? { startIndex, endIndex } : null;
  }
  return null;
};

/** Move a cut forward past the tool-call group it would split. */
export const alignCutForward = (
  messages: readonly CompactionMessageView[],
  index: number,
): number => {
  if (index <= 0 || index >= messages.length) return index;
  const group = containingToolCallGroup(messages, index);
  return group && index > group.startIndex ? group.endIndex + 1 : index;
};

/** Move a cut back to the start of the tool-call group it would split. */
export const alignCutBackward = (
  messages: readonly CompactionMessageView[],
  index: number,
): number => {
  if (index <= 0 || index >= messages.length) return index;
  const group = containingToolCallGroup(messages, index);
  return group && index > group.startIndex ? group.startIndex : index;
};

/** Where the verbatim tail starts: the newest messages within the budget. */
export const tailStartByTokenBudget = (
  messages: readonly CompactionMessageView[],
  headEnd: number,
  keepRecentTokens: number,
  minTailMessages = MIN_TAIL_MESSAGES,
): number => {
  let accumulated = 0;
  let tailStart = messages.length;
  for (let index = messages.length - 1; index >= headEnd; index -= 1) {
    const tokens = messages[index]!.tokens;
    if (accumulated + tokens > keepRecentTokens && tailStart < messages.length)
      break;
    accumulated += tokens;
    tailStart = index;
  }
  const minCut = messages.length - minTailMessages;
  return alignCutBackward(
    messages,
    minCut >= headEnd ? Math.min(tailStart, minCut) : tailStart,
  );
};

/**
 * The messages that open a compacted conversation, as the model reads them on
 * every host: the checkpoint summary as an assistant message, then the
 * pinned copy of the latest instruction when there is one.
 */
export const checkpointMessages = (args: {
  summary: string;
  pinnedInstruction?: string;
  timestamp: number;
}): Array<UserMessage | AssistantMessage> => [
  {
    role: "assistant",
    content: [{ type: "text", text: formatCheckpointText(args.summary) }],
    api: "openai-completions",
    provider: "openai",
    model: "history",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: args.timestamp,
  },
  ...(args.pinnedInstruction?.trim()
    ? [
        {
          role: "user" as const,
          content: args.pinnedInstruction,
          timestamp: args.timestamp,
        },
      ]
    : []),
];
