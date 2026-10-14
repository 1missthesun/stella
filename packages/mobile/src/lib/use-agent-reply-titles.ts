import { useMemo, useRef, useState } from "react";
import type { ReplyRef } from "@stella/contracts/reply-refs";
import type { ChatArtifact, ChatMessage } from "../types";
import { agentTaskStatus } from "@stella/contracts/agent-ledger";
import type { MobileAgentState } from "./mobile-reply-context";
import { useConversationAgentLedger } from "./use-conversation-agent-ledger";

const GENERIC_TITLE = "Task";

const untitled = (title: string | undefined, threadId: string): boolean => {
  const value = title?.trim();
  return !value || value === threadId || value === GENERIC_TITLE;
};

type AgentState = MobileAgentState;

type CloudAgent = { title?: string; state?: AgentState };

const NO_IDS: readonly string[] = [];

const messageAgentIds = (message: ChatMessage): readonly string[] => {
  if (!message.replyRefs && !message.artifacts) return NO_IDS;
  const ids: string[] = [];
  for (const ref of message.replyRefs ?? []) {
    if (ref.kind === "agent") ids.push(ref.threadId);
  }
  for (const artifact of message.artifacts ?? []) {
    const payload = artifact.payload;
    if (payload.kind !== "agent-work") continue;
    for (const agent of payload.agents ?? []) if (agent.agentId) ids.push(agent.agentId);
    for (const id of payload.agentIds ?? []) ids.push(id);
  }
  return ids.length ? ids : NO_IDS;
};

const sharedPrefix = <T>(a: readonly T[], b: readonly T[]): number => {
  const shared = Math.min(a.length, b.length);
  let kept = 0;
  while (kept < shared && a[kept] === b[kept]) kept += 1;
  return kept;
};

/**
 * Every agent the transcript names, in first-seen order, reading only the
 * messages after the unchanged start; the same list comes back while it
 * didn't change.
 */
const createTranscriptAgentIds = () => {
  let previous: {
    messages: readonly ChatMessage[];
    perMessage: (readonly string[])[];
    seen: Set<string>;
    ids: string[];
  } | null = null;
  return (messages: readonly ChatMessage[]): string[] => {
    const kept = previous ? sharedPrefix(previous.messages, messages) : 0;
    if (previous && kept === messages.length && kept === previous.messages.length) {
      return previous.ids;
    }
    const perMessage = previous ? previous.perMessage.slice(0, kept) : [];
    for (let at = kept; at < messages.length; at += 1) perMessage.push(messageAgentIds(messages[at]!));
    let seen: Set<string>;
    let ids: string[];
    if (previous && kept === previous.messages.length) {
      seen = new Set(previous.seen);
      ids = previous.ids.slice();
      for (let at = kept; at < perMessage.length; at += 1) {
        for (const id of perMessage[at]!) {
          if (seen.has(id)) continue;
          seen.add(id);
          ids.push(id);
        }
      }
    } else {
      seen = new Set();
      ids = [];
      for (const list of perMessage) {
        for (const id of list) {
          if (seen.has(id)) continue;
          seen.add(id);
          ids.push(id);
        }
      }
    }
    if (
      previous &&
      ids.length === previous.ids.length &&
      ids.every((id, i) => id === previous!.ids[i])
    ) {
      ids = previous.ids;
    }
    previous = { messages, perMessage, seen, ids };
    return ids;
  };
};

/** `cachedTitledMessage` over the transcript, redoing only rows after the unchanged start. */
const createTitledMessages = () => {
  let previous: {
    messages: readonly ChatMessage[];
    agents: ReadonlyMap<string, CloudAgent>;
    titled: ChatMessage[];
  } | null = null;
  return (messages: ChatMessage[], agents: ReadonlyMap<string, CloudAgent>): ChatMessage[] => {
    const kept = previous && previous.agents === agents ? sharedPrefix(previous.messages, messages) : 0;
    if (previous && kept === messages.length && kept === previous.messages.length) {
      return previous.titled;
    }
    const titled = previous ? previous.titled.slice(0, kept) : [];
    for (let at = kept; at < messages.length; at += 1) {
      titled.push(cachedTitledMessage(messages[at]!, agents));
    }
    previous = { messages, agents, titled };
    return titled;
  };
};

const titledRef = (ref: ReplyRef, agents: ReadonlyMap<string, CloudAgent>): ReplyRef => {
  if (ref.kind !== "agent" || !untitled(ref.title, ref.threadId)) return ref;
  const title = agents.get(ref.threadId)?.title;
  return title ? { ...ref, title } : ref;
};

