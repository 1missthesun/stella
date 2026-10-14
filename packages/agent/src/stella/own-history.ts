/**
 * An agent's own history: `history.search`, `history.read` and `history.sql`
 * in its `code` tool, answered from its own transcript and nothing else.
 *
 * The thread is the agent's conversation in this harness, found by its thread
 * id under the orchestrator. What it holds: its brief and the messages it was
 * given, what it said, and the reports and messages of the agents it started,
 * compacted parts included (compaction leaves the entries in place, and a
 * host that moves the oldest of them out of its store hands them back through
 * `archived`). The conversation it was started from and other agents'
 * threads are never read.
 */
import type { Context } from "@earendil-works/chord";
import type { ConversationId, EntryId, EntryRecord, Harness } from "@earendil-works/pi-durable";
import { answerOwnHistory, withoutThinking, type OwnHistoryRow, type OwnHistorySql } from "@stella/contracts/history-search";
import { MAX_AGENT_DEPTH } from "./agent-doc.ts";
import { StellaAgentsDoc } from "./agents.ts";

const PAGE = 500;

const ROLE_OF: Record<string, OwnHistoryRow["role"]> = {
  "pi.user": "user",
  "pi.assistant": "assistant",
  "pi.tool-result": "toolResult",
};

/** The agent's conversation, by its thread id, anywhere under the orchestrator. */
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

/** Entries a host moved out of its store, oldest first, all older than any it still holds. */
export type ArchivedEntries = (conversationId: ConversationId) => Promise<readonly EntryRecord[]>;

/** Every message of the conversation, oldest first. */
const threadRows = async (
  harness: Harness,
  conversationId: ConversationId,
  context: Context,
  archived?: ArchivedEntries,
): Promise<OwnHistoryRow[]> => {
  const rows: OwnHistoryRow[] = [];
  let after = 0;
  const take = (entry: EntryRecord) => {
    const role = ROLE_OF[entry.kind];
    const message = entry.model?.[0] as { timestamp?: unknown } | undefined;
    if (role && message) {
      rows.push({
        seq: Number(entry.id),
        kind: "message",
        turnId: `entry:${entry.id}`,
        createdAtMs: typeof message.timestamp === "number" ? message.timestamp : 0,
        role,
        payload: withoutThinking(message),
      });
    }
    after = Number(entry.id);
  };
  for (const entry of archived ? await archived(conversationId) : []) take(entry);
  for (;;) {
    const page = await harness.commit(
      async (tx) =>
        (await tx.scanEntries({ conversationId, order: "ascending", minEntryId: (after + 1) as EntryId }, PAGE)).items,
      context,
    );
    for (const entry of page as readonly EntryRecord[]) take(entry);
    if (page.length < PAGE) return rows;
  }
};

/** Answer one `history.*` call of the agent with `threadId`, from its own thread. */
export const ownHistoryQuery = async (
  harness: Harness,
  root: ConversationId,
  threadId: string,
  args: Record<string, unknown>,
  context: Context,
  sql?: OwnHistorySql,
  archived?: ArchivedEntries,
): Promise<unknown> => {
  const conversationId = await threadConversation(harness, root, threadId, context);
  if (conversationId === undefined) throw new Error("Your history is unavailable here.");
  return answerOwnHistory(await threadRows(harness, conversationId, context, archived), args, sql);
};
