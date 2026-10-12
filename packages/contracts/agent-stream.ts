export type AgentResponseTarget =
  | { type: "user_turn" }
  | { type: "agent_turn"; agentId: string }
  | {
      type: "agent_terminal_notice";
      agentId: string;
      terminalState: "completed" | "failed" | "canceled";
    };

