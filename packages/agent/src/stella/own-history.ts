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
