import { useMemo } from "react";
import type { TaskLifecycleStatus } from "@stella/contracts/agent-runtime";
import { ledgerThreadTaskStatus } from "@stella/contracts/agent-ledger";
import { isFollowUpTitle } from "@stella/contracts/agent-titles";
import { CONVERSATION_AGENT_THREADS_MAX } from "@stella/contracts/backend/agent-threads";
import {
  isPlacementThreadId,
  placementRemoteThreadAgentId,
} from "@stella/contracts/placement-thread-id";
import { isPrivateConversationId } from "@/features/chat/services/chat-storage-preference";
import { fallbackTaskDescription } from "@/features/chat/lib/event-transforms";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import { useBackendView } from "@/platform/backend/use-backend-view";
import { cloudConversationBelongsToOwnerSubject } from "./cloud-conversation-selection";
import { useJournalAgent } from "./journal-agent-store";

const plainTitle = (value: string | undefined, threadId: string): string => {
  const title = value?.trim() ?? "";
  return title === threadId ? "" : title;
};

const firstTitle = (
  candidates: readonly (string | undefined)[],
  threadId: string,
  accept: (title: string) => boolean,
): string => {
  for (const candidate of candidates) {
    const title = plainTitle(candidate, threadId);
    if (title && accept(title)) return title;
  }
  return "";
};

export type AgentCard = {
  title?: string;
  status?: TaskLifecycleStatus;
};

/**
 * The cloud thread an agent id names. A device-placed agent cited by its
 * local placement id resolves to the conversation's cloud thread whose id
 * hashes to it.
 */
function useCloudThreadId(conversationId: string, threadId: string, enabled: boolean): string {
  const placed = enabled && isPlacementThreadId(threadId);
  const page = useBackendView(
    "agentThreads.forConversation",
    placed ? { conversationId, limit: CONVERSATION_AGENT_THREADS_MAX } : "skip",
  );
  const threads = page.value?.threads;
  return useMemo(() => {
    if (!placed || !threads) return threadId;
    const match = threads.find(
      (thread) => placementRemoteThreadAgentId(thread.threadId) === threadId,
    );
    return match?.threadId ?? threadId;
  }, [placed, threadId, threads]);
}

/**
 * An agent's title and status. The agent ledger is the authority for both:
 * its row's status wins over this computer's own record of the agent and
 * over the journal. Those stand in while the row loads, for an agent the
 * ledger never held, and for a chat stored only on this computer.
 */
export function useAgentCard(
  conversationId: string,
  threadId: string,
  candidates: readonly (string | undefined)[],
  localStatus?: TaskLifecycleStatus,
): AgentCard {
  const { isCloudConversationReady, ownerSubject } = useCloudConversationSession();
  const cloudEnabled =
    Boolean(threadId) && isCloudConversationReady && !isPrivateConversationId(conversationId);
  const cloudThreadId = useCloudThreadId(conversationId, threadId, cloudEnabled);
  const journal = useJournalAgent(conversationId, threadId);
  const cloudJournal = useJournalAgent(conversationId, cloudThreadId);
  const lookup = useBackendView(
    "agentThreads.get",
    cloudEnabled ? { conversationId, threadId: cloudThreadId } : "skip",
  );
  const thread =
    lookup.value && cloudConversationBelongsToOwnerSubject(lookup.value, ownerSubject)
      ? lookup.value
      : null;
  const notFollowUp = (title: string) =>
    !isFollowUpTitle(journal, title) && !isFollowUpTitle(cloudJournal, title);
  const cloudTitle = thread ? plainTitle(thread.description, cloudThreadId) : "";
  const titles = [...candidates, cloudJournal?.title, journal?.title];
  const derived = fallbackTaskDescription(threadId);
  const title =
    (cloudTitle && notFollowUp(cloudTitle) ? cloudTitle : "") ||
    firstTitle(titles, threadId, (value) => value !== derived && notFollowUp(value)) ||
    cloudTitle ||
    firstTitle(titles, threadId, () => true);
  const status =
    (thread ? ledgerThreadTaskStatus(thread.status) : undefined) ??
    localStatus ??
    cloudJournal?.status ??
    journal?.status;
  return {
    ...(title ? { title } : {}),
    ...(status ? { status } : {}),
  };
}

export function useAgentTitle(
  conversationId: string,
  threadId: string,
  candidates: readonly (string | undefined)[],
): string | undefined {
  return useAgentCard(conversationId, threadId, candidates, "completed").title;
}
