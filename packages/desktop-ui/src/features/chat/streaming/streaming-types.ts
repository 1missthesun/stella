export type { AgentResponseTarget } from "@stella/contracts/agent-stream";

export const assistantScrollFollowKey = (
  userMessageId: string,
  indexInTurn: number,
): string => `assistant-${userMessageId}-${indexInTurn}`;
