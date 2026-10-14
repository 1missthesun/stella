import type { Context } from "@earendil-works/chord";
import type { Message } from "@earendil-works/pi-ai";
import {
  CompactionEntry,
  defineDoc,
  defineEntry,
  type Conversation,
  type Cursor,
  type EntryId,
  type EntryRecord,
  type Harness,
} from "@earendil-works/pi-durable";
import type { JournalCheckpoint, JournalCheckpointFirstKept } from "@stella/contracts/journal-checkpoint";

export type JournalMessage = {
  seq: number;
  turnId: string;
  role: "user" | "assistant" | "toolResult";
  hidden: boolean;
  message: Message;
  clientMsgId?: string;
};

export type JournalOpenTurn = {
  localTurnId: string;
  leaseToken: string;
  ownerGeneration: string;
  entries: number[];
};

export type JournalSyncState = {
  syncId?: string;
  importedSeq?: number;
  seededFromSeq?: number;
  publishedCheckpoint?: number;
  adoptedCheckpoint?: number;
  mirrored?: number;
  relayed?: string[];
  open?: JournalOpenTurn;
  epoch?: number;
};

export const JournalSyncDoc = defineDoc<JournalSyncState>({
  kind: "stella.journal-sync",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({}),
});

const ENTRY_KIND = { user: "pi.user", assistant: "pi.assistant", toolResult: "pi.tool-result" } as const;

export const JournalContextStartEntry = defineEntry("stella.journal-context-start");

const ALIGN_SCAN_PAGE = 64;

export type JournalStart = {
  contextStartSeq: number;
  checkpoint?: JournalCheckpoint;
};

export type JournalSeed = { fromSeq: number; checkpoint?: JournalCheckpoint };

export const journalImportAfter = async (
  state: Readonly<JournalSyncState> | undefined,
  start: () => JournalStart | Promise<JournalStart>,
): Promise<{ after: number; seed?: JournalSeed }> => {
  if (state?.importedSeq !== undefined) return { after: state.importedSeq };
  const { contextStartSeq, checkpoint } = await start();
  return checkpoint
    ? { after: checkpoint.throughSeq, seed: { fromSeq: checkpoint.throughSeq + 1, checkpoint } }
    : { after: contextStartSeq - 1, seed: { fromSeq: contextStartSeq } };
};

const journalCheckpointOf = (entry: Pick<EntryRecord, "data"> | undefined): number | undefined => {
  const seq = (entry?.data as { journalCheckpoint?: unknown } | undefined)?.journalCheckpoint;
  return typeof seq === "number" ? seq : undefined;
};

const messageText = (message: Message | undefined): string => {
  if (!message || message.role !== "user") return "";
  if (typeof message.content === "string") return message.content;
  return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
};

export async function checkpointToPublish(
  harness: Harness,
  root: Conversation,
  ownTurnOf: (
    prompt: EntryRecord,
  ) => JournalCheckpointFirstKept | undefined | Promise<JournalCheckpointFirstKept | undefined>,
  context: Context,
): Promise<{ markerId: EntryId; summary: string; firstKept: JournalCheckpointFirstKept } | undefined> {
  const found = await harness.commit(async (tx) => {
    const doc = await tx.doc(JournalSyncDoc, root.id);
    const marker = await tx.latestHeadMarker(root.id);
    if (
      !marker ||
      marker.kind !== CompactionEntry.kind ||
      journalCheckpointOf(marker) !== undefined ||
      (doc.publishedCheckpoint ?? 0) >= marker.id
    ) {
      return undefined;
    }
    const summary = messageText(marker.model?.[0]);
    if (!summary) return undefined;
    const kept = await tx.entry(marker.head);
    const keptSeq = journalSeqOf(kept);
    if (keptSeq !== undefined) return { markerId: marker.id, summary, firstKept: { seq: keptSeq } as const };
    let cursor: Cursor | undefined;
    do {
      const page = await tx.scanEntries(
        { conversationId: root.id, order: "descending", maxEntryId: marker.head },
        ALIGN_SCAN_PAGE,
        cursor,
      );
      for (const entry of page.items) {
        if (entry.kind !== ENTRY_KIND.user) continue;
        const seq = journalSeqOf(entry);
        return seq === undefined
          ? { markerId: marker.id, summary, prompt: entry }
          : { markerId: marker.id, summary, firstKept: { seq } as const };
      }
      cursor = page.next;
    } while (cursor !== undefined);
    return undefined;
  }, context);
  if (!found) return undefined;
  if (found.firstKept) return { markerId: found.markerId, summary: found.summary, firstKept: found.firstKept };
  if (!found.prompt) return undefined;
  const firstKept = await ownTurnOf(found.prompt);
  return firstKept ? { markerId: found.markerId, summary: found.summary, firstKept } : undefined;
}

