import { useCallback, useEffect, useMemo, useState } from "react";
import { ledgerThreadTaskStatus } from "@stella/contracts/agent-ledger";
import { CONVERSATION_AGENT_THREADS_MAX } from "@stella/contracts/backend/agent-threads";
import { isPlacementThreadId, placementAliases } from "@stella/contracts/placement-thread-id";
import {
  emptyAgentActivityState,
  foldAgentActivity,
  type AgentActivityRecordInput,
} from "@stella/contracts/conversation-agent-activity";
import type { TaskItem } from "@/features/chat/lib/event-transforms";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import { useBackendView } from "@/platform/backend/use-backend-view";
import { cloudConversationBelongsToOwnerSubject } from "./cloud-conversation-selection";
import type { CloudAgentThread } from "./cloud-api";

export const cloudPlacementLabel = (placement: string): string =>
  placement === "computer" ? "Computer" : "Cloud";

export const cloudThreadReport = (
  thread: CloudAgentThread,
): string | undefined => {
  if (thread.resultJson) {
    try {
      const parsed = JSON.parse(thread.resultJson) as { finalText?: string };
      if (typeof parsed.finalText === "string" && parsed.finalText.trim()) {
        return parsed.finalText.trim();
      }
    } catch {
      return thread.resultJson;
    }
  }
  return thread.errorMessage?.trim() || undefined;
};

export const cloudThreadToTask = (thread: CloudAgentThread): TaskItem => {
  const status = ledgerThreadTaskStatus(thread.status);
  const report = cloudThreadReport(thread);
  return {
    id: thread.threadId,
    description: thread.description,
    agentType: thread.agentType || "general",
    ...(thread.parentThreadId ? { parentAgentId: thread.parentThreadId } : {}),
    source: "stella",
    status,
    startedAtMs: thread.createdAt,
    lastUpdatedAtMs: thread.updatedAt,
    ...(status === "running" ? {} : { completedAtMs: thread.updatedAt }),
    ...(report
      ? {
          assistantMessages: [report],
          assistantMessagesUpdatedAtMs: thread.updatedAt,
        }
      : {}),
  };
};

export type CloudActivity = {
  threads: CloudAgentThread[];
  tasks: TaskItem[];
  placements: ReadonlyMap<string, string>;
  threadsById: ReadonlyMap<string, CloudAgentThread>;
  hasRunning: boolean;
};

const EMPTY_ACTIVITY: CloudActivity = {
  threads: [],
  tasks: [],
  placements: new Map(),
  threadsById: new Map(),
  hasRunning: false,
};

const projectCloudActivity = (
  threads: readonly CloudAgentThread[] | undefined,
): CloudActivity => {
  if (!threads?.length) return EMPTY_ACTIVITY;
  const tasks: TaskItem[] = [];
  const placements = new Map<string, string>();
  const threadsById = new Map<string, CloudAgentThread>();
  for (const thread of threads) {
    tasks.push(cloudThreadToTask(thread));
    placements.set(thread.threadId, cloudPlacementLabel(thread.placement));
    threadsById.set(thread.threadId, thread);
  }
  return {
    threads: [...threads],
    tasks,
    placements,
    threadsById,
    hasRunning: tasks.some((task) => task.status === "running"),
  };
};

export type CloudConversationActivity = CloudActivity & {
  hasLoaded: boolean;
  ledgerReady: boolean;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  loadOlder: () => void;
};

export const CLOUD_ACTIVITY_PAGE_SIZE = 30;

export const cloudThreadsForOwnerSubject = (
  threads: readonly CloudAgentThread[],
  ownerSubject: string | null,
): CloudAgentThread[] =>
  threads.filter((thread) =>
    cloudConversationBelongsToOwnerSubject(thread, ownerSubject),
  );

export const mergeCloudThreadSnapshots = (
  history: readonly CloudAgentThread[],
  running: readonly CloudAgentThread[],
): CloudAgentThread[] => {
  const byId = new Map(history.map((thread) => [thread.threadId, thread]));
  for (const thread of running) {
    const current = byId.get(thread.threadId);
    if (!current || thread.updatedAt > current.updatedAt) {
      byId.set(thread.threadId, thread);
    }
  }
  return [...byId.values()].sort(
    (a, b) => b.updatedAt - a.updatedAt || a.threadId.localeCompare(b.threadId),
  );
};

