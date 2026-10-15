import { assistantRowHasOwnContent } from "../lib/assistant-row-content";
import { withReplyContext } from "../lib/reply-context";
import { isUiHiddenChatMessagePayload } from "@stella/contracts/chat-event-visibility";
import {
  deriveConversationFiles,
  type ConversationFileEntry,
} from "@/features/workspace-display/derive-conversation-files";
import { useLayoutEffect, useMemo, useRef } from "react";
import { parseReplyRefs } from "@/features/chat/lib/reply-refs";
import { readMessageReaction } from "@stella/contracts/reply-refs";
import type { EventRecord } from "@/features/chat/lib/event-transforms";
import type { MessagePayload } from "@/features/chat/lib/event-transforms";
import {
  isAgentCompletedEvent,
  isAgentStartedEvent,
  isAssistantMessage,
  isUserMessage,
} from "@/features/chat/lib/event-transforms";
import type { MessageRecord } from "@stella/contracts/local-chat";
import { isOrchestratorReservedBuiltinAgentId } from "@stella/contracts/agent-runtime";
import { isOfficePreviewRef } from "@stella/contracts/office-preview";
import { parseReminderMark } from "@stella/contracts/reminders";
import { parseScheduleNoticeCard } from "@stella/contracts/schedule-notice";
import {
  collectTurnSourceDiffPayloads,
  deriveTurnInlineImagePayloads,
  deriveTurnResource,
} from "@/features/chat/lib/derive-turn-resource";
import {
  buildBackgroundTaskLifecycleIndex,
  followUpReplacesActivePredecessor,
  resolveBackgroundTaskCardLifecycle,
  type BackgroundTaskLifecycleIndex,
} from "@/features/chat/lib/background-task-lifecycle";
import type { AgentCompletionSection } from "@/features/chat/lib/agent-completion";
import { deriveTurnMapArtifacts } from "@/features/chat/lib/derive-turn-map-artifacts";
import { deriveTurnAskRecords } from "@/features/chat/lib/derive-turn-ask-records";
import { filterMessagesForUiDisplay } from "@/features/chat/lib/message-display";
import {
  stabilizeTurnRows,
  type StableTurnRowsState,
} from "@/features/chat/lib/stable-rows";
import { eventRowEqual } from "@/features/chat/lib/row-equality";
import { useDeveloperResourcePreviewsEnabled } from "@/shared/lib/developer-resource-previews";
import type {
  AssistantRowViewModel,
  EventRowViewModel,
  UserRowViewModel,
} from "@/features/chat/conversation-row-types";
import {
  getDisplayMessageText,
  getDisplayUserText,
  getAttachments,
  getChannelEnvelope,
} from "@/features/chat/lib/message-turn-display";
import {
  assistantScrollFollowKey,
  type AgentResponseTarget,
} from "@/features/chat/streaming/streaming-types";

const getMessagePayload = (
  event?: EventRecord | MessageRecord,
): MessagePayload | null => {
  if (!event?.payload || typeof event.payload !== "object") return null;
  return event.payload as MessagePayload;
};

const getOfficePreviewRef = (events: readonly EventRecord[]) => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event) continue;
    if (event.type !== "tool_result") continue;
    const payload = event.payload as { officePreviewRef?: unknown } | undefined;
    const previewRef = payload?.officePreviewRef;
    if (isOfficePreviewRef(previewRef)) return previewRef;
  }
  return undefined;
};

const asNonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;

/**
 * Background-work threads kicked off (or re-activated) on this assistant
 * turn, read from the `agent-started` lifecycle events attached to the turn
 * — the same canonical source the sidebar Activity surface and live task
 * list use.
 *
 * Why the lifecycle event and not the `spawn_agent` tool_result: the spawn
 * handler returns its `thread_id` under `result`, which the runtime persists
 * only as a preview *string* (the structured object never lands on the
 * tool_result event payload), so the id isn't reliably recoverable there.
 * `agent-started` carries `agentId` directly. It also fires on `send_message`
 * re-activation (so updating a thread drops a fresh card lower in the chat)
 * and for agents spawned via `multi_tool_use_parallel`, and never fires for
 * a failed spawn (so no phantom card).
 *
 * Only user-facing *delegated* work earns a card: `general` and any custom
 * user-installed subagent. A denylist (rather than an allowlist of only
 * known agent types) means legitimate custom subagents still surface while
 * future internal builtins remain excluded automatically. Tool-internal
 * one-shot helpers like HTML/canvas and Recall never emit `agent-started`, so
 * they cannot produce a card regardless.
 */
