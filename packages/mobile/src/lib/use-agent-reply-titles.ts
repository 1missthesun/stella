import { useEffect, useMemo, useState } from "react";
import type { ReplyRef } from "@stella/contracts/reply-refs";
import type { ChatArtifact, ChatMessage } from "../types";
import { agentThreadStatus } from "@stella/contracts/agent-titles";
import { CONVERSATION_AGENT_THREADS_MAX } from "@stella/contracts/backend/agent-threads";
import { isPlacementThreadId, placementAliases } from "@stella/contracts/placement-thread-id";
import { getBackendClient } from "./backend";

const GENERIC_TITLE = "Task";

const untitled = (title: string | undefined, threadId: string): boolean => {
  const value = title?.trim();
  return !value || value === threadId || value === GENERIC_TITLE;
};

type AgentState = "running" | "completed" | "error";

type CloudAgent = { title?: string; state?: AgentState };

const unresolvedThreadIds = (messages: readonly ChatMessage[]): string[] => {
  const ids = new Set<string>();
  for (const message of messages) {
    for (const ref of message.replyRefs ?? []) {
      if (ref.kind !== "agent") continue;
      const state = message.agentStates?.[ref.threadId];
      if (untitled(ref.title, ref.threadId) || !state || state === "running") ids.add(ref.threadId);
    }
    for (const artifact of message.artifacts ?? []) {
      const payload = artifact.payload;
      if (payload.kind !== "agent-work") continue;
      for (const agent of payload.agents ?? []) {
        if (agent.agentId && untitled(agent.title, agent.agentId)) ids.add(agent.agentId);
      }
      const only = payload.agentIds?.length === 1 ? payload.agentIds[0] : undefined;
      if (only && untitled(payload.title, only)) ids.add(only);
    }
  }
  return [...ids].sort();
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

const cloudState = (status: string): AgentState => {
  const state = agentThreadStatus(status);
  return state === "running" || state === "completed" ? state : "error";
};

export function useAgentReplyTitles(
  conversationId: string | null,
  messages: ChatMessage[],
): ChatMessage[] {
  const key = useMemo(() => unresolvedThreadIds(messages).join("\n"), [messages]);
  const [agents, setAgents] = useState<ReadonlyMap<string, CloudAgent>>(() => new Map());
  useEffect(() => {
    setAgents(new Map());
  }, [conversationId]);
  useEffect(() => {
    if (!conversationId || !key) return;
    let client: ReturnType<typeof getBackendClient>;
    try {
      client = getBackendClient();
    } catch {
      return;
    }
    const record = (threadId: string, thread: { description?: string; status: string }) => {
      const description = thread.description?.trim();
      const next: CloudAgent = {
        ...(description && !untitled(description, threadId) ? { title: description } : {}),
        state: cloudState(thread.status),
      };
      setAgents((current) => {
        const previous = current.get(threadId);
        if (previous?.title === next.title && previous?.state === next.state) return current;
        return new Map(current).set(threadId, next);
      });
    };
    const threadIds = key.split("\n");
    const placed = new Set(threadIds.filter(isPlacementThreadId));
    const stops = threadIds
      .filter((threadId) => !placed.has(threadId))
      .map((threadId) =>
        client.watch(
          "agentThreads.get",
          { conversationId, threadId },
          (thread) => {
            if (thread) record(threadId, thread);
          },
          () => {},
        ),
      );
    if (placed.size > 0) {
      stops.push(
        client.watch(
          "agentThreads.forConversation",
          { conversationId, limit: CONVERSATION_AGENT_THREADS_MAX },
          (page) => {
            const threads = page?.threads ?? [];
            const aliases = placementAliases(threads.map((thread) => thread.threadId));
            for (const threadId of placed) {
              const cloudId = aliases.get(threadId);
              const thread = cloudId ? threads.find((entry) => entry.threadId === cloudId) : undefined;
              if (thread) record(threadId, thread);
            }
          },
          () => {},
        ),
      );
    }
    return () => {
      for (const stop of stops) stop();
    };
  }, [conversationId, key]);
  return useMemo(
    () => (agents.size === 0 ? messages : messages.map((message) => titledMessage(message, agents))),
    [messages, agents],
  );
}
