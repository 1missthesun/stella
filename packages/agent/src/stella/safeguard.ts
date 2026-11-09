/**
 * A safety block in a conversation's own storage. The block itself is the
 * run's failed model response; what the user chose is an entry that edits the
 * model's context: `removed` omits the blocked messages with pi's context
 * edits and leaves a notice in their place, `cleared` starts the context
 * over. Entries are immutable, so compaction, resume and another engine's
 * session all read the edited context; nothing is deleted from the history.
 */
import type { Context } from "@earendil-works/chord";
import type { Message } from "@earendil-works/pi-ai";
import {
  CompactionEntry,
  defineDoc,
  defineEntry,
  type ContextEdit,
  type Conversation,
  type ConversationId,
  type Cursor,
  type EntryId,
  type EntryRecord,
  type Harness,
} from "@earendil-works/pi-durable";
import {
  applySafeguardEvent,
  emptySafeguardFold,
  isSafeguardRemovedContextNotice,
  SAFEGUARD_CLEARED_CONTEXT_NOTICE,
  SAFEGUARD_REMOVED_CONTEXT_NOTICE,
  type SafeguardEvent,
  type SafeguardFold,
} from "@stella/contracts/safeguard-block";
import { journalSeqOf } from "./journal-sync.ts";

export const SAFEGUARD_ENTRY_KIND = "stella.safeguard";

export type SafeguardEntryData = { at: number } & (
  | { state: "removed"; requestId: string; targets: number[] }
  | { state: "cleared"; requestId: string }
  | { state: "switched"; requestId: string; label: string }
);

export const SafeguardEntry = defineEntry<SafeguardEntryData>(SAFEGUARD_ENTRY_KIND);

export const SafeguardDoc = defineDoc<{ fold: SafeguardFold }>({
  kind: "stella.safeguard",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({ fold: emptySafeguardFold() }),
});

const MESSAGE_KINDS: ReadonlySet<string> = new Set(["pi.user", "pi.assistant", "pi.tool-result"]);
const SCAN_PAGE = 128;
const SCAN_LIMIT = 4_096;

const textOf = (message: Message): string =>
  message.role === "system"
    ? ""
    : typeof message.content === "string"
      ? message.content
      : message.content.map((part) => (part.type === "text" ? part.text : "")).join("");

/** A message that changes what came before it for every reader: a removal or a fresh start. */
export const isSafeguardContextBoundary = (message: Message): boolean => {
  if (message.role !== "user") return false;
  const text = textOf(message);
  return isSafeguardRemovedContextNotice(text) || text.startsWith(SAFEGUARD_CLEARED_CONTEXT_NOTICE);
};

export const readSafeguardFold = async (
  harness: Harness,
  conversationId: ConversationId,
  context: Context,
): Promise<SafeguardFold> => (await harness.snapshot(SafeguardDoc, conversationId, context))?.fold ?? emptySafeguardFold();

/** Applies events to the conversation's fold; returns it and whether it changed. */
export const noteSafeguardEvents = async (
  harness: Harness,
  conversationId: ConversationId,
  events: readonly SafeguardEvent[],
  context: Context,
): Promise<{ fold: SafeguardFold; changed: boolean }> => {
  if (events.length === 0) return { fold: await readSafeguardFold(harness, conversationId, context), changed: false };
  return await harness.commit(async (tx) => {
    const doc = await tx.doc(SafeguardDoc, conversationId);
    const before = JSON.stringify(doc.fold);
    let fold = JSON.parse(before) as SafeguardFold;
    for (const event of events) fold = applySafeguardEvent(fold, event);
    const after = JSON.stringify(fold);
    if (after !== before) doc.fold = JSON.parse(after) as SafeguardFold;
    return { fold, changed: after !== before };
  }, context);
};

const isReply = (entry: EntryRecord): boolean => {
  const message = entry.model?.[0];
  return (
    entry.kind === "pi.assistant" &&
    message?.role === "assistant" &&
    (message.stopReason === "stop" || message.stopReason === "length") &&
    (message.api as string) !== "stella-notice"
  );
};

/** The newest entries of the active context, newest first, down to where it starts. */
const recentContextEntries = async (
  harness: Harness,
  root: Conversation,
  context: Context,
  until: (entry: EntryRecord) => boolean,
): Promise<EntryRecord[]> =>
  await harness.commit(async (tx) => {
    const found: EntryRecord[] = [];
    let floor: EntryId | undefined;
    let cursor: Cursor | undefined;
    do {
      const page = await tx.scanEntries({ conversationId: root.id, order: "descending" }, SCAN_PAGE, cursor);
      for (const entry of page.items) {
        if (floor !== undefined && entry.id < floor) return found;
        if (entry.head !== undefined) {
          if (floor === undefined) floor = entry.head;
          if (entry.head === entry.id) return found;
          continue;
        }
        if (until(entry)) return found;
        found.push(entry);
        if (found.length >= SCAN_LIMIT) return found;
      }
      cursor = page.next;
    } while (cursor !== undefined);
    return found;
  }, context);