export const getBackgroundWork = (
  events: readonly EventRecord[],
):
  | {
      threadIds: string[];
      descriptions: Record<string, string>;
      spawnedAtMs: Record<string, number>;
      statusTexts: Record<string, string>;
      followUpThreadIds: string[];
      startEventIdsByThread: Record<string, string>;
      attemptGenerationsByThread: Record<string, number>;
      rootRunIdsByThread: Record<string, string>;
      cardId: string;
    }
  | undefined => {
  const threadIds: string[] = [];
  const descriptions: Record<string, string> = {};
  const statusTexts: Record<string, string> = {};
  const followUpThreadIds: string[] = [];
  const startEventIdsByThread: Record<string, string> = {};
  const attemptGenerationsByThread: Record<string, number> = {};
  const rootRunIdsByThread: Record<string, string> = {};
  const spawnedAtMs: Record<string, number> = {};
  for (const event of events) {
    if (!isAgentStartedEvent(event)) continue;
    const agentType = asNonEmptyString(event.payload.agentType);
    if (agentType && isOrchestratorReservedBuiltinAgentId(agentType)) {
      continue;
    }
    const agentId = asNonEmptyString(event.payload.agentId);
    if (!agentId) continue;
    if (!threadIds.includes(agentId)) threadIds.push(agentId);
    const description = asNonEmptyString(event.payload.description);
    const priorTimestamp = spawnedAtMs[agentId];
    const priorEventId = startEventIdsByThread[agentId];
    const candidateAttempt =
      typeof event.payload.attemptGeneration === "number" &&
      Number.isInteger(event.payload.attemptGeneration) &&
      event.payload.attemptGeneration >= 0
        ? event.payload.attemptGeneration
        : undefined;
    const priorAttempt = attemptGenerationsByThread[agentId];
    const isLatestOccurrence =
      priorTimestamp === undefined ||
      event.timestamp > priorTimestamp ||
      (event.timestamp === priorTimestamp &&
        (candidateAttempt !== undefined || priorAttempt !== undefined
          ? candidateAttempt !== undefined &&
            (priorAttempt === undefined || candidateAttempt > priorAttempt)
          : !priorEventId || event._id.localeCompare(priorEventId) > 0));
    if (isLatestOccurrence) {
      spawnedAtMs[agentId] = event.timestamp;
      startEventIdsByThread[agentId] = event._id;
      if (candidateAttempt !== undefined) {
        attemptGenerationsByThread[agentId] = candidateAttempt;
      } else {
        delete attemptGenerationsByThread[agentId];
      }
      if (description) descriptions[agentId] = description;
      const rootRunId = asNonEmptyString(event.payload.rootRunId);
      if (rootRunId) rootRunIdsByThread[agentId] = rootRunId;
      else delete rootRunIdsByThread[agentId];
      const previousFollowUpIndex = followUpThreadIds.indexOf(agentId);
      if (previousFollowUpIndex >= 0) {
        followUpThreadIds.splice(previousFollowUpIndex, 1);
      }
      delete statusTexts[agentId];
      if (event.payload.isFollowUp) {
        followUpThreadIds.push(agentId);
        const followUp = asNonEmptyString(event.payload.statusText);
        if (followUp) statusTexts[agentId] = followUp;
      }
    }
  }
  if (threadIds.length === 0) return undefined;
  const startEventIds = threadIds
    .map((threadId) => startEventIdsByThread[threadId])
    .filter((eventId): eventId is string => Boolean(eventId));
  return {
    threadIds,
    descriptions,
    spawnedAtMs,
    statusTexts,
    followUpThreadIds,
    startEventIdsByThread,
    attemptGenerationsByThread,
    rootRunIdsByThread,
    cardId: `agent-activity:${startEventIds.join("+")}`,
  };
};

export const getSpawnedThreadIds = (
  events: readonly EventRecord[],
): string[] => {
  const ids: string[] = [];
  const add = (id: unknown) => {
    const value = asNonEmptyString(id);
    if (value && !ids.includes(value)) ids.push(value);
  };
  for (const event of events) {
    if (isAgentStartedEvent(event)) {
      add(event.payload.agentId);
      continue;
    }
    const payload = event.payload as
      | { toolName?: unknown; thread_id?: unknown; result?: unknown; args?: { thread_id?: unknown } }
      | undefined;
    if (payload?.toolName !== "spawn_agent" && payload?.toolName !== "send_message") continue;
    if (event.type === "tool_request") {
      add(payload.args?.thread_id);
      continue;
    }
    if (event.type !== "tool_result") continue;
    add(payload.thread_id);
    const result = payload.result;
    if (result && typeof result === "object" && "thread_id" in result) {
      add((result as { thread_id?: unknown }).thread_id);
    }
  }
  return ids;
};

/**
 * Descriptions of the tasks a set of tool events spawned. A locally executed
 * turn mirrored into the cloud journal keeps neither a lifecycle card nor a
 * structured spawn result, so the `spawn_agent` request's description is the
 * only durable handle; reply context matches it against the task titles that
 * later reports cite (the same match the focus lineage uses).
 */
export const getSpawnedDescriptions = (
  events: readonly EventRecord[],
): string[] => {
  const descriptions: string[] = [];
  for (const event of events) {
    if (event.type !== "tool_request") continue;
    const payload = event.payload as
      | { toolName?: unknown; args?: { description?: unknown } }
      | undefined;
    if (payload?.toolName !== "spawn_agent") continue;
    const description = asNonEmptyString(payload.args?.description);
    if (description && !descriptions.includes(description)) descriptions.push(description);
  }
  return descriptions;
};

