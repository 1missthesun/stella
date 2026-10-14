import {
  isPiAgentInput,
  piTerminalNotice,
  isPiScheduledInput,
  piJournalUserMessage,
  piMessageText,
  type PiChatState,
  type PiEntry,
} from "@stella/contracts/pi-chat";
import type { EventRecord, MessageRecord } from "@stella/contracts/local-chat";
import type { DesktopThreadActivityRecord } from "@/features/chat/thread-activity-types";
import type { JournalRecord } from "@stella/contracts/conversation-protocol";
import { journalRecordsToMessageRecords } from "@/features/cloud/journal-message-records";

type Turn = {
  userMessageId?: string;
  entryId?: number;
  assistantMessages: number;
  hidden?: true;
};

export type PiTurnIndex = {
  entryId: number;
  userMessageId: string;
  timestamp: number;
  own: boolean;
};

export type PiChatProjection = {
  records: JournalRecord[];
  messages: MessageRecord[];
  turn: Turn;
  turns: PiTurnIndex[];
  rootId: number | null;
};

const writtenIn = (entry: PiEntry): boolean => {
  const data = entry.data as { journalSeq?: unknown; localLog?: unknown } | undefined;
  return typeof data?.journalSeq === "number" || typeof data?.localLog === "string";
};

export const projectPiChat = (state: Pick<PiChatState, "entries" | "requestIds">): PiChatProjection => {
  const records: JournalRecord[] = [];
  let turnId = "pi:0";
  let turn: Turn = { assistantMessages: 0 };
  const turns: PiTurnIndex[] = [];
  let ending: JournalRecord | undefined;
  for (const entry of state.entries) {
    const message = entry.model?.[0];
    if (!message || message.role === "system") continue;
    const base = { seq: entry.id, turnId, createdAtMs: message.timestamp, kind: "message" as const };
    if (entry.kind === "pi.user" && message.role === "user") {
      if (ending) records.push(ending);
      ending = undefined;
      turnId = `pi:${entry.id}`;
      const journaled = piJournalUserMessage(message);
      const clientMsgId = state.requestIds[entry.id] ?? journaled.clientMsgId;
      const { hidden } = journaled;
      const origin = (message as { originUserMessageId?: unknown }).originUserMessageId;
      const payload = {
        ...journaled.message,
        ...(typeof origin === "string" && origin ? { originUserMessageId: origin } : {}),
      };
      const automation = hidden && !isPiAgentInput(message) && !isPiScheduledInput(message);
      turn = {
        userMessageId: clientMsgId ?? `cloud:${turnId}:message:${entry.id}`,
        entryId: entry.id,
        assistantMessages: 0,
        ...(automation ? { hidden: true as const } : {}),
      };
      turns.push({
        entryId: entry.id,
        userMessageId: turn.userMessageId!,
        timestamp: message.timestamp,
        own: !writtenIn(entry),
      });
      records.push({
        ...base,
        turnId,
        role: "user",
        hidden,
        ...(clientMsgId ? { clientMsgId } : {}),
        payload,
      });
    } else if (entry.kind === "pi.assistant" && message.role === "assistant" && message.voiceSession) {
      records.push({ ...base, role: "assistant", hidden: false, payload: message as unknown as Record<string, unknown> });
    } else if (turn.hidden || (message.role === "assistant" && message.stella?.hidden)) {
      continue;
    } else if (message.role === "assistant" && "reminder" in message) {
      continue;
    } else if (entry.kind === "pi.assistant" && message.role === "assistant") {
      records.push({ ...base, role: "assistant", hidden: false, payload: message as unknown as Record<string, unknown> });
      if (piMessageText(message).trim()) turn.assistantMessages += 1;
      const terminal = piTerminalNotice(message);
      ending = terminal
        ? { seq: entry.id, turnId, createdAtMs: message.timestamp, kind: "turn", phase: terminal.phase, notice: terminal.notice }
        : undefined;
    } else if (entry.kind === "pi.tool-result" && message.role === "toolResult") {
      records.push({ ...base, role: "toolResult", hidden: false, payload: message as unknown as Record<string, unknown> });
    }
  }
  if (ending) records.push(ending);
  return {
    records,
    messages: journalRecordsToMessageRecords(records),
    turn,
    turns,
    rootId: state.entries[0]?.conversationId ?? null,
  };
};

