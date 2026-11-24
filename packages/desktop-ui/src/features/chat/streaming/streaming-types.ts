export type { AgentResponseTarget } from "@stella/contracts/agent-stream";

import type { AgentResponseTarget } from "@stella/contracts/agent-stream";
import type { ReplyRef } from "@stella/contracts/reply-refs";

export type StreamingAssistantOverlay = {
  _id: string;
  userMessageId: string;
  indexInTurn: number;
  text: string;
  responseTarget?: AgentResponseTarget;
  replyRefs?: ReplyRef[];
  timestamp: number;
  runId: string;
  canonicalMessageId?: string;
  locked?: boolean;
};

export const assistantScrollFollowKey = (
  userMessageId: string,
  indexInTurn: number,
): string => `assistant-${userMessageId}-${indexInTurn}`;
