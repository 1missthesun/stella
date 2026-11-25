import {
  messageText,
  type JournalMessageRecord,
  type JournalRecord,
  type JournalTurnRecord,
} from "./conversation-protocol.js";
import type { AgentAttemptOutcome } from "./agent-status.js";
import { wakePromptOf } from "./agent-wake-prompt.js";
import { EMAIL_CARD_TYPE } from "./email-card.js";
import { REMINDER_CARD_TYPE } from "./reminders.js";
import {
  splitMessageReplyRefs,
  toReplyPreview,
  type MessageReaction,
  type RawReplyRef,
  type ReplyRef,
} from "./reply-refs.js";
import { SAFEGUARD_CARD_TYPE } from "./safeguard-block.js";
import { SCHEDULE_NOTICE_CARD_TYPE } from "./schedule-notice.js";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const recordReactions = new WeakMap<
  JournalMessageRecord,
  readonly { sequence: number; emoji: string }[]
>();

export const journalRecordReactions = (
  record: JournalMessageRecord,
): readonly { sequence: number; emoji: string }[] => reactionsOf(record);

const reactionsOf = (
  record: JournalMessageRecord,
): readonly { sequence: number; emoji: string }[] => {
  let reactions = recordReactions.get(record);
  if (!reactions) {
    reactions = splitMessageReplyRefs(record.payload).reactions;
    recordReactions.set(record, reactions);
  }
  return reactions;
};

export const journalUserReactions = (
  records: readonly JournalRecord[],
): Map<number, MessageReaction> => {
  const userSeqs = new Set<number>();
  const reactions = new Map<number, MessageReaction>();
  for (const record of records) {
    if (record.kind !== "message" || record.hidden) continue;
    if (record.role === "user") {
      userSeqs.add(record.seq);
      continue;
    }
    if (record.role !== "assistant") continue;
    for (const reaction of reactionsOf(record)) {
      if (!userSeqs.has(reaction.sequence)) continue;
      reactions.set(reaction.sequence, {
        emoji: reaction.emoji,
        at: journalMessageTimestamp(record),
      });
    }
  }
  return reactions;
};

const WRITER_CLOCK_TOLERANCE_MS = 5 * 60_000;

export const journalMessageTimestamp = (
  record: JournalMessageRecord,
  prompt?: JournalMessageRecord,
): number => {
  const written = record.payload.timestamp;
  if (typeof written !== "number" || !Number.isFinite(written)) return record.createdAtMs;
  if (record.createdAtMs <= 0) return written;
  if (written > record.createdAtMs + WRITER_CLOCK_TOLERANCE_MS) return record.createdAtMs;
  if (record.turnId.startsWith("import:")) return written;
  const earliest =
    record.role === "user"
      ? record.createdAtMs
      : prompt && prompt !== record
        ? prompt.createdAtMs
        : undefined;
  return earliest === undefined || written >= earliest - WRITER_CLOCK_TOLERANCE_MS
    ? written
    : earliest;
};

const SHOWN_CARD_TYPES: ReadonlySet<string> = new Set([
  REMINDER_CARD_TYPE,
  SCHEDULE_NOTICE_CARD_TYPE,
  SAFEGUARD_CARD_TYPE,
  EMAIL_CARD_TYPE,
]);

const showsInChat = (record: JournalRecord): boolean =>
  record.kind === "message" || (record.kind === "card" && SHOWN_CARD_TYPES.has(record.card.type));

export const journalTurnSeq = (turnRecords: readonly JournalRecord[]): number =>
  (turnRecords.find(showsInChat) ?? turnRecords[0]!).seq;

export type JournalMirroredWake = {
  record: JournalMessageRecord;
  threadId: string;
  description?: string;
  outcome: { kind: AgentAttemptOutcome; body: string };
};

const wakePrompts = new WeakMap<
  JournalMessageRecord,
  ReturnType<typeof wakePromptOf>
>();

const cachedWakePrompt = (record: JournalMessageRecord) => {
  if (wakePrompts.has(record)) return wakePrompts.get(record)!;
  const prompt = wakePromptOf(record.payload, record.clientMsgId);
  wakePrompts.set(record, prompt);
  return prompt;
};

export const journalMirroredWake = (
  turnRecords: readonly JournalRecord[],
): JournalMirroredWake | null => {
  const carded = new Set<string>();
  for (const record of turnRecords) {
    if (record.kind === "card" && record.card.type === "agent-lifecycle") {
      carded.add(record.card.event.payload.agentId);
    }
  }
  let wake: JournalMirroredWake | null = null;
  for (const record of turnRecords) {
    if (record.kind !== "message" || record.role !== "user" || !record.hidden) {
      continue;
    }
    const prompt = cachedWakePrompt(record);
    if (!prompt || carded.has(prompt.threadId)) continue;
    wake = {
      record,
      threadId: prompt.threadId,
      ...(prompt.description ? { description: prompt.description } : {}),
      outcome: { kind: prompt.outcome, body: prompt.body },
    };
  }
  return wake;
};