export const getBackgroundWorks = (
  events: readonly EventRecord[],
): NonNullable<ReturnType<typeof getBackgroundWork>>[] => {
  const cards: NonNullable<ReturnType<typeof getBackgroundWork>>[] = [];
  const starts = events
    .filter(isAgentStartedEvent)
    .sort((a, b) => a.timestamp - b.timestamp || a._id.localeCompare(b._id));
  for (const event of starts) {
    const card = getBackgroundWork([event]);
    if (card) cards.push(card);
  }
  return cards;
};

const getCwd = (events: readonly EventRecord[]): string | undefined => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== "tool_request") continue;
    const payload = event.payload as { args?: unknown } | undefined;
    if (!payload?.args || typeof payload.args !== "object") continue;
    const args = payload.args as Record<string, unknown>;
    const cwd =
      asNonEmptyString(args.working_directory) ??
      asNonEmptyString(args.workdir) ??
      asNonEmptyString(args.cwd);
    if (cwd) return cwd;
  }
  return undefined;
};

type UseEventRowsOptions = {
  messages: MessageRecord[];
  maxItems?: number;
  agentTitles?: ReadonlyMap<string, string>;
  agentParents?: ReadonlyMap<string, string>;
};

type UseEventRowsResult = {
  rows: EventRowViewModel[];
};

export const assistantRowHasNonBackgroundContent = (
  row: AssistantRowViewModel,
): boolean =>
  assistantRowHasOwnContent(row) ||
  Boolean(row.reminder) ||
  (row.agentCompletion?.sections.length ?? 0) > 0;

/**
 * Reconcile a completion that surfaces on more than one row. During the
 * SQLite/stream handoff the same `agent-completed` event can briefly be
 * projected onto both the user-message fallback row and the assistant row,
 * drawing two identical completion cards. Key each section by `agentId` +
 * `completedAtMs`: the same pair on two rows is the same completion (the
 * latest row wins, mirroring the background-work `latestOwnerByThread`
 * duplicated handling); a different `completedAtMs` is a genuine `send_message`
 * re-run's later completion and both stay. Redundant copies strip their
 * duplicated sections and the row is marked dropped when nothing else
 * remains. Mutates `rows` / `droppedRowIndices` in place (same contract as
 * the background-work pass it sits beside).
 */
export const dedupeAgentCompletionRows = (
  rows: EventRowViewModel[],
  droppedRowIndices: Set<number>,
): void => {
  const completionKey = (section: AgentCompletionSection) =>
    section.completionEventId ??
    `${section.agentId}\u001f${section.completedAtMs}`;
  const latestCompletionOwner = new Map<string, number>();
  rows.forEach((row, index) => {
    if (row.kind !== "assistant" || !row.agentCompletion) return;
    for (const section of row.agentCompletion.sections) {
      latestCompletionOwner.set(completionKey(section), index);
    }
  });
  rows.forEach((row, index) => {
    if (row.kind !== "assistant" || !row.agentCompletion) return;
    const surviving = row.agentCompletion.sections.filter(
      (section) => latestCompletionOwner.get(completionKey(section)) === index,
    );
    if (surviving.length === row.agentCompletion.sections.length) return;
    if (surviving.length > 0) {
      row.agentCompletion = { sections: surviving };
      return;
    }
    const { agentCompletion: _omitCompletion, ...rest } = row;
    if (assistantRowHasNonBackgroundContent(rest) || rest.backgroundWork) {
      rows[index] = rest;
    } else {
      // Synthetic row whose sole content was the duplicated completion —
      // drop it so the canonical copy is the only render.
      droppedRowIndices.add(index);
    }
  });
};

export const deriveLinkedFiles = (
  text: string,
  timestamp: number,
): ConversationFileEntry[] => {
  if (!text || !text.includes("](")) return [];
  return deriveConversationFiles([
    {
      _id: "linked-files",
      timestamp,
      type: "assistant_message",
      payload: { text },
    },
  ]).filter((entry) => entry.payload.kind !== "source-diff");
};

const isOwnTurnToolEvent = (event: EventRecord): boolean => {
  if (event.type !== "tool_result") return true;
  const agentType = asNonEmptyString(event.payload?.agentType);
  return !agentType || agentType === "orchestrator";
};

export const projectAgentCompletionSections = (
  toolEvents: readonly EventRecord[],
  lifecycleIndex: BackgroundTaskLifecycleIndex,
  agentId?: string,
): AgentCompletionSection[] => {
  const sections = new Map<string, AgentCompletionSection>();
  for (const event of toolEvents) {
    if (!isAgentCompletedEvent(event)) continue;
    const startEventId = lifecycleIndex.startEventIdByLifecycleEventId.get(
      event._id,
    );
    const section = startEventId
      ? lifecycleIndex.byStartEventId.get(startEventId)?.completion
      : undefined;
    if (!section) continue;
    if (agentId !== undefined && section.agentId !== agentId) continue;
    sections.set(section.completionEventId ?? event._id, section);
  }
  return [...sections.values()];
};

