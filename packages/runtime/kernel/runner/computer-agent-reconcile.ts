import { silentRunReport } from "@stella/contracts/backend/agent-reports";

export type ComputerAgentStanding = {
  status: "running" | "completed" | "error" | "canceled";
  attempt: number;
  error?: string;
  lastText?: string;
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
    result?: string;
    error?: string;
  }): Promise<unknown>;
  pending(threadId: string): boolean;
  cancel(input: { threadId: string; attemptGeneration: number; reason: string }): Promise<unknown>;
  standing(threadId: string): Promise<ComputerAgentStanding | undefined>;
}): Promise<{ settled: string[] }> => {
  const settled: string[] = [];
  for (const thread of await args.running()) {
    // Its own start or terminal is still queued here; that one settles it
    // with the real result, so settling it now would win with an empty one.
    if (args.pending(thread.threadId)) continue;
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
          : { result: here.lastText?.trim() || silentRunReport({}) }),
      });
    }
    settled.push(thread.threadId);
  }
  return { settled };
};
