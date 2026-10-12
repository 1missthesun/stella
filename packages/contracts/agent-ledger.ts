/**
 * A conversation's agents as the owner's agent ledger records them
 * (`agentThreads.forConversation`, `agentThreads.running`, and
 * `agentThreads.get` for one agent): status, title and which of them run.
 * Clients read these here instead of folding journal cards and wake prompts.
 * Journal cards stay where an agent's report sits in the chat and join this
 * by agent id, in whatever order they arrived.
 *
 * The journal fold is the fallback, agent by agent: for a chat stored only on
 * this computer (no ledger), for an agent from before ledger rows (the ledger
 * answers that it has no row), and while the ledger has not answered or
 * cannot be reached.
 */

import type { TaskLifecycleStatus } from "./agent-runtime.js";
import {
  agentStatusOf,
  type AgentStatus,
} from "./agent-status.js";
import type { AgentThreadSummary } from "./backend/agent-threads.js";
import {
  isPlacementThreadId,
  placementAliases,
} from "./placement-thread-id.js";

export type LedgerAgent = {
  agentId: string;
  title: string;
  status: AgentStatus;
  agentType: string;
  parentAgentId?: string;
  attemptGeneration: number;
  createdAtMs: number;
  updatedAtMs: number;
  errorMessage?: string;
};

export type AgentLedger = {
  /** The conversation's agent list has loaded. False for a chat with no ledger, or one still loading or unreachable. */
  ready: boolean;
  /**
   * What the ledger answered per agent id, including the placement ids older
   * transcripts cite an agent by: its row, or null when it has none.
   * An id it has not answered for is absent.
   */
  agents: ReadonlyMap<string, LedgerAgent | null>;
};

export const EMPTY_AGENT_LEDGER: AgentLedger = {
  ready: false,
  agents: new Map(),
};

/** How many agents one client looks up singly, beyond the conversation's list. */
export const LEDGER_LOOKUP_LIMIT = 24;

export const ledgerAgentFromThread = (
  thread: AgentThreadSummary,
): LedgerAgent => ({
  agentId: thread.threadId,
  title: thread.description.trim(),
  status: agentStatusOf(thread.status) ?? "failed",
  agentType: thread.agentType || "general",
  ...(thread.parentThreadId ? { parentAgentId: thread.parentThreadId } : {}),
  attemptGeneration: thread.attemptGeneration,
  createdAtMs: thread.createdAt,
  updatedAtMs: thread.updatedAt,
  ...(thread.errorMessage?.trim()
    ? { errorMessage: thread.errorMessage.trim() }
    : {}),
});

/**
 * Whether an agent is one of the orchestrator's own: Stella started it, so it
 * has no parent agent. Only these count toward push notifications, the
 * top-bar agents list and the in-progress count; an agent's own agents never
 * do, whatever engine runs them and wherever they run.
 */
export const isTopLevelAgent = (agent: { parentAgentId?: string }): boolean =>
  !agent.parentAgentId;

/** An agent's status as a task's: anything still working reads as running, and paused stays paused. */
export const agentTaskStatus = (status: AgentStatus): TaskLifecycleStatus => {
  switch (status) {
    case "completed":
    case "canceled":
    case "paused":
      return status;
    case "failed":
      return "error";
    default:
      return "running";
  }
};

/** A ledger row's status word as a task's status. */
export const ledgerThreadTaskStatus = (status: string): TaskLifecycleStatus =>
  agentTaskStatus(agentStatusOf(status) ?? "failed");

/**
 * The ledger from what a client has read: the conversation's lists (newest
 * row wins), single lookups (null where the ledger has no row), and the
 * placement ids the transcript cites, resolved to the cloud thread they
 * hash from.
 */
export const buildAgentLedger = (args: {
  ready: boolean;
  lists: readonly (readonly AgentThreadSummary[] | undefined)[];
  lookups?: ReadonlyMap<string, AgentThreadSummary | null>;
  citedIds?: Iterable<string>;
}): AgentLedger => {
  const rows = new Map<string, LedgerAgent>();
  const keep = (thread: AgentThreadSummary) => {
    const current = rows.get(thread.threadId);
    if (!current || thread.updatedAt >= current.updatedAtMs) {
      rows.set(thread.threadId, ledgerAgentFromThread(thread));
    }
  };
  for (const list of args.lists) for (const thread of list ?? []) keep(thread);
  const agents = new Map<string, LedgerAgent | null>(rows);
  for (const [id, thread] of args.lookups ?? []) {
    if (!thread) {
      if (!agents.has(id)) agents.set(id, null);
      continue;
    }
    keep(thread);
    const row = rows.get(thread.threadId)!;
    agents.set(thread.threadId, row);
    agents.set(id, row);
  }
  const placed = [...(args.citedIds ?? [])].filter(
    (id) => isPlacementThreadId(id) && !agents.get(id),
  );
  if (placed.length > 0) {
    const aliases = placementAliases(rows.keys());
    for (const id of placed) {
      const row = rows.get(aliases.get(id) ?? "");
      if (row) agents.set(id, row);
    }
  }
  return { ready: args.ready, agents };
};

/**
 * The agents worth asking the ledger about one by one: ones the transcript
 * cites or the journal shows running that the conversation's list does not
 * hold. The newest-cited first, at most `limit` of them.
 */
export const ledgerLookupIds = (
  ledger: AgentLedger,
  ids: Iterable<string>,
  limit = LEDGER_LOOKUP_LIMIT,
): string[] => {
  const wanted: string[] = [];
  for (const id of ids) {
    if (!id || wanted.includes(id) || ledger.agents.get(id)) continue;
    wanted.push(id);
  }
  return wanted.slice(-limit).sort();
};