export type JournaledPiTurn = {
  userMessageId: string;
  settled: boolean;
};

export const journaledPiTurns = (
  records: readonly JournalRecord[],
  turns: readonly PiTurnIndex[],
  deviceId: string | null,
): Map<number, JournaledPiTurn> => {
  type Found = JournaledPiTurn & { writer: string; entryId: number };
  const found = new Map<string, Found>();
  for (const record of records) {
    let turn = found.get(record.turnId);
    if (!turn) {
      const match = /^(?:desktop|voice):([^:]+):pi:([^:]+):(\d+)$/.exec(record.turnId);
      if (!match) continue;
      turn = { writer: `${match[1]}:${match[2]}`, entryId: Number(match[3]), userMessageId: "", settled: false };
      found.set(record.turnId, turn);
    }
    if (record.kind === "message" && record.role === "user") {
      turn.userMessageId = record.clientMsgId ?? `cloud:${record.turnId}:message:${record.seq}`;
    } else if (record.kind === "turn" && record.phase !== "started") {
      turn.settled = true;
    }
  }
  const own = new Map(turns.filter((turn) => turn.own).map((turn) => [turn.entryId, turn.userMessageId]));
  let writer = [...found.values()].find((turn) => own.get(turn.entryId) === turn.userMessageId)?.writer;
  if (!writer && deviceId) writer = [...found.values()].find((turn) => turn.writer.startsWith(`${deviceId}:`))?.writer;
  const journaled = new Map<number, JournaledPiTurn>();
  if (!writer) return journaled;
  for (const turn of found.values()) {
    if (turn.writer === writer) journaled.set(turn.entryId, { userMessageId: turn.userMessageId, settled: turn.settled });
  }
  return journaled;
};

export type PiPendingRows = {
  messages: MessageRecord[];
  journalUserIds: ReadonlyMap<string, string>;
};

const NO_PENDING_ROWS: PiPendingRows = { messages: [], journalUserIds: new Map() };

export const piPendingRows = (args: {
  projection: PiChatProjection;
  journaled: ReadonlyMap<number, JournaledPiTurn>;
  canonical: readonly MessageRecord[];
  sinceMs: number | null;
}): PiPendingRows => {
  const { projection, journaled, canonical, sinceMs } = args;
  const pending = projection.turns.filter((turn) => {
    if (!turn.own || (sinceMs !== null && turn.timestamp < sinceMs)) return false;
    return journaled.get(turn.entryId)?.settled !== true;
  });
  const opening = sinceMs === null;
  if (pending.length === 0 && !opening) return NO_PENDING_ROWS;
  const canonicalReplies = new Map<string, number>();
  const canonicalUsers = new Set<string>();
  for (const message of canonical) {
    if (message.type === "user_message") canonicalUsers.add(message._id);
    const owner = message.type === "assistant_message" ? message.payload?.userMessageId : undefined;
    if (typeof owner === "string") canonicalReplies.set(owner, (canonicalReplies.get(owner) ?? 0) + 1);
  }
  const byUser = new Map(pending.map((turn) => [turn.userMessageId, turn]));
  const journalUserIds = new Map<string, string>();
  const replies = new Map<string, number>();
  const messages: MessageRecord[] = [];
  for (const message of projection.messages) {
    const owner =
      message.type === "user_message"
        ? message._id
        : typeof message.payload?.userMessageId === "string"
          ? message.payload.userMessageId
          : undefined;
    if (!owner) {
      if (opening && message.type === "assistant_message") messages.push(message);
      continue;
    }
    const turn = byUser.get(owner);
    if (!turn) continue;
    const journal =
      journaled.get(turn.entryId) ??
      (canonicalUsers.has(turn.userMessageId) ? { userMessageId: turn.userMessageId, settled: false } : undefined);
    if (!journal) {
      messages.push(message);
      continue;
    }
    if (message.type === "user_message") continue;
    if (journal.userMessageId && journal.userMessageId !== turn.userMessageId) {
      journalUserIds.set(turn.userMessageId, journal.userMessageId);
    }
    const target = journal.userMessageId || turn.userMessageId;
    const ordinal = (replies.get(target) ?? 0) + 1;
    replies.set(target, ordinal);
    if (ordinal <= (canonicalReplies.get(target) ?? 0)) continue;
    messages.push(
      target === turn.userMessageId
        ? message
        : { ...message, payload: { ...message.payload, userMessageId: target } },
    );
  }
  return messages.length === 0 && journalUserIds.size === 0 ? NO_PENDING_ROWS : { messages, journalUserIds };
};

