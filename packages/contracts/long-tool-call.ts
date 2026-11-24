export const LONG_TOOL_CALL_MS = 12 * 60_000;

const WAITS_FOR_USER: ReadonlySet<string> = new Set(["ask_user", "request_secure_input"]);

export const waitsForUser = (tool: string): boolean => WAITS_FOR_USER.has(tool);

export type CurrentToolCall = { tool: string; since: number };

export const longToolCall = <T extends CurrentToolCall>(call: T | undefined, now = Date.now()): T | undefined =>
  call && !waitsForUser(call.tool) && now - call.since >= LONG_TOOL_CALL_MS ? call : undefined;

export const toolCallMinutes = (call: CurrentToolCall, now = Date.now()): number =>
  Math.max(0, Math.floor((now - call.since) / 60_000));

export const longToolCallText = (call: CurrentToolCall, now = Date.now()): string =>
  `on one ${call.tool} call for ${toolCallMinutes(call, now)} min, longer than any time limit allows: it may be stuck`;