const titledArtifact = (
  artifact: ChatArtifact,
  known: ReadonlyMap<string, CloudAgent>,
): ChatArtifact => {
  const payload = artifact.payload;
  if (payload.kind !== "agent-work") return artifact;
  let changed = false;
  const agents = payload.agents?.map((agent) => {
    const title = agent.agentId && untitled(agent.title, agent.agentId)
      ? known.get(agent.agentId)?.title
      : undefined;
    if (!title) return agent;
    changed = true;
    return { ...agent, title };
  });
  const only = payload.agentIds?.length === 1 ? payload.agentIds[0] : undefined;
  const cardTitle = only && untitled(payload.title, only) ? known.get(only)?.title : undefined;
  if (cardTitle) changed = true;
  if (!changed) return artifact;
  return {
    ...artifact,
    payload: {
      ...payload,
      ...(agents ? { agents } : {}),
      ...(cardTitle ? { title: cardTitle } : {}),
    },
  };
};

const cloudStates = (
  message: ChatMessage,
  agents: ReadonlyMap<string, CloudAgent>,
): ChatMessage["agentStates"] | undefined => {
  let states: Record<string, AgentState> | undefined;
  for (const ref of message.replyRefs ?? []) {
    if (ref.kind !== "agent") continue;
    const state = agents.get(ref.threadId)?.state;
    if (!state || message.agentStates?.[ref.threadId] === state) continue;
    states = { ...(states ?? message.agentStates), [ref.threadId]: state };
  }
  return states;
};

const titledMessage = (
  message: ChatMessage,
  agents: ReadonlyMap<string, CloudAgent>,
): ChatMessage => {
  const replyRefs = message.replyRefs?.map((ref) => titledRef(ref, agents));
  const artifacts = message.artifacts?.map((artifact) => titledArtifact(artifact, agents));
  const agentStates = cloudStates(message, agents);
  const refsChanged = replyRefs?.some((ref, index) => ref !== message.replyRefs![index]) ?? false;
  const artifactsChanged =
    artifacts?.some((artifact, index) => artifact !== message.artifacts![index]) ?? false;
  if (!refsChanged && !artifactsChanged && !agentStates) return message;
  return {
    ...message,
    ...(refsChanged ? { replyRefs } : {}),
    ...(artifactsChanged ? { artifacts } : {}),
    ...(agentStates ? { agentStates } : {}),
  };
};

const titledMessages = new WeakMap<
  ChatMessage,
  { agents: ReadonlyMap<string, CloudAgent>; message: ChatMessage }
>();

const cachedTitledMessage = (
  message: ChatMessage,
  agents: ReadonlyMap<string, CloudAgent>,
): ChatMessage => {
  const cached = titledMessages.get(message);
  if (cached?.agents === agents) return cached.message;
  const titled = titledMessage(message, agents);
  titledMessages.set(message, { agents, message: titled });
  return titled;
};

const sameAgents = (
  a: ReadonlyMap<string, CloudAgent>,
  b: ReadonlyMap<string, CloudAgent>,
): boolean => {
  if (a.size !== b.size) return false;
  for (const [id, agent] of a) {
    const other = b.get(id);
    if (!other || other.title !== agent.title || other.state !== agent.state) return false;
  }
  return true;
};

const cloudState = (status: Parameters<typeof agentTaskStatus>[0]): AgentState => {
  const state = agentTaskStatus(status);
  return state === "canceled" ? "error" : state;
};

export function useAgentReplyTitles(
  conversationId: string | null,
  messages: ChatMessage[],
): ChatMessage[] {
  const [transcriptAgentIds] = useState(createTranscriptAgentIds);
  const [titledMessages] = useState(createTitledMessages);
  const ids = useMemo(() => transcriptAgentIds(messages), [messages, transcriptAgentIds]);
  const ledger = useConversationAgentLedger(conversationId, ids);
  const agentsRef = useRef<ReadonlyMap<string, CloudAgent>>(new Map());
  const agents = useMemo(() => {
    const known = new Map<string, CloudAgent>();
    if (!ledger.ready) return known;
    for (const id of ids) {
      const row = ledger.agents.get(id);
      if (!row) continue;
      known.set(id, {
        ...(row.title && !untitled(row.title, id) ? { title: row.title } : {}),
        state: cloudState(row.status),
      });
    }
    if (sameAgents(known, agentsRef.current)) return agentsRef.current;
    agentsRef.current = known;
    return known;
  }, [ids, ledger]);
  return useMemo(
    () => (agents.size === 0 ? messages : titledMessages(messages, agents)),
    [messages, agents, titledMessages],
  );
}
