import type { ReplyRef } from "@stella/contracts/reply-refs";
import {
  projectReplyContexts,
  replyRefKey,
  titleNamesThread,
  type ReplyContextProjection,
  type ReplyContextRow,
} from "@stella/contracts/reply-context";
import { journalAgents } from "@stella/contracts/agent-titles";
import { isAgentStopReason } from "@stella/contracts/agent-status";
import type { ChatMessage, ChatArtifact } from "../types";
import {
  messageText,
  type JournalFile,
  type JournalMessageRecord,
  type JournalRecord,
} from "@stella/contracts/conversation-protocol";
import { bareToolName } from "@stella/contracts/conversation-agent-activity";
import { cloudFileArtifact } from "./cloud-file-payload";
import { journalMirroredWake } from "@stella/contracts/conversation-journal-projection";

const SUMMARY_MAX_CHARS = 160;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const spawnResultThreadId = (record: JournalMessageRecord): string | null => {
  const toolName = record.payload.toolName;
  if (record.role !== "toolResult" || record.payload.isError === true) return null;
  if (typeof toolName !== "string" || bareToolName(toolName) !== "spawn_agent") return null;
  const details = asRecord(record.payload.details);
  if (typeof details?.thread_id === "string" && details.thread_id) return details.thread_id;
  try {
    const threadId = asRecord(JSON.parse(messageText(record.payload)))?.thread_id;
    return typeof threadId === "string" && threadId ? threadId : null;
  } catch {
    return null;
  }
};

export function summaryExcerpt(result: string): string {
  const compact = result
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d+[.)][ \t]+)/gm, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (compact.length <= SUMMARY_MAX_CHARS) return compact;
  const head = compact.slice(0, SUMMARY_MAX_CHARS);
  const lastSpace = head.lastIndexOf(" ");
  const cut = lastSpace >= SUMMARY_MAX_CHARS - 24 ? head.slice(0, lastSpace) : head;
  return `${cut.trimEnd()}…`;
}

