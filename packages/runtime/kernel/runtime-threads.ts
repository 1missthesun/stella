/**
 * Active work is budgeted in SLOTS, not raw threads: a thread group
 * (several related threads spawned for one request) occupies one slot,
 * and an ungrouped thread is its own slot. Eviction flips whole slots
 * to 'evicted'; the rows survive and stay resumable via `send_message`
 * and stay in the `thread` table.
 */
import type { TaskLifecycleStatus } from "@stella/contracts/agent-runtime";

export type RuntimeThreadRecord = {
  conversationId: string;
  threadId: string;
  name: string;
  agentType: string;
  // Slot/eviction state, NOT execution state: "active" means the thread
  // still occupies a live roster slot (vs "evicted" — dropped from the
  // budget but resumable). This says nothing about whether the agent is
  // currently running a turn; that is `agentStatus`.
  status: "active" | "evicted";
  createdAt: number;
  lastUsedAt: number;
  // Live lifecycle status of the agent bound to this thread, sourced from
  // `runtime_agents.status`. "running" means the agent is executing a turn
  // right now; any terminal value (or absence) means it is idle/resumable.
  // This is the single source of truth for the active-vs-paused distinction
  // surfaced to the orchestrator.
  agentStatus?: TaskLifecycleStatus;
  // When the agent record was last written (turn start / terminal). Folded
  // into the last-active timestamp so a currently-running thread reads as
  // freshly active even if the durable thread row wasn't touched this turn.
  agentUpdatedAt?: number;
  description?: string;
  summary?: string;
};

/**
 * The one place the orchestrator-facing active-vs-paused distinction is
 * derived. Per the product model there is no "dead" thread: a thread is
 * either actively executing a turn or paused (idle but resumable). Only a
 * live "running" agent record counts as active; everything else — a
 * terminal run outcome or no agent record at all — is paused.
 */
export type RuntimeThreadLiveState = "active" | "paused";

export const deriveRuntimeThreadLiveState = (
  record: Pick<RuntimeThreadRecord, "agentStatus">,
): RuntimeThreadLiveState =>
  record.agentStatus === "running" ? "active" : "paused";
