import { useEffect, useMemo, useRef } from "react";
import { backendClient } from "@/platform/backend/backend-client";
import { type TaskItem } from "@/features/chat/lib/event-transforms";
import { useChatRuntime } from "@/context/use-chat-runtime";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { AGENT_IDS } from "@stella/contracts/agent-runtime";

const MOUNT_GRACE_MS = 2_000;

export type ActivityNotificationKind = "started" | "completed" | "failed";

export type ActivityNotification = {
  kind: ActivityNotificationKind;
  taskId: string;
  title: string;
};

export type TaskNotificationRecord = {
  attemptGeneration?: number;
  observedRunning: boolean;
  eligibleForStartedNotification: boolean;
  startedNotified: boolean;
  terminalNotified: boolean;
};

type MobileActivityTaskItem = TaskItem & {
  source?: string;
  attemptGeneration?: number;
};

const isWellFormedThreadId = (value: string): boolean =>
  value.length > 0 && value.trim() === value;

export function selectActivityNotificationTasks(
  tasks: readonly TaskItem[],
): TaskItem[] {
  const seenIds = new Set<string>();
  const duplicateIds = new Set<string>();
  for (const task of tasks) {
    if (seenIds.has(task.id)) duplicateIds.add(task.id);
    else seenIds.add(task.id);
  }

  return tasks.filter((task) => {
    if (!isWellFormedThreadId(task.id) || duplicateIds.has(task.id)) {
      return false;
    }
    if ((task as MobileActivityTaskItem).source !== "stella") return false;
    if (task.agentType !== AGENT_IDS.GENERAL) return false;
    return task.parentAgentId === undefined;
  });
}

export function collectActivityNotifications(
  tasks: readonly TaskItem[],
  records: Map<string, TaskNotificationRecord>,
  mountedAtMs: number,
): ActivityNotification[] {
  const kinds: ActivityNotification[] = [];
  const seenTaskIds = new Set<string>();

  for (const task of tasks) {
    const attemptGeneration = (task as MobileActivityTaskItem)
      .attemptGeneration;
    seenTaskIds.add(task.id);
    let record = records.get(task.id);

    if (!record) {
      record = {
        attemptGeneration,
        observedRunning: task.status === "running",
        eligibleForStartedNotification:
          task.startedAtMs >= mountedAtMs - MOUNT_GRACE_MS,
        startedNotified: false,
        terminalNotified: false,
      };
      records.set(task.id, record);
    } else {
      const recordedGeneration = record.attemptGeneration;
      const observedGeneration = attemptGeneration;
      if (
        recordedGeneration !== undefined &&
        (observedGeneration === undefined ||
          observedGeneration < recordedGeneration)
      ) {
        continue;
      }
      if (
        recordedGeneration !== undefined &&
        observedGeneration !== undefined &&
        observedGeneration > recordedGeneration
      ) {
        record = {
          attemptGeneration: observedGeneration,
          observedRunning: task.status === "running",
          eligibleForStartedNotification: true,
          startedNotified: false,
          terminalNotified: false,
        };
        records.set(task.id, record);
      } else if (
        recordedGeneration === undefined &&
        observedGeneration !== undefined
      ) {
        record.attemptGeneration = observedGeneration;
      }
    }

    if (task.status === "running") {
      record.observedRunning = true;
      if (record.eligibleForStartedNotification && !record.startedNotified) {
        record.startedNotified = true;
        kinds.push({ kind: "started", taskId: task.id, title: task.description.trim() });
      }
      continue;
    }

    const terminalAtMs =
      task.completedAtMs ?? task.lastUpdatedAtMs ?? task.startedAtMs;
    const eligibleForTerminalNotification =
      record.observedRunning || terminalAtMs >= mountedAtMs - MOUNT_GRACE_MS;

    if (
      !record.terminalNotified &&
      eligibleForTerminalNotification &&
      task.status !== "canceled"
    ) {
      record.terminalNotified = true;
      kinds.push({
        kind: task.status === "completed" ? "completed" : "failed",
        taskId: task.id,
        title: task.description.trim(),
      });
    }
  }

  for (const taskId of records.keys()) {
    if (seenTaskIds.has(taskId)) continue;
    records.delete(taskId);
  }

  return kinds;
}

export function MobileActivityNotificationsBridge() {
  const { hasConnectedAccount } = useAuthSessionState();
  const chat = useChatRuntime();
  const mountedAtMsRef = useRef(Date.now());
  const recordsRef = useRef<Map<string, TaskNotificationRecord>>(new Map());

  const allTasks = useMemo(
    () => selectActivityNotificationTasks(chat.conversation.tasks),
    [chat.conversation.tasks],
  );

  useEffect(() => {
    const send = (notification: ActivityNotification) => {
      const { kind, taskId, title } = notification;
      void backendClient
        .call("phone.notifyActivity", { kind, taskId, ...(title ? { title } : {}) })
        .catch((error: unknown) => {
          if ((error as { code?: unknown } | null)?.code !== "BAD_REQUEST") throw error;
          return backendClient.call("phone.notifyActivity", { kind });
        })
        .catch((error) => {
          console.warn("[mobile-activity] Failed to send notification:", error);
        });
    };

    if (!hasConnectedAccount) {
      recordsRef.current.clear();
      return;
    }

    const notifications = collectActivityNotifications(
      allTasks,
      recordsRef.current,
      mountedAtMsRef.current,
    );
    for (const notification of notifications) {
      send(notification);
    }
  }, [allTasks, hasConnectedAccount]);

  return null;
}
