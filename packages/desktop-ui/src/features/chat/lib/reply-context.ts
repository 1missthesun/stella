import type { EventRowViewModel, UserRowViewModel } from "../conversation-row-types";
import {
  projectReplyContexts,
  titleNamesThread,
  type ReplyContextRow,
} from "@stella/contracts/reply-context";
import {
  agentIdCanonicalizer,
  agentIdsOf,
  projectAgentLabels,
  type AgentLabelRow,
} from "@stella/contracts/agent-labels";
import { assistantRowHasOwnContent } from "./assistant-row-content";

export type ReplyContextOptions = {
  /**
   * Task titles by thread id from the runtime's Activity list. The
   * authoritative source when the transcript itself carries no title for a
   * spawn (a locally executed turn mirrored into the cloud journal).
   */
  agentTitles?: ReadonlyMap<string, string>;
  agentParents?: ReadonlyMap<string, string>;
};

const rendersNothing = (row: UserRowViewModel): boolean =>
  !row.text.trim() &&
  row.attachments.length === 0 &&
  !row.windowLabel &&
  !row.quotedText &&
  !(row.pastedTexts?.length) &&
  !(row.appSelectionLabels?.length) &&
  !row.activityLabel;

export function withReplyContext(
  rows: EventRowViewModel[],
  options: ReplyContextOptions = {},
): EventRowViewModel[] {
  // Task titles the timeline knows, so a spawn that only recorded its
  // description (a local turn mirrored to the cloud journal) still owns the
  // thread a later report cites by that same title.
  const threadIdsByTitle = new Map<string, string[]>();
  const citedThreadIds = new Set<string>();
  const learn = (title: string | undefined, threadId: string) => {
    const key = title?.trim();
    if (!key) return;
    const known = threadIdsByTitle.get(key);
    if (!known) threadIdsByTitle.set(key, [threadId]);
    else if (!known.includes(threadId)) known.push(threadId);
  };
  for (const [threadId, title] of options.agentTitles ?? []) learn(title, threadId);
  for (const row of rows) {
    if (row.kind !== "assistant") continue;
    for (const ref of row.replyRefs ?? []) {
      if (ref.kind !== "agent") continue;
      citedThreadIds.add(ref.threadId);
      learn(ref.title, ref.threadId);
    }
    for (const [threadId, title] of Object.entries(row.backgroundWork?.descriptions ?? {})) {
      learn(title, threadId);
    }
  }
  const ownedAgents = (ids: readonly string[] | undefined, titles: readonly string[] | undefined) => {
    const owned = [...(ids ?? [])];
    for (const title of titles ?? []) {
      for (const threadId of threadIdsByTitle.get(title.trim()) ?? []) {
        if (!owned.includes(threadId)) owned.push(threadId);
      }
      // Last resort: the thread id is the description's slug.
      for (const threadId of citedThreadIds) {
        if (!owned.includes(threadId) && titleNamesThread(title, threadId)) owned.push(threadId);
      }
    }
    return owned;
  };
  const input: ReplyContextRow[] = rows.map((row) => {
    if (row.kind === "user") {
      const owns = ownedAgents(row.spawnedThreadIds, row.spawnedDescriptions);
      return {
        id: row.id,
        role: "user",
        ...(row.hidden || rendersNothing(row) ? { hidden: true } : {}),
        ...(owns.length ? { ownsAgentIds: owns } : {}),
      };
    }
    const answers: string[] = [];
    if (row.replyToUserMessageId) answers.push(row.replyToUserMessageId);
    if (row.sourceMessageId) answers.push(row.sourceMessageId);
    const ownsAgentIds = ownedAgents(
      [...(row.backgroundWork?.threadIds ?? []), ...(row.spawnedThreadIds ?? [])],
      row.spawnedDescriptions,
    );
    return {
      id: row.id,
      role: "assistant",
      ...(row.replyRefs ? { refs: row.replyRefs } : {}),
      ...(answers.length ? { answersMessageIds: answers } : {}),
      ...(ownsAgentIds.length ? { ownsAgentIds } : {}),
    };
  });
  const { contexts } = projectReplyContexts(input);
  const parents = options.agentParents;
  const topLevel = (threadId: string): string => {
    if (!parents?.size) return threadId;
    let current = threadId;
    const seen = new Set([current]);
    for (let parent = parents.get(current); parent && !seen.has(parent); parent = parents.get(current)) {
      seen.add(parent);
      current = parent;
    }
    return current;
  };
  const labelRows: AgentLabelRow[] = rows.map((row) => {
    if (row.kind === "user") {
      return { id: row.id, role: "user", ...(row.hidden || rendersNothing(row) ? { hidden: true } : {}) };
    }
    const agentIds = [
      ...(row.backgroundWork?.threadIds ?? []),
      ...(row.spawnedThreadIds ?? []),
      ...(row.agentCompletion?.sections.map((section) => section.agentId) ?? []),
      ...(row.replyRefs ?? []).flatMap((ref) => (ref.kind === "agent" ? [ref.threadId] : [])),
    ].map(topLevel);
    const paints =
      assistantRowHasOwnContent(row) || Boolean(row.backgroundWork) || Boolean(row.agentCompletion);
    return {
      id: row.id,
      role: "assistant",
      ...(paints ? {} : { hidden: true }),
      ...(agentIds.length ? { agentIds } : {}),
    };
  });
  const labels = projectAgentLabels(labelRows, agentIdCanonicalizer(agentIdsOf(labelRows)));
  return rows.map((row) => {
    if (row.kind !== "assistant") return row;
    const agentLabelIds = labels.get(row.id);
    if (!row.replyRefs?.length && !agentLabelIds) return row;
    const visible = contexts.get(row.id);
    return {
      ...row,
      ...(row.replyRefs ? { replyRefs: visible ? [visible] : [] } : {}),
      ...(agentLabelIds ? { agentLabelIds } : {}),
    };
  });
}
