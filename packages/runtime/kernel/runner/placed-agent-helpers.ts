/**
 * The owner's agent threads list every agent, under the agent that started
 * it. An agent another device placed here runs with this computer's local
 * storage (`runBlockingLocalAgent`), so the helpers it starts are local
 * agents, which publish nothing to the cloud. This mirrors each of their
 * attempts there, under the placed agent's cloud thread id, through the same
 * durable outbox a cloud conversation's agents use. Reports are untouched:
 * a helper still reports to the agent that started it, here.
 */
import type { AgentLifecycleEvent } from "../agents/local-agent-manager.js";
import type { ComputerAgentCloudRecords } from "./computer-agent-cloud-records.js";
import type { RunnerContext } from "./types.js";

const MAX_CHAIN = 8;

/**
 * The cloud thread id of the agent that started a local agent, when that
 * agent was placed here or is itself one of a placed agent's helpers.
 */
export const placedHelperParent = (
  context: Pick<RunnerContext, "runtimeStore">,
  agentId: string,
): string | undefined => {
  let record = context.runtimeStore.getAgentRecord?.(agentId);
  let parentThreadId: string | undefined;
  for (let depth = 0; depth < MAX_CHAIN; depth += 1) {
    if (!record || record.storageMode === "cloud" || !record.parentAgentId) return undefined;
    const parent = context.runtimeStore.getAgentRecord?.(record.parentAgentId);
    if (!parent || parent.storageMode === "cloud") return undefined;
    parentThreadId ??= parent.remoteThreadId ?? parent.threadId;
    if (parent.remoteThreadId) return parentThreadId;
    record = parent;
  }
  return undefined;
};

export const createPlacedHelperMirror = (
  context: Pick<RunnerContext, "runtimeStore" | "cloudOwnerGeneration">,
  records: Pick<ComputerAgentCloudRecords, "create" | "complete">,
) => {
  /** Each helper's mirror writes in order: its start reaches the outbox before its end. */
  const queues = new Map<string, Promise<void>>();
  const enqueue = (agentId: string, write: () => Promise<unknown>) => {
    const next = (queues.get(agentId) ?? Promise.resolve())
      .then(write)
      .then(
        () => undefined,
        (error: unknown) => {
          console.warn(
            "[placed-agent-helpers] cloud record failed",
            error instanceof Error ? error.message : error,
          );
        },
      );
    queues.set(agentId, next);
    void next.then(() => {
      if (queues.get(agentId) === next) queues.delete(agentId);
    });
  };
  return (event: AgentLifecycleEvent): void => {
    const agentId = typeof event?.agentId === "string" ? event.agentId : "";
    const attemptGeneration = event?.attemptGeneration;
    if (!agentId || typeof attemptGeneration !== "number" || attemptGeneration < 1) return;
    const terminal =
      event.type === "agent-completed" || event.type === "agent-failed" || event.type === "agent-canceled";
    if (event.type !== "agent-started" && !terminal) return;
    const parentAgentId = placedHelperParent(context, agentId);
    if (!parentAgentId) return;
    if (event.type === "agent-started") {
      enqueue(agentId, async () =>
        records.create({
          agentId,
          conversationId: event.conversationId,
          description: event.description,
          agentType: event.agentType,
          attemptGeneration,
          ownerGeneration: await context.cloudOwnerGeneration(),
          parentAgentId,
        }),
      );
      return;
    }
    enqueue(agentId, async () =>
      records.complete({
        agentId,
        attemptGeneration,
        ownerGeneration: await context.cloudOwnerGeneration(),
        status:
          event.type === "agent-completed"
            ? "completed"
            : event.type === "agent-failed"
              ? "error"
              : event.status === "paused"
                ? "paused"
                : "canceled",
        ...(typeof event.result === "string" && event.result ? { result: event.result.slice(0, 30_000) } : {}),
        ...(typeof event.error === "string" && event.error ? { error: event.error.slice(0, 10_000) } : {}),
      }),
    );
  };
};
