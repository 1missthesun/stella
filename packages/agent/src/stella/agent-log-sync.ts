import type { Context } from "@earendil-works/chord";
import type { Message } from "@earendil-works/pi-ai";
import {
  CompactionEntry,
  defineDoc,
  defineExtension,
  GenerationTask,
  hook,
  ROOT_CONVERSATION_ID,
  type Conversation,
  type ConversationId,
  type EntryId,
  type EntryRecord,
  type Extension,
  type Harness,
} from "@earendil-works/pi-durable";
import {
  AGENT_LOG_MOVED_REASON,
  AGENT_LOG_RECORD_MAX_BYTES,
  type AgentLogCalls,
  type AgentLogRecordDraft,
} from "@stella/contracts/backend/agent-logs";
import { StellaAgentDoc } from "./agent-doc.ts";
import { importJournal, journalSeqOf, JournalSyncDoc, type JournalMessage, type JournalSeed } from "./journal-sync.ts";

export type AgentLogState = {
  syncId?: string;
  mirrored?: number;
  ackedSeq?: number;
  released?: true;
};

export const AgentLogDoc = defineDoc<AgentLogState>({
  kind: "stella.agent-log",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({}),
});

export type AgentLogTransport = {
  holder: string;
  conversationId: string;
  append(args: { threadId: string; records: AgentLogRecordDraft[] }): Promise<AgentLogCalls["agentLogs.append"]["result"]>;
  read(args: { threadId: string; afterSeq: number }): Promise<AgentLogCalls["agentLogs.read"]["result"]>;
};

export type AgentLogAppendStat = { threadId: string; records: number; bytes: number; ms: number };

const ROLE_OF_KIND: Record<string, "user" | "assistant" | "toolResult" | undefined> = {
  "pi.user": "user",
  "pi.assistant": "assistant",
  "pi.tool-result": "toolResult",
};

const PAGE = 100;
const APPEND_BATCH_BYTES = 768 * 1024;
const RETRY_MS = [1_000, 5_000, 15_000, 60_000];
const RECORD_SLACK_BYTES = 4 * 1024;

const recordKey = (syncId: string, entry: EntryId | number) => `${syncId}:${entry}`;

/**
 * A message as the log holds it: whole when it fits a record, else with its
 * images dropped and its text cut, saying so, so the next holder still reads
 * what it was.
 */
export const boundedMessageJson = (message: Message): string => {
  const whole = JSON.stringify(message);
  const limit = AGENT_LOG_RECORD_MAX_BYTES - RECORD_SLACK_BYTES;
  if (whole.length <= limit) return whole;
  if (typeof message.content === "string") {
    return JSON.stringify({ ...message, content: `${message.content.slice(0, limit / 2)}\n[cut: over the sync limit]` });
  }
  const parts = message.content as Array<{ type: string; text?: string; [key: string]: unknown }>;
  const texts = parts.filter((part) => part.type === "text").length || 1;
  const share = Math.floor(limit / 2 / texts);
  const content = parts.map((part) =>
    part.type === "image"
      ? { type: "text", text: "[an image, not synced]" }
      : part.type === "text" && typeof part.text === "string" && part.text.length > share
        ? { ...part, text: `${part.text.slice(0, share)}\n[cut: over the sync limit]` }
        : part,
  );
  const bounded = JSON.stringify({ ...message, content });
  return bounded.length <= limit ? bounded : JSON.stringify({ ...message, content: [{ type: "text", text: "[a message over the sync limit]" }] });
};

const refusedAsMoved = (error: unknown): boolean =>
  (error as { reason?: unknown } | null)?.reason === AGENT_LOG_MOVED_REASON ||
  (error as { data?: { reason?: unknown } } | null)?.data?.reason === AGENT_LOG_MOVED_REASON ||
  String((error as { message?: unknown } | null)?.message ?? "").includes(AGENT_LOG_MOVED_REASON);

