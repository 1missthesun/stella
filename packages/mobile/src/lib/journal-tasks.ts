import {
  emptyAgentActivityState,
  foldAgentActivity,
  type AgentActivityEntry,
} from "@stella/contracts/conversation-agent-activity";
import type { MobileTask } from "../types";
import {
  hasToolCalls,
  type JournalRecord,
} from "@stella/contracts/conversation-protocol";
import type { JournalView } from "./journal-index";
import {
  agentTaskStatus,
  type AgentLedger,
  type LedgerAgent,
} from "@stella/contracts/agent-ledger";

export const agentSnapshotTasks = (
  agents: readonly AgentActivityEntry[],
): MobileTask[] =>
  agents.map((agent) => ({
    id: agent.agentId,
    title: agent.title,
    status: "running" as const,
    authoritativeRunning: true as const,
    createdAt: agent.createdAtMs,
    updatedAt: agent.updatedAtMs,
    ...(agent.agentType ? { agentType: agent.agentType } : {}),
    ...(agent.statusText ? { statusText: agent.statusText } : {}),
  }));

/**
 * Re-stamps `authoritativeRunning` after a merge.
 *
 * The merge rules prefer whichever snapshot is newer and copy only a few named
 * fields forward, so a row the server named as running can come out of a merge
 * carrying a local fold's shape instead. The server's word is about the agent,
 * not about one snapshot of it, so it is applied again afterwards — and only to
 * rows the merge still considers running, because a terminal row this device
 * genuinely saw is newer evidence than the list.
 */
export const markAuthoritativeRunning = (
  tasks: readonly MobileTask[],
  agents: readonly AgentActivityEntry[],
): MobileTask[] => {
  if (agents.length === 0) return [...tasks];
  const running = new Set(agents.map((agent) => agent.agentId));
  return tasks.map((task) =>
    task.status === "running" &&
    !task.authoritativeRunning &&
    running.has(task.id)
      ? { ...task, authoritativeRunning: true as const }
      : task,
  );
};

/**
 * The server's running-agent list is what runs. A row the record fold left
 * running and the list does not name has ended, or never ran at all (a start
 * card whose end was never written): it reads as done. Except a row started
 * after the list was read (`listedAtMs`, the server's clock as records'
 * times are), which the next list has yet to name.
 */
export const settleUnlistedTasks = (
  tasks: readonly MobileTask[],
  agents: readonly AgentActivityEntry[],
  listedAtMs: number,
): MobileTask[] => {
  const listed = new Set(agents.map((agent) => agent.agentId));
  return tasks.map((task) => {
    if (task.status !== "running" || listed.has(task.id) || task.createdAt > listedAtMs) {
      return task;
    }
    const { statusText: _statusText, ...rest } = task;
    return { ...rest, status: "completed" as const, completedAt: rest.updatedAt ?? rest.createdAt };
  });
};

const journalTask = (
  entry: AgentActivityEntry,
  listed: ReadonlySet<string>,
): MobileTask => ({
  id: entry.agentId,
  title: entry.title,
  status: entry.status,
  createdAt: entry.createdAtMs,
  updatedAt: entry.updatedAtMs,
  ...(entry.status === "running" && listed.has(entry.agentId)
    ? { authoritativeRunning: true as const }
    : {}),
  ...(entry.agentType ? { agentType: entry.agentType } : {}),
  ...(entry.statusText ? { statusText: entry.statusText } : {}),
  ...(entry.completedAtMs !== undefined ? { completedAt: entry.completedAtMs } : {}),
  ...(entry.result ? { resultText: entry.result } : {}),
  ...(entry.error ? { errorMessage: entry.error } : {}),
});

/** The records `foldAgentActivity` reads; the rest of the journal never changes a task. */
export const JOURNAL_TASK_RECORDS: JournalView = {
  id: "journal-tasks",
  test: (record) => {
    if (record.kind === "card") return true;
    if (record.kind !== "message") return false;
    if (record.role === "toolResult") return true;
    if (record.role === "user") return record.hidden;
    return record.role === "assistant" && hasToolCalls(record.payload);
  },
};

export const collectJournalTasks = (
  records: readonly JournalRecord[],
  runningAgents: readonly AgentActivityEntry[] = [],
): MobileTask[] => {
  const state = emptyAgentActivityState();
  for (const agent of runningAgents) state.entries.set(agent.agentId, agent);
  foldAgentActivity(state, records, { outcomes: true });
  const listed = new Set(runningAgents.map((agent) => agent.agentId));
  return [...state.entries.values()].map((entry) => journalTask(entry, listed));
};

const ledgerTask = (id: string, row: LedgerAgent, base?: MobileTask): MobileTask => {
  const status = agentTaskStatus(row.status);
  const {
    statusText,
    authoritativeRunning: _authoritativeRunning,
    completedAt,
    errorMessage,
    ...rest
  } = base ?? { id, title: row.title, createdAt: row.createdAtMs };
  const failure = status === "error" ? (row.errorMessage ?? errorMessage) : undefined;
  return {
    ...rest,
    id,
    title: row.title || rest.title,
    agentType: row.agentType,
    ...(row.parentAgentId ? { parentAgentId: row.parentAgentId } : {}),
    status,
    createdAt: base?.createdAt ?? row.createdAtMs,
    updatedAt: Math.max(row.updatedAtMs, base?.updatedAt ?? 0),
    ...(status === "running"
      ? { authoritativeRunning: true as const, ...(statusText ? { statusText } : {}) }
      : { completedAt: completedAt ?? row.updatedAtMs }),
    ...(failure ? { errorMessage: failure } : {}),
  };
};

export const applyAgentLedger = (
  tasks: readonly MobileTask[],
  ledger: AgentLedger,
): MobileTask[] => {
  if (!ledger.ready) return [...tasks];
  const covered = new Set<string>();
  const merged = tasks.map((task) => {
    const row = ledger.agents.get(task.id);
    if (!row) return task;
    covered.add(row.agentId);
    return ledgerTask(task.id, row, task);
  });
  for (const row of ledger.agents.values()) {
    if (!row || covered.has(row.agentId)) continue;
    covered.add(row.agentId);
    merged.push(ledgerTask(row.agentId, row));
  }
  return merged;
};
