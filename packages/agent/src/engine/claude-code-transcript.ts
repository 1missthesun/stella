/**
 * A Claude Code session transcript written from Stella's own history, so a
 * CLI that has no session of this conversation (it starts here, the engine
 * changed, its account changed, or the conversation moved) resumes a native
 * session holding every turn and tool call as they happened, rather than a
 * replay in one message.
 *
 * The lines are the CLI's session `.jsonl`: one user or assistant line per
 * turn, chained by `parentUuid`. Turns alternate as the Messages API needs
 * them: the results of an assistant's tool calls open the next user turn,
 * and a call whose result was never recorded is answered as such.
 */
import { createHash, randomUUID } from "node:crypto";
import type { ImageContent, Message, TextContent } from "@earendil-works/pi-ai";

export type ClaudeCodeTranscriptMeta = { sessionId: string; cwd: string; version: string };

type Block = Record<string, unknown>;
type Turn = { role: "user" | "assistant"; results: Block[]; content: Block[]; model?: string };

const TOOL_ID = /^[A-Za-z0-9_-]{1,64}$/;

const toolId = (id: string): string =>
  TOOL_ID.test(id) ? id : `toolu_${createHash("sha256").update(id).digest("hex").slice(0, 24)}`;

const toolName = (name: string): string => {
  const safe = name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
  return safe || "tool";
};

const blocksOf = (content: string | readonly (TextContent | ImageContent)[]): Block[] =>
  typeof content === "string"
    ? content.trim()
      ? [{ type: "text", text: content }]
      : []
    : content.flatMap((part): Block[] =>
        part.type === "text"
          ? part.text.trim()
            ? [{ type: "text", text: part.text }]
            : []
          : [{ type: "image", source: { type: "base64", media_type: part.mimeType, data: part.data } }],
      );

/** `messages` as API turns: alternating, tool results first in the turn after their calls. */
const turnsOf = (messages: readonly Message[], name: (tool: string) => string): Turn[] => {
  const turns: Turn[] = [];
  let pending = new Set<string>();
  const userTurn = (): Turn => {
    const last = turns.at(-1);
    if (last?.role === "user") return last;
    const turn: Turn = { role: "user", results: [], content: [] };
    turns.push(turn);
    return turn;
  };
  const settle = () => {
    if (pending.size === 0) return;
    const turn = userTurn();
    for (const id of pending) {
      turn.results.push({ type: "tool_result", tool_use_id: id, content: "No result was recorded for this call.", is_error: true });
    }
    pending = new Set();
  };
  for (const message of messages) {
    switch (message.role) {
      case "system":
        break;
      case "user": {
        const blocks = blocksOf(message.content);
        if (blocks.length > 0) userTurn().content.push(...blocks);
        break;
      }
      case "toolResult": {
        const id = toolId(message.toolCallId);
        const blocks = blocksOf(message.content);
        if (pending.delete(id)) {
          userTurn().results.push({
            type: "tool_result",
            tool_use_id: id,
            content: blocks.length > 0 ? blocks : "(no output)",
            ...(message.isError ? { is_error: true } : {}),
          });
        } else if (blocks.length > 0) {
          userTurn().content.push({ type: "text", text: `[${message.toolName} result]` }, ...blocks);
        }
        break;
      }
      case "assistant": {
        settle();
        const blocks: Block[] = [];
        for (const part of message.content) {
          if (part.type === "text" && part.text.trim()) blocks.push({ type: "text", text: part.text });
          if (part.type === "toolCall") {
            const id = toolId(part.id);
            pending.add(id);
            blocks.push({ type: "tool_use", id, name: name(part.name), input: part.arguments ?? {} });
          }
        }
        if (blocks.length === 0) break;
        const last = turns.at(-1);
        if (last?.role === "assistant") last.content.push(...blocks);
        else turns.push({ role: "assistant", results: [], content: blocks, model: message.model });
        break;
      }
    }
  }
  settle();
  if (turns[0]?.role === "assistant") turns.unshift({ role: "user", results: [], content: [{ type: "text", text: "(The conversation continues.)" }] });
  return turns;
};

/** The session `.jsonl` for `messages`; `toolName` gives each Stella tool the name the CLI knows it by. */
export const claudeCodeTranscript = (
  messages: readonly Message[],
  meta: ClaudeCodeTranscriptMeta,
  toolNameOf: (tool: string) => string,
): string => {
  const timestamp = new Date().toISOString();
  let parentUuid: string | null = null;
  const lines: string[] = [];
  turnsOf(messages, (tool) => toolName(toolNameOf(tool))).forEach((turn, index) => {
    const uuid = randomUUID();
    const content = [...turn.results, ...turn.content];
    const message =
      turn.role === "user"
        ? { role: "user", content }
        : {
            id: `msg_stella_${index}`,
            type: "message",
            role: "assistant",
            model: turn.model || "claude",
            content,
            stop_reason: content.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          };
    lines.push(
      JSON.stringify({
        parentUuid,
        isSidechain: false,
        userType: "external",
        cwd: meta.cwd,
        sessionId: meta.sessionId,
        version: meta.version,
        type: turn.role,
        message,
        uuid,
        timestamp,
      }),
    );
    parentUuid = uuid;
  });
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
};
