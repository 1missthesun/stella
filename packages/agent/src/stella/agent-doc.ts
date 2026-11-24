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
  /** Its finished report, sent with send_message `done: true`: filed as the report when the turn ends. */
  done?: { text: string; callIds: string[] };
  notes?: StellaPendingNote[];
  /** Stella last answered this agent's ask_user or request_secure_input, which then goes straight to the user. */
  stellaReplied?: { tool: string; at: number };
  /** An ask this agent put to Stella first and is waiting on; her next message lands in `reply`, not the inbox. */
  askingStella?: { key: string; reply?: string };
  /** Its spawn asked for a large cloud workspace (`workspace: "large"`); a cloud host sizes its container from it. */
  workspace?: "large";
};

export type StellaPendingNote = {
  callId: string;
  key: string;
  message: string;
  from: { threadId: string; label: string };
  remote?: true;
  /** Goes to this agent (a lead on another host) instead of Stella. */
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
