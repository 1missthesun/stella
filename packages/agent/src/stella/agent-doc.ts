import { defineDoc } from "@earendil-works/pi-durable";

export type StellaAgentRole = {
  agentType: "orchestrator" | "general";
  depth: number;
  description?: string;
  threadId?: string;
  parentConversationId?: number;
  startedBy?: { threadId: string; label: string };
  moving?: { deviceId: string; name: string; brief: string; key: string };
  /** This turn ends waiting (end_turn_waiting): no report, and the next message resumes it. */
  waiting?: { waitingFor: string };
  notes?: StellaPendingNote[];
  /** Stella last answered this agent's ask_user or request_secure_input, which then goes straight to the user. */
  stellaReplied?: { tool: string; at: number };
  /** An ask this agent put to Stella first and is waiting on; her next message lands in `reply`, not the inbox. */
  askingStella?: { key: string; reply?: string };
};

export type StellaPendingNote = {
  callId: string;
  key: string;
  message: string;
  from: { threadId: string; label: string };
  remote?: true;
};

export const StellaAgentDoc = defineDoc<StellaAgentRole>({
  kind: "stella.agent",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ agentType: "orchestrator", depth: 0 }),
});

export { MAX_AGENT_DEPTH } from "@stella/contracts/agent-depth";