export const isIntraTurnAssistantRuntime = (
  runtime:
    | { followedByToolCall?: boolean; turnComplete?: boolean }
    | null
    | undefined,
): boolean =>
  runtime?.followedByToolCall === true && runtime?.turnComplete !== true;

const isImageOnlyInlineRow = (row: AssistantRowViewModel): boolean =>
  row.text.trim().length === 0 &&
  (row.inlineImagePayloads?.length ?? 0) > 0 &&
  !row.officePreviewRef &&
  !row.resourcePayload &&
  !row.sourceDiffPayloads?.length &&
  !row.voiceSession &&
  !row.backgroundWork &&
  !row.agentCompletion?.sections.length;

const coalesceInlineImageRows = (
  rows: EventRowViewModel[],
): EventRowViewModel[] => {
  const out: EventRowViewModel[] = [];
  for (const row of rows) {
    if (row.kind !== "assistant" || !isImageOnlyInlineRow(row)) {
      out.push(row);
      continue;
    }
    const prev = out[out.length - 1];
    if (
      prev?.kind === "assistant" &&
      prev.replyToUserMessageId === row.replyToUserMessageId &&
      !prev.officePreviewRef &&
      !prev.resourcePayload &&
      !prev.sourceDiffPayloads?.length &&
      !prev.backgroundWork &&
      !prev.agentCompletion?.sections.length
    ) {
      out[out.length - 1] = {
        ...prev,
        inlineImagePayloads: [
          ...(prev.inlineImagePayloads ?? []),
          ...(row.inlineImagePayloads ?? []),
        ],
      };
      continue;
    }
    out.push(row);
  }
  return out;
};

const isVoiceOnlyRow = (row: AssistantRowViewModel): boolean =>
  !!row.voiceSession &&
  row.text.trim().length === 0 &&
  !row.officePreviewRef &&
  !row.resourcePayload &&
  !row.inlineImagePayloads?.length &&
  !row.sourceDiffPayloads?.length &&
  !row.backgroundWork &&
  !row.agentCompletion?.sections.length;

const coalesceVoiceSessionRows = (
  rows: EventRowViewModel[],
): EventRowViewModel[] => {
  const out: EventRowViewModel[] = [];
  for (const row of rows) {
    if (row.kind !== "assistant" || !isVoiceOnlyRow(row)) {
      out.push(row);
      continue;
    }
    const prev = out[out.length - 1];
    if (
      prev?.kind === "assistant" &&
      isVoiceOnlyRow(prev) &&
      prev.voiceSession &&
      row.voiceSession
    ) {
      out[out.length - 1] = {
        ...prev,
        voiceSession: {
          ...prev.voiceSession,
          durationMs:
            prev.voiceSession.durationMs + row.voiceSession.durationMs,
        },
      };
      continue;
    }
    out.push(row);
  }
  return out;
};

