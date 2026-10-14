export type ComputerAgentStanding = {
  status: "running" | "completed" | "error" | "canceled";
  attempt: number;
  error?: string;
};

type RunningComputerThread = {
  threadId: string;
  conversationId: string;
  attemptGeneration: number;
};

export const INTERRUPTED_AGENT_REASON =
  "Interrupted: this computer is no longer running this agent.";

export const reconcileComputerAgents = async (args: {
  running(): Promise<RunningComputerThread[]>;
  complete(input: {
    threadId: string;
    attemptGeneration: number;
    status: "completed" | "failed" | "canceled";
    error?: string;
  }): Promise<unknown>;
  cancel(input: { threadId: string; attemptGeneration: number; reason: string }): Promise<unknown>;
  standing(threadId: string): Promise<ComputerAgentStanding | undefined>;
}): Promise<{ settled: string[] }> => {
  const settled: string[] = [];
  for (const thread of await args.running()) {
    const here = await args.standing(thread.threadId);
    if (here?.status === "running") continue;
    if (here && here.attempt > thread.attemptGeneration) continue;
    if (!here) {
      await args.cancel({
        threadId: thread.threadId,
        attemptGeneration: thread.attemptGeneration,
        reason: INTERRUPTED_AGENT_REASON,
      });
    } else {
      await args.complete({
        threadId: thread.threadId,
        attemptGeneration: thread.attemptGeneration,
        status: here.status === "error" ? "failed" : here.status,
        ...(here.status !== "completed"
          ? { error: here.error?.trim() || INTERRUPTED_AGENT_REASON }
          : {}),
      });
    }
    settled.push(thread.threadId);
  }
  return { settled };
};
