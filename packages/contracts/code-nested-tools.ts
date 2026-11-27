import type { JournalMessageRecord, JournalRecord } from "./conversation-protocol";

/**
 * Tools the orchestrator reaches only inside `code`, as `tools.<name>(...)`: listed in code's catalog, never offered as
 * tools of their own. Tasks keep them as their own tools.
 */
export const ORCHESTRATOR_CODE_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "ask_user",
  "drive",
  "email",
  "html",
  "image_gen",
  "video_gen",
  "view",
]);

/** Tools whose call the chat shows (an image, a canvas, a view). A call to one inside `code` shows as its own call. */
export const CHAT_SHOWN_TOOLS: ReadonlySet<string> = new Set(["html", "image_gen", "video_gen", "view"]);

const CODE_TOOL_NAMES: ReadonlySet<string> = new Set(["code", "node_repl"]);

/** The arguments a chat-shown call keeps: all but an `html` call's document, which the chat reads from the saved file. */
export const shownCallArgs = (toolName: string, args: Record<string, unknown>): Record<string, unknown> => {
  if (toolName !== "html") return args;
  const { html: _html, ...rest } = args;
  return rest;
};

/** A chat-shown call made inside one `code` call, carried in that call's result details under `shownCalls`. */
export type CodeShownCall = {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  text: string;
  details?: unknown;
  isError?: true;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const parseShownCall = (value: unknown): CodeShownCall | undefined => {
  const call = asRecord(value);
  if (!call || typeof call.id !== "string" || !call.id || typeof call.toolName !== "string") return undefined;
  if (!CHAT_SHOWN_TOOLS.has(call.toolName)) return undefined;
  return {
    id: call.id,
    toolName: call.toolName,
    args: asRecord(call.args) ?? {},
    text: typeof call.text === "string" ? call.text : "",
    ...(call.details !== undefined ? { details: call.details } : {}),
    ...(call.isError === true ? { isError: true as const } : {}),
  };
};

/** The chat-shown calls a `code` call's result details carry; none for any other tool. */
export const codeShownCalls = (toolName: unknown, details: unknown): CodeShownCall[] => {
  if (typeof toolName !== "string" || !CODE_TOOL_NAMES.has(toolName)) return [];
  const calls = asRecord(details)?.shownCalls;
  if (!Array.isArray(calls)) return [];
  return calls.flatMap((call) => {
    const parsed = parseShownCall(call);
    return parsed ? [parsed] : [];
  });
};

/**
 * Journal records with each chat-shown call made inside `code` written out as its own call: a tool call on the
 * assistant message that made the `code` call (after its other calls) and a tool result right after the `code`
 * result, marked with `shownIn` (the `code` call's id). Every projection then shows it as it shows a direct call.
 */
export const withCodeShownCalls = (records: readonly JournalRecord[]): JournalRecord[] => {
  const byCodeCall = new Map<string, CodeShownCall[]>();
  for (const record of records) {
    if (record.kind !== "message" || record.role !== "toolResult") continue;
    const id = record.payload.toolCallId;
    const calls = codeShownCalls(record.payload.toolName, record.payload.details);
    if (typeof id === "string" && calls.length > 0) byCodeCall.set(id, calls);
  }
  if (byCodeCall.size === 0) return [...records];
  const out: JournalRecord[] = [];
  for (const record of records) {
    if (record.kind !== "message") {
      out.push(record);
      continue;
    }
    if (record.role === "assistant" && Array.isArray(record.payload.content)) {
      const shown = record.payload.content.flatMap((block) => {
        const call = asRecord(block);
        return call?.type === "toolCall" && typeof call.id === "string" ? (byCodeCall.get(call.id) ?? []) : [];
      });
      out.push(
        shown.length === 0
          ? record
          : {
              ...record,
              payload: {
                ...record.payload,
                content: [
                  ...record.payload.content,
                  ...shown.map((call) => ({ type: "toolCall", id: call.id, name: call.toolName, arguments: call.args })),
                ],
              },
            },
      );
      continue;
    }
    out.push(record);
    const codeCallId = record.role === "toolResult" ? record.payload.toolCallId : undefined;
    const shown = typeof codeCallId === "string" ? byCodeCall.get(codeCallId) : undefined;
    for (const call of shown ?? []) {
      const result: JournalMessageRecord = {
        ...record,
        payload: {
          role: "toolResult",
          toolCallId: call.id,
          toolName: call.toolName,
          content: [{ type: "text", text: call.text }],
          ...(call.details !== undefined ? { details: call.details } : {}),
          isError: call.isError === true,
          shownIn: codeCallId,
        },
      };
      out.push(result);
    }
  }
  return out;
};
