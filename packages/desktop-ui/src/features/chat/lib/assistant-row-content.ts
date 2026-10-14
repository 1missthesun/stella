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
  Boolean(row.voiceSession);
export const eventRowRendersContent = (row: EventRowViewModel): boolean =>
  row.kind === "user" ? !row.hidden : assistantRowHasVisibleContent(row);