export function projectMobileLifecycle(messages: ChatMessage[], records: readonly JournalRecord[], conversationId: string): ChatMessage[] {
  const journal = journalAgents(records);
  const titles = new Map<string, string>();
  for (const [threadId, agent] of journal) if (agent.title) titles.set(threadId, agent.title);
  const messagesById = new Map(messages.map(message => [message.id, message]));
  const assistantsByTurn = new Map<string, Array<{ seq: number; message: ChatMessage }>>();
  for (const record of records) {
    if (record.kind !== "message" || record.role !== "assistant" || record.hidden) continue;
    const message = messagesById.get(`cloud:${record.turnId}:message:${record.seq}`);
    if (!message) continue;
    const rows = assistantsByTurn.get(record.turnId) ?? [];
    rows.push({ seq: record.seq, message });
    assistantsByTurn.set(record.turnId, rows);
  }
  const anchorBefore = (turnId: string, seq: number) => {
    const rows = assistantsByTurn.get(turnId) ?? [];
    return rows.filter(row => row.seq < seq).at(-1)?.message ?? rows[0]?.message;
  };
  const anchorAfter = (turnId: string, seq: number) => {
    const rows = assistantsByTurn.get(turnId) ?? [];
    return rows.find(row => row.seq > seq)?.message ?? rows.at(-1)?.message;
  };
  const attach = (message: ChatMessage, artifacts: ChatArtifact[]) => {
    message.artifacts = [...(message.artifacts ?? []), ...artifacts];
  };

  const starts = new Map<string, ChatArtifact>();
  const agentByTurn = new Map<string, string>();
  const filesByAgent = new Map<string, Array<{ file: JournalFile; createdAt: number }>>();
  const completions: Array<{ eventId: string; agentId: string; turnId: string; seq: number; createdAt: number; result: string; failed: boolean }> = [];
  for (const record of records) {
    if (record.kind !== "card") continue;
    if (record.card.type === "files") {
      const agentId = agentByTurn.get(record.turnId);
      if (!agentId) continue;
      const list = filesByAgent.get(agentId) ?? [];
      for (const file of record.card.files) list.push({ file, createdAt: record.createdAtMs });
      filesByAgent.set(agentId, list);
      continue;
    }
    if (record.card.type !== "agent-lifecycle") continue;
    const { event } = record.card;
    const id = event.payload.agentId;
    const key = `${id}:${event.payload.attemptGeneration}`;
    if (event.type === "agent-started") {
      titles.set(id, event.payload.description);
      if (!agentByTurn.has(record.turnId)) agentByTurn.set(record.turnId, id);
      const message = anchorBefore(record.turnId, record.seq);
      if (!message) continue;
      const artifact: ChatArtifact = { id: record.card.eventId, conversationId, payload: {
        kind: "agent-work", agentIds: [id], state: "running", total: 1, completed: 0,
        title: event.payload.description, subtitle: "", createdAt: record.createdAtMs,
        followUp: event.payload.isFollowUp,
      } };
      attach(message, [artifact]);
      starts.set(key, artifact);
    } else if (event.type !== "agent-progress") {
      const artifact = starts.get(key);
      if (artifact?.payload.kind === "agent-work") {
        artifact.payload = { ...artifact.payload, state: "done", completed: event.type === "agent-completed" ? 1 : 0, failed: event.type !== "agent-completed" };
      }
      const stopped =
        event.type === "agent-canceled" &&
        ((event.payload.status as string | undefined) === "paused" || isAgentStopReason(event.payload.error));
      if (!stopped) {
        completions.push({
          eventId: record.card.eventId, agentId: id, turnId: record.turnId, seq: record.seq,
          createdAt: record.createdAtMs,
          result: event.type === "agent-completed" && typeof event.payload.result === "string" ? event.payload.result : "",
          failed: event.type !== "agent-completed",
        });
      }
    }
  }

  const turns = new Map<string, JournalRecord[]>();
  for (const record of records) {
    const turn = turns.get(record.turnId);
    if (turn) turn.push(record);
    else turns.set(record.turnId, [record]);
  }
  const carded = new Set<string>();
  for (const record of records) {
    if (record.kind === "card" && record.card.type === "agent-lifecycle") carded.add(record.card.event.payload.agentId);
  }
  for (const [turnId, turnRecords] of turns) {
    for (const record of turnRecords) {
      if (record.kind !== "message") continue;
      const id = spawnResultThreadId(record);
      if (!id || carded.has(id)) continue;
      carded.add(id);
      const message = anchorBefore(turnId, record.seq);
      if (!message) continue;
      const status = journal.get(id)?.status;
      const details = asRecord(record.payload.details);
      const title = titles.get(id) || (typeof details?.description === "string" ? details.description : "") || id;
      attach(message, [{ id: `cloud:${turnId}:spawn:${record.seq}`, conversationId, payload: {
        kind: "agent-work", agentIds: [id], total: 1, title, subtitle: "", createdAt: record.createdAtMs,
        ...(status === undefined || status === "running"
          ? { state: "running", completed: 0 }
          : { state: "done", completed: status === "completed" ? 1 : 0, ...(status === "completed" ? {} : { failed: true }) }),
      } }]);
    }
  }

  const wakeTitles = new Map<string, string>();
  for (const [turnId, turnRecords] of turns) {
    const wake = journalMirroredWake(turnRecords);
    if (!wake || (wake.outcome.kind === "canceled" && isAgentStopReason(wake.outcome.body))) continue;
    if (wake.description) wakeTitles.set(wake.threadId, wake.description);
    const failed = wake.outcome.kind !== "completed";
    completions.push({
      eventId: `cloud:${turnId}:wake:${wake.record.seq}`, agentId: wake.threadId, turnId, seq: wake.record.seq,
      createdAt: wake.record.createdAtMs, result: failed ? "" : wake.outcome.body, failed,
    });
  }
  completions.sort((a, b) => a.seq - b.seq);

  const relayed = new Set<string>();
  for (const completion of completions) {
    const message = anchorAfter(completion.turnId, completion.seq);
    if (!message) continue;
    const relayKey = `${message.id}\n${completion.agentId}`;
    if (relayed.has(relayKey)) continue;
    relayed.add(relayKey);
    const title = titles.get(completion.agentId) || wakeTitles.get(completion.agentId) || "Task";
    const files = (filesByAgent.get(completion.agentId) ?? []).map(entry => cloudFileArtifact(entry.file, conversationId, entry.createdAt));
    const summary = summaryExcerpt(completion.result);
    const card: ChatArtifact = { id: `${completion.eventId}:completion`, conversationId, payload: {
      kind: "agent-work", state: "done", agentIds: [completion.agentId], total: 1,
      completed: completion.failed ? 0 : 1, ...(completion.failed ? { failed: true } : {}),
      title, subtitle: "", createdAt: completion.createdAt, completion: true,
      agents: [{ agentId: completion.agentId, title, files: files.map(file => file.payload), ...(summary ? { summary } : {}) }],
    } };
    attach(message, [card]);
  }
  const descriptions = messages.flatMap(message => message.spawnedDescriptions ?? []);
  const titleFor = (ref: Extract<ReplyRef, { kind: "agent" }>) =>
    titles.get(ref.threadId) ||
    (ref.title && ref.title !== ref.threadId ? ref.title : "") ||
    descriptions.find(description => titleNamesThread(description, ref.threadId)) ||
    ref.title;
  const stateFor = (threadId: string): MobileAgentState | undefined => {
    const status = journal.get(threadId)?.status;
    if (!status) return undefined;
    return status === "running" || status === "completed" || status === "canceled" ? status : "error";
  };
  const statesFor = (refs: readonly ReplyRef[]) => {
    const states: Record<string, MobileAgentState> = {};
    for (const ref of refs) {
      const state = ref.kind === "agent" ? stateFor(ref.threadId) : undefined;
      if (ref.kind === "agent" && state) states[ref.threadId] = state;
    }
    return Object.keys(states).length ? { agentStates: states } : {};
  };
  return messages.map(message => ({ ...message, ...(message.replyRefs ? {
    replyRefs: message.replyRefs.map(ref => ref.kind === "agent" ? { ...ref, title: titleFor(ref) } : ref),
    ...statesFor(message.replyRefs),
  } : {}) }));
}

