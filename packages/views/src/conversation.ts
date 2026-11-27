// A view as a conversation carries it, for the devices that don't have its file (the web, the
// phone): the orchestrator's `view` tool call has the whole source in its arguments (and the data,
// when it gave some), and its result names the file it wrote, so the newest successful call for a
// file is the view to run. The source is read from the call: the cloud journal redacts tool results
// (any `name="value"` looks like a secret to it), which leaves a result's copy of the source broken.
import { isViewPath } from "./paths";

/** Who made a version: Stella's own `view` call, a task's view card, or the user restoring an earlier one. */
export type ViewAuthor = { kind: "stella" } | { kind: "task"; agentId: string; title?: string } | { kind: "restore"; from: number };

/** The newest version of one view the conversation carries. */
export type ConversationView = {
  filePath: string;
  slug?: string;
  title?: string;
  source: string;
  /** The newest data any call gave; `undefined` when none did. */
  data?: unknown;
  /** When the newest source was written (the tool's `createdAt`, else the event's time). */
  createdAt: number;
  /** Who wrote the newest source. */
  by?: ViewAuthor;
};

/** The author a `view` result names (a task's card and a restore carry theirs in the details). */
export const viewAuthorOf = (details: Record<string, unknown>): ViewAuthor => {
  if (typeof details.restoredFrom === "number" && Number.isFinite(details.restoredFrom)) return { kind: "restore", from: details.restoredFrom };
  if (typeof details.agentId === "string" && details.agentId) {
    return { kind: "task", agentId: details.agentId, ...(typeof details.agentTitle === "string" && details.agentTitle ? { title: details.agentTitle } : {}) };
  }
  return { kind: "stella" };
};

/** The loose shape of a tool result event (desktop events, and the web's journal records alike). */
export type ViewToolEvent = {
  type?: string;
  /** Pairs a tool call with its result. */
  requestId?: string;
  timestamp?: number;
  payload?: unknown;
};

export const VIEW_TOOL = "view";

const record = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** A `view` tool call's arguments, or null. */
export function viewToolCallArgs(event: ViewToolEvent): Record<string, unknown> | null {
  if (event.type !== "tool_request") return null;
  const payload = record(event.payload);
  return payload && payload.toolName === VIEW_TOOL ? record(payload.args) : null;
}

/** The view one tool result event carries (its source from `call`, the call's arguments, when known), or null. */
export function viewFromToolEvent(event: ViewToolEvent, call?: Record<string, unknown> | null): (Omit<ConversationView, "data"> & { data?: unknown; hasData: boolean }) | null {
  if (event.type !== "tool_result") return null;
  const payload = record(event.payload);
  if (!payload || payload.toolName !== VIEW_TOOL || payload.error) return null;
  const details = record(payload.details) ?? record(payload.result) ?? payload;
  const filePath = typeof details.filePath === "string" ? details.filePath : "";
  const source = typeof call?.source === "string" ? call.source : typeof details.source === "string" ? details.source : "";
  const from = call && "data" in call ? call : details;
  if (!filePath || !source || !isViewPath(filePath)) return null;
  const createdAt = typeof details.createdAt === "number" && Number.isFinite(details.createdAt) ? details.createdAt : (event.timestamp ?? 0);
  return {
    filePath,
    source,
    createdAt,
    by: viewAuthorOf(details),
    ...(typeof details.slug === "string" ? { slug: details.slug } : {}),
    ...(typeof details.title === "string" ? { title: details.title } : typeof call?.title === "string" ? { title: call.title } : {}),
    hasData: "data" in from,
    ...("data" in from ? { data: from.data } : {}),
  };
}

/** The newest version of each view among `events` (in conversation order), by file path. */
export function latestConversationViews(events: Iterable<ViewToolEvent>, into = new Map<string, ConversationView>()): Map<string, ConversationView> {
  const calls = new Map<string, Record<string, unknown>>();
  for (const event of events) {
    const args = viewToolCallArgs(event);
    if (args) {
      if (event.requestId) calls.set(event.requestId, args);
      continue;
    }
    const view = viewFromToolEvent(event, event.requestId ? calls.get(event.requestId) : null);
    if (!view) continue;
    const previous = into.get(view.filePath);
    if (previous && previous.createdAt > view.createdAt) {
      if (view.hasData && previous.data === undefined) previous.data = view.data;
      continue;
    }
    const { hasData, ...rest } = view;
    into.set(view.filePath, { ...rest, ...(hasData ? { data: view.data } : previous && previous.data !== undefined ? { data: previous.data } : {}) });
  }
  return into;
}
