import type { AgentMessageSender } from "./agent-directory.js";

export const MAX_AGENT_DEPTH = 2;

export type AgentLineage = { depth: number; startedBy?: AgentMessageSender };

export const readAgentLineage = (value: unknown): AgentLineage | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const { depth, startedBy } = value as { depth?: unknown; startedBy?: unknown };
  if (typeof depth !== "number" || !Number.isSafeInteger(depth) || depth < 1) return undefined;
  if (startedBy === undefined) return { depth };
  const starter = startedBy as { threadId?: unknown; label?: unknown } | null;
  if (typeof starter?.threadId !== "string" || !starter.threadId || typeof starter.label !== "string") return undefined;
  return { depth, startedBy: { threadId: starter.threadId, label: starter.label } };
};
