import { useEffect, useMemo, useState } from "react";
import {
  buildAgentLedger,
  EMPTY_AGENT_LEDGER,
  ledgerLookupIds,
  type AgentLedger,
} from "@stella/contracts/agent-ledger";
import type { AgentThreadSummary } from "@stella/contracts/backend/agent-threads";
import { getBackendClient } from "./backend";

/** The conversation's newest agents read as one list; running ones always come too. */
const LEDGER_PAGE_SIZE = 30;

type Lists = {
  conversationId: string;
  page?: AgentThreadSummary[];
  running?: AgentThreadSummary[];
};

const client = (): ReturnType<typeof getBackendClient> | null => {
  try {
    return getBackendClient();
  } catch {
    return null;
  }
};

/**
 * One cloud conversation's agents from the agent ledger: its newest agents,
 * every running one, and each agent in `ids` (cited in the transcript or
 * running by the journal's word) the list does not hold, looked up singly so
 * the answer says whether the ledger has a row at all. Identical views are
 * shared, so every caller in one conversation rides one subscription.
 * `null` as the conversation means a chat with no ledger: it reads
 * nothing and stays on the journal.
 */
export function useConversationAgentLedger(
  conversationId: string | null,
  wantedIds: readonly string[],
): AgentLedger {
  const idsKey = [...new Set(wantedIds)].join("\n");
  const ids = useMemo(() => (idsKey ? idsKey.split("\n") : []), [idsKey]);
  const [lists, setLists] = useState<Lists | null>(null);
  const [lookups, setLookups] = useState<{
    conversationId: string;
    rows: ReadonlyMap<string, AgentThreadSummary | null>;
  } | null>(null);

  useEffect(() => {
    setLists(null);
    setLookups(null);
    const backend = conversationId ? client() : null;
    if (!conversationId || !backend) return;
    const stops = [
      backend.watch(
        "agentThreads.forConversation",
        { conversationId, limit: LEDGER_PAGE_SIZE },
        (value) =>
          setLists((current) => ({
            ...(current?.conversationId === conversationId ? current : {}),
            conversationId,
            page: value.threads,
          })),
        () => {},
      ),
      backend.watch(
        "agentThreads.running",
        { conversationId },
        (value) =>
          setLists((current) => ({
            ...(current?.conversationId === conversationId ? current : {}),
            conversationId,
            running: value,
          })),
        () => {},
      ),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, [conversationId]);

  const current = lists?.conversationId === conversationId ? lists : null;
  const listed = useMemo(
    () =>
      buildAgentLedger({
        ready: Boolean(current?.page && current.running),
        lists: [current?.page, current?.running],
        citedIds: ids,
      }),
    [current, ids],
  );
  const lookupKey = useMemo(
    () => (listed.ready ? ledgerLookupIds(listed, ids).join("\n") : ""),
    [ids, listed],
  );

  useEffect(() => {
    const backend = conversationId && lookupKey ? client() : null;
    if (!conversationId || !lookupKey || !backend) return;
    const stops = lookupKey.split("\n").map((threadId) =>
      backend.watch(
        "agentThreads.get",
        { conversationId, threadId },
        (thread) =>
          setLookups((previous) => {
            const rows = new Map(
              previous?.conversationId === conversationId ? previous.rows : [],
            );
            rows.set(threadId, thread);
            return { conversationId, rows };
          }),
        () => {},
      ),
    );
    return () => {
      for (const stop of stops) stop();
    };
  }, [conversationId, lookupKey]);

  const lookupRows = useMemo(() => {
    if (lookups?.conversationId !== conversationId || !lookupKey) return null;
    const wanted = new Set(lookupKey.split("\n"));
    const rows = new Map([...lookups.rows].filter(([id]) => wanted.has(id)));
    return rows.size > 0 ? rows : null;
  }, [conversationId, lookupKey, lookups]);
  return useMemo(() => {
    if (!conversationId || !listed.ready) return EMPTY_AGENT_LEDGER;
    if (!lookupRows) return listed;
    return buildAgentLedger({
      ready: true,
      lists: [current?.page, current?.running],
      lookups: lookupRows,
      citedIds: ids,
    });
  }, [conversationId, current, ids, listed, lookupRows]);
}
