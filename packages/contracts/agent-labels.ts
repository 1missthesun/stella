/**
 * Agent pills: which messages name the agent they are about. The pill
 * appears on the first message about an agent and again only when a message
 * concerns a different agent. Messages about no agent in between do not
 * reset it, so returning to the same agent stays quiet. Both clients apply
 * this one rule.
 */
import { isPlacementThreadId, placementAliases } from "./placement-thread-id";

export type AgentLabelRow = {
  id: string;
  role: "user" | "assistant";
  hidden?: boolean;
  /** Agents this row concerns, most specific first (spawned, reported, cited). */
  agentIds?: readonly string[];
};

/**
 * Collapses the ids one agent is known by: a device-placed agent cited by its
 * local placement id is the cloud thread whose id hashes to it.
 */
export const agentIdCanonicalizer = (
  ids: Iterable<string>,
): ((id: string) => string) => {
  const aliases = placementAliases(ids);
  return (id) => (isPlacementThreadId(id) ? (aliases.get(id) ?? id) : id);
};

/** Row id → the agent ids its pill names, in order. */
export function projectAgentLabels(
  rows: readonly AgentLabelRow[],
  canonical: (id: string) => string = (id) => id,
): Map<string, string[]> {
  const labels = new Map<string, string[]>();
  let current: string | null = null;
  for (const row of rows) {
    if (row.hidden || row.role !== "assistant" || !row.agentIds?.length) continue;
    const seen = new Set<string>();
    const fresh: string[] = [];
    for (const raw of row.agentIds) {
      const id = canonical(raw);
      if (seen.has(id)) continue;
      seen.add(id);
      if (id !== current) fresh.push(raw);
    }
    if (fresh.length === 0) continue;
    labels.set(row.id, fresh);
    current = canonical(fresh[fresh.length - 1]!);
  }
  return labels;
}

/** Every agent id the rows mention, for building the canonicalizer. */
export const agentIdsOf = (rows: readonly AgentLabelRow[]): string[] => {
  const ids = new Set<string>();
  for (const row of rows) for (const id of row.agentIds ?? []) ids.add(id);
  return [...ids];
};