export function useEventRows(opts: UseEventRowsOptions): UseEventRowsResult {
  const developerResourcePreviewsEnabled =
    useDeveloperResourcePreviewsEnabled();
  const { messages, maxItems, agentTitles, agentParents } = opts;

  const displayMessages = useMemo(
    () => filterMessagesForUiDisplay(messages),
    [messages],
  );

  const lifecycleCacheRef = useRef<{
    toolEventsByIndex: ReadonlyArray<readonly EventRecord[]>;
    result: BackgroundTaskLifecycleIndex;
  } | null>(null);
  const lifecycleIndex = useMemo<BackgroundTaskLifecycleIndex>(() => {
    const cache = lifecycleCacheRef.current;
    if (
      cache &&
      cache.toolEventsByIndex.length === messages.length &&
      messages.every((message, index) => {
        const prior = cache.toolEventsByIndex[index];
        return (
          prior === message.toolEvents ||
          (prior?.length === 0 && message.toolEvents.length === 0)
        );
      })
    ) {
      return cache.result;
    }
    const events: EventRecord[] = [];
    const toolEventsByIndex: Array<readonly EventRecord[]> = [];
    for (const message of messages) {
      toolEventsByIndex.push(message.toolEvents);
      for (const event of message.toolEvents) events.push(event);
    }
    const result = buildBackgroundTaskLifecycleIndex(events);
    lifecycleCacheRef.current = { toolEventsByIndex, result };
    return result;
  }, [messages]);

  /**
   * Per-message projection cache. Finalized messages keep a stable object
   * identity across stream deltas (see `stabilizeMessageList`), so their
   * already-projected rows are reused instead of being re-derived on every
   * streamed delta — only the live overlay (whose identity changes per
   * delta) re-projects. Without this the whole list re-derives each frame,
   * O(messages) work that grows with conversation length.
   *
   * Excluded from the cache: rows carrying a background-work card. Those are
   * mutated in place by the dedup/supersede pass below and their
   * `completedThreadIds` depend on the per-frame completion map, so they are
   * rebuilt every frame (they are rare — only turns that spawned agents).
   *
   * Keyed by message identity and invalidated wholesale when the
   * developer-resource-preview flag flips (the only non-message-intrinsic
   * input to a row's content; the per-frame completion map only feeds the
   * uncached background-work rows).
   */
  const projectionCacheRef = useRef<{
    devFlag: boolean;
    byMessage: WeakMap<
      MessageRecord,
      { rows: EventRowViewModel[]; indexWithinTurn: number }
    >;
  }>({
    devFlag: developerResourcePreviewsEnabled,
    byMessage: new WeakMap(),
  });

  const allRows = useMemo<EventRowViewModel[]>(() => {
    const computed: EventRowViewModel[] = [];
    const assistantCountByUserMessageId = new Map<string, number>();

    const buildBackgroundWorks = (toolEvents: readonly EventRecord[]) =>
      getBackgroundWorks(toolEvents).map((base) => ({
        ...base,
        ...resolveBackgroundTaskCardLifecycle(
          base.threadIds,
          base.startEventIdsByThread,
          lifecycleIndex,
        ),
      }));

    const pushAdditionalBackgroundWorkRows = (
      produced: EventRowViewModel[],
      works: ReturnType<typeof buildBackgroundWorks>,
      baseId: string,
      replyToUserMessageId?: string,
    ) => {
      for (let index = 1; index < works.length; index += 1) {
        const backgroundWork = works[index];
        if (!backgroundWork) continue;
        const id = `${baseId}:agent-activity:${backgroundWork.cardId}`;
        produced.push({
          kind: "assistant",
          id,
          text: "",
          cacheKey: id,
          ...(replyToUserMessageId ? { replyToUserMessageId } : {}),
          backgroundWork,
        });
      }
    };

    const projectionCache = projectionCacheRef.current;
    if (projectionCache.devFlag !== developerResourcePreviewsEnabled) {
      projectionCache.devFlag = developerResourcePreviewsEnabled;
      projectionCache.byMessage = new WeakMap();
    }
    const cacheByMessage = projectionCache.byMessage;

    for (const message of displayMessages) {
      let indexWithinTurn = -1;
      let assistantReplyId: string | undefined;
      if (isAssistantMessage(message)) {
        const indexPayload = getMessagePayload(message);
        assistantReplyId =
          typeof indexPayload?.userMessageId === "string" &&
          indexPayload.userMessageId.length > 0
            ? indexPayload.userMessageId
            : undefined;
        if (assistantReplyId !== undefined) {
          indexWithinTurn =
            (assistantCountByUserMessageId.get(assistantReplyId) ?? 0) + 1;
          assistantCountByUserMessageId.set(assistantReplyId, indexWithinTurn);
        }
      }

      const cachedProjection = cacheByMessage.get(message);
      if (
        cachedProjection &&
        cachedProjection.indexWithinTurn === indexWithinTurn
      ) {
        for (const cachedRow of cachedProjection.rows) computed.push(cachedRow);
        continue;
      }

      const produced: EventRowViewModel[] = [];

      if (isUserMessage(message)) {
        const contextMetadata = getMessagePayload(message)?.metadata?.context;
        const windowLabel =
          typeof contextMetadata?.windowLabel === "string" &&
          contextMetadata.windowLabel.trim()
            ? contextMetadata.windowLabel.trim()
            : undefined;
        const windowPreviewImageUrl =
          typeof contextMetadata?.windowPreviewImageUrl === "string" &&
          contextMetadata.windowPreviewImageUrl.trim()
            ? contextMetadata.windowPreviewImageUrl.trim()
            : undefined;
        // Prefer the per-selection list; older messages persisted a
        // single (possibly joined) label.
        const appSelectionLabels = (() => {
          const plural = Array.isArray(contextMetadata?.appSelectionLabels)
            ? contextMetadata.appSelectionLabels
                .filter((label): label is string => typeof label === "string")
                .map((label) => label.trim())
                .filter((label) => label.length > 0)
            : [];
          if (plural.length > 0) return plural;
          const singular =
            typeof contextMetadata?.appSelectionLabel === "string" &&
            contextMetadata.appSelectionLabel.trim()
              ? contextMetadata.appSelectionLabel.trim()
              : undefined;
          return singular ? [singular] : [];
        })();
        const activityLabel =
          typeof contextMetadata?.activityLabel === "string" &&
          contextMetadata.activityLabel.trim()
            ? contextMetadata.activityLabel.trim()
            : undefined;
        const pastedTexts =
          Array.isArray(contextMetadata?.pastedTexts) &&
          contextMetadata.pastedTexts.length > 0
            ? contextMetadata.pastedTexts
            : undefined;
        const quotedText =
          typeof contextMetadata?.quotedText === "string" &&
          contextMetadata.quotedText.trim()
            ? contextMetadata.quotedText.trim()
            : undefined;
        const messageReaction = readMessageReaction(message.payload);
        const userSpawnedThreadIds = getSpawnedThreadIds(message.toolEvents);
        const userSpawnedDescriptions = getSpawnedDescriptions(message.toolEvents);
        const row: UserRowViewModel = {
          kind: "user",
          id: message._id,
          text: getDisplayUserText(message),
          timestampMs: message.timestamp,
          ...(isUiHiddenChatMessagePayload(message.payload ?? null)
            ? { hidden: true }
            : {}),
          ...(userSpawnedThreadIds.length > 0
            ? { spawnedThreadIds: userSpawnedThreadIds }
            : {}),
          ...(userSpawnedDescriptions.length > 0
            ? { spawnedDescriptions: userSpawnedDescriptions }
            : {}),
          ...(windowLabel ? { windowLabel } : {}),
          ...(windowPreviewImageUrl ? { windowPreviewImageUrl } : {}),
          ...(appSelectionLabels.length > 0 ? { appSelectionLabels } : {}),
          ...(activityLabel ? { activityLabel } : {}),
          ...(pastedTexts ? { pastedTexts } : {}),
          ...(quotedText ? { quotedText } : {}),
          ...(messageReaction
            ? { reaction: messageReaction.emoji, reactionAt: messageReaction.at }
            : {}),
          attachments: getAttachments(message),
          ...(getChannelEnvelope(message)
            ? { channelEnvelope: getChannelEnvelope(message) }
            : {}),
        };
        produced.push(row);
        const userBackgroundWorks = buildBackgroundWorks(message.toolEvents);
        const userBackgroundWork = userBackgroundWorks[0];
        if (userBackgroundWork) {
          const activityKey = `assistant-agent-activity-${message._id}`;
          produced.push({
            kind: "assistant",
            id: activityKey,
            text: "",
            cacheKey: activityKey,
            replyToUserMessageId: message._id,
            backgroundWork: userBackgroundWork,
            sourceMessageId: message._id,
            ...(typeof message.sequence === "number"
              ? { sourceMessageSequence: message.sequence }
              : {}),
            ...(message.toolEventSummary
              ? { toolEventSummary: message.toolEventSummary }
              : {}),
          });
          pushAdditionalBackgroundWorkRows(
            produced,
            userBackgroundWorks,
            activityKey,
            message._id,
          );
        }
      } else if (isAssistantMessage(message)) {
        const text = getDisplayMessageText(message);
        const payload = getMessagePayload(message);
        const replyToUserMessageId = assistantReplyId;
        const runtimeMetadata = (
          payload?.metadata as
            | {
                runtime?: {
                  responseTarget?: AgentResponseTarget;
                  replyRefs?: unknown;
                  followedByToolCall?: boolean;
                  turnComplete?: boolean;
                };
              }
            | undefined
        )?.runtime;
        const responseTarget = runtimeMetadata?.responseTarget;
        const replyRefs = parseReplyRefs(runtimeMetadata?.replyRefs);
        const stableKey =
          replyToUserMessageId !== undefined
            ? assistantScrollFollowKey(replyToUserMessageId, indexWithinTurn)
            : message._id;
        const toolEvents = message.toolEvents;
        const ownToolEvents = toolEvents.filter(isOwnTurnToolEvent);
        const resourcePayload = deriveTurnResource(
          ownToolEvents,
          text,
          getCwd(ownToolEvents),
          { developerResourcesEnabled: developerResourcePreviewsEnabled },
        );
        const inlineImagePayloads = deriveTurnInlineImagePayloads(ownToolEvents);
        const mapArtifacts = deriveTurnMapArtifacts(toolEvents);
        const askRecords = deriveTurnAskRecords(toolEvents);
        const sourceDiffPayloads = collectTurnSourceDiffPayloads(ownToolEvents, {
          developerResourcesEnabled: developerResourcePreviewsEnabled,
          assistantText: text,
        });
        const officePreviewRef = getOfficePreviewRef(ownToolEvents);
        const voiceSession = payload?.metadata?.voiceSession;
        const reminder = parseReminderMark(payload?.metadata?.reminder);
        const scheduleNotice = parseScheduleNoticeCard(payload?.metadata?.scheduleNotice);
        const backgroundWorks = buildBackgroundWorks(toolEvents);
        const backgroundWork = backgroundWorks[0];
        const spawnedThreadIds = getSpawnedThreadIds(toolEvents);
        const spawnedDescriptions = getSpawnedDescriptions(toolEvents);
        const agentCompletionSections = projectAgentCompletionSections(
          toolEvents,
          lifecycleIndex,
        );
        const linkedFiles = deriveLinkedFiles(text, message.timestamp);
        const isIntraTurn = isIntraTurnAssistantRuntime(runtimeMetadata);
        const row: AssistantRowViewModel = {
          kind: "assistant",
          id: stableKey,
          text: voiceSession ? "" : text,
          timestampMs: message.timestamp,
          cacheKey: stableKey,
          sourceMessageId: message._id,
          ...(typeof message.sequence === "number"
            ? { sourceMessageSequence: message.sequence }
            : {}),
          ...(message.toolEventSummary
            ? { toolEventSummary: message.toolEventSummary }
            : {}),
          ...(isIntraTurn ? { isIntraTurn: true } : {}),
          ...(responseTarget ? { responseTarget } : {}),
          ...(replyRefs.length > 0 ? { replyRefs } : {}),
          ...(replyToUserMessageId ? { replyToUserMessageId } : {}),
          ...(officePreviewRef ? { officePreviewRef } : {}),
          ...(linkedFiles.length > 0 ? { linkedFiles } : {}),
          ...(resourcePayload ? { resourcePayload } : {}),
          ...(inlineImagePayloads.length > 0 ? { inlineImagePayloads } : {}),
          ...(mapArtifacts.length > 0 ? { mapArtifacts } : {}),
          ...(askRecords.length > 0 ? { askRecords } : {}),
          ...(sourceDiffPayloads.length > 0 ? { sourceDiffPayloads } : {}),
          ...(voiceSession ? { voiceSession } : {}),
          ...(reminder ? { reminder } : {}),
          ...(scheduleNotice ? { scheduleNotice } : {}),
          ...(backgroundWork ? { backgroundWork } : {}),
          ...(spawnedThreadIds.length > 0 ? { spawnedThreadIds } : {}),
          ...(spawnedDescriptions.length > 0 ? { spawnedDescriptions } : {}),
          ...(agentCompletionSections.length > 0
            ? { agentCompletion: { sections: agentCompletionSections } }
            : {}),
        };
        produced.push(row);
        pushAdditionalBackgroundWorkRows(
          produced,
          backgroundWorks,
          stableKey,
          replyToUserMessageId,
        );
      }

      // Cache the projection for reuse on the next delta, EXCEPT rows that
      // carry an agent activity card: those are mutated by the dedup passes
      // below and depend on per-frame cross-row lifecycle state, so they must be rebuilt
      // each frame. Everything else is a pure function of the (stable)
      // message identity + dev flag.
      const hasAgentActivityCard = produced.some(
        (producedRow) =>
          producedRow.kind === "assistant" &&
          (Boolean(producedRow.backgroundWork) ||
            (producedRow.agentCompletion?.sections.length ?? 0) > 0),
      );
      if (hasAgentActivityCard) {
        cacheByMessage.delete(message);
      } else {
        cacheByMessage.set(message, { rows: produced, indexWithinTurn });
      }
      for (const producedRow of produced) computed.push(producedRow);
    }

    // Reconcile a thread that surfaces on more than one row. Exact duplicate
    // copies share the canonical `agent-started` event id. A different start
    // id is a genuine later activation of the durable thread.
    //
    //  - Follow-up while active: the newer card replaces the predecessor.
    //    There is no synthetic completed breadcrumb for the interrupted
    //    occurrence; only the current follow-up remains visible.
    //
    //  - Follow-up after settlement: both cards remain. The predecessor keeps
    //    its real terminal state/prose and the follow-up owns its own status.
    //
    //  - Exact duplicate: the SAME `agent-started` event (identical
    //    `spawnedAtMs`) projected onto two rows — e.g. a fire-and-forget
    //    spawn briefly anchored on both the user-message fallback row and the
    //    assistant row during the SQLite/stream handoff. Rendering both draws
    //    two identical "Started in background" receipts, so the redundant
    //    (non-canonical) copy drops the thread entirely. One spawn = one card.
    const latestOwnerByThread = new Map<string, number>();
    computed.forEach((row, index) => {
      if (row.kind !== "assistant" || !row.backgroundWork) return;
      for (const id of row.backgroundWork.threadIds) {
        latestOwnerByThread.set(id, index);
      }
    });
    const ownerBackgroundWorkForThread = (id: string) => {
      const ownerIndex = latestOwnerByThread.get(id);
      if (ownerIndex === undefined) return undefined;
      const owner = computed[ownerIndex];
      if (owner?.kind !== "assistant" || !owner.backgroundWork)
        return undefined;
      return owner.backgroundWork;
    };
    const droppedRowIndices = new Set<number>();
    computed.forEach((row, index) => {
      if (row.kind !== "assistant" || !row.backgroundWork) return;
      const superseded: string[] = [];
      const duplicated = new Set<string>();
      const replaced = new Set<string>();
      for (const id of row.backgroundWork.threadIds) {
        if (latestOwnerByThread.get(id) === index) continue;
        const owner = ownerBackgroundWorkForThread(id);
        const ownerStartEventId = owner?.startEventIdsByThread[id];
        const selfStartEventId = row.backgroundWork.startEventIdsByThread[id];
        if (
          ownerStartEventId !== undefined &&
          selfStartEventId === ownerStartEventId
        ) {
          duplicated.add(id);
        } else if (
          ownerStartEventId &&
          selfStartEventId &&
          owner?.followUpThreadIds?.includes(id) &&
          followUpReplacesActivePredecessor(
            selfStartEventId,
            ownerStartEventId,
            lifecycleIndex,
          )
        ) {
          replaced.add(id);
        } else if (owner?.followUpThreadIds?.includes(id)) {
          superseded.push(id);
        } else {
          superseded.push(id);
        }
      }
      const removed = new Set([...duplicated, ...replaced]);
      if (removed.size === 0) {
        if (superseded.length > 0) {
          row.backgroundWork = {
            ...row.backgroundWork,
            supersededThreadIds: superseded,
          };
        }
        return;
      }
      const remainingThreadIds = row.backgroundWork.threadIds.filter(
        (id) => !removed.has(id),
      );
      if (remainingThreadIds.length === 0) {
        if (assistantRowHasNonBackgroundContent(row)) {
          const { backgroundWork: _omit, ...rest } = row;
          computed[index] = rest;
        } else {
          // Synthetic card-only row whose sole receipt was duplicated or
          // replaced by an in-flight follow-up — keep only the current card.
          droppedRowIndices.add(index);
        }
        return;
      }
      const descriptions = { ...row.backgroundWork.descriptions };
      const spawnedAtMs = { ...(row.backgroundWork.spawnedAtMs ?? {}) };
      const statusTexts = { ...(row.backgroundWork.statusTexts ?? {}) };
      const progressTexts = { ...(row.backgroundWork.progressTexts ?? {}) };
      const startEventIdsByThread = {
        ...row.backgroundWork.startEventIdsByThread,
      };
      const attemptGenerationsByThread = {
        ...(row.backgroundWork.attemptGenerationsByThread ?? {}),
      };
      const rootRunIdsByThread = { ...row.backgroundWork.rootRunIdsByThread };
      const terminalEventIdsByThread = {
        ...(row.backgroundWork.terminalEventIdsByThread ?? {}),
      };
      for (const id of removed) {
        delete descriptions[id];
        delete spawnedAtMs[id];
        delete statusTexts[id];
        delete progressTexts[id];
        delete startEventIdsByThread[id];
        delete attemptGenerationsByThread[id];
        delete rootRunIdsByThread[id];
        delete terminalEventIdsByThread[id];
      }
      const remainingSuperseded = superseded.filter((id) =>
        remainingThreadIds.includes(id),
      );
      const followUpThreadIds = (
        row.backgroundWork.followUpThreadIds ?? []
      ).filter((id) => !removed.has(id));
      row.backgroundWork = {
        ...row.backgroundWork,
        threadIds: remainingThreadIds,
        completedThreadIds: row.backgroundWork.completedThreadIds.filter(
          (id) => !removed.has(id),
        ),
        ...(row.backgroundWork.stoppedThreadIds
          ? {
              stoppedThreadIds: row.backgroundWork.stoppedThreadIds.filter(
                (id) => !removed.has(id),
              ),
            }
          : {}),
        ...(row.backgroundWork.failedThreadIds
          ? {
              failedThreadIds: row.backgroundWork.failedThreadIds.filter(
                (id) => !removed.has(id),
              ),
            }
          : {}),
        descriptions,
        spawnedAtMs,
        statusTexts,
        progressTexts,
        startEventIdsByThread,
        attemptGenerationsByThread,
        rootRunIdsByThread,
        terminalEventIdsByThread,
        completionSections: (
          row.backgroundWork.completionSections ?? []
        ).filter(
          (section) =>
            !section.startEventId ||
            !removed.has(section.agentId) ||
            startEventIdsByThread[section.agentId] === section.startEventId,
        ),
        cardId: `agent-activity:${remainingThreadIds
          .map((id) => startEventIdsByThread[id])
          .filter(Boolean)
          .join("+")}`,
        followUpThreadIds,
        ...(remainingSuperseded.length > 0
          ? { supersededThreadIds: remainingSuperseded }
          : {}),
      };
    });

    dedupeAgentCompletionRows(computed, droppedRowIndices);

    const deduped =
      droppedRowIndices.size > 0
        ? computed.filter((_, index) => !droppedRowIndices.has(index))
        : computed;

    return withReplyContext(
      coalesceVoiceSessionRows(coalesceInlineImageRows(deduped)),
      { agentTitles, agentParents },
    );
  }, [agentParents, agentTitles, developerResourcePreviewsEnabled, displayMessages, lifecycleIndex]);

  const rowsStableRef = useRef<StableTurnRowsState<EventRowViewModel> | null>(
    null,
  );

  const stableRowsState = useMemo(
    () => stabilizeTurnRows(allRows, rowsStableRef.current, eventRowEqual),
    [allRows],
  );

  useLayoutEffect(() => {
    rowsStableRef.current = stableRowsState;
  }, [stableRowsState]);

  const stableRows = stableRowsState.result;

  const slicedRows = useMemo(() => {
    if (typeof maxItems !== "number") return stableRows;
    const cap = Math.max(0, Math.floor(maxItems));
    if (cap <= 0) return [];
    if (stableRows.length <= cap) return stableRows;
    return stableRows.slice(stableRows.length - cap);
  }, [maxItems, stableRows]);

  return {
    rows: slicedRows,
  };
}
