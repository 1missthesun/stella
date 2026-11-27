import type { Context } from "@earendil-works/chord/context";
import type { ConversationId, EntryId, EntryRecord, Harness } from "@earendil-works/pi-durable";
import { answerOwnHistory, withoutThinking, type OwnHistoryRow } from "@stella/contracts/history-search";
import { MAX_AGENT_DEPTH } from "./agent-doc.ts";
import { StellaAgentsDoc } from "./agents.ts";
import { SAFEGUARD_ENTRY_KIND, type SafeguardEntryData } from "./safeguard.ts";

const PAGE = 500;

const ROLE_OF: Record<string, OwnHistoryRow["role"]> = {
  "pi.user": "user",
  "pi.assistant": "assistant",
  "pi.tool-result": "toolResult",
};

const threadConversation = async (
  harness: Harness,
  root: ConversationId,
  threadId: string,
  context: Context,
): Promise<ConversationId | undefined> => {
  const visit = async (conversationId: ConversationId, depth: number): Promise<ConversationId | undefined> => {
    const agents = (await harness.snapshot(StellaAgentsDoc, conversationId, context))?.agents ?? {};
    const own = agents[threadId];
    if (own && !own.remote && own.conversationId >= 0) return own.conversationId as ConversationId;
    if (depth >= MAX_AGENT_DEPTH) return undefined;
    for (const agent of Object.values(agents)) {
      if (agent.remote || agent.conversationId < 0) continue;
      const found = await visit(agent.conversationId as ConversationId, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return await visit(root, 0);
};

export type ArchivedEntries = (conversationId: ConversationId) => Promise<readonly EntryRecord[]>;

/** What one entry adds to a thread's history: a message row, and/or earlier rows a safeguard removed. */
export const historyEntryEffect = (entry: EntryRecord): { row?: OwnHistoryRow; removes?: readonly number[] } => {
  const data = entry.kind === SAFEGUARD_ENTRY_KIND ? (entry.data as SafeguardEntryData | undefined) : undefined;
  const removes = data?.state === "removed" ? data.targets : undefined;
  const role = ROLE_OF[entry.kind];
  const message = entry.model?.[0] as { timestamp?: unknown } | undefined;
  const row: OwnHistoryRow | undefined =
    role && message
      ? {
          seq: Number(entry.id),
          kind: "message",
          turnId: `entry:${entry.id}`,
          createdAtMs: typeof message.timestamp === "number" ? message.timestamp : 0,
          role,
          payload: withoutThinking(message),
        }
      : undefined;
  return { ...(row ? { row } : {}), ...(removes ? { removes } : {}) };
};

/** One page of a thread's entries after `after`, oldest first; `done` once nothing follows it. */
export type HistoryEntriesAfter = (after: number) => Promise<{ entries: readonly EntryRecord[]; done: boolean }>;

/** Answers a history query for a thread from an index it keeps up to date through `entriesAfter`. */
export type OwnHistoryIndex = (
  conversationId: ConversationId,
  entriesAfter: HistoryEntriesAfter,
  args: Record<string, unknown>,
) => Promise<unknown>;

const entriesAfterIn =
  (harness: Harness, conversationId: ConversationId, context: Context): HistoryEntriesAfter =>
  async (after) => {
    const page = await harness.commit(
      async (tx) => await tx.scanEntries({ conversationId, order: "ascending", minEntryId: (after + 1) as EntryId }, PAGE),
      context,
    );
    return { entries: page.items as readonly EntryRecord[], done: page.next === undefined };
  };

const threadRows = async (
  harness: Harness,
  conversationId: ConversationId,
  context: Context,
  archived?: ArchivedEntries,
): Promise<OwnHistoryRow[]> => {
  const rows: OwnHistoryRow[] = [];
  const removed = new Set<number>();
  let after = 0;
  const take = (entry: EntryRecord) => {
    const effect = historyEntryEffect(entry);
    for (const target of effect.removes ?? []) removed.add(target);
    if (effect.row) rows.push(effect.row);
    after = Number(entry.id);
  };
  for (const entry of archived ? await archived(conversationId) : []) take(entry);
  const entriesAfter = entriesAfterIn(harness, conversationId, context);
  for (;;) {
    const page = await entriesAfter(after);
    for (const entry of page.entries) take(entry);
    if (page.done) return removed.size > 0 ? rows.filter((row) => !removed.has(row.seq)) : rows;
  }
};

export const ownHistoryQuery = async (
  harness: Harness,
  root: ConversationId,
  threadId: string,
  args: Record<string, unknown>,
  context: Context,
  index?: OwnHistoryIndex,
  archived?: ArchivedEntries,
): Promise<unknown> => {
  const conversationId = await threadConversation(harness, root, threadId, context);
  if (conversationId === undefined) throw new Error("Your history is unavailable here.");
  if (index && !archived) return await index(conversationId, entriesAfterIn(harness, conversationId, context), args);
  return answerOwnHistory(await threadRows(harness, conversationId, context, archived), args);
};
