import type {
  AssistantRowViewModel,
  EventRowViewModel,
} from "@/features/chat/conversation-row-types";

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
  assistantRowHasOwnContent(row) || (row.agentLabelIds?.length ?? 0) > 0;

/**
 * Content a row paints apart from its agent pill. Spawn and completion rows
 * paint no card of their own: the agent they concern is named by the pill,
 * which only appears where the conversation turns to another agent.
 */
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
/**
 * Whether a timeline row produces a rendered box at all. User rows always
 * render; assistant rows render when they have visible content. A reply
 * arrives whole, so there is no empty pre-text row to reserve space for.
 */
export const eventRowRendersContent = (row: EventRowViewModel): boolean =>
  row.kind === "user" ? !row.hidden : assistantRowHasVisibleContent(row);
