import { isPlacementThreadId, placementAliases } from "./placement-thread-id";

export type AgentLabelRow = {
  id: string;
  role: "user" | "assistant";
  hidden?: boolean;
  agentIds?: readonly string[];
};

export const agentIdCanonicalizer = (
  ids: Iterable<string>,
): ((id: string) => string) => {
  const aliases = placementAliases(ids);
  return (id) => (isPlacementThreadId(id) ? (aliases.get(id) ?? id) : id);
};

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

export const agentIdsOf = (rows: readonly AgentLabelRow[]): string[] => {
  const ids = new Set<string>();
  for (const row of rows) for (const id of row.agentIds ?? []) ids.add(id);
  return [...ids];
};
