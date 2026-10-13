/**
 * How deep Stella's agents nest, on every host. Stella (the orchestrator) is
 * depth 0, the agents she starts are depth 1, theirs are depth 2, and so on.
 * An agent's depth is one more than the agent that started it, wherever
 * either runs: the owner's agent threads derive it from the parent chain
 * (`parent_thread_id`), and a host that runs an agent another host started
 * or moved there is told it rather than guessing.
 */
import type { AgentMessageSender } from "./agent-directory.js";

/** The deepest an agent may be; an agent at this depth starts none of its own. */
export const MAX_AGENT_DEPTH = 2;

/**
 * Where an agent another host started, or that moved, sits among Stella's
 * agents: its depth and the agent that started it (absent when Stella did).
 * The owner's agent threads derive both from its parent chain, which no move
 * changes, so every host runs it as what it is.
 */
export type AgentLineage = { depth: number; startedBy?: AgentMessageSender };

/** A lineage from the wire, or undefined when it is not one. */
export const readAgentLineage = (value: unknown): AgentLineage | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const { depth, startedBy } = value as { depth?: unknown; startedBy?: unknown };
  if (typeof depth !== "number" || !Number.isSafeInteger(depth) || depth < 1) return undefined;
  if (startedBy === undefined) return { depth };
  const starter = startedBy as { threadId?: unknown; label?: unknown } | null;
  if (typeof starter?.threadId !== "string" || !starter.threadId || typeof starter.label !== "string") return undefined;
  return { depth, startedBy: { threadId: starter.threadId, label: starter.label } };
};
