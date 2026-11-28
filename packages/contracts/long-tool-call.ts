export const LONG_TOOL_CALL_MS = 12 * 60_000;

const WAITS_FOR_USER: ReadonlySet<string> = new Set(["ask_user", "request_secure_input"]);

export const waitsForUser = (tool: string): boolean => WAITS_FOR_USER.has(tool);

export type CurrentToolCall = { tool: string; since: number };

/**
 * What a running call's live details carry once something inside it (an ask_user in a code cell, a held media call)
 * waited on the user: the time held so far, and since when it still is. Held time doesn't count toward a long call.
 */
export type ToolCallHold = { heldMs: number; heldSince?: number };

const HOLD_KEY = "stellaHold";

export const toolCallHoldDetails = (hold: ToolCallHold): { [HOLD_KEY]: ToolCallHold } => ({ [HOLD_KEY]: hold });

export const toolCallHoldOf = (details: unknown): ToolCallHold | undefined => {
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  const hold = (details as Record<string, unknown>)[HOLD_KEY];
  if (!hold || typeof hold !== "object") return undefined;
  const { heldMs, heldSince } = hold as Record<string, unknown>;
  if (typeof heldMs !== "number" || !Number.isFinite(heldMs)) return undefined;
  return { heldMs: Math.max(0, heldMs), ...(typeof heldSince === "number" && Number.isFinite(heldSince) ? { heldSince } : {}) };
};

/** A call started at `startedAt` with its held time taken out, or undefined while it is held now. */
export const unheldToolCall = (tool: string, startedAt: number, details: unknown): CurrentToolCall | undefined => {
  const hold = toolCallHoldOf(details);
  if (hold?.heldSince !== undefined) return undefined;
  return { tool, since: startedAt + (hold?.heldMs ?? 0) };
};

export const longToolCall = <T extends CurrentToolCall>(call: T | undefined, now = Date.now()): T | undefined =>
  call && !waitsForUser(call.tool) && now - call.since >= LONG_TOOL_CALL_MS ? call : undefined;

export const toolCallMinutes = (call: CurrentToolCall, now = Date.now()): number =>
  Math.max(0, Math.floor((now - call.since) / 60_000));

export const longToolCallText = (call: CurrentToolCall, now = Date.now()): string =>
  `on one ${call.tool} call for ${toolCallMinutes(call, now)} min, longer than any time limit allows: it may be stuck`;

export const LONG_TOOL_CALL_OUTPUT_CHARS = 400;

/**
 * What a task's starter is sent, once, when one of the task's tool calls runs past `LONG_TOOL_CALL_MS`: the same facts
 * `agent_status` shows for `long_call`, framed as an automatic notice from that task.
 */
export const longToolCallWakeText = (
  args: { threadId: string; description: string; call: CurrentToolCall; output?: string },
  now = Date.now(),
): string => {
  const tail = args.output?.trim() ? args.output.slice(-LONG_TOOL_CALL_OUTPUT_CHARS) : undefined;
  return [
    `[Long tool call] Automatic notice, not written by the task: "${args.description.replace(/\s+/g, " ").trim().slice(0, 120)}" (${args.threadId}) is ${longToolCallText(args.call, now)}.`,
    tail ? `Latest output of that call:\n${tail}` : "That call has printed no output.",
    "If it is hung, stop_agent ends the call with its processes, then send_message resumes the task where it was. If it is just slow, leave it: this notice comes once per call.",
  ].join("\n");
};
