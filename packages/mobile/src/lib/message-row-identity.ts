import type { ChatMessage } from "../types";
import { messageRowArtifacts } from "./agent-artifact-consolidation";
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

const textPresence = new WeakMap<ChatMessage, boolean>();

export const messageHasText = (message: ChatMessage): boolean => {
  let present = textPresence.get(message);
  if (present === undefined) {
    present = (message.text ?? "").trim().length > 0;
    textPresence.set(message, present);
  }
  return present;
};

type VisibleOptions = {
  contextMessageIds?: ReadonlyMap<string, { kind: string }>;
  canOpenArtifacts?: boolean;
};

const NOT_CONSULTED = Symbol("not-consulted");

/** Whether a row is left out, and the reply context it read to decide (if any). */
const hiddenVerdict = (
  message: ChatMessage,
  options: VisibleOptions,
): { hidden: boolean; context: { kind: string } | undefined | typeof NOT_CONSULTED } => {
  if (isStandInArtifactRow(message)) return { hidden: true, context: NOT_CONSULTED };
  if (message.role === "user" || messageHasText(message) || message.stopped || message.cloudFallback) {
    return { hidden: false, context: NOT_CONSULTED };
  }
  if ((message.askRecords?.length ?? 0) > 0 || message.scheduleNotice) {
    return { hidden: false, context: NOT_CONSULTED };
  }
  const context = options.contextMessageIds?.get(message.id);
  return { hidden: hiddenWithContext(message, options, context), context };
};

const hiddenWithContext = (
  message: ChatMessage,
  options: VisibleOptions,
  context: { kind: string } | undefined,
): boolean => {
  if (context && (SHOW_AGENT_CARDS || context.kind !== "agent")) return false;
  if (message.toolSteps?.some(step =>
    step.toolName.toLowerCase() === "schedule" && step.status !== "error" &&
    Boolean(scheduleReceiptText({ resultPreview: step.resultPreview })),
  )) return false;
  const { agentWork, maps, looseFiles } = messageRowArtifacts(message);
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

export const visibleChatMessages = (
  messages: ChatMessage[],
  options: VisibleOptions = {},
): ChatMessage[] => {
  const isHidden = (message: ChatMessage) => hiddenVerdict(message, options).hidden;
  const firstHidden = messages.findIndex(isHidden);
  if (firstHidden === -1) return messages;
  const visible = messages.slice(0, firstHidden);
  for (let i = firstHidden + 1; i < messages.length; i += 1) {
    if (!isHidden(messages[i])) visible.push(messages[i]);
  }
  return visible;
};

/**
 * `visibleChatMessages` for a transcript that changes mostly at its end. Rows
 * that kept their place and identity keep their verdict unless the reply
 * context they read changed; unchanged input returns the previous list.
 */
export const createVisibleChatMessages = () => {
  let previous: {
    messages: readonly ChatMessage[];
    canOpenArtifacts: boolean | undefined;
    contexts: VisibleOptions["contextMessageIds"];
    consulted: number[];
    contextAt: Map<number, { kind: string } | undefined>;
    visibleBefore: number[];
    visible: ChatMessage[];
  } | null = null;
  return (messages: ChatMessage[], options: VisibleOptions = {}): ChatMessage[] => {
    let kept = 0;
    if (previous && previous.canOpenArtifacts === options.canOpenArtifacts) {
      const shared = Math.min(messages.length, previous.messages.length);
      while (kept < shared && messages[kept] === previous.messages[kept]) kept += 1;
      if (previous.contexts !== options.contextMessageIds) {
        for (const at of previous.consulted) {
          if (at >= kept) break;
          if (options.contextMessageIds?.get(messages[at]!.id) !== previous.contextAt.get(at)) {
            kept = at;
            break;
          }
        }
      }
      if (kept === messages.length && kept === previous.messages.length) {
        previous.contexts = options.contextMessageIds;
        return previous.visible;
      }
    }
    const consulted: number[] = [];
    const contextAt = new Map<number, { kind: string } | undefined>();
    if (previous) {
      for (const at of previous.consulted) {
        if (at >= kept) break;
        consulted.push(at);
        contextAt.set(at, previous.contextAt.get(at));
      }
    }
    const visibleBefore = previous ? previous.visibleBefore.slice(0, kept + 1) : [0];
    const visible = previous ? previous.visible.slice(0, visibleBefore[kept]) : [];
    for (let at = kept; at < messages.length; at += 1) {
      const message = messages[at]!;
      const verdict = hiddenVerdict(message, options);
      if (verdict.context !== NOT_CONSULTED) {
        consulted.push(at);
        contextAt.set(at, verdict.context);
      }
      if (!verdict.hidden) visible.push(message);
      visibleBefore.push(visible.length);
    }
    const result = visible.length === messages.length ? messages : visible;
    previous = {
      messages,
      canOpenArtifacts: options.canOpenArtifacts,
      contexts: options.contextMessageIds,
      consulted,
      contextAt,
      visibleBefore,
      visible: result,
    };
    return result;
  };
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
