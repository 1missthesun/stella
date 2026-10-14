import {
  buildNativeConnectorCatalog,
  type NativeConnectorCatalogEntry,
  type NativeConnectorCatalogOverride,
} from "./native-integrations.js";
import {
  listConfiguredApiConnectors,
  listConfiguredConnectorCommands,
} from "./state.js";

export type ConnectorDiscoveryKind = "native" | "mcp" | "api";

export type ConnectorDiscoveryMatch = {
  id: string;
  name: string;
  kind: ConnectorDiscoveryKind;
  description: string;
  category?: string;
  provider?: NativeConnectorCatalogEntry["provider"];
  enabled: boolean;
  connectable: boolean;
  score: number;
};

export const DISCOVERY_RESULT_LIMIT = 8;
const DESCRIPTION_LIMIT = 140;

const normalizeQueryTokens = (query: string): string[] => {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
  return [...new Set(tokens)];
};

const truncateDescription = (value: string | undefined): string => {
  const collapsed = (value ?? "").replace(/\s+/gu, " ").trim();
  if (collapsed.length <= DESCRIPTION_LIMIT) return collapsed;
  return `${collapsed.slice(0, DESCRIPTION_LIMIT - 1)}…`;
};

export {
  scoreConnectorMatch,
} from "./discovery-score.js";
import { scoreConnectorMatch } from "./discovery-score.js";

export const discoverConnectors = async (
  stellaAppDir: string,
  query: string,
  options: {
    catalogOverride?: NativeConnectorCatalogOverride;
    enabledNativeIds: ReadonlySet<string>;
    limit?: number;
  },
): Promise<ConnectorDiscoveryMatch[]> => {
  const tokens = normalizeQueryTokens(query);
  if (tokens.length === 0) return [];

  const [commands, apis] = await Promise.all([
    listConfiguredConnectorCommands(stellaAppDir).catch(() => []),
    listConfiguredApiConnectors(stellaAppDir).catch(() => []),
  ]);

  const matches: ConnectorDiscoveryMatch[] = [];

  for (const entry of buildNativeConnectorCatalog(options.catalogOverride)) {
    const score = scoreConnectorMatch(tokens, entry);
    if (score <= 0) continue;
    matches.push({
      id: entry.id,
      name: entry.name,
      kind: "native",
      description: truncateDescription(entry.description),
      category: entry.category,
      provider: entry.provider,
      enabled: options.enabledNativeIds.has(entry.id),
      connectable: entry.connectable,
      score,
    });
  }

  for (const command of commands) {
    const score = scoreConnectorMatch(tokens, {
      id: command.id,
      name: command.displayName,
      description: command.description,
    });
    if (score <= 0) continue;
    matches.push({
      id: command.id,
      name: command.displayName,
      kind: "mcp",
      description: truncateDescription(command.description),
      enabled: true,
      connectable: false,
      score,
    });
  }

  for (const api of apis) {
    const score = scoreConnectorMatch(tokens, {
      id: api.id,
      name: api.displayName,
      description: api.description,
    });
    if (score <= 0) continue;
    matches.push({
      id: api.id,
      name: api.displayName,
      kind: "api",
      description: truncateDescription(api.description),
      enabled: true,
      connectable: false,
      score,
    });
  }

  matches.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (left.enabled !== right.enabled) return left.enabled ? -1 : 1;
    return left.name.localeCompare(right.name);
  });

  return matches.slice(0, options.limit ?? DISCOVERY_RESULT_LIMIT);
};