export function agentLogSync(options: {
  harness: () => Harness | undefined;
  transport: () => AgentLogTransport | undefined;
  report: (error: unknown) => void;
  onAppend?: (stat: AgentLogAppendStat) => void;
  /** Readies a message for the log, such as bringing stored images back inline; runs one entry at a time. */
  prepare?: (message: Message) => Promise<Message>;
  context: Context;
}) {
  const { context } = options;
  const running = new Map<number, Promise<void>>();
  const again = new Set<number>();
  const retries = new Map<number, number>();

  const syncOnce = async (harness: Harness, transport: AgentLogTransport, conversationId: ConversationId): Promise<void> => {
    const role = await harness.snapshot(StellaAgentDoc, conversationId, context);
    if (role?.agentType !== "general" || !role.threadId) return;
    const threadId = role.threadId;
    const state = (await harness.snapshot(AgentLogDoc, conversationId, context)) ?? {};
    if (state.released) return;
    const syncId = state.syncId ?? crypto.randomUUID().replaceAll("-", "").slice(0, 16);
    let mirrored = state.mirrored ?? 0;
    let acked = state.ackedSeq;
    const save = () =>
      harness.commit(async (tx) => {
        const doc = await tx.doc(AgentLogDoc, conversationId);
        doc.syncId = syncId;
        doc.mirrored = Math.max(doc.mirrored ?? 0, mirrored);
        if (acked !== undefined) doc.ackedSeq = Math.max(doc.ackedSeq ?? -1, acked);
        return undefined;
      }, context);
    for (;;) {
      const page = await harness.commit(
        async (tx) => (await tx.scanEntries({ conversationId, minEntryId: (mirrored + 1) as EntryId, order: "ascending" }, PAGE)).items,
        context,
      );
      if (page.length === 0) break;
      let batch: AgentLogRecordDraft[] = [];
      let bytes = 0;
      let through = mirrored;
      const send = async () => {
        if (batch.length > 0) {
          const started = performance.now();
          const result = await transport.append({ threadId, records: batch });
          options.onAppend?.({ threadId, records: batch.length, bytes, ms: Math.round(performance.now() - started) });
          acked = Math.max(acked ?? -1, result.throughSeq);
        }
        mirrored = through;
        batch = [];
        bytes = 0;
        await save();
      };
      // Drafted one entry at a time so a page of image-heavy entries never sits inline in memory at once.
      for (const entry of page) {
        const draft = await draftOf(harness, entry, syncId, context, options.prepare);
        if (draft) {
          const size = draft.payloadJson.length + draft.key.length;
          if (batch.length > 0 && bytes + size > APPEND_BATCH_BYTES) await send();
          batch.push(draft);
          bytes += size;
        }
        through = entry.id;
      }
      await send();
      if (page.length < PAGE) break;
    }
  };

  const run = (conversationId: ConversationId): Promise<void> => {
    const current = running.get(conversationId);
    if (current) {
      again.add(conversationId);
      return current;
    }
    const work = (async () => {
      try {
        do {
          again.delete(conversationId);
          const harness = options.harness();
          const transport = options.transport();
          if (!harness || !transport) return;
          try {
            await syncOnce(harness, transport, conversationId);
            retries.delete(conversationId);
          } catch (error) {
            if (refusedAsMoved(error)) {
              await harness.commit(async (tx) => {
                (await tx.doc(AgentLogDoc, conversationId)).released = true;
                return undefined;
              }, context);
              return;
            }
            const attempt = retries.get(conversationId) ?? 0;
            retries.set(conversationId, attempt + 1);
            setTimeout(() => void run(conversationId).catch(() => undefined), RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]);
            throw error;
          }
        } while (again.has(conversationId));
      } finally {
        running.delete(conversationId);
      }
    })();
    running.set(conversationId, work);
    return work;
  };

  const kick = (conversationId: ConversationId) => {
    if (conversationId === ROOT_CONVERSATION_ID) return;
    void run(conversationId).catch(options.report);
  };

  const flush = async (conversationId: ConversationId): Promise<void> => {
    for (let pass = 0; pass < 3; pass += 1) {
      await running.get(conversationId)?.catch(() => undefined);
      await run(conversationId);
      if (!running.has(conversationId) && !again.has(conversationId)) return;
    }
  };

  const extension = (): Extension =>
    defineExtension({
      name: "stella-agent-log-sync",
      hooks: [
        hook(GenerationTask, {
          beforeRequest: (_request, api) => {
            kick(api.conversationId);
            return undefined;
          },
          afterTools: (_assistant, _results, api) => {
            kick(api.conversationId);
          },
        }),
      ],
    });

  return { kick, flush, extension };
}

