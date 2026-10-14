export type { AgentResponseTarget } from "@stella/contracts/agent-stream";

import type { AgentResponseTarget } from "@stella/contracts/agent-stream";
import type { ReplyRef } from "@stella/contracts/reply-refs";

/**
 * In-memory assistant message the renderer is showing ahead of SQLite.
 *
 * The persisted source of truth is SQLite, and the runtime delivers each
 * assistant message whole over IPC. The renderer turns that message into a
 * synthetic in-memory `MessageRecord` so the reply can be on screen before
 * its row commits, rather than overlaying a separate "tail row" on top of the
 * persisted list. The overlay is inserted into `displayMessages` by
 * `useConversationDisplayMessages`. While it exists, it masks the persisted
 * row at the same `(userMessageId, indexInTurn)` slot and borrows that row's
 * metadata.
 *
 * Layout invariants:
 *   - `indexInTurn` is 1-based per `userMessageId`. The first assistant
 *     message in a turn (e.g. the preamble) gets `1`; the post-tool
 *     answer gets `2`; etc.
 *   - `timestamp` need only sort the overlay AFTER its anchoring user
 *     message and after any earlier persisted assistants in the same
 *     turn. `Date.now()` at creation time satisfies that; if the real
 *     persisted row lands while the overlay is still present, the
 *     persisted twin is hidden until the overlay is cleared.
 *   - `responseTarget` mirrors the runtime's per-message target so the
 *     row renderer can pick up agent-terminal-notice styling, etc.
 */
export type StreamingAssistantOverlay = {
  _id: string;
  userMessageId: string;
  indexInTurn: number;
  text: string;
  responseTarget?: AgentResponseTarget;
  replyRefs?: ReplyRef[];
  timestamp: number;
  runId: string;
  canonicalMessageId?: string;
  locked?: boolean;
};

export const assistantScrollFollowKey = (
  userMessageId: string,
  indexInTurn: number,
): string => `assistant-${userMessageId}-${indexInTurn}`;