/** Everything the model has seen since the conversation last got a reply. */
export const entriesSinceLastReply = async (harness: Harness, root: Conversation, context: Context): Promise<EntryId[]> =>
  (await recentContextEntries(harness, root, context, isReply))
    .filter((entry) => MESSAGE_KINDS.has(entry.kind))
    .map((entry) => entry.id)
    .reverse();

/**
 * This host's entries for a journaled removal: those it imported with a
 * journal seq in the span, and each of its own turns in it, from the turn's
 * prompt to the next prompt.
 */
export const entriesOfJournalSpan = async (
  harness: Harness,
  root: Conversation,
  span: { fromSeq: number; toSeq: number; ownPrompts: readonly EntryId[] },
  context: Context,
): Promise<EntryId[]> => {
  const firstOwn = span.ownPrompts.length > 0 ? Math.min(...span.ownPrompts) : undefined;
  const recent = (
    await recentContextEntries(harness, root, context, (entry) => {
      const seq = journalSeqOf(entry);
      return seq !== undefined && seq < span.fromSeq && (firstOwn === undefined || entry.id < firstOwn);
    })
  ).reverse();
  const own = new Set<number>(span.ownPrompts);
  const targets: EntryId[] = [];
  let inOwnTurn = false;
  for (const entry of recent) {
    if (entry.kind === "pi.user") inOwnTurn = own.has(entry.id);
    if (!MESSAGE_KINDS.has(entry.kind)) continue;
    const seq = journalSeqOf(entry);
    if (seq !== undefined ? seq >= span.fromSeq && seq <= span.toSeq : inOwnTurn) targets.push(entry.id);
  }
  return targets;
};

const removedNotice = (): Message => ({
  role: "user",
  content: [{ type: "text", text: SAFEGUARD_REMOVED_CONTEXT_NOTICE, stella: { hidden: true } } as never],
  timestamp: Date.now(),
});

/** Takes `targets` out of the model's context. Returns false when this removal was already applied. */
export const removeFromContext = async (
  harness: Harness,
  root: Conversation,
  args: { requestId: string; targets: readonly EntryId[] },
  context: Context,
): Promise<boolean> => {
  const requestId = `safeguard:${args.requestId}`;
  if (await harness.commit((tx) => tx.submissionByRequest(root.id, requestId), context)) return false;
  const edits: ContextEdit[] = args.targets.map((target) => ({ target, action: "omit" }));
  const submission = await root.submit(
    {
      type: "write",
      requestId,
      entry: {
        kind: SAFEGUARD_ENTRY_KIND,
        ...(edits.length > 0 ? { model: [removedNotice()], edits } : {}),
        data: {
          state: "removed",
          requestId: args.requestId,
          targets: [...args.targets],
          at: Date.now(),
        } satisfies SafeguardEntryData,
      },
    },
    context,
  );
  await submission.wait(context);
  return true;
};

/**
 * Starts the model's context over. `journalCheckpoint` is the journal seq the
 * fresh start is recorded at, so no host publishes it as a compaction of its own.
 */
export const clearContext = async (
  harness: Harness,
  root: Conversation,
  args: { requestId: string; journalCheckpoint?: number },
  context: Context,
): Promise<boolean> => {
  const requestId = `safeguard:${args.requestId}`;
  if (await harness.commit((tx) => tx.submissionByRequest(root.id, requestId), context)) return false;
  const reset = await root.submit(
    {
      type: "write",
      requestId,
      entry: {
        kind: CompactionEntry.kind,
        head: "self",
        model: [{ role: "user", content: SAFEGUARD_CLEARED_CONTEXT_NOTICE, timestamp: Date.now() }],
        data: {
          reason: "threshold",
          safeguardCleared: true,
          ...(args.journalCheckpoint !== undefined ? { journalCheckpoint: args.journalCheckpoint } : {}),
        },
      },
    },
    context,
  );
  await reset.wait(context);
  await noteInTimeline(harness, root, { state: "cleared", requestId: args.requestId }, context);
  return true;
};

/** A line in the timeline for a choice that changed no entry's place in the context. */
export const noteInTimeline = async (
  harness: Harness,
  root: Conversation,
  data: { state: "cleared"; requestId: string } | { state: "switched"; requestId: string; label: string },
  context: Context,
): Promise<void> => {
  const submission = await root.submit(
    {
      type: "write",
      requestId: `safeguard:${data.requestId}:${data.state}`,
      entry: { kind: SAFEGUARD_ENTRY_KIND, data: { ...data, at: Date.now() } satisfies SafeguardEntryData },
    },
    context,
  );
  await submission.wait(context);
};
