import type { ChatMessage } from "../types";
import { consolidateRowArtifacts } from "./agent-artifact-consolidation";
import { scheduleReceiptText } from "./schedule-receipt-summary";
import { SHOW_AGENT_CARDS } from "./agent-cards";

const STAND_IN_ARTIFACT_ID_SUFFIXES = [":artifacts", ":agent"];

export const isStandInArtifactRow = (
  message: Pick<ChatMessage, "id" | "canonicalId">,
): boolean =>
  STAND_IN_ARTIFACT_ID_SUFFIXES.some(
    (suffix) =>
      message.id.endsWith(suffix) ||
      (message.canonicalId?.endsWith(suffix) ?? false),
  );

export const visibleChatMessages = (
  messages: ChatMessage[],
  options: { contextMessageIds?: ReadonlyMap<string, { kind: string }>; canOpenArtifacts?: boolean } = {},
): ChatMessage[] => {
  const isHidden = (message: ChatMessage): boolean => {
    if (isStandInArtifactRow(message)) return true;
    if (message.role === "user" || message.text.trim() || message.stopped || message.cloudFallback) return false;
    if ((message.askRecords?.length ?? 0) > 0) return false;
    const context = options.contextMessageIds?.get(message.id);
    if (context && (SHOW_AGENT_CARDS || context.kind !== "agent")) return false;
    if (message.toolSteps?.some(step =>
      step.toolName.toLowerCase() === "schedule" && step.status !== "error" &&
      Boolean(scheduleReceiptText({ resultPreview: step.resultPreview })),
    )) return false;
    const { agentWork, maps, looseFiles } = consolidateRowArtifacts(message.artifacts ?? [], message.tasks ?? []);
    if (maps.length || looseFiles.some(artifact =>
      options.canOpenArtifacts !== false ||
      (artifact.payload.kind === "media" && artifact.payload.asset.kind === "image"),
    )) return false;
    if (!SHOW_AGENT_CARDS) return true;
    return !agentWork.some(({ payload }) =>
      payload.state === "done" && payload.completion === true && payload.followUp !== true &&
      (payload.agents?.some(agent => Boolean(agent.agentId)) || payload.agentIds?.some(Boolean)),
    );
  };
  const firstHidden = messages.findIndex(isHidden);
  if (firstHidden === -1) return messages;
  const visible = messages.slice(0, firstHidden);
  for (let i = firstHidden + 1; i < messages.length; i += 1) {
    if (!isHidden(messages[i])) visible.push(messages[i]);
  }
  return visible;
};

export const shouldAnimateMessageEntry = (
  seenMessageIds: Set<string>,
  messageId: string,
): boolean => {
  if (seenMessageIds.has(messageId)) return false;
  seenMessageIds.add(messageId);
  return true;
};

export const markPrependedMessagesSeen = (
  seenMessageIds: Set<string>,
  messages: readonly Pick<ChatMessage, "id">[],
  previousHeadId: string | null,
): string | null => {
  const nextHeadId = messages[0]?.id ?? null;
  if (previousHeadId === null || previousHeadId === nextHeadId) {
    return nextHeadId;
  }
  const previousHeadIndex = messages.findIndex(
    (message) => message.id === previousHeadId,
  );
  for (let index = 0; index < previousHeadIndex; index += 1) {
    seenMessageIds.add(messages[index]!.id);
  }
  return nextHeadId;
};