export const hasIncompleteLeadingJournalTurn = (
  records: readonly JournalRecord[],
  hasOlder: boolean,
  options: { dropCardOnly?: boolean } = {},
): boolean => {
  if (!hasOlder || records.length === 0) return false;
  const leadingTurnId = records[0]!.turnId;
  const leadingTurn = records.filter(
    (record) => record.turnId === leadingTurnId,
  );
  const hasPrompt = leadingTurn.some(
    (record) =>
      (record.kind === "message" && record.role === "user") ||
      (record.kind === "card" &&
        (record.card.type === "reminder" ||
          record.card.type === "schedule-notice" ||
          record.card.type === "email")),
  );
  if (hasPrompt) return false;
  if (options.dropCardOnly) return true;
  return leadingTurn.some(
    (record) =>
      (record.kind === "message" && record.role !== "user") ||
      record.kind === "turn",
  );
};

export const completeJournalWindowRecords = (
  records: readonly JournalRecord[],
  hasOlder: boolean,
  options: { dropCardOnly?: boolean } = {},
): JournalRecord[] => {
  if (!hasIncompleteLeadingJournalTurn(records, hasOlder, options)) {
    return [...records];
  }
  const incompleteTurnId = records[0]!.turnId;
  return records.filter((record) => record.turnId !== incompleteTurnId);
};

export const journalTerminalNotice = (
  turnRecords: readonly JournalRecord[],
): (JournalTurnRecord & { notice: string }) | null => {
  let terminal: JournalTurnRecord | undefined;
  for (const record of turnRecords) {
    if (record.kind === "turn" && record.phase !== "started") terminal = record;
  }
  if (!terminal || terminal.phase === "completed" || !terminal.notice) {
    return null;
  }
  const notice = terminal.notice;
  const alreadyReplied = turnRecords.some(
    (record) =>
      record.kind === "message" &&
      record.role === "assistant" &&
      messageText(record.payload) === notice,
  );
  return alreadyReplied ? null : { ...terminal, notice };
};

export const resolveJournalReplyRefs = (args: {
  raw: readonly RawReplyRef[];
  recordsBySeq: Pick<ReadonlyMap<number, JournalRecord>, "get">;
  turnUserRecord: JournalMessageRecord | undefined;
  agentTitles?: ReadonlyMap<string, string>;
  messageId: (record: JournalMessageRecord) => string;
}): ReplyRef[] => {
  const refs: ReplyRef[] = [];
  const seen = new Set<string>();
  const push = (ref: ReplyRef) => {
    const key = ref.kind === "message" ? `m:${ref.id}` : `a:${ref.threadId}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  };
  for (const ref of args.raw) {
    if (ref.kind === "agent") {
      push({
        kind: "agent",
        threadId: ref.threadId,
        title: args.agentTitles?.get(ref.threadId) ?? "",
      });
      continue;
    }
    const record = args.recordsBySeq.get(ref.sequence);
    if (!record || record.kind !== "message" || record.hidden) continue;
    if (record.role !== "user" && record.role !== "assistant") continue;
    if (args.turnUserRecord && record.seq === args.turnUserRecord.seq) continue;
    const text = messageText(record.payload);
    push({
      kind: "message",
      sequence: ref.sequence,
      id: args.messageId(record),
      role: record.role,
      preview: toReplyPreview(
        record.role === "assistant" ? splitMessageReplyRefs(record.payload).text : text,
      ),
    });
  }
  if (refs.length === 0 && args.turnUserRecord?.hidden) {
    const wake = wakePromptOf(args.turnUserRecord.payload, args.turnUserRecord.clientMsgId);
    if (wake)
      push({
        kind: "agent",
        threadId: wake.threadId,
        title: args.agentTitles?.get(wake.threadId) ?? wake.description ?? "",
      });
  }
  return refs;
};

export const storedJournalReplyRefs = (
  payload: Record<string, unknown>,
): ReplyRef[] => {
  const runtime = asRecord(asRecord(payload.metadata)?.runtime);
  if (!runtime || !Array.isArray(runtime.replyRefs)) return [];
  return runtime.replyRefs.flatMap((entry: unknown): ReplyRef[] => {
    const ref = asRecord(entry);
    if (!ref) return [];
    if (ref.kind === "agent" && typeof ref.threadId === "string") {
      return [
        {
          kind: "agent",
          threadId: ref.threadId,
          title: typeof ref.title === "string" ? ref.title : "",
        },
      ];
    }
    if (
      ref.kind === "message" &&
      typeof ref.id === "string" &&
      typeof ref.sequence === "number" &&
      (ref.role === "user" || ref.role === "assistant")
    ) {
      return [
        {
          kind: "message",
          id: ref.id,
          sequence: ref.sequence,
          role: ref.role,
          preview: typeof ref.preview === "string" ? ref.preview : "",
        },
      ];
    }
    return [];
  });
};
