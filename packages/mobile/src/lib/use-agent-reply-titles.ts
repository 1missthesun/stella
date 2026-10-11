import { useMemo } from "react";
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

/** Every agent the transcript cites or carries a work card for, oldest first. */
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

const cloudState = (status: Parameters<typeof agentTaskStatus>[0]): AgentState => {
  const state = agentTaskStatus(status);
  return state === "canceled" ? "error" : state;
};

/**
 * The transcript with each cited agent's title and status from the agent
 * ledger. Its status wins over what the journal's cards said; a title
 * replaces only a missing one, since older runs stored a follow-up's label
 * as the description. An agent the ledger has no row for keeps the
 * journal's word, as does every agent while the ledger has not loaded.
 */
export function useAgentReplyTitles(
  conversationId: string | null,
  messages: ChatMessage[],
): ChatMessage[] {
  const ids = useMemo(() => transcriptAgentIds(messages), [messages]);
  const ledger = useConversationAgentLedger(conversationId, ids);
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
    return known;
  }, [ids, ledger]);
  return useMemo(
    () => (agents.size === 0 ? messages : messages.map((message) => titledMessage(message, agents))),
    [messages, agents],
  );
}
