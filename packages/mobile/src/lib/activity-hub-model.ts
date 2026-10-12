import type { ActivityIndicatorEntry } from "@stella/contracts/activity-indicator";
import { isTopLevelAgent } from "@stella/contracts/agent-ledger";
import {
  agentWorkCardSections,
  isAgentWorkArtifact,
  isNoiseFileArtifact,
} from "./agent-artifact-consolidation";
import type { ChatArtifact, ChatMessage, MobileTask } from "../types";

/**
 * A `running` snapshot with no fresher evidence than this is treated as
 * settled.
 *
 * The phone's task list is a fold of whatever snapshots reached it — synced
 * message rows and journal records — and nothing guarantees the terminal one
 * ever arrives: the loaded window can simply start after an agent spawned and
 * end before it finished, and a computer that has since gone away reports no
 * authoritative rows to correct it. Those orphans used to read as running
 * forever, which is what put a phantom tally in the top bar and kept the
 * sidebar's rows shimmering with nothing actually in flight.
 *
 * Desktop never had the problem because its rows come straight from the
 * runtime's own lifecycle. The window matches the one the desktop projection
 * and the persisted loader already use (`AGENT_WORK_STALE_MS`), so all three
 * agree on when silence counts as finished.
 */
export const RUNNING_TASK_STALE_MS = 5 * 60_000;

/** Freshest evidence that a task was still alive. */
const lastSeenAt = (task: MobileTask): number =>
  task.updatedAt ?? task.completedAt ?? task.createdAt;

/**
 * Settle `running` tasks that have gone quiet past the stale window.
 *
 * Applied once, where the hub is published, so every surface reading it — the
 * top-bar indicator, its menu, the sidebar's rows and group summaries — agrees
 * without each having to re-derive liveness. Deliberately NOT folded into the
 * task merge itself: that merge's rules let a terminal snapshot beat a running
 * one, so settling there could stop a genuinely long agent's authoritative row
 * from winning. Here it only ever affects what the chrome displays.
 */
export const settleStaleHubTasks = (
  tasks: readonly MobileTask[],
  nowMs: number = Date.now(),
): MobileTask[] =>
  tasks.map((task) => {
    if (task.status !== "running") return task;
    // The journal itself says this agent is working. Silence in the rows this
    // device happens to hold says nothing about that, and settling it here is
    // exactly how a phone that had been closed for a while came back claiming
    // nothing was in progress while several agents were.
    if (task.authoritativeRunning) return task;
    if (nowMs - lastSeenAt(task) <= RUNNING_TASK_STALE_MS) return task;
    const { statusText: _statusText, ...rest } = task;
    return { ...rest, status: "completed" as const };
  });

const hubTaskActivityAt = (task: MobileTask): number =>
  Math.max(task.createdAt, task.updatedAt ?? 0, task.completedAt ?? 0);

const compareHubTasks = (a: MobileTask, b: MobileTask): number => {
  const activeRank = (task: MobileTask) => (task.status === "running" ? 0 : 1);
  return (
    activeRank(a) - activeRank(b) ||
    hubTaskActivityAt(b) - hubTaskActivityAt(a) ||
    b.createdAt - a.createdAt ||
    a.id.localeCompare(b.id)
  );
};

/** Active agents first, then most-recently-active within each status group. */
export const sortHubTasksByRecency = (
  tasks: readonly MobileTask[],
): MobileTask[] => [...tasks].sort(compareHubTasks);

/**
 * The running top-level agents, as the top-bar indicator and its menu read
 * them out: only Stella's own agents, like desktop's top-level work units. An
 * agent's own agents never count, whether or not their parent is listed.
 */
export const runningActivityIndicatorEntries = (
  tasks: readonly MobileTask[],
): ActivityIndicatorEntry[] =>
  sortHubTasksByRecency(
    tasks.filter((task) => isTopLevelAgent(task) && task.status === "running"),
  ).map((task) => ({ id: task.id, title: task.title.trim() }));

/** Full, newest-first artifact dataset for ownership and search. */
export const collectActivityHubArtifacts = (
  messages: readonly Pick<ChatMessage, "artifacts">[],
): ChatArtifact[] => {
  const seen = new Set<string>();
  const out: ChatArtifact[] = [];
  const push = (artifact: ChatArtifact) => {
    if (isNoiseFileArtifact(artifact) || seen.has(artifact.id)) return;
    seen.add(artifact.id);
    out.push(artifact);
  };

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    for (const artifact of messages[index].artifacts ?? []) {
      if (isAgentWorkArtifact(artifact)) {
        for (const section of agentWorkCardSections(artifact) ?? []) {
          for (const file of section.files) push(file);
        }
        continue;
      }
      push(artifact);
    }
  }
  return out;
};