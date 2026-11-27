import { journalLifecycleEvent } from "./journal-activity-files";
import { userMessageEventId } from "./sent-message-ids";
import type {
  Attachment,
  EventRecord,
  MessageRecord,
} from "@stella/contracts/local-chat";
import { isPiAgentText, isPiAskFirstText } from "@stella/contracts/pi-chat";
import { parseReminderCard, reminderMarkOf } from "@stella/contracts/reminders";
import { parseWelcomeCard, WELCOME_TEXT, welcomeMarkOf } from "@stella/contracts/welcome-message";
import { parseScheduleNoticeCard } from "@stella/contracts/schedule-notice";
import { parseEmailCard } from "@stella/contracts/email-card";
import { parseViewCard, viewCardToolEvents } from "@stella/contracts/view-card";
import {
  parseSafeguardCard,
  safeguardCardLabel,
  withoutSafeguardRemoved,
} from "@stella/contracts/safeguard-block";
import { journalAgentTitles } from "@stella/contracts/agent-titles";
import { withCodeShownCalls } from "@stella/contracts/code-nested-tools";
import {
  agentToolResultThreadId,
  bareToolName,
} from "@stella/contracts/conversation-agent-activity";
import { assistantOwnerId, placeInConversation } from "@/features/chat/lib/message-order";
import { groupEventsIntoMessages } from "@/features/chat/lib/group-events-into-messages";
import {
  journalUserMessage,
  type JournalUserMessage,
} from "@stella/contracts/journal-user-message";
import { driveAttachmentRef } from "./drive-attachment-previews";
import {
  messageText,
  type JournalMessageRecord,
  type JournalRecord,
} from "@stella/contracts/conversation-protocol";
import {
  journalMessageTimestamp,
  journalTerminalNotice,
  journalMirroredWake,
  journalTurnSeq,
  journalUserReactions,
  resolveJournalReplyRefs,
} from "@stella/contracts/conversation-journal-projection";
import { splitMessageReplyRefs, type ReplyRef } from "@stella/contracts/reply-refs";

const userEventId = userMessageEventId;

const messageEventId = (record: JournalMessageRecord): string =>
  record.role === "user"
    ? userEventId(record)
    : `cloud:${record.turnId}:message:${record.seq}`;

const lifecycleAgentIdsOnTurn = (
  turnRecords: readonly JournalRecord[],
): Set<string> => {
  const ids = new Set<string>();
  for (const record of turnRecords) {
    if (record.kind === "card" && record.card.type === "agent-lifecycle") {
      ids.add(record.card.event.payload.agentId);
    }
  }
  return ids;
};

const startCardedAgentIds = (
  turns: ReadonlyMap<string, readonly JournalRecord[]>,
): Set<string> => {
  const ids = new Set<string>();
  for (const turnRecords of turns.values()) {
    if (!turnRecords.some((record) => record.kind === "message")) continue;
    for (const record of turnRecords) {
      if (
        record.kind === "card" &&
        record.card.type === "agent-lifecycle" &&
        record.card.event.type === "agent-started"
      ) {
        ids.add(record.card.event.payload.agentId);
      }
    }
  }
  return ids;
};

const spawnResultThreadId = (
  record: JournalMessageRecord,
): string | null =>
  record.role === "toolResult" &&
  typeof record.payload.toolName === "string" &&
  bareToolName(record.payload.toolName) === "spawn_agent"
    ? agentToolResultThreadId(record.payload)
    : null;