export const useCloudConversationActivity = (
  conversationId: string | null,
): CloudConversationActivity => {
  const { isCloudConversationReady, ownerSubject } =
    useCloudConversationSession();
  const enabled = isCloudConversationReady && Boolean(conversationId);
  const [limit, setLimit] = useState(CLOUD_ACTIVITY_PAGE_SIZE);
  useEffect(() => setLimit(CLOUD_ACTIVITY_PAGE_SIZE), [conversationId]);
  const page = useBackendView(
    "agentThreads.forConversation",
    enabled && conversationId ? { conversationId, limit } : "skip",
    { keepPreviousValue: true },
  );
  const running = useBackendView(
    "agentThreads.running",
    enabled && conversationId ? { conversationId } : "skip",
  );
  const pageThreads = page.value?.threads;
  const runningThreads = running.value;
  const ownedThreads = useMemo(
    () =>
      pageThreads
        ? cloudThreadsForOwnerSubject(pageThreads, ownerSubject)
        : undefined,
    [ownerSubject, pageThreads],
  );
  const ownedRunningThreads = useMemo(
    () =>
      runningThreads
        ? cloudThreadsForOwnerSubject(runningThreads, ownerSubject)
        : undefined,
    [ownerSubject, runningThreads],
  );
  const pageOwnedByCurrentScope =
    pageThreads === undefined || ownedThreads?.length === pageThreads.length;
  const runningOwnedByCurrentScope =
    runningThreads === undefined ||
    ownedRunningThreads?.length === runningThreads.length;
  const pageScopeIsCurrent =
    pageOwnedByCurrentScope && runningOwnedByCurrentScope;
  const runningHasLoaded = !enabled || running.status !== "loading";
  const threads = useMemo(
    () =>
      pageScopeIsCurrent
        ? mergeCloudThreadSnapshots(
            ownedThreads ?? [],
            ownedRunningThreads ?? [],
          )
        : undefined,
    [ownedRunningThreads, ownedThreads, pageScopeIsCurrent],
  );
  const hasLoaded =
    pageScopeIsCurrent &&
    runningHasLoaded &&
    (!enabled || page.status !== "loading");
  const isLoadingOlder =
    pageScopeIsCurrent &&
    page.status === "loading" &&
    limit > CLOUD_ACTIVITY_PAGE_SIZE;
  const hasOlder =
    pageScopeIsCurrent &&
    ((page.value?.hasMore ?? false) || isLoadingOlder) &&
    limit < CONVERSATION_AGENT_THREADS_MAX;
  const canLoadMore = page.status === "ready" && page.value.hasMore;
  const ledgerReady =
    enabled &&
    pageScopeIsCurrent &&
    page.value !== undefined &&
    running.value !== undefined;
  const loadOlder = useCallback(() => {
    if (pageScopeIsCurrent && canLoadMore) {
      setLimit((current) =>
        Math.min(current + CLOUD_ACTIVITY_PAGE_SIZE, CONVERSATION_AGENT_THREADS_MAX),
      );
    }
  }, [canLoadMore, pageScopeIsCurrent]);
  return useMemo(
    () => ({
      ...projectCloudActivity(threads),
      hasLoaded,
      ledgerReady,
      hasOlder,
      isLoadingOlder,
      loadOlder,
    }),
    [hasLoaded, hasOlder, isLoadingOlder, ledgerReady, loadOlder, threads],
  );
};

export const mergeCloudConversationTasks = (
  canonical: readonly TaskItem[],
  operational: readonly TaskItem[],
): TaskItem[] => {
  if (canonical.length === 0) return [...operational];
  const aliases = operational.some((task) => isPlacementThreadId(task.id))
    ? placementAliases(canonical.map((task) => task.id))
    : null;
  const canonicalId = (id: string) => aliases?.get(id) ?? id;
  const operationalById = new Map(
    operational.map((task) => [canonicalId(task.id), task] as const),
  );
  const canonicalIds = new Set(canonical.map((task) => task.id));
  const merged = canonical.map((task) => {
    const overlay = operationalById.get(task.id);
    if (!overlay || task.status !== "running") return task;
    return {
      ...task,
      ...(overlay.statusText ? { statusText: overlay.statusText } : {}),
      ...(overlay.reasoningText
        ? { reasoningText: overlay.reasoningText }
        : {}),
      ...(overlay.anchorTurnId ? { anchorTurnId: overlay.anchorTurnId } : {}),
    };
  });
  for (const task of operational) {
    if (!canonicalIds.has(canonicalId(task.id))) merged.push(task);
  }
  return merged;
};

export const journalActivityTasks = (
  records: readonly AgentActivityRecordInput[],
): TaskItem[] =>
  [...foldAgentActivity(emptyAgentActivityState(), records).entries.values()].map(
    (entry): TaskItem => ({
      id: entry.agentId,
      description: entry.title,
      agentType: entry.agentType ?? "general",
      source: "stella",
      status: entry.status,
      startedAtMs: entry.createdAtMs,
      lastUpdatedAtMs: entry.updatedAtMs,
      ...(entry.statusText ? { statusText: entry.statusText } : {}),
      ...(entry.completedAtMs !== undefined ? { completedAtMs: entry.completedAtMs } : {}),
    }),
  );
