import { useMemo } from "react";
import { CONVERSATION_AGENT_THREADS_MAX } from "@stella/contracts/backend/agent-threads";
import { isPrivateConversationId } from "@/features/chat/services/chat-storage-preference";
import type { DesktopThreadActivityRecord } from "@/features/chat/thread-activity-types";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import { useBackendView } from "@/platform/backend/use-backend-view";

export const useAgentParents = (
  conversationId: string | null | undefined,
  records: readonly DesktopThreadActivityRecord[],
): ReadonlyMap<string, string> => {
  const { isCloudConversationReady } = useCloudConversationSession();
  const cloudEnabled =
    Boolean(conversationId) &&
    isCloudConversationReady &&
    !isPrivateConversationId(conversationId);
  const page = useBackendView(
    "agentThreads.forConversation",
    cloudEnabled && conversationId
      ? { conversationId, limit: CONVERSATION_AGENT_THREADS_MAX }
      : "skip",
  );
  const threads = page.value?.threads;
  const key = useMemo(() => {
    const pairs = new Set<string>();
    for (const record of records) {
      if (record.parentAgentId && record.parentAgentId !== record.threadId) {
        pairs.add(`${record.threadId}\u001f${record.parentAgentId}`);
      }
    }
    for (const thread of threads ?? []) {
      if (thread.parentThreadId && thread.parentThreadId !== thread.threadId) {
        pairs.add(`${thread.threadId}\u001f${thread.parentThreadId}`);
      }
    }
    return [...pairs].sort().join("\u001e");
  }, [records, threads]);
  return useMemo(() => {
    const parents = new Map<string, string>();
    if (!key) return parents;
    for (const entry of key.split("\u001e")) {
      const [threadId, parentId] = entry.split("\u001f");
      if (threadId && parentId) parents.set(threadId, parentId);
    }
    return parents;
  }, [key]);
};