const mirroredLifecycleEvents = (
  turnId: string,
  turnRecords: readonly JournalRecord[],
  startCarded: ReadonlySet<string>,
): { spawns: Map<number, EventRecord>; wake: EventRecord | null } => {
  const carded = new Set([...lifecycleAgentIdsOnTurn(turnRecords), ...startCarded]);
  const descriptionsByCall = new Map<string, string>();
  for (const record of turnRecords) {
    if (record.kind !== "message" || record.role !== "assistant") continue;
    for (const block of contentBlocks(record.payload)) {
      if (block.type !== "toolCall" || block.name !== "spawn_agent") continue;
      const description = asRecord(block.arguments)?.description;
      if (typeof block.id === "string" && typeof description === "string") {
        descriptionsByCall.set(block.id, description.trim());
      }
    }
  }
  const spawns = new Map<number, EventRecord>();
  const mirroredWake = journalMirroredWake(turnRecords);
  let wake: EventRecord | null = null;
  if (mirroredWake) {
    const { record, outcome } = mirroredWake;
    const timestamp = journalMessageTimestamp(record);
    const base = {
      agentId: mirroredWake.threadId,
      ...(mirroredWake.description ? { description: mirroredWake.description } : {}),
    };
    wake =
      outcome.kind === "completed"
        ? {
            _id: `cloud:${turnId}:wake:${record.seq}:agent-completed`,
            timestamp,
            type: "agent-completed",
            payload: { ...base, result: outcome.body },
          }
        : {
            _id: `cloud:${turnId}:wake:${record.seq}:agent-${outcome.kind}`,
            timestamp,
            type: outcome.kind === "failed" ? "agent-failed" : "agent-canceled",
            payload: {
              ...base,
              ...(outcome.body ? { error: outcome.body } : {}),
            },
          };
  }
  const prompt = turnRecords.find(
    (record): record is JournalMessageRecord =>
      record.kind === "message" && record.role === "user",
  );
  for (const record of turnRecords) {
    if (record.kind !== "message") continue;
    const timestamp = journalMessageTimestamp(record, prompt);
    if (record.role === "user" && record.hidden) continue;
    const threadId = spawnResultThreadId(record);
    if (!threadId || carded.has(threadId)) continue;
    const callId =
      typeof record.payload.toolCallId === "string" ? record.payload.toolCallId : "";
    const description =
      descriptionsByCall.get(callId) ??
      (() => {
        const details = asRecord(record.payload.details);
        return typeof details?.description === "string" ? details.description : "";
      })();
    spawns.set(record.seq, {
      _id: `cloud:${turnId}:tool-result:${record.seq}:agent-started`,
      timestamp: timestamp + 1,
      type: "agent-started",
      payload: {
        agentId: threadId,
        description,
        agentType: "general",
      },
    });
  }
  return { spawns, wake };
};

type AgentMessagePayload = Record<string, unknown>;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const contentBlocks = (
  payload: AgentMessagePayload,
): Array<Record<string, unknown>> =>
  Array.isArray(payload.content)
    ? payload.content
        .map(asRecord)
        .filter((entry): entry is Record<string, unknown> => entry !== null)
    : [];

const userAttachments = (message: JournalUserMessage): Attachment[] => [
  ...message.inlineImages.map((image) => ({
    url: `data:${image.mimeType};base64,${image.data}`,
    mimeType: image.mimeType,
  })),
  ...message.declaredFiles.map(
    (file): Attachment => ({
      kind: "file",
      ...(file.name ? { name: file.name } : {}),
      ...(file.mimeType ? { mimeType: file.mimeType } : {}),
      ...(file.size !== undefined ? { size: file.size } : {}),
      ...(file.path ? { path: file.path, url: file.path } : {}),
    }),
  ),
  ...message.drivePaths.map(driveAttachmentRef),
];

