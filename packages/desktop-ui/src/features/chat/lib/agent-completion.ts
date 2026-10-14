/**
 * Per-agent completion card derivation.
 *
 * A delegated agent's user-facing files are linked in the `result` of its
 * `agent-completed` event. The
 * background-task lifecycle selector folds that payload back onto the card
 * created by the matching `agent-started` occurrence, so completion enriches
 * the existing spawn-anchored card instead of inserting another timeline row.
 *
 * Two structural facts make this clean and append-only by construction:
 *   1. The response itself is the source of truth, so intermediate tool and
 *      scratch files never become completion-card artifacts unless the agent
 *      deliberately links them.
 *   2. Each `agent-completed` event attaches to exactly one message row (see
 *      `group-events-into-messages`) — though during the SQLite/stream
 *      handoff the same underlying event can briefly be projected onto both
 *      the user-message fallback row and the assistant row; the dedup pass in
 *      `use-event-rows` collapses that duplicate (keyed by `agentId` +
 *      `completedAtMs`).
 *
 * Kept as a pure module (no React) so the derivation is unit-testable,
 * mirroring the other extracted chat derivations.
 */
import type { EventRecord } from "./event-transforms";
import {
  fallbackTaskDescription,
  isAgentCompletedEvent,
} from "./event-transforms";
import { deriveAgentFilesMap } from "@/features/workspace-display/agent-files";
import type { ConversationFileEntry } from "@/features/workspace-display/derive-conversation-files";
import { isDeclaredOutputPath } from "@/features/workspace-display/path-to-viewer";

export type AgentCompletionSection = {
  agentId: string;
  agentType?: string;
  title: string;
  startEventId?: string;
  completionEventId?: string;
  rootRunId?: string;
  completedAtMs: number;
  files: ConversationFileEntry[];
  result?: string;
};

export type AgentMeta = {
  description?: string;
  agentType?: string;
};

const asNonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;

const rankDeliverablesFirst = (
  entries: ConversationFileEntry[],
): ConversationFileEntry[] => [
  ...entries.filter((entry) => isDeclaredOutputPath(entry.path)),
  ...entries.filter((entry) => !isDeclaredOutputPath(entry.path)),
];

export function deriveAgentCompletionFiles(
  toolEvents: ReadonlyArray<EventRecord>,
): Map<string, ConversationFileEntry[]> {
  return deriveAgentFilesMap(toolEvents, isAgentCompletedEvent);
}

export function buildAgentCompletionSections(
  toolEvents: ReadonlyArray<EventRecord>,
  agentMetaById: ReadonlyMap<string, AgentMeta>,
): AgentCompletionSection[] {
  const files = deriveAgentCompletionFiles(toolEvents);

  const completedAgentIds: string[] = [];
  const completedAtByAgent = new Map<string, number>();
  const completionEventIdByAgent = new Map<string, string>();
  const rootRunIdByAgent = new Map<string, string>();
  const resultByAgent = new Map<string, string>();
  for (const event of toolEvents) {
    if (!isAgentCompletedEvent(event)) continue;
    const agentId = asNonEmptyString(event.payload.agentId);
    if (!agentId) continue;
    const prev = completedAtByAgent.get(agentId);
    if (prev === undefined) completedAgentIds.push(agentId);
    if (prev === undefined || event.timestamp >= prev) {
      completedAtByAgent.set(agentId, Math.max(prev ?? 0, event.timestamp));
      completionEventIdByAgent.set(agentId, event._id);
      const rootRunId = asNonEmptyString(event.payload.rootRunId);
      if (rootRunId) rootRunIdByAgent.set(agentId, rootRunId);
      else rootRunIdByAgent.delete(agentId);
      const result = asNonEmptyString(event.payload.result);
      if (result) resultByAgent.set(agentId, result);
      else resultByAgent.delete(agentId);
    }
  }

  const sections: AgentCompletionSection[] = [];
  for (const agentId of completedAgentIds) {
    const meta = agentMetaById.get(agentId);
    const title =
      meta?.description?.trim() ||
      fallbackTaskDescription(agentId);
    const entries = files.get(agentId) ?? [];
    const result = resultByAgent.get(agentId);
    sections.push({
      agentId,
      ...(meta?.agentType ? { agentType: meta.agentType } : {}),
      title,
      completedAtMs: completedAtByAgent.get(agentId) ?? 0,
      ...(completionEventIdByAgent.get(agentId)
        ? { completionEventId: completionEventIdByAgent.get(agentId) }
        : {}),
      ...(rootRunIdByAgent.get(agentId)
        ? { rootRunId: rootRunIdByAgent.get(agentId) }
        : {}),
      files: rankDeliverablesFirst([...entries]),
      ...(result ? { result } : {}),
    });
  }
  return sections;
}