export type MobileAgentState = "running" | "completed" | "error" | "canceled";

export type MobileReplyContexts = ReplyContextProjection & {
  agentStates: ReadonlyMap<string, MobileAgentState>;
};

const agentIdsOf = (message: ChatMessage): string[] => {
  const ids: string[] = [...(message.spawnedThreadIds ?? [])];
  for (const artifact of message.artifacts ?? []) {
    if (artifact.payload.kind === "agent-work" && !artifact.payload.completion) {
      for (const id of artifact.payload.agentIds ?? []) if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
};

export function mobileOwnedAgentIds(messages: readonly ChatMessage[]): (message: ChatMessage) => string[] {
  const threadIdsByTitle = new Map<string, string[]>();
  const citedThreadIds = new Set<string>();
  const learn = (title: string | undefined, threadId: string) => {
    const key = title?.trim();
    if (!key) return;
    const known = threadIdsByTitle.get(key) ?? [];
    if (!known.includes(threadId)) known.push(threadId);
    threadIdsByTitle.set(key, known);
  };
  for (const message of messages) {
    for (const ref of message.replyRefs ?? []) {
      if (ref.kind !== "agent") continue;
      citedThreadIds.add(ref.threadId);
      learn(ref.title, ref.threadId);
    }
    for (const artifact of message.artifacts ?? []) {
      if (artifact.payload.kind !== "agent-work") continue;
      for (const id of artifact.payload.agentIds ?? []) learn(artifact.payload.title, id);
    }
  }
  return (message: ChatMessage) => {
    const owned = agentIdsOf(message);
    for (const title of message.spawnedDescriptions ?? []) {
      for (const id of threadIdsByTitle.get(title.trim()) ?? []) if (!owned.includes(id)) owned.push(id);
      for (const id of citedThreadIds) if (!owned.includes(id) && titleNamesThread(title, id)) owned.push(id);
    }
    return owned;
  };
}

export function mobileReplyContexts(messages: readonly ChatMessage[]): MobileReplyContexts {
  const agentStates = new Map<string, MobileAgentState>();
  const latestStates = new Map<string, MobileAgentState>();
  const ownedAgents = mobileOwnedAgentIds(messages);
  const rows: ReplyContextRow[] = messages.map(message => {
    const aliasIds = message.canonicalId ? [message.canonicalId] : undefined;
    if (message.role === "user") return { id: message.id, role: "user", ...(aliasIds ? { aliasIds } : {}) };
    for (const artifact of message.artifacts ?? []) {
      if (artifact.payload.kind !== "agent-work") continue;
      const state: MobileAgentState = artifact.payload.state === "running" ? "running" : artifact.payload.failed ? "error" : "completed";
      for (const id of artifact.payload.agentIds ?? []) agentStates.set(id, state);
    }
    for (const [id, state] of Object.entries(message.agentStates ?? {})) latestStates.set(id, state);
    const ownsAgentIds = ownedAgents(message);
    return {
      id: message.id,
      role: "assistant",
      ...(aliasIds ? { aliasIds } : {}),
      ...(message.replyRefs ? { refs: message.replyRefs } : {}),
      ...(message.requestId ? { answersMessageIds: [message.requestId] } : {}),
      ...(ownsAgentIds.length ? { ownsAgentIds } : {}),
    };
  });
  const projection = projectReplyContexts(rows);
  for (const [id, state] of latestStates) agentStates.set(id, state);
  return { ...projection, agentStates };
}

export function mobileReplyLineage(messages: readonly ChatMessage[], root: ReplyRef): ChatMessage[] {
  const isRootMessage = (message: ChatMessage) => root.kind === "message" && (message.id === root.id || message.canonicalId === root.id);
  const rootIds = new Set<string>();
  if (root.kind === "message") {
    rootIds.add(root.id);
    for (const message of messages) if (isRootMessage(message)) { rootIds.add(message.id); if (message.canonicalId) rootIds.add(message.canonicalId); }
  }
  const turnOf = (message: ChatMessage) => root.kind === "message" && Boolean(message.requestId) && rootIds.has(message.requestId!);
  const ownAgentIds = new Set<string>();
  if (root.kind === "message") {
    const ownedAgents = mobileOwnedAgentIds(messages);
    for (const message of messages) if (turnOf(message)) for (const id of ownedAgents(message)) ownAgentIds.add(id);
  }
  const cites = (ref: ReplyRef) => root.kind === "agent"
    ? replyRefKey(ref) === replyRefKey(root)
    : (ref.kind === "message" && rootIds.has(ref.id)) || (ref.kind === "agent" && ownAgentIds.has(ref.threadId));
  const owns = (message: ChatMessage) => root.kind === "agent"
    ? message.artifacts?.some(a => a.payload.kind === "agent-work" && a.payload.agentIds?.includes(root.threadId))
    : isRootMessage(message) || turnOf(message);
  const selected = messages.filter(m => owns(m) || m.replyRefs?.some(cites));
  const userIds = new Set(selected.filter(m => owns(m)).map(m => m.requestId));
  const selectedIds = new Set(selected.map(message => message.id));
  return messages.filter(m => selectedIds.has(m.id) || userIds.has(m.id) || (Boolean(m.canonicalId) && userIds.has(m.canonicalId)));
}

