import {
  CLAUDE_CODE_AGENT_AUTO_COMPACT_WINDOW,
  CONTEXT_HANDOFF_AGENT_DESCRIPTION,
  CONTEXT_HANDOFF_NOTES_DESCRIPTION,
  CONTEXT_HANDOFF_NOTES_MAX_CHARS,
  CONTEXT_HANDOFF_TOOL,
  CONTEXT_HANDOFFS_PER_TURN,
  contextHandoffNudge,
  contextHandoffOffered,
  contextHandoffTaskOf,
  contextHandoffText,
  contextHandoffThreshold,
  isContextHandoffText,
  parseHandoffTokens,
} from "@stella/contracts/context-handoff";
import type { ToolMetadata, ToolResult } from "@stella/runtime/kernel/tools/types.js";

export const cloudAgentHandoffTool: ToolMetadata = {
  name: CONTEXT_HANDOFF_TOOL,
  description: CONTEXT_HANDOFF_AGENT_DESCRIPTION,
  parameters: {
    type: "object",
    properties: { notes: { type: "string", description: CONTEXT_HANDOFF_NOTES_DESCRIPTION } },
    required: ["notes"],
    additionalProperties: false,
  },
};

const CLAUDE_DEFAULT_WINDOW = 200_000;
const CLAUDE_LONG_WINDOW = 1_000_000;

export type CloudAgentHandoff = {
  noteContext(tokens: number): void;
  noteWindow(window: number): void;
  noteBackground(descriptions: readonly string[]): void;
  nudge(): string | undefined;
  run(params: Record<string, unknown>): ToolResult;
  pending(): boolean;
  take(args: { task?: string; turn: readonly string[] }): string | undefined;
  isNudge(text: string): boolean;
};

export const createCloudAgentHandoff = (args: { model: string; atTokens?: string | number }): CloudAgentHandoff => {
  const override = parseHandoffTokens(args.atTokens);
  let window = /\[1m\]/iu.test(args.model) ? CLAUDE_LONG_WINDOW : CLAUDE_DEFAULT_WINDOW;
  let tokens = 0;
  let background: readonly string[] = [];
  let notes: string | undefined;
  let count = 0;
  let nudgedAt = -1;
  const nudges = new Set<string>();
  const threshold = (): number | undefined =>
    contextHandoffThreshold(Math.min(window, CLAUDE_CODE_AGENT_AUTO_COMPACT_WINDOW), override);
  return {
    noteContext(next) {
      if (next > 0) tokens = next;
    },
    noteWindow(next) {
      if (next > 0) window = next;
    },
    noteBackground(descriptions) {
      background = descriptions;
    },
    nudge() {
      const at = threshold();
      if (at === undefined || notes !== undefined || count >= CONTEXT_HANDOFFS_PER_TURN || tokens < at) return undefined;
      const step = Math.max(1, Math.floor(at * 0.05));
      const bucket = Math.floor(tokens / step);
      if (bucket <= nudgedAt) return undefined;
      nudgedAt = bucket;
      const text = contextHandoffNudge({
        tokens,
        threshold: at,
        agent: true,
        ...(background.length > 0
          ? {
              blocked: `your own background work has to finish or be stopped with TaskStop (${background.slice(0, 5).join("; ")}), since it can't follow you into a fresh context.`,
            }
          : {}),
      });
      nudges.add(text);
      return text;
    },
    run(params) {
      const written = typeof params.notes === "string" ? params.notes.trim() : "";
      if (!written) return { error: "Write your handoff notes in `notes`." };
      if (written.length > CONTEXT_HANDOFF_NOTES_MAX_CHARS) {
        return {
          error: `Your notes are ${written.length} characters; keep them under ${CONTEXT_HANDOFF_NOTES_MAX_CHARS}, the points the work still needs, and call ${CONTEXT_HANDOFF_TOOL} again.`,
        };
      }
      if (notes !== undefined) return { error: "You already handed off; end this turn now with no reply." };
      if (count >= CONTEXT_HANDOFFS_PER_TURN) {
        return { error: `You already handed off ${CONTEXT_HANDOFFS_PER_TURN} times in this turn; carry on without another one.` };
      }
      const at = threshold();
      if (at === undefined || !contextHandoffOffered(tokens, at)) {
        return { error: `Your context is only about ${Math.round(tokens / 1000)}k tokens, so no handoff is needed yet; carry on.` };
      }
      if (background.length > 0) {
        return {
          error: `Your own background work is still running (${background.slice(0, 5).join("; ")}), and it can't follow you into a fresh context. Wait for it to finish, or stop what you no longer need with TaskStop, then call ${CONTEXT_HANDOFF_TOOL} again.`,
        };
      }
      notes = written;
      return {
        result:
          "Handed off. End this turn now with no reply and no further tool calls; you continue at once in a fresh context that starts from these notes.",
      };
    },
    pending: () => notes !== undefined,
    take(context) {
      if (notes === undefined) return undefined;
      const text = contextHandoffText({ notes, ...(context.task ? { task: context.task } : {}), turn: context.turn, running: [] });
      notes = undefined;
      count += 1;
      tokens = 0;
      nudgedAt = -1;
      return text;
    },
    isNudge: (text) => nudges.has(text.trim()) || nudges.has(text),
  };
};

const userTextOf = (payloadJson: string): string => {
  try {
    const content = (JSON.parse(payloadJson) as { content?: unknown }).content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content
      .map((part) => (part && typeof part === "object" && (part as { type?: unknown }).type === "text" ? String((part as { text?: unknown }).text ?? "") : ""))
      .join("\n\n");
  } catch {
    return "";
  }
};

export const cloudAgentBrief = (
  history: readonly { role: string; payloadJson: string }[],
  prompt: string,
  complete: boolean,
): string | undefined => {
  const users = history.filter((row) => row.role === "user").map((row) => userTextOf(row.payloadJson));
  const handedOff = users.findLast((text) => isContextHandoffText(text));
  if (handedOff !== undefined) return contextHandoffTaskOf(handedOff);
  if (users.length === 0) return history.length === 0 ? prompt : undefined;
  return complete ? users[0] : undefined;
};
