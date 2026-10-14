import { useMemo, useRef } from "react";
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

const transcriptAgentIds = (messages: readonly ChatMessage[]): string[] => {
  const ids = new Set<string>();
  for (const message of messages) {
    for (const ref of message.replyRefs ?? []) {
      if (ref.kind === "agent") ids.add(ref.threadId);
    }
    for (const artifact of message.artifacts ?? []) {
      const payload = artifact.payload;
      if (payload.kind !== "agent-work") continue;
      for (const agent of payload.agents ?? []) if (agent.agentId) ids.add(agent.agentId);
      for (const id of payload.agentIds ?? []) ids.add(id);
    }
  }
  return [...ids];
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
  const ids = useMemo(() => transcriptAgentIds(messages), [messages]);
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
    () => (agents.size === 0 ? messages : messages.map((message) => cachedTitledMessage(message, agents))),
    [messages, agents],
  );
}
