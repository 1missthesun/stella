import { defineDoc } from "@earendil-works/pi-durable";
import { boundedReplay } from "./doc-checkpoint.ts";

export type StellaAgentRole = {
  agentType: "orchestrator" | "general";
  depth: number;
  description?: string;
  threadId?: string;
  parentConversationId?: number;
  startedBy?: { threadId: string; label: string };
  moving?: { deviceId: string; name: string; brief: string; key: string };
  /** Set by older builds' end_turn_waiting; read only so a turn it marked still clears it. */
  waiting?: { waitingFor: string; afterEntry?: number };
  done?: { text: string; callIds: string[] };
  notes?: StellaPendingNote[];
  stellaReplied?: { tool: string; at: number };
  askingStella?: { key: string; reply?: string };
  workspace?: "large";
};

export type StellaPendingNote = {
  callId: string;
  key: string;
  message: string;
  from: { threadId: string; label: string };
  remote?: true;
  to?: string;
};

export const StellaAgentDoc = defineDoc<StellaAgentRole>({
  kind: "stella.agent",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "current",
  initial: () => ({ agentType: "orchestrator", depth: 0 }),
  checkpointWhen: boundedReplay,
});

export { MAX_AGENT_DEPTH } from "@stella/contracts/agent-depth";