export async function recordEngineCompaction(
  harness: Harness,
  root: Conversation,
  compaction: { id: string; summary: string; engine: string; preservedMessages?: number },
  context: Context,
): Promise<boolean> {
  const messageKinds = new Set<string>(Object.values(ENTRY_KIND));
  const head = await harness.commit(async (tx) => {
    let skip = compaction.preservedMessages ?? 0;
    let cursor: Cursor | undefined;
    do {
      const page = await tx.scanEntries({ conversationId: root.id, order: "descending" }, ALIGN_SCAN_PAGE, cursor);
      for (const entry of page.items) {
        if (!messageKinds.has(entry.kind)) continue;
        if (skip > 0) {
          skip -= 1;
          continue;
        }
        if (entry.kind === ENTRY_KIND.user) return entry.id;
      }
      cursor = page.next;
    } while (cursor !== undefined);
    return undefined;
  }, context);
  if (head === undefined) return false;
  await root.submit(
    {
      type: "write",
      requestId: `engine-compaction:${compaction.id}`,
      entry: {
        kind: CompactionEntry.kind,
        head,
        model: [{ role: "user", content: compaction.summary, timestamp: Date.now() }],
        data: { reason: "threshold", engine: compaction.engine },
      },
    },
    context,
  );
  return true;
}

export async function noteCheckpointPublished(
  harness: Harness,
  root: Conversation,
  markerId: EntryId,
  context: Context,
): Promise<void> {
  await harness.commit(async (tx) => {
    const doc = await tx.doc(JournalSyncDoc, root.id);
    doc.publishedCheckpoint = Math.max(doc.publishedCheckpoint ?? 0, markerId);
    return undefined;
  }, context);
}

export async function alignJournalContext(
  harness: Harness,
  root: Conversation,
  contextStartSeq: number,
  context: Context,
): Promise<boolean> {
  return await harness.commit(async (tx) => {
    const doc = await tx.doc(JournalSyncDoc, root.id);
    if (doc.importedSeq === undefined || doc.seededFromSeq !== undefined) return false;
    doc.seededFromSeq = contextStartSeq;
    const marker = await tx.latestHeadMarker(root.id);
    let firstKept: EntryId | undefined;
    let older: EntryId | undefined;
    let cursor: Cursor | undefined;
    do {
      const page = await tx.scanEntries({ conversationId: root.id, order: "descending" }, ALIGN_SCAN_PAGE, cursor);
      for (const entry of page.items) {
        const seq = journalSeqOf(entry);
        if (seq !== undefined && seq < contextStartSeq) {
          older = entry.id;
          break;
        }
        if (entry.kind === ENTRY_KIND.user) firstKept = entry.id;
      }
      cursor = page.next;
    } while (older === undefined && cursor !== undefined);
    if (older === undefined || (marker && marker.head > older)) return false;
    await tx.appendEntry(root.id, { kind: JournalContextStartEntry.kind, head: firstKept ?? "self" });
    doc.importedSeq = Math.max(doc.importedSeq, contextStartSeq - 1);
    return true;
  }, context);
}

