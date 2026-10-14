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
  ready: boolean;
  agents: ReadonlyMap<string, LedgerAgent | null>;
};

export const EMPTY_AGENT_LEDGER: AgentLedger = {
  ready: false,
  agents: new Map(),
};

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

export const isTopLevelAgent = (agent: { parentAgentId?: string }): boolean =>
  !agent.parentAgentId;

export const agentTaskStatus = (status: AgentStatus): TaskLifecycleStatus => {
  switch (status) {
    case "completed":
    case "canceled":
      return status;
    case "failed":
      return "error";
    default:
      return "running";
  }
};

export const ledgerThreadTaskStatus = (status: string): TaskLifecycleStatus =>
  agentTaskStatus(agentStatusOf(status) ?? "failed");

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
