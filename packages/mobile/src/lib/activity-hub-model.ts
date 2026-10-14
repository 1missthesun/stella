import type { ActivityIndicatorEntry } from "@stella/contracts/activity-indicator";
import { isTopLevelAgent } from "@stella/contracts/agent-ledger";
import {
  agentWorkCardSections,
  isAgentWorkArtifact,
  isNoiseFileArtifact,
} from "./agent-artifact-consolidation";
import type { ChatArtifact, ChatMessage, MobileTask } from "../types";

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

export const sortHubTasksByRecency = (
  tasks: readonly MobileTask[],
): MobileTask[] => [...tasks].sort(compareHubTasks);

export const runningActivityIndicatorEntries = (
  tasks: readonly MobileTask[],
): ActivityIndicatorEntry[] =>
  sortHubTasksByRecency(
    tasks.filter((task) => isTopLevelAgent(task) && task.status === "running"),
  ).map((task) => ({ id: task.id, title: task.title.trim() }));

const NO_ARTIFACTS: readonly ChatArtifact[] = [];

const messageHubArtifacts = (
  message: Pick<ChatMessage, "artifacts">,
): readonly ChatArtifact[] => {
  if (!message.artifacts?.length) return NO_ARTIFACTS;
  const out: ChatArtifact[] = [];
  for (const artifact of message.artifacts) {
    if (isAgentWorkArtifact(artifact)) {
      for (const section of agentWorkCardSections(artifact) ?? []) out.push(...section.files);
      continue;
    }
    out.push(artifact);
  }
  return out.length ? out : NO_ARTIFACTS;
};

/**
 * Artifacts for the activity hub, newest first and deduplicated by id. Reads
 * only messages after the unchanged start of the transcript and returns the
 * previous list when no artifact came or went.
 */
export const createActivityHubArtifacts = () => {
  let previous: {
    messages: readonly Pick<ChatMessage, "artifacts">[];
    perMessage: (readonly ChatArtifact[])[];
    result: ChatArtifact[];
  } | null = null;
  return (messages: readonly Pick<ChatMessage, "artifacts">[]): ChatArtifact[] => {
    let kept = 0;
    if (previous) {
      const shared = Math.min(messages.length, previous.messages.length);
      while (kept < shared && messages[kept] === previous.messages[kept]) kept += 1;
    }
    const perMessage = previous ? previous.perMessage.slice(0, kept) : [];
    let changed = !previous;
    for (let at = kept; at < messages.length; at += 1) {
      const list = messageHubArtifacts(messages[at]!);
      perMessage.push(list);
      if (list !== (previous?.perMessage[at] ?? NO_ARTIFACTS)) changed = true;
    }
    if (previous && previous.perMessage.length !== perMessage.length) {
      for (let at = perMessage.length; at < previous.perMessage.length; at += 1) {
        if (previous.perMessage[at]!.length) changed = true;
      }
    }
    if (!changed && previous) {
      previous = { messages, perMessage, result: previous.result };
      return previous.result;
    }
    const seen = new Set<string>();
    const result: ChatArtifact[] = [];
    for (let at = perMessage.length - 1; at >= 0; at -= 1) {
      for (const artifact of perMessage[at]!) {
        if (isNoiseFileArtifact(artifact) || seen.has(artifact.id)) continue;
        seen.add(artifact.id);
        result.push(artifact);
      }
    }
    previous = { messages, perMessage, result };
    return result;
  };
};
