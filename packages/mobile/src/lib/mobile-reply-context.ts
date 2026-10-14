import type { ReplyRef } from "@stella/contracts/reply-refs";
import {
  createReplyContextProjector,
  projectReplyContexts,
  replyRefKey,
  titleNamesThread,
  type ReplyContextProjection,
  type ReplyContextRow,
} from "@stella/contracts/reply-context";
import { journalAgents, journalRecordTouchesAgents } from "@stella/contracts/agent-titles";
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
import type { JournalIndex, JournalView } from "./journal-index";
import { replaceEqualDeep } from "./structural-sharing";

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

const excerpts = new Map<string, string>();
const MAX_EXCERPTS = 512;

export function summaryExcerpt(result: string): string {
  let excerpt = excerpts.get(result);
  if (excerpt === undefined) {
    excerpt = readSummaryExcerpt(result);
    if (excerpts.size >= MAX_EXCERPTS) excerpts.clear();
    excerpts.set(result, excerpt);
  }
  return excerpt;
}

function readSummaryExcerpt(result: string): string {
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

/** One turn's projected messages; `facts` is this module's per-projection scratch. */
export type ProjectedTurn = {
  readonly turnId: string;
  readonly messages: readonly ChatMessage[];
  facts?: TurnFacts;
};

const AGENT_RECORDS: JournalView = {
  id: "agent-records",
  test: journalRecordTouchesAgents,
};
const AGENT_CARDS: JournalView = {
  id: "agent-cards",
  test: (record) =>
    record.kind === "card" &&
    (record.card.type === "agent-lifecycle" || record.card.type === "files"),
};
const SPAWN_RESULTS: JournalView = {
  id: "spawn-results",
  test: (record) => {
    if (record.kind !== "message" || record.role !== "toolResult") return false;
    const toolName = record.payload.toolName;
    return typeof toolName !== "string" || bareToolName(toolName) === "spawn_agent";
  },
};
const HIDDEN_USERS: JournalView = {
  id: "hidden-users",
  test: (record) =>
    record.kind === "message" && record.role === "user" && record.hidden,
};

const journals = new WeakMap<readonly JournalRecord[], ReturnType<typeof journalAgents>>();
const journalOf = (records: readonly JournalRecord[]) => {
  let journal = journals.get(records);
  if (!journal) {
    journal = journalAgents(records);
    journals.set(records, journal);
  }
  return journal;
};

const spawnThreadIds = new WeakMap<JournalMessageRecord, string | null>();
const cachedSpawnResultThreadId = (record: JournalMessageRecord): string | null => {
  let id = spawnThreadIds.get(record);
  if (id === undefined) {
    id = spawnResultThreadId(record);
    spawnThreadIds.set(record, id);
  }
  return id;
};

type TurnFacts = {
  anchors: { seq: number; id: string }[];
  descriptions: readonly string[];
  hasRefs: boolean;
  output?: {
    lifecycle: Lifecycle;
    contribution: TurnContribution;
    messages: readonly ChatMessage[];
  };
};

const factsOf = (entry: ProjectedTurn): TurnFacts => {
  let facts = entry.facts;
  if (!facts) {
    const { turnId, messages } = entry;
    const prefix = `cloud:${turnId}:message:`;
    facts = {
      anchors: messages.flatMap((message) =>
        message.role === "assistant" && message.id === `${prefix}${message.sequence}`
          ? [{ seq: message.sequence!, id: message.id }]
          : []),
      descriptions: messages.flatMap((message) => message.spawnedDescriptions ?? []),
      hasRefs: messages.some((message) => message.replyRefs !== undefined),
    };
    entry.facts = facts;
  }
  return facts;
};

type Lifecycle = {
  views: readonly (readonly JournalRecord[])[];
  descriptions: readonly string[];
  anchorTurns: Map<string, ProjectedTurn | undefined>;
  journal: ReturnType<typeof journalAgents>;
  titles: Map<string, string>;
  attached: Map<string, Map<string, ChatArtifact[]>>;
  /** Agent-ref titles found in spawn descriptions; reused while those only grow. */
  describedThreads: Map<string, { checked: number; title?: string }>;
};

type TurnContribution = {
  artifacts: (ChatArtifact[] | undefined)[];
  refs: ({ title: string | undefined; state: MobileAgentState | undefined }[] | undefined)[];
};

const lifecycles = new Map<string, Lifecycle>();
const MAX_CACHED_LIFECYCLES = 4;

const sameList = <T>(a: readonly T[], b: readonly T[]): boolean =>
  a.length === b.length && a.every((value, i) => value === b[i]);

/**
 * Agent lifecycle, spawn and wake artifacts, and agent titles on reply refs.
 * Reads only the agent-related records of the window and keeps every turn's
 * messages as they were unless what they show changed.
 */
export function projectMobileLifecycle(
  turns: readonly ProjectedTurn[],
  index: JournalIndex,
  conversationId: string,
  projectedTurn: (turnId: string) => ProjectedTurn | undefined,
): ChatMessage[] {
  const descriptions: string[] = [];
  for (const entry of turns) {
    const facts = factsOf(entry);
    if (facts.descriptions.length) descriptions.push(...facts.descriptions);
  }
  const views = [
    index.view(AGENT_RECORDS),
    index.view(AGENT_CARDS),
    index.view(SPAWN_RESULTS),
    index.view(HIDDEN_USERS),
  ];
  let lifecycle = lifecycles.get(conversationId);
  if (
    !lifecycle ||
    !sameList(lifecycle.views, views) ||
    !sameList(lifecycle.descriptions, descriptions) ||
    [...lifecycle.anchorTurns].some(([turnId, entry]) => projectedTurn(turnId) !== entry)
  ) {
    const previous = lifecycle;
    lifecycle = buildLifecycle(views, descriptions, index, projectedTurn, conversationId);
    if (
      previous &&
      previous.descriptions.length <= descriptions.length &&
      previous.descriptions.every((description, i) => description === descriptions[i])
    ) {
      lifecycle.describedThreads = previous.describedThreads;
    }
    lifecycles.delete(conversationId);
    lifecycles.set(conversationId, lifecycle);
    while (lifecycles.size > MAX_CACHED_LIFECYCLES) {
      const oldest = lifecycles.keys().next().value;
      if (oldest === undefined) break;
      lifecycles.delete(oldest);
    }
  }
  const out: ChatMessage[] = [];
  for (const entry of turns) {
    const attachments = lifecycle.attached.get(entry.turnId);
    const facts = factsOf(entry);
    if (!attachments && !facts.hasRefs) {
      for (const message of entry.messages) out.push(message);
      continue;
    }
    const previous = facts.output;
    if (previous?.lifecycle !== lifecycle) {
      const contribution = contributionOf(entry.messages, attachments, lifecycle, descriptions);
      facts.output =
        previous && replaceEqualDeep(previous.contribution, contribution) === previous.contribution
          ? { ...previous, lifecycle }
          : {
              lifecycle,
              contribution,
              messages: applyContribution(entry.messages, contribution, previous),
            };
    }
    for (const message of facts.output!.messages) out.push(message);
  }
  return out;
}

function contributionOf(
  messages: readonly ChatMessage[],
  attachments: Map<string, ChatArtifact[]> | undefined,
  lifecycle: Lifecycle,
  descriptions: readonly string[],
): TurnContribution {
  const { titles, journal, describedThreads } = lifecycle;
  const describing = (threadId: string) => {
    let entry = describedThreads.get(threadId);
    if (!entry) describedThreads.set(threadId, (entry = { checked: 0 }));
    for (; entry.title === undefined && entry.checked < descriptions.length; entry.checked += 1) {
      const description = descriptions[entry.checked]!;
      if (titleNamesThread(description, threadId)) entry.title = description;
    }
    return entry.title;
  };
  const titleFor = (ref: Extract<ReplyRef, { kind: "agent" }>) =>
    titles.get(ref.threadId) ||
    (ref.title && ref.title !== ref.threadId ? ref.title : "") ||
    describing(ref.threadId) ||
    ref.title;
  const stateFor = (threadId: string): MobileAgentState | undefined => {
    const status = journal.get(threadId)?.status;
    if (!status) return undefined;
    return status === "running" || status === "completed" || status === "canceled" ? status : "error";
  };
  return {
    artifacts: messages.map((message) => attachments?.get(message.id)),
    refs: messages.map((message) =>
      message.replyRefs?.map((ref) =>
        ref.kind === "agent"
          ? { title: titleFor(ref), state: stateFor(ref.threadId) }
          : { title: undefined, state: undefined })),
  };
}

function applyContribution(
  messages: readonly ChatMessage[],
  contribution: TurnContribution,
  previous?: { contribution: TurnContribution; messages: readonly ChatMessage[] },
): ChatMessage[] {
  return messages.map((original, i) => {
    if (
      previous &&
      replaceEqualDeep(previous.contribution.artifacts[i], contribution.artifacts[i]) ===
        previous.contribution.artifacts[i] &&
      replaceEqualDeep(previous.contribution.refs[i], contribution.refs[i]) ===
        previous.contribution.refs[i]
    ) {
      return previous.messages[i]!;
    }
    const artifacts = contribution.artifacts[i];
    const message = artifacts
      ? { ...original, artifacts: [...(original.artifacts ?? []), ...artifacts] }
      : original;
    const refs = contribution.refs[i];
    if (!message.replyRefs || !refs) return message;
    const states: Record<string, MobileAgentState> = {};
    message.replyRefs.forEach((ref, at) => {
      const state = refs[at]?.state;
      if (ref.kind === "agent" && state) states[ref.threadId] = state;
    });
    return {
      ...message,
      replyRefs: message.replyRefs.map((ref, at) =>
        ref.kind === "agent" ? { ...ref, title: refs[at]!.title! } : ref),
      ...(Object.keys(states).length ? { agentStates: states } : {}),
    };
  });
}

function buildLifecycle(
  views: readonly (readonly JournalRecord[])[],
  descriptions: readonly string[],
  index: JournalIndex,
  projectedTurn: (turnId: string) => ProjectedTurn | undefined,
  conversationId: string,
): Lifecycle {
  const [agentRecords, cards, spawnResults, hiddenUsers] = views as [
    readonly JournalRecord[],
    readonly JournalRecord[],
    readonly JournalRecord[],
    readonly JournalRecord[],
  ];
  const journal = journalOf(agentRecords);
  const titles = new Map<string, string>();
  for (const [threadId, agent] of journal) if (agent.title) titles.set(threadId, agent.title);
  const anchorTurns = new Map<string, ProjectedTurn | undefined>();
  const anchorsOf = (turnId: string) => {
    const entry = projectedTurn(turnId);
    anchorTurns.set(turnId, entry);
    return entry ? factsOf(entry).anchors : [];
  };
  const anchorBefore = (turnId: string, seq: number) => {
    const rows = anchorsOf(turnId);
    return rows.filter(row => row.seq < seq).at(-1)?.id ?? rows[0]?.id;
  };
  const anchorAfter = (turnId: string, seq: number) => {
    const rows = anchorsOf(turnId);
    return rows.find(row => row.seq > seq)?.id ?? rows.at(-1)?.id;
  };
  const attached = new Map<string, Map<string, ChatArtifact[]>>();
  const attach = (turnId: string, messageId: string, artifact: ChatArtifact) => {
    let byMessage = attached.get(turnId);
    if (!byMessage) attached.set(turnId, (byMessage = new Map()));
    const list = byMessage.get(messageId);
    if (list) list.push(artifact);
    else byMessage.set(messageId, [artifact]);
  };

  const starts = new Map<string, ChatArtifact>();
  const agentByTurn = new Map<string, string>();
  const carded = new Set<string>();
  const filesByAgent = new Map<string, Array<{ file: JournalFile; createdAt: number }>>();
  const completions: Array<{ eventId: string; agentId: string; turnId: string; seq: number; createdAt: number; result: string; failed: boolean }> = [];
  for (const record of cards) {
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
    carded.add(id);
    const key = `${id}:${event.payload.attemptGeneration}`;
    if (event.type === "agent-started") {
      titles.set(id, event.payload.description);
      if (!agentByTurn.has(record.turnId)) agentByTurn.set(record.turnId, id);
      const messageId = anchorBefore(record.turnId, record.seq);
      if (!messageId) continue;
      const artifact: ChatArtifact = { id: record.card.eventId, conversationId, payload: {
        kind: "agent-work", agentIds: [id], state: "running", total: 1, completed: 0,
        title: event.payload.description, subtitle: "", createdAt: record.createdAtMs,
        followUp: event.payload.isFollowUp,
      } };
      attach(record.turnId, messageId, artifact);
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

  const inTurnOrder = (records: readonly JournalRecord[]) => {
    const byTurn = new Map<string, JournalRecord[]>();
    for (const record of records) {
      const list = byTurn.get(record.turnId);
      if (list) list.push(record);
      else byTurn.set(record.turnId, [record]);
    }
    return [...byTurn].sort(
      (a, b) => (index.turn(a[0])?.firstSeq ?? 0) - (index.turn(b[0])?.firstSeq ?? 0),
    );
  };

  for (const [turnId, turnRecords] of inTurnOrder(spawnResults)) {
    for (const record of turnRecords) {
      if (record.kind !== "message") continue;
      const id = cachedSpawnResultThreadId(record);
      if (!id || carded.has(id)) continue;
      carded.add(id);
      const messageId = anchorBefore(turnId, record.seq);
      if (!messageId) continue;
      const status = journal.get(id)?.status;
      const details = asRecord(record.payload.details);
      const title = titles.get(id) || (typeof details?.description === "string" ? details.description : "") || id;
      attach(turnId, messageId, { id: `cloud:${turnId}:spawn:${record.seq}`, conversationId, payload: {
        kind: "agent-work", agentIds: [id], total: 1, title, subtitle: "", createdAt: record.createdAtMs,
        ...(status === undefined || status === "running"
          ? { state: "running", completed: 0 }
          : { state: "done", completed: status === "completed" ? 1 : 0, ...(status === "completed" ? {} : { failed: true }) }),
      } });
    }
  }

  const wakeTitles = new Map<string, string>();
  for (const [turnId] of inTurnOrder(hiddenUsers)) {
    const turn = index.turn(turnId);
    if (!turn) continue;
    const memo = turn.memo as { wake?: ReturnType<typeof journalMirroredWake> };
    const wake = memo.wake === undefined ? (memo.wake = journalMirroredWake(turn.records)) : memo.wake;
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
    const messageId = anchorAfter(completion.turnId, completion.seq);
    if (!messageId) continue;
    const relayKey = `${messageId}\n${completion.agentId}`;
    if (relayed.has(relayKey)) continue;
    relayed.add(relayKey);
    const title = titles.get(completion.agentId) || wakeTitles.get(completion.agentId) || "Task";
    const files = (filesByAgent.get(completion.agentId) ?? []).map(entry => cloudFileArtifact(entry.file, conversationId, entry.createdAt));
    const summary = summaryExcerpt(completion.result);
    attach(completion.turnId, messageId, { id: `${completion.eventId}:completion`, conversationId, payload: {
      kind: "agent-work", state: "done", agentIds: [completion.agentId], total: 1,
      completed: completion.failed ? 0 : 1, ...(completion.failed ? { failed: true } : {}),
      title, subtitle: "", createdAt: completion.createdAt, completion: true,
      agents: [{ agentId: completion.agentId, title, files: files.map(file => file.payload), ...(summary ? { summary } : {}) }],
    } });
  }
  return {
    views,
    descriptions,
    anchorTurns,
    journal,
    titles,
    attached,
    describedThreads: new Map(),
  };
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

const replyContextRows = new WeakMap<ChatMessage, ReplyContextRow>();

const replyContextRow = (message: ChatMessage, ownsAgentIds: string[]): ReplyContextRow => {
  const aliasIds = message.canonicalId ? [message.canonicalId] : undefined;
  if (message.role === "user") return { id: message.id, role: "user", ...(aliasIds ? { aliasIds } : {}) };
  return {
    id: message.id,
    role: "assistant",
    ...(aliasIds ? { aliasIds } : {}),
    ...(message.replyRefs ? { refs: message.replyRefs } : {}),
    ...(message.requestId ? { answersMessageIds: [message.requestId] } : {}),
    ...(ownsAgentIds.length ? { ownsAgentIds } : {}),
  };
};

const spawnContextRows = new WeakMap<ChatMessage, { owned: string; row: ReplyContextRow }>();

export function mobileReplyContexts(
  messages: readonly ChatMessage[],
  project: (rows: readonly ReplyContextRow[]) => ReplyContextProjection = projectReplyContexts,
): MobileReplyContexts {
  const agentStates = new Map<string, MobileAgentState>();
  const latestStates = new Map<string, MobileAgentState>();
  let ownedAgents: ((message: ChatMessage) => string[]) | null = null;
  const rows: ReplyContextRow[] = messages.map(message => {
    if (message.role !== "user") {
      for (const artifact of message.artifacts ?? []) {
        if (artifact.payload.kind !== "agent-work") continue;
        const state: MobileAgentState = artifact.payload.state === "running" ? "running" : artifact.payload.failed ? "error" : "completed";
        for (const id of artifact.payload.agentIds ?? []) agentStates.set(id, state);
      }
      if (message.agentStates) {
        for (const [id, state] of Object.entries(message.agentStates)) latestStates.set(id, state);
      }
    }
    if (message.role !== "user" && message.spawnedDescriptions?.length) {
      ownedAgents ??= mobileOwnedAgentIds(messages);
      const ownsAgentIds = ownedAgents(message);
      const owned = ownsAgentIds.join("\n");
      const cached = spawnContextRows.get(message);
      if (cached?.owned === owned) return cached.row;
      const row = replyContextRow(message, ownsAgentIds);
      spawnContextRows.set(message, { owned, row });
      return row;
    }
    let row = replyContextRows.get(message);
    if (!row) {
      row = replyContextRow(message, message.role === "user" ? [] : agentIdsOf(message));
      replyContextRows.set(message, row);
    }
    return row;
  });
  const projection = project(rows);
  for (const [id, state] of latestStates) agentStates.set(id, state);
  return { ...projection, agentStates };
}

type MessageFacts = {
  readonly states?: readonly (readonly [string, MobileAgentState])[];
  readonly latest?: readonly (readonly [string, MobileAgentState])[];
  readonly learns?: readonly (readonly [string | undefined, string])[];
  readonly cites?: readonly string[];
  readonly spawnTitles?: readonly string[];
};

const NO_FACTS: MessageFacts = {};

const messageFacts = (message: ChatMessage): MessageFacts => {
  const learns: (readonly [string | undefined, string])[] = [];
  const cites: string[] = [];
  for (const ref of message.replyRefs ?? []) {
    if (ref.kind !== "agent") continue;
    cites.push(ref.threadId);
    learns.push([ref.title, ref.threadId]);
  }
  for (const artifact of message.artifacts ?? []) {
    if (artifact.payload.kind !== "agent-work") continue;
    for (const id of artifact.payload.agentIds ?? []) learns.push([artifact.payload.title, id]);
  }
  const states: (readonly [string, MobileAgentState])[] = [];
  const latest: (readonly [string, MobileAgentState])[] = [];
  let spawnTitles: readonly string[] | undefined;
  if (message.role !== "user") {
    for (const artifact of message.artifacts ?? []) {
      if (artifact.payload.kind !== "agent-work") continue;
      const state: MobileAgentState = artifact.payload.state === "running" ? "running" : artifact.payload.failed ? "error" : "completed";
      for (const id of artifact.payload.agentIds ?? []) states.push([id, state]);
    }
    if (message.agentStates) latest.push(...Object.entries(message.agentStates));
    if (message.spawnedDescriptions?.length) spawnTitles = message.spawnedDescriptions;
  }
  if (!learns.length && !states.length && !latest.length && !spawnTitles) return NO_FACTS;
  return {
    ...(states.length ? { states } : {}),
    ...(latest.length ? { latest } : {}),
    ...(learns.length ? { learns } : {}),
    ...(cites.length ? { cites } : {}),
    ...(spawnTitles ? { spawnTitles } : {}),
  };
};

type OwnedLearning = {
  byTitle: Map<string, string[]>;
  cited: string[];
  citedSet: Set<string>;
};

const learnOwnership = (facts: readonly MessageFacts[], contributors: readonly number[]): OwnedLearning => {
  const byTitle = new Map<string, string[]>();
  const citedSet = new Set<string>();
  const cited: string[] = [];
  for (const at of contributors) {
    const { learns, cites } = facts[at]!;
    for (const id of cites ?? []) {
      if (citedSet.has(id)) continue;
      citedSet.add(id);
      cited.push(id);
    }
    for (const [title, threadId] of learns ?? []) {
      const key = title?.trim();
      if (!key) continue;
      const known = byTitle.get(key) ?? [];
      if (!known.includes(threadId)) known.push(threadId);
      byTitle.set(key, known);
    }
  }
  return { byTitle, cited, citedSet };
};

const ownedAgentIds = (message: ChatMessage, learning: OwnedLearning): string[] => {
  const owned = agentIdsOf(message);
  for (const title of message.spawnedDescriptions ?? []) {
    for (const id of learning.byTitle.get(title.trim()) ?? []) if (!owned.includes(id)) owned.push(id);
    for (const id of learning.cited) if (!owned.includes(id) && titleNamesThread(title, id)) owned.push(id);
  }
  return owned;
};

const sameIds = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((id, i) => id === b[i]));

/**
 * `mobileReplyContexts` for a transcript that changes mostly at its end:
 * rows of messages that kept their place and identity are reused, the
 * spawn rows whose owned agents depend on the whole transcript are rebuilt
 * only when what they read changed, and the fold rewinds rather than restarts.
 */
export function createMobileReplyContexts(): (messages: readonly ChatMessage[]) => MobileReplyContexts {
  const project = createReplyContextProjector();
  let previous: {
    messages: readonly ChatMessage[];
    facts: MessageFacts[];
    contributors: number[];
    rows: ReplyContextRow[];
    owned: (string | undefined)[];
    learning: OwnedLearning;
    result: MobileReplyContexts;
  } | null = null;
  return (messages) => {
    let kept = 0;
    if (previous) {
      const shared = Math.min(messages.length, previous.messages.length);
      while (kept < shared && messages[kept] === previous.messages[kept]) kept += 1;
      if (kept === messages.length && kept === previous.messages.length) return previous.result;
    }
    const facts = previous ? previous.facts.slice(0, kept) : [];
    let contributors: number[] = [];
    if (previous) {
      for (const at of previous.contributors) {
        if (at >= kept) break;
        contributors.push(at);
      }
    }
    for (let at = kept; at < messages.length; at += 1) {
      const next = messageFacts(messages[at]!);
      facts.push(next);
      if (next !== NO_FACTS) contributors.push(at);
    }
    const learning = learnOwnership(facts, contributors);
    let changedTitles: Set<string> | null = null;
    let newCited: readonly string[] = [];
    let allSpawnsChanged = !previous;
    if (previous) {
      const before = previous.learning;
      changedTitles = new Set();
      for (const [title, ids] of learning.byTitle) {
        if (!sameIds(ids, before.byTitle.get(title))) changedTitles.add(title);
      }
      for (const title of before.byTitle.keys()) {
        if (!learning.byTitle.has(title)) changedTitles.add(title);
      }
      if (
        learning.cited.length >= before.cited.length &&
        before.cited.every((id, i) => learning.cited[i] === id)
      ) {
        newCited = learning.cited.slice(before.cited.length);
      } else {
        allSpawnsChanged = true;
      }
    }
    const rows: ReplyContextRow[] = new Array(messages.length);
    const owned: (string | undefined)[] = new Array(messages.length);
    for (let at = 0; at < messages.length; at += 1) {
      const message = messages[at]!;
      const titles = facts[at]!.spawnTitles;
      if (at < kept && previous) {
        const unaffected =
          !titles ||
          (!allSpawnsChanged &&
            !titles.some((title) => changedTitles!.has(title.trim())) &&
            !newCited.some((id) => titles.some((title) => titleNamesThread(title, id))));
        if (unaffected) {
          rows[at] = previous.rows[at]!;
          owned[at] = previous.owned[at];
          continue;
        }
      }
      if (titles) {
        const ownsAgentIds = ownedAgentIds(message, learning);
        const key = ownsAgentIds.join("\n");
        const reuse = at < kept && previous?.owned[at] === key;
        rows[at] = reuse ? previous!.rows[at]! : replyContextRow(message, ownsAgentIds);
        owned[at] = key;
        continue;
      }
      let row = replyContextRows.get(message);
      if (!row) {
        row = replyContextRow(message, message.role === "user" ? [] : agentIdsOf(message));
        replyContextRows.set(message, row);
      }
      rows[at] = row;
    }
    const agentStates = new Map<string, MobileAgentState>();
    for (const at of contributors) {
      for (const [id, state] of facts[at]!.states ?? []) agentStates.set(id, state);
    }
    for (const at of contributors) {
      for (const [id, state] of facts[at]!.latest ?? []) agentStates.set(id, state);
    }
    const result = { ...project(rows), agentStates };
    previous = { messages, facts, contributors, rows, owned, learning, result };
    return result;
  };
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

