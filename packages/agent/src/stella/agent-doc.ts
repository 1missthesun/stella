/**
 * Which Stella agent a conversation is. The root conversation is the
 * orchestrator and has no document; every agent conversation is created
 * with one. Its prompt, gateway agent type and depth limit follow from it,
 * and its parent link is how an agent's report finds its way up.
 */
import { defineDoc } from "@earendil-works/pi-durable";

export type StellaAgentRole = {
  /** Gateway agent type and prompt: `orchestrator` or `general`. */
  agentType: "orchestrator" | "general";
  /** 0 for the orchestrator, 1 for its agents, one more for each level below (`MAX_AGENT_DEPTH`). */
  depth: number;
  /** The short name the parent gave this agent. */
  description?: string;
  /** This agent's thread id in its parent's agent list. */
  threadId?: string;
  /** The conversation that started this agent. */
  parentConversationId?: number;
  /** Who started it, by the thread id its messages and send_message use. */
  startedBy?: { threadId: string; label: string };
  /**
   * It called `switch_destination`: once its run here ends, it moves to this
   * computer, with this brief (`StellaExecutionHost.moveAgent`).
   */
  moving?: { deviceId: string; name: string; brief: string; key: string };
  /**
   * Its `send_message`s to the Stella its report goes to, this run, not yet
   * settled. One goes out once the agent takes another step; one sent in its
   * run's last step becomes part of its report instead, so a run reaches
   * Stella once (`settleNotes` in agents.ts).
   */
  notes?: StellaPendingNote[];
};

/** A note to Stella waiting on the agent's next step. */
export type StellaPendingNote = {
  /** Its tool call, to tell whether the run went on after it. */
  callId: string;
  /** Exactly-once key: the tool call's task id. */
  key: string;
  /** What the agent wrote. */
  message: string;
  /** From whom, as Stella reads it. */
  from: { threadId: string; label: string };
  /** Stella runs on the host that started the agent, not here: it goes through the owner's agent threads. */
  remote?: true;
};

export const StellaAgentDoc = defineDoc<StellaAgentRole>({
  kind: "stella.agent",
  version: 1,
  scope: "conversation",
  history: "latest",
  // A fork is the same agent.
  fork: "current",
  initial: () => ({ agentType: "orchestrator", depth: 0 }),
});

export { MAX_AGENT_DEPTH } from "@stella/contracts/agent-depth";