const textPayload = (
  record: Extract<JournalRecord, { kind: "message" }>,
  text: string,
  userMessageId?: string,
  replyRefs?: ReplyRef[],
  followedByToolCall?: boolean,
): Record<string, unknown> => {
  const voiceSession = asRecord(record.payload.voiceSession);
  const reminder = asRecord(record.payload.reminder);
  const displayContext =
    record.role === "user"
      ? journalUserMessage(record.payload).displayContext
      : undefined;
  const metadata = {
    ...(record.hidden ? { ui: { visibility: "hidden" as const } } : {}),
    ...(displayContext ? { context: displayContext } : {}),
    ...(voiceSession ? { voiceSession } : {}),
    ...(reminder ? { reminder } : {}),
    ...((replyRefs && replyRefs.length > 0) || followedByToolCall
      ? {
          runtime: {
            ...(replyRefs && replyRefs.length > 0 ? { replyRefs } : {}),
            ...(followedByToolCall ? { followedByToolCall: true } : {}),
          },
        }
      : {}),
  };
  return {
    text,
    ...(record.role === "user" && typeof record.payload.originUserMessageId === "string"
      ? { originUserMessageId: record.payload.originUserMessageId } : {}),
    ...(userMessageId ? { userMessageId } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    ...(typeof record.payload.source === "string"
      ? { source: record.payload.source }
      : {}),
    ...(asRecord(record.payload.usage) ? { usage: record.payload.usage } : {}),
  };
};

export const activeCloudUserMessageIds = (
  records: readonly JournalRecord[],
): Set<string> => {
  const turns = new Map<
    string,
    { phase: string | null; userMessageId: string | null }
  >();
  for (const record of records) {
    const turn = turns.get(record.turnId) ?? {
      phase: null,
      userMessageId: null,
    };
    if (record.kind === "turn") turn.phase = record.phase;
    if (record.kind === "message" && record.role === "user") {
      turn.userMessageId = userEventId(record);
    }
    turns.set(record.turnId, turn);
  }
  return new Set(
    [...turns.values()]
      .filter(
        (turn): turn is { phase: "started"; userMessageId: string } =>
          turn.phase === "started" && turn.userMessageId !== null,
      )
      .map((turn) => turn.userMessageId),
  );
};

const terminalNoticeEvent = (
  turnId: string,
  turnRecords: readonly JournalRecord[],
  userMessageId: string | undefined,
): EventRecord | null => {
  const terminal = journalTerminalNotice(turnRecords);
  if (!terminal) return null;
  return {
    _id: `cloud:${turnId}:notice:${terminal.seq}`,
    timestamp: terminal.createdAtMs,
    sequence: terminal.seq,
    type: "assistant_message",
    payload: {
      text: terminal.notice,
      ...(userMessageId ? { userMessageId } : {}),
      source: "cloud-turn-notice",
    },
  };
};

export const journalRecordsToMessageRecords = (
  journaled: readonly JournalRecord[],
): MessageRecord[] => {
  const records = withCodeShownCalls(withoutSafeguardRemoved(journaled));
  const byTurn = new Map<string, JournalRecord[]>();
  const recordsBySeq = new Map<number, JournalMessageRecord>();
  const agentTitles = journalAgentTitles(records);
  const reactions = journalUserReactions(records);
  for (const record of records) {
    const turn = byTurn.get(record.turnId);
    if (turn) turn.push(record);
    else byTurn.set(record.turnId, [record]);
    if (record.kind === "message") recordsBySeq.set(record.seq, record);
  }
  const startCarded = startCardedAgentIds(byTurn);

  const messages: MessageRecord[] = [];
  const turnsInOrder = [...byTurn].sort(
    ([, left], [, right]) => journalTurnSeq(left) - journalTurnSeq(right),
  );
  for (const [turnId, turnRecords] of turnsInOrder) {
    const events: EventRecord[] = [];
    let userMessageId: string | undefined;
    let turnUserRecord: JournalMessageRecord | undefined;
    let quiet = false;
    const mirrored = mirroredLifecycleEvents(turnId, turnRecords, startCarded);
    const promptAhead = turnRecords.some(
      (record) => record.kind === "message" && record.role === "user",
    );
    const beforePrompt: EventRecord[] = [];
    let viewRowOpened = false;

    for (const record of turnRecords) {
      const lifecycle = journalLifecycleEvent(record);
      if (lifecycle) {
        if (promptAhead && !turnUserRecord) beforePrompt.push(lifecycle);
        else events.push(lifecycle);
        continue;
      }
      const reminder = record.kind === "card" ? parseReminderCard(record.card) : null;
      if (reminder) {
        events.push({
          _id: `cloud:${turnId}:reminder:${record.seq}`,
          timestamp: record.createdAtMs,
          sequence: record.seq,
          type: "assistant_message",
          payload: {
            text: reminder.text,
            metadata: { reminder: reminderMarkOf(reminder) },
          },
        });
        continue;
      }
      const welcome = record.kind === "card" ? parseWelcomeCard(record.card) : null;
      if (welcome) {
        events.push({
          _id: `cloud:${turnId}:welcome:${record.seq}`,
          timestamp: record.createdAtMs,
          sequence: record.seq,
          type: "assistant_message",
          payload: { text: WELCOME_TEXT, metadata: { welcome: welcomeMarkOf(welcome) } },
        });
        continue;
      }
      const scheduleNotice = record.kind === "card" ? parseScheduleNoticeCard(record.card) : null;
      if (scheduleNotice) {
        events.push({
          _id: `cloud:${turnId}:schedule-notice:${record.seq}`,
          timestamp: record.createdAtMs,
          sequence: record.seq,
          type: "assistant_message",
          payload: { text: "", metadata: { scheduleNotice } },
        });
        continue;
      }
      if (record.kind === "card" && parseEmailCard(record.card)) continue;
      // A task's view: its own row (one per task and view), carrying each version as the `view`
      // call and result Stella's own views make, so every surface shows it the same way.
      const viewCard = record.kind === "card" ? parseViewCard(record.card) : null;
      if (viewCard) {
        if (!viewRowOpened) {
          viewRowOpened = true;
          events.push({
            _id: `cloud:${turnId}:view:${record.seq}`,
            timestamp: record.createdAtMs,
            sequence: record.seq,
            type: "assistant_message",
            payload: { text: "", source: "view-card" },
          });
        }
        const requestId = `cloud:${turnId}:view-call:${record.seq}`;
        const { call, result } = viewCardToolEvents(viewCard);
        events.push({
          _id: `cloud:${turnId}:view-request:${record.seq}`,
          timestamp: record.createdAtMs,
          type: "tool_request",
          requestId,
          payload: call,
        });
        events.push({
          _id: `cloud:${turnId}:view-result:${record.seq}`,
          timestamp: record.createdAtMs,
          type: "tool_result",
          requestId,
          payload: { ...result, result: result.details, ...result.details },
        });
        continue;
      }
      const safeguard = record.kind === "card" ? parseSafeguardCard(record.card) : null;
      const safeguardLabel = safeguard ? safeguardCardLabel(safeguard) : null;
      if (safeguardLabel) {
        events.push({
          _id: `cloud:${turnId}:safeguard:${record.seq}`,
          timestamp: record.createdAtMs,
          sequence: record.seq,
          type: "assistant_message",
          payload: { text: safeguardLabel, source: "cloud-turn-notice" },
        });
        continue;
      }
      if (record.kind !== "message") continue;
      const timestamp = journalMessageTimestamp(record, turnUserRecord);
      if (record.role === "user") {
        turnUserRecord = record;
        userMessageId = userEventId(record);
        const message = journalUserMessage(record.payload);
        const userText = message.text;
        const attachments = userAttachments(message);
        const blank = message.blank;
        const unshown = blank || isPiAgentText(userText);
        quiet = isPiAskFirstText(userText);
        const reaction = reactions.get(record.seq);
        events.push({
          _id: userMessageId,
          timestamp,
          sequence: record.seq,
          type: "user_message",
          payload: {
            ...textPayload(
              unshown && !record.hidden ? { ...record, hidden: true } : record,
              userText,
            ),
            ...(attachments.length > 0 ? { attachments } : {}),
            ...(reaction ? { reaction } : {}),
          },
        });
        if (mirrored.wake) events.push(mirrored.wake);
        events.push(...beforePrompt.splice(0));
        continue;
      }
      if (quiet) continue;

      if (record.role === "assistant") {
        const { text, refs } = splitMessageReplyRefs(record.payload);
        const followedByToolCall =
          record.payload.followedByToolCall === true ||
          contentBlocks(record.payload).some((block) => block.type === "toolCall");
        if (text) {
          events.push({
            _id: `cloud:${turnId}:message:${record.seq}`,
            timestamp,
            sequence: record.seq,
            type: "assistant_message",
            payload: textPayload(
              record,
              text,
              userMessageId,
              resolveJournalReplyRefs({
                raw: refs,
                recordsBySeq,
                turnUserRecord,
                agentTitles,
                messageId: messageEventId,
              }),
              followedByToolCall,
            ),
          });
        }
        for (const [index, block] of contentBlocks(record.payload).entries()) {
          if (block.type !== "toolCall") continue;
          const toolCallId =
            typeof block.id === "string" && block.id
              ? block.id
              : `cloud:${turnId}:tool:${record.seq}:${index}`;
          const toolName =
            typeof block.name === "string" && block.name ? block.name : "tool";
          events.push({
            _id: `cloud:${turnId}:tool-request:${record.seq}:${index}`,
            timestamp: timestamp + index + 1,
            type: "tool_request",
            requestId: toolCallId,
            payload: {
              toolName,
              ...(asRecord(block.arguments)
                ? { args: block.arguments as Record<string, unknown> }
                : {}),
            },
          });
        }
        continue;
      }

      const toolCallId =
        typeof record.payload.toolCallId === "string"
          ? record.payload.toolCallId
          : `cloud:${turnId}:tool-result:${record.seq}`;
      const toolName =
        typeof record.payload.toolName === "string"
          ? record.payload.toolName
          : "tool";
      const resultText = messageText(record.payload);
      const details = asRecord(record.payload.details);
      const shownIn = record.payload.shownIn;
      events.push({
        _id:
          typeof shownIn === "string"
            ? `cloud:${turnId}:tool-result:${record.seq}:${toolCallId}`
            : `cloud:${turnId}:tool-result:${record.seq}`,
        timestamp,
        type: "tool_result",
        requestId: toolCallId,
        payload: {
          toolName,
          agentType: "orchestrator",
          result: details ?? resultText,
          resultPreview: resultText,
          ...(details ?? {}),
          ...(record.payload.isError === true
            ? { error: resultText || "Tool failed." }
            : {}),
        },
      });
      const spawn = mirrored.spawns.get(record.seq);
      if (spawn) events.push(spawn);
    }
    const notice = terminalNoticeEvent(turnId, turnRecords, userMessageId);
    if (notice) events.push(notice);
    messages.push(...groupEventsIntoMessages(events));
  }
  return messages;
};

export const withoutSequence = ({
  sequence: _otherLogSequence,
  ...message
}: MessageRecord): MessageRecord => message;

export const mergeCanonicalMessagesWithLocalCache = (
  canonical: readonly MessageRecord[],
  local: readonly MessageRecord[],
  activeUserMessageIds: ReadonlySet<string> = new Set(),
): MessageRecord[] => {
  if (local.length === 0) return [...canonical];

  const canonicalIds = new Set(canonical.map((message) => message._id));
  const canonicalAssistantCounts = new Map<string, number>();
  for (const message of canonical) {
    const owner = assistantOwnerId(message);
    if (!owner) continue;
    canonicalAssistantCounts.set(
      owner,
      (canonicalAssistantCounts.get(owner) ?? 0) + 1,
    );
  }

  const localAssistantOrdinals = new Map<string, number>();
  const unacknowledged = local.filter((message) => {
    if (canonicalIds.has(message._id)) return false;
    const owner = assistantOwnerId(message);
    if (message.payload?.source === "cloud-sync-error") {
      return owner !== undefined && canonicalIds.has(owner);
    }
    if (!owner) return activeUserMessageIds.has(message._id);
    if (!activeUserMessageIds.has(owner)) return false;
    const ordinal = (localAssistantOrdinals.get(owner) ?? 0) + 1;
    localAssistantOrdinals.set(owner, ordinal);
    return ordinal > (canonicalAssistantCounts.get(owner) ?? 0);
  });

  return placeInConversation(canonical, unacknowledged.map(withoutSequence));
};
