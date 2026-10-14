import type {
  AssistantRowViewModel,
  EventRowViewModel,
} from "@/features/chat/conversation-row-types";

/**
 * Agent pills (the task cards quoted above a reply when Stella starts,
 * continues or relays an agent, with their connector line). Hidden for now;
 * flipping this back restores them. The rows still carry `agentLabelIds`.
 */
export const SHOW_AGENT_CARDS = false;

export const shownAgentLabelIds = (row: AssistantRowViewModel): string[] =>
  SHOW_AGENT_CARDS ? (row.agentLabelIds ?? []) : [];

/**
 * Whether an assistant row paints ANYTHING on screen.
 *
 * Single source of truth shared by:
 *  - `AssistantMessageRow` — a row with no visible content renders `null`
 *    (or a bare streaming placeholder while the first token is pending);
 *  - `ChatTimeline` — rows that render nothing are dropped BEFORE the
 *    virtualized list is built, so they can't occupy an item slot or
 *    accumulate per-row separator gaps as invisible spacers between
 *    turns. (Empty assistant segments are routine: tool-only stream
 *    segments, and rows whose lifecycle events were re-anchored onto a
 *    different row by `route-lifecycle-events`.)
 *
 * Keep in sync with the render branches in `AssistantMessageRow`: every
 * field that can paint content must be checked here, otherwise a row
 * carrying only that field would be dropped from the timeline.
 */
export const assistantRowHasVisibleContent = (
  row: AssistantRowViewModel,
): boolean =>
  assistantRowHasOwnContent(row) || shownAgentLabelIds(row).length > 0;

export const assistantRowHasOwnContent = (
  row: AssistantRowViewModel,
): boolean =>
  row.text.trim().length > 0 ||
  Boolean(row.officePreviewRef) ||
  Boolean(row.resourcePayload) ||
  (row.linkedFiles?.length ?? 0) > 0 ||
  (row.inlineImagePayloads?.length ?? 0) > 0 ||
  (row.mapArtifacts?.length ?? 0) > 0 ||
  (row.askRecords?.length ?? 0) > 0 ||
  (row.sourceDiffPayloads?.length ?? 0) > 0 ||
  Boolean(row.customSlot) ||
  Boolean(row.voiceSession);
export const eventRowRendersContent = (row: EventRowViewModel): boolean =>
  row.kind === "user" ? !row.hidden : assistantRowHasVisibleContent(row);
