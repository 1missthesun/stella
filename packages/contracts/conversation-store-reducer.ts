import {
  BACKFILL_BATCH_RECORDS,
  MAX_CLIENT_RECORDS,
  type JournalRecord,
  type LiveTurnSnapshot,
} from "./conversation-protocol.js";
import type { SocketStatus } from "./conversation-socket.js";

export type LiveTurn = {
  turnId: string;
  toolName: string | null;
  toolCallId: string | null;
  toolLabel: string | null;
};

export type ConversationViewState = {
  conversationId: string;
  status: SocketStatus;
  statusMessage: string | null;
  statusRetryable: boolean;
  epoch: number | null;
  headSeq: number;
  records: readonly JournalRecord[];
  live: LiveTurn | null;
  title: string;
  floorSeq: number;
  hasOlder: boolean;
  loadingOlder: boolean;
  olderNotice: string | null;
};

export const EMPTY_JOURNAL_RECORDS: readonly JournalRecord[] = [];

export const initialConversationViewState = (
  conversationId: string,
): ConversationViewState => ({
  conversationId,
  status: "idle",
  statusMessage: null,
  statusRetryable: true,
  epoch: null,
  headSeq: -1,
  records: EMPTY_JOURNAL_RECORDS,
  live: null,
  title: "",
  floorSeq: 0,
  hasOlder: false,
  loadingOlder: false,
  olderNotice: null,
});

export const OLDER_TIMEOUT_MS = 15_000;
export const TEARDOWN_GRACE_MS = 5_000;
export const MAX_RETAINED_STORES = 8;

export const OLDER_LIMIT_NOTICE =
  "That's as far back as this view holds — reload to go further.";
export const OLDER_INCOMPLETE_NOTICE =
  "Couldn't load that part of this conversation. Try again.";
export const OLDER_EXHAUSTED_NOTICE =
  "That's the start of what Stella still has.";

export const olderWouldExceedRetainedLimit = (
  records: readonly JournalRecord[],
): boolean => records.length + BACKFILL_BATCH_RECORDS > MAX_CLIENT_RECORDS;

export const liveTurnFromReady = (
  live: LiveTurnSnapshot | null,
): LiveTurn | null => {
  if (!live) return null;
  const running = [...live.tools].reverse().find((tool) => tool.phase === "start");
  return {
    turnId: live.turnId,
    toolName: running?.name ?? null,
    toolCallId: running?.toolCallId ?? null,
    toolLabel: running?.label ?? null,
  };
};

export const liveTurnWithTool = (
  live: LiveTurn | null,
  tool: {
    turnId: string;
    toolCallId: string;
    name: string;
    label?: string;
    phase: "start" | "end";
  },
): LiveTurn => {
  const current =
    live && live.turnId === tool.turnId
      ? live
      : { turnId: tool.turnId, toolName: null, toolCallId: null, toolLabel: null };
  if (tool.phase === "end" && current.toolCallId && current.toolCallId !== tool.toolCallId) {
    return current;
  }
  return {
    ...current,
    toolName: tool.phase === "start" ? tool.name : null,
    toolCallId: tool.phase === "start" ? tool.toolCallId : null,
    toolLabel: tool.phase === "start" ? (tool.label ?? null) : null,
  };
};

export const liveTurnAfterRecords = (
  live: LiveTurn | null,
  records: readonly JournalRecord[],
): LiveTurn | null => {
  let next = live;
  for (const record of records) {
    if (record.kind !== "turn") continue;
    if (record.phase === "started") {
      if (next?.turnId !== record.turnId) {
        next = { turnId: record.turnId, toolName: null, toolCallId: null, toolLabel: null };
      }
    } else if (next?.turnId === record.turnId) {
      next = null;
    }
  }
  return next;
};

export const appendJournalRecords = (
  view: Pick<
    ConversationViewState,
    "records" | "hasOlder" | "floorSeq" | "headSeq"
  >,
  incoming: readonly JournalRecord[],
  options: { replaceRetained?: boolean; overflow?: number } = {},
): {
  records: readonly JournalRecord[];
  fresh: readonly JournalRecord[];
  hasOlder: boolean;
  headSeq: number;
} | null => {
  if (!incoming.length) return null;
  const retained = options.replaceRetained
    ? EMPTY_JOURNAL_RECORDS
    : view.records;
  const lastStored = retained.at(-1)?.seq ?? -1;
  const fresh = incoming.filter((record) => record.seq > lastStored);
  if (!fresh.length) return null;
  const restart = lastStored >= 0 && fresh[0]!.seq > lastStored + 1;
  let records = (restart ? EMPTY_JOURNAL_RECORDS : retained).concat(fresh);
  let hasOlder = options.replaceRetained
    ? fresh[0]!.seq > view.floorSeq
    : view.hasOlder || restart;
  if (records.length > MAX_CLIENT_RECORDS + (options.overflow ?? 0)) {
    records = records.slice(records.length - MAX_CLIENT_RECORDS);
    hasOlder = true;
  }
  if (records[0] && records[0].seq > view.floorSeq) hasOlder = true;
  return {
    records,
    fresh,
    hasOlder,
    headSeq: Math.max(view.headSeq, records.at(-1)?.seq ?? -1),
  };
};

export const olderRangeIsComplete = (
  incoming: readonly JournalRecord[],
  range?: { complete?: boolean; fromSeq?: number; toSeq?: number },
): boolean => {
  if (range?.complete === false) return false;
  const fromSeq = range?.fromSeq;
  const toSeq = range?.toSeq;
  if (fromSeq === undefined || toSeq === undefined) return true;
  return (
    incoming.length === toSeq - fromSeq + 1 &&
    incoming.every((record, index) => record.seq === fromSeq + index)
  );
};

/**
 * The window cut back to the retention cap, for a store that lets appends run
 * past it (`overflow`) and trims later; null when nothing needs trimming.
 */
export const trimRetainedRecords = (
  view: Pick<ConversationViewState, "records" | "floorSeq">,
): { records: readonly JournalRecord[]; hasOlder: boolean } | null => {
  if (view.records.length <= MAX_CLIENT_RECORDS) return null;
  const records = view.records.slice(view.records.length - MAX_CLIENT_RECORDS);
  return { records, hasOlder: true };
};

export const prependOlderRecords = (
  view: Pick<ConversationViewState, "records" | "floorSeq">,
  page: readonly JournalRecord[],
): { records: readonly JournalRecord[]; hasOlder: boolean } | null => {
  const oldest = view.records[0]?.seq ?? Number.POSITIVE_INFINITY;
  const older = page
    .filter((record) => record.seq < oldest)
    .sort((a, b) => a.seq - b.seq);
  if (!older.length) return null;
  const records = older.concat(view.records);
  return { records, hasOlder: (records[0]?.seq ?? 0) > view.floorSeq };
};