export type AgentLogSync = ReturnType<typeof agentLogSync>;

const draftOf = async (
  harness: Harness,
  entry: EntryRecord,
  syncId: string,
  context: Context,
  prepare?: (message: Message) => Promise<Message>,
): Promise<AgentLogRecordDraft | undefined> => {
  if (journalSeqOf(entry) !== undefined) return undefined;
  const message = entry.model?.[0] as Message | undefined;
  const role = ROLE_OF_KIND[entry.kind];
  if (role && message) {
    const ready = prepare ? await prepare(message) : message;
    return { key: recordKey(syncId, entry.id), role, payloadJson: boundedMessageJson(ready) };
  }
  if (entry.kind !== CompactionEntry.kind || !message || message.role !== "user") return undefined;
  if ((entry.data as { journalCheckpoint?: unknown } | undefined)?.journalCheckpoint !== undefined) return undefined;
  const summary = typeof message.content === "string" ? message.content : message.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
  if (!summary.trim() || entry.head === undefined) return undefined;
  const kept = await harness.commit(async (tx) => tx.entry(entry.head as EntryId), context);
  const keptSeq = journalSeqOf(kept);
  return {
    key: recordKey(syncId, entry.id),
    role: "checkpoint",
    payloadJson: JSON.stringify({
      summary: summary.slice(0, AGENT_LOG_RECORD_MAX_BYTES - RECORD_SLACK_BYTES),
      ...(keptSeq !== undefined ? { firstKeptSeq: keptSeq } : { firstKeptKey: recordKey(syncId, entry.head) }),
    }),
  };
};

export async function importAgentLog(
  harness: Harness,
  conversation: Conversation,
  transport: AgentLogTransport,
  threadId: string,
  context: Context,
): Promise<{ imported: number; cwd?: string; holder?: string }> {
  const state = (await harness.snapshot(AgentLogDoc, conversation.id, context)) ?? {};
  const synced = await harness.snapshot(JournalSyncDoc, conversation.id, context);
  const fresh = synced?.importedSeq === undefined && state.ackedSeq === undefined;
  let after = Math.max(synced?.importedSeq ?? -1, state.ackedSeq ?? -1);
  const own = state.syncId ? `${state.syncId}:` : undefined;
  let imported = 0;
  let cwd: string | undefined;
  let holder: string | undefined;
  let seed: JournalSeed | undefined;
  for (let first = true; ; first = false) {
    const page = await transport.read({ threadId, afterSeq: after });
    cwd ??= page.cwd;
    holder ??= page.holder;
    if (first && fresh && page.checkpoint) {
      seed = {
        fromSeq: page.checkpoint.throughSeq + 1,
        checkpoint: { summary: page.checkpoint.summary, throughSeq: page.checkpoint.throughSeq },
      };
    }
    const messages: JournalMessage[] = [];
    for (const record of page.records) {
      if (record.role === "checkpoint" || (own && record.key.startsWith(own))) continue;
      let message: Message;
      try {
        message = JSON.parse(record.payloadJson) as Message;
      } catch {
        continue;
      }
      messages.push({ seq: record.seq, turnId: "", role: record.role, hidden: false, message });
    }
    const through = page.records.at(-1)?.seq ?? (seed ? seed.fromSeq - 1 : after);
    if (messages.length > 0 || seed || through > after) {
      imported += await importJournal(harness, conversation, messages, through, context, seed);
    }
    seed = undefined;
    if (page.complete || through <= after) break;
    after = through;
  }
  if (state.released && holder === transport.holder) {
    await harness.commit(async (tx) => {
      delete (await tx.doc(AgentLogDoc, conversation.id)).released;
      return undefined;
    }, context);
  }
  return { imported, ...(cwd ? { cwd } : {}), ...(holder ? { holder } : {}) };
}