export async function adoptJournalCheckpoint(
  harness: Harness,
  root: Conversation,
  checkpoint: JournalCheckpoint,
  context: Context,
): Promise<boolean> {
  const plan = await harness.commit(async (tx) => {
    const doc = await tx.doc(JournalSyncDoc, root.id);
    if ((doc.adoptedCheckpoint ?? -1) >= checkpoint.throughSeq) return undefined;
    if ((doc.importedSeq ?? -1) < checkpoint.throughSeq) return undefined;
    const marker = await tx.latestHeadMarker(root.id);
    if (marker && journalCheckpointOf(marker) !== undefined && journalCheckpointOf(marker)! >= checkpoint.throughSeq) {
      return undefined;
    }
    let head: EntryId | undefined;
    let covered = false;
    let cursor: Cursor | undefined;
    do {
      const page = await tx.scanEntries({ conversationId: root.id, order: "descending" }, ALIGN_SCAN_PAGE, cursor);
      for (const entry of page.items) {
        if (marker && entry.id < marker.head) break;
        const seq = journalSeqOf(entry);
        if (seq !== undefined && seq <= checkpoint.throughSeq) {
          covered = true;
          break;
        }
        if (entry.kind === ENTRY_KIND.user) head = entry.id;
      }
      if (covered || (marker && page.items.some((entry) => entry.id < marker.head))) break;
      cursor = page.next;
    } while (cursor !== undefined);
    if (!covered) return undefined;
    if (marker && head !== undefined && head <= marker.head) return undefined;
    return { head };
  }, context);
  if (!plan) return false;
  await root.submit(
    {
      type: "write",
      requestId: `journal-checkpoint:${checkpoint.throughSeq}`,
      entry: {
        kind: CompactionEntry.kind,
        ...(plan.head === undefined ? { head: "self" as const } : { head: plan.head }),
        model: [{ role: "user", content: checkpoint.summary, timestamp: Date.now() }],
        data: { reason: "threshold", journalCheckpoint: checkpoint.throughSeq },
      },
    },
    context,
  );
  await harness.commit(async (tx) => {
    const doc = await tx.doc(JournalSyncDoc, root.id);
    doc.adoptedCheckpoint = Math.max(doc.adoptedCheckpoint ?? -1, checkpoint.throughSeq);
    return undefined;
  }, context);
  return true;
}

export const journalSeqOf = (entry: Pick<EntryRecord, "data"> | undefined): number | undefined => {
  const seq = (entry?.data as { journalSeq?: unknown } | undefined)?.journalSeq;
  return typeof seq === "number" ? seq : undefined;
};

const asWritten = ({ message, hidden, clientMsgId, seq }: JournalMessage): Message => {
  if (message.role !== "user") return message;
  const parts = typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
  return {
    ...message,
    content: parts.map((part, index) => {
      const marks = {
        ...(part as { stella?: Record<string, unknown> }).stella,
        ...(hidden && part.type === "text" ? { hidden: true } : {}),
        ...(clientMsgId && index === 0 ? { clientMsgId } : {}),
        ...(!hidden && index === 0 ? { seq } : {}),
      };
      return Object.keys(marks).length > 0 ? { ...part, stella: marks } : part;
    }),
  } as Message;
};

export async function importJournal(
  harness: Harness,
  root: Conversation,
  messages: readonly JournalMessage[],
  throughSeq: number,
  context: Context,
  seed?: JournalSeed,
): Promise<number> {
  let state = await harness.snapshot(JournalSyncDoc, root.id, context);
  const checkpoint = seed?.checkpoint;
  if (checkpoint && state?.importedSeq === undefined) {
    state = await harness.commit(async (tx) => {
      const doc = await tx.doc(JournalSyncDoc, root.id);
      if (doc.importedSeq === undefined) {
        await tx.appendEntry(root.id, {
          kind: CompactionEntry.kind,
          head: "self",
          model: [{ role: "user", content: checkpoint.summary, timestamp: Date.now() }],
          data: { reason: "threshold", journalCheckpoint: checkpoint.throughSeq },
        });
        doc.seededFromSeq = seed.fromSeq;
        doc.importedSeq = checkpoint.throughSeq;
      }
      return { ...doc };
    }, context);
  }
  const imported = state?.importedSeq ?? -1;
  const requestId = (seq: number) => (state?.epoch ? `journal:${state.epoch}:${seq}` : `journal:${seq}`);
  let written = 0;
  for (const record of messages) {
    if (record.seq <= imported) continue;
    await root.submit(
      {
        type: "write",
        requestId: requestId(record.seq),
        entry: { kind: ENTRY_KIND[record.role], model: [asWritten(record)], data: { journalSeq: record.seq } },
      },
      context,
    );
    written += 1;
  }
  if (throughSeq > imported) {
    await harness.commit(async (tx) => {
      const doc = await tx.doc(JournalSyncDoc, root.id);
      if (doc.importedSeq === undefined && seed) doc.seededFromSeq = seed.fromSeq;
      doc.importedSeq = Math.max(doc.importedSeq ?? -1, throughSeq);
      return undefined;
    }, context);
  }
  return written;
}
