import { defineDoc } from "@earendil-works/pi-durable";

export type StellaAgentRole = {
  agentType: "orchestrator" | "general";
  depth: number;
  description?: string;
  threadId?: string;
  parentConversationId?: number;
  startedBy?: { threadId: string; label: string };
  moving?: { deviceId: string; name: string; brief: string; key: string };
  notes?: StellaPendingNote[];
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
