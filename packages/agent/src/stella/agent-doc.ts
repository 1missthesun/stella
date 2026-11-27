import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { defineDoc, type ModelRef } from "@earendil-works/pi-durable";
import { boundedReplay } from "./doc-checkpoint.ts";

export type StellaAgentRole = {
  agentType: "orchestrator" | "general";
  depth: number;
  description?: string;
  threadId?: string;
  parentConversationId?: number;
  startedBy?: { threadId: string; label: string };
  moving?: { deviceId: string; name: string; brief: string; key: string; model?: string };
  /** switch_to with only a model: applied when this turn ends, and the task carries on from the brief. */
  switching?: { runsOn: SwitchedRunsOn; label: string; brief: string; key: string };
  /** Model switches that interrupted a run: a run that ends aborted after one was switched, not stopped. */
  switches?: number;
  /** Set by older builds' end_turn_waiting; read only so a turn it marked still clears it. */
  waiting?: { waitingFor: string; afterEntry?: number };
  done?: { text: string; callIds: string[] };
  notes?: StellaPendingNote[];
  stellaReplied?: { tool: string; at: number };
  askingStella?: { key: string; reply?: string };
  workspace?: "large";
  /** Tool calls (newest last) whose starter was already told they ran past `LONG_TOOL_CALL_MS`. */
  longCallsTold?: string[];
};

export type SwitchedRunsOn = { model: ModelRef; thinkingLevel?: ModelThinkingLevel };

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