export const piAgentActivityEvents = (records: readonly DesktopThreadActivityRecord[]): EventRecord[] => {
  const events: EventRecord[] = [];
  for (const record of records) {
    if (record.source !== "stella" || !record.pi) continue;
    const identity = { agentId: record.threadId, attemptGeneration: record.attemptGeneration ?? 1 };
    events.push({
      _id: `pi:${record.threadId}:started`,
      timestamp: record.startedAt,
      type: "agent-started",
      payload: { ...identity, description: record.description, agentType: record.agentType },
    });
    const endedAt = record.completedAt ?? record.startedAt;
    if (record.status === "completed") {
      events.push({
        _id: `pi:${record.threadId}:completed`,
        timestamp: endedAt,
        type: "agent-completed",
        payload: { ...identity, result: record.result ?? "" },
      });
    } else if (record.status === "error" || record.status === "canceled") {
      events.push({
        _id: `pi:${record.threadId}:${record.status}`,
        timestamp: endedAt,
        type: record.status === "error" ? "agent-failed" : "agent-canceled",
        payload: { ...identity, ...(record.error ? { error: record.error } : {}) },
      });
    }
  }
  return events.sort((a, b) => a.timestamp - b.timestamp || (a._id < b._id ? -1 : 1));
};


const rowEntryId = (message: MessageRecord, turns: ReadonlyMap<string, PiTurnIndex>): number | undefined => {
  if (message.type === "user_message") return turns.get(message._id)?.entryId;
  const tail = /:(\d+)$/.exec(message._id)?.[1];
  return tail ? Number(tail) : undefined;
};

export const piPendingLogRows = (args: {
  projection: PiChatProjection;
  log: readonly MessageRecord[];
  conversationId: string;
  sinceMs: number | null;
}): PiPendingRows => {
  const { projection, log, conversationId, sinceMs } = args;
  if (projection.messages.length === 0) return NO_PENDING_ROWS;
  const prefix = `pi:${conversationId}:${projection.rootId ?? ""}:`;
  const written = new Set<number>();
  const logIds = new Set<string>();
  const note = (id: string) => {
    logIds.add(id);
    if (!id.startsWith(prefix)) return;
    const entryId = /^(\d+)/.exec(id.slice(prefix.length))?.[1];
    if (entryId) written.add(Number(entryId));
  };
  for (const message of log) {
    note(message._id);
    for (const event of message.toolEvents) note(event._id);
  }
  const turns = new Map(projection.turns.map((turn) => [turn.userMessageId, turn]));
  const journalUserIds = new Map<string, string>();
  const messages: MessageRecord[] = [];
  for (const message of projection.messages) {
    const owner =
      message.type === "user_message"
        ? message._id
        : typeof message.payload?.userMessageId === "string"
          ? message.payload.userMessageId
          : undefined;
    const turn = owner ? turns.get(owner) : undefined;
    if (owner && (!turn || !turn.own)) continue;
    if (turn && sinceMs !== null && turn.timestamp < sinceMs) continue;
    if (!turn && sinceMs !== null) continue;
    const entryId = rowEntryId(message, turns);
    if (entryId === undefined || written.has(entryId) || logIds.has(message._id)) continue;
    const logUserId = turn && !logIds.has(turn.userMessageId) ? `${prefix}${turn.entryId}` : undefined;
    if (turn && logUserId && logIds.has(logUserId)) {
      journalUserIds.set(turn.userMessageId, logUserId);
      if (message.type === "user_message") continue;
      messages.push({ ...message, payload: { ...message.payload, userMessageId: logUserId } });
      continue;
    }
    messages.push(message);
  }
  return messages.length === 0 && journalUserIds.size === 0 ? NO_PENDING_ROWS : { messages, journalUserIds };
};
