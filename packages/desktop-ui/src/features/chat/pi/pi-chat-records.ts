import {
  isPiAgentInput,
  isPiAskFirstInput,
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
import { toServerTime } from "@stella/contracts/server-clock";
import { journalRecordsToMessageRecords, withoutSequence } from "@/features/cloud/journal-message-records";

type Turn = {
  userMessageId?: string;
  entryId?: number;
  assistantMessages: number;
  hidden?: true;
};

export type PiTurnIndex = {
  entryId: number;
  userMessageId: string;
  own: boolean;
  journalSeq?: number;
  logId?: string;
};

export type PiChatProjection = {
  records: JournalRecord[];
  messages: MessageRecord[];
  turn: Turn;
  turns: PiTurnIndex[];
  rootId: number | null;
};

const writtenIn = (entry: PiEntry): { journalSeq?: number; logId?: string } => {
  const data = entry.data as { journalSeq?: unknown; localLog?: unknown } | undefined;
  return {
    ...(typeof data?.journalSeq === "number" ? { journalSeq: data.journalSeq } : {}),
    ...(typeof data?.localLog === "string" ? { logId: data.localLog } : {}),
  };
};

export const projectPiChat = (state: Pick<PiChatState, "entries" | "requestIds" | "running">): PiChatProjection => {
  const records: JournalRecord[] = [];
  let turnId = "pi:0";
  let turn: Turn = { assistantMessages: 0 };
  const turns: PiTurnIndex[] = [];
  let ending: JournalRecord | undefined;
  const removed = new Set<number>();
  for (const entry of state.entries) {
    const choice = entry.kind === "stella.safeguard" ? (entry.data as { state?: unknown; targets?: unknown }) : null;
    if (choice?.state === "removed" && Array.isArray(choice.targets)) {
      for (const target of choice.targets) removed.add(Number(target));
    }
  }
  for (const entry of state.entries) {
    const message = entry.model?.[0];
    if (!message || message.role === "system" || removed.has(entry.id) || entry.kind === "stella.safeguard") continue;
    const createdAtMs = toServerTime(message.timestamp);
    const base = { seq: entry.id, turnId, createdAtMs, kind: "message" as const };
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
      const automation = hidden && (isPiAskFirstInput(message) || (!isPiAgentInput(message) && !isPiScheduledInput(message)));
      turn = {
        userMessageId: clientMsgId ?? `cloud:${turnId}:message:${entry.id}`,
        entryId: entry.id,
        assistantMessages: 0,
        ...(automation ? { hidden: true as const } : {}),
      };
      const written = writtenIn(entry);
      turns.push({
        entryId: entry.id,
        userMessageId: turn.userMessageId!,
        own: written.journalSeq === undefined && written.logId === undefined,
        ...written,
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
        ? { seq: entry.id, turnId, createdAtMs, kind: "turn", phase: terminal.phase, notice: terminal.notice }
        : undefined;
    } else if (entry.kind === "pi.tool-result" && message.role === "toolResult") {
      records.push({ ...base, role: "toolResult", hidden: false, payload: message as unknown as Record<string, unknown> });
    }
  }
  if (ending && !state.running) records.push(ending);
  return {
    records,
    messages: journalRecordsToMessageRecords(records).map(withoutSequence),
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
  beforeIds: ReadonlyMap<string, string>;
};

const NO_PENDING_ROWS: PiPendingRows = { messages: [], journalUserIds: new Map(), beforeIds: new Map() };

type RecordWindow = {
  hasOlder: boolean;
  startSeq: number | null;
};

const firstEntryInWindow = (
  turns: readonly PiTurnIndex[],
  recordedRowOf: (turn: PiTurnIndex) => string | undefined,
  isBeforeWindow: (turn: PiTurnIndex) => boolean,
): number => {
  const afterOlder = turns.slice(turns.findLastIndex(isBeforeWindow) + 1);
  return afterOlder.find((turn) => recordedRowOf(turn) !== undefined)?.entryId ?? Number.POSITIVE_INFINITY;
};

const nextRecordedRow = (
  turns: readonly PiTurnIndex[],
  turn: PiTurnIndex,
  recordedRowOf: (turn: PiTurnIndex) => string | undefined,
): string | undefined => {
  for (const later of turns) {
    if (later.entryId <= turn.entryId) continue;
    const row = recordedRowOf(later);
    if (row !== undefined) return row;
  }
  return undefined;
};

export const piPendingRows = (args: {
  projection: PiChatProjection;
  journaled: ReadonlyMap<number, JournaledPiTurn>;
  canonical: readonly MessageRecord[];
  window: RecordWindow;
}): PiPendingRows => {
  const { projection, journaled, canonical, window } = args;
  const opening = !window.hasOlder;
  const userIds = new Set<string>();
  const userIdsBySeq = new Map<number, string>();
  for (const message of canonical) {
    if (message.type !== "user_message") continue;
    userIds.add(message._id);
    if (message.sequence !== undefined) userIdsBySeq.set(message.sequence, message._id);
  }
  const recordedRowOf = (turn: PiTurnIndex): string | undefined => {
    if (turn.journalSeq !== undefined) return userIdsBySeq.get(turn.journalSeq);
    const id = journaled.get(turn.entryId)?.userMessageId || turn.userMessageId;
    return userIds.has(id) ? id : undefined;
  };
  const fromEntry = opening
    ? Number.NEGATIVE_INFINITY
    : firstEntryInWindow(
        projection.turns,
        recordedRowOf,
        (turn) =>
          turn.journalSeq !== undefined && window.startSeq !== null && turn.journalSeq < window.startSeq,
      );
  const pending = projection.turns.filter(
    (turn) => turn.own && turn.entryId >= fromEntry && journaled.get(turn.entryId)?.settled !== true,
  );
  if (pending.length === 0 && !opening) return NO_PENDING_ROWS;
  const canonicalReplies = new Map<string, number>();
  for (const message of canonical) {
    const owner = message.type === "assistant_message" ? message.payload?.userMessageId : undefined;
    if (typeof owner === "string") canonicalReplies.set(owner, (canonicalReplies.get(owner) ?? 0) + 1);
  }
  const byUser = new Map(pending.map((turn) => [turn.userMessageId, turn]));
  const journalUserIds = new Map<string, string>();
  const beforeIds = new Map<string, string>();
  const firstRow = canonical[0]?._id;
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
      if (opening && message.type === "assistant_message") {
        messages.push(message);
        if (firstRow) beforeIds.set(message._id, firstRow);
      }
      continue;
    }
    const turn = byUser.get(owner);
    if (!turn) continue;
    const journal =
      journaled.get(turn.entryId) ??
      (userIds.has(turn.userMessageId) ? { userMessageId: turn.userMessageId, settled: false } : undefined);
    if (!journal) {
      const before = nextRecordedRow(projection.turns, turn, recordedRowOf);
      if (before) beforeIds.set(message._id, before);
      messages.push(
        message.type === "user_message"
          ? { ...message, payload: { ...message.payload, sendPending: "unsynced" } }
          : message,
      );
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
  return messages.length === 0 && journalUserIds.size === 0
    ? NO_PENDING_ROWS
    : { messages, journalUserIds, beforeIds };
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
  hasOlder: boolean;
}): PiPendingRows => {
  const { projection, log, conversationId, hasOlder } = args;
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
  const recordedRowOf = (turn: PiTurnIndex): string | undefined =>
    [turn.logId, turn.userMessageId, `${prefix}${turn.entryId}`].find(
      (id) => id !== undefined && logIds.has(id),
    );
  const fromEntry = hasOlder
    ? firstEntryInWindow(projection.turns, recordedRowOf, () => false)
    : Number.NEGATIVE_INFINITY;
  const journalUserIds = new Map<string, string>();
  const beforeIds = new Map<string, string>();
  const firstRow = log[0]?._id;
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
    if (turn ? turn.entryId < fromEntry : hasOlder) continue;
    const entryId = rowEntryId(message, turns);
    if (entryId === undefined || written.has(entryId) || logIds.has(message._id)) continue;
    const logUserId = turn && !logIds.has(turn.userMessageId) ? `${prefix}${turn.entryId}` : undefined;
    if (turn && logUserId && logIds.has(logUserId)) {
      journalUserIds.set(turn.userMessageId, logUserId);
      if (message.type === "user_message") continue;
      messages.push({ ...message, payload: { ...message.payload, userMessageId: logUserId } });
      continue;
    }
    const before = turn
      ? nextRecordedRow(projection.turns, turn, recordedRowOf)
      : firstRow;
    if (before) beforeIds.set(message._id, before);
    messages.push(message);
  }
  return messages.length === 0 && journalUserIds.size === 0
    ? NO_PENDING_ROWS
    : { messages, journalUserIds, beforeIds };
};
