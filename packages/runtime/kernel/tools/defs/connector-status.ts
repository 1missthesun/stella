import { AGENT_IDS } from "@stella/contracts/agent-runtime";
import {
  resolveNativeConnectorCatalog,
  type NativeCatalogSource,
} from "../../connectors/catalog-cache.js";
import { getNativeConnectorReadiness } from "../../connectors/connection-status.js";
import { scoreConnectorMatch } from "../../connectors/discovery.js";
import type { NativeConnectorCatalogEntry } from "../../connectors/native-integrations.js";
import type { ToolDefinition } from "../types.js";
import {
  CONNECTOR_STATUS_SEARCH_TERMS,
  CONNECTOR_STATUS_TOOL_DESCRIPTION,
  CONNECTOR_STATUS_TOOL_LABEL,
  CONNECTOR_STATUS_TOOL_NAME,
  CONNECTOR_STATUS_TOOL_PARAMETERS,
  CONNECTOR_STATUS_TOOL_REPLAY,
  CONNECTOR_STATUS_TOOL_WORKING_TEXT,
  connectorConnectedText,
  connectorNotConnectedText,
} from "./connector-status-def.js";

export { CONNECTOR_STATUS_TOOL_NAME };

export type ConnectorConnectionRequester = (
  payload: {
    id: string;
    name: string;
    description?: string;
    iconUrl?: string;
    category?: string;
    reason?: string;
    conversationId?: string;
  },
  signal?: AbortSignal,
) => Promise<
  | { ok: true; status: "connected" | "already_connected" }
  | {
      ok: false;
      reason: "declined" | "cancelled" | "timeout" | "unsupported" | string;
    }
>;

export type ConnectorStatusToolOptions = {
  stellaDataDir: string;
  getCloudBackendAuth?: () => { baseUrl: string; authToken: string } | null;
  requestConnectorConnection?: ConnectorConnectionRequester;
};

const SERVER_CATALOG_TTL_MS = 5 * 60 * 1000;

type CatalogMemo = {
  stellaDataDir: string;
  loadedAt: number;
  entries: NativeConnectorCatalogEntry[];
  source: NativeCatalogSource;
  sources: Record<string, NativeCatalogSource>;
};

let catalogMemo: CatalogMemo | null = null;

const loadCatalog = async (
  options: ConnectorStatusToolOptions,
): Promise<{
  entries: NativeConnectorCatalogEntry[];
  source: NativeCatalogSource;
  sources: Record<string, NativeCatalogSource>;
}> => {
  if (
    catalogMemo &&
    catalogMemo.stellaDataDir === options.stellaDataDir &&
    Date.now() - catalogMemo.loadedAt < SERVER_CATALOG_TTL_MS
  ) {
    return {
      entries: catalogMemo.entries,
      source: catalogMemo.source,
      sources: catalogMemo.sources,
    };
  }
  const resolved = await resolveNativeConnectorCatalog({
    stellaDataDir: options.stellaDataDir,
    ...(options.getCloudBackendAuth ? { getBackendAuth: options.getCloudBackendAuth } : {}),
  });
  catalogMemo = {
    stellaDataDir: options.stellaDataDir,
    loadedAt: Date.now(),
    entries: resolved.entries,
    source: resolved.source,
    sources: resolved.sources,
  };
  return resolved;
};

const tokenize = (value: string): string[] => [
  ...new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length > 1),
  ),
];

const resolveEntry = (
  catalog: readonly NativeConnectorCatalogEntry[],
  query: string,
): {
  entry: NativeConnectorCatalogEntry | null;
  suggestions: NativeConnectorCatalogEntry[];
} => {
  const normalized = query.trim().toLowerCase();
  const exact = catalog.find(
    (entry) =>
      entry.id === normalized || entry.name.trim().toLowerCase() === normalized,
  );
  if (exact) return { entry: exact, suggestions: [] };
  const tokens = tokenize(query);
  const ranked = catalog
    .map((entry) => ({ entry, score: scoreConnectorMatch(tokens, entry) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score);
  if (ranked.length > 0 && ranked[0]!.score >= 20) {
    return { entry: ranked[0]!.entry, suggestions: [] };
  }
  return {
    entry: null,
    suggestions: ranked.slice(0, 3).map(({ entry }) => entry),
  };
};

export const createConnectorStatusTool = (
  options: ConnectorStatusToolOptions,
): ToolDefinition => ({
  name: CONNECTOR_STATUS_TOOL_NAME,
  replay: CONNECTOR_STATUS_TOOL_REPLAY,
  label: CONNECTOR_STATUS_TOOL_LABEL,
  workingText: CONNECTOR_STATUS_TOOL_WORKING_TEXT,
  agentTypes: [AGENT_IDS.ORCHESTRATOR],
  awaitsUser: true,
  demoted: { searchTerms: CONNECTOR_STATUS_SEARCH_TERMS },
  description: CONNECTOR_STATUS_TOOL_DESCRIPTION,
  parameters: CONNECTOR_STATUS_TOOL_PARAMETERS,
  execute: async (args, context, extras) => {
    const query =
      typeof args.connector === "string" ? args.connector.trim() : "";
    if (!query) {
      return { error: "connector is required (id or name)." };
    }
    const reason =
      typeof args.reason === "string" && args.reason.trim()
        ? args.reason.trim()
        : undefined;

    const catalog = await loadCatalog(options);
    const { entry, suggestions } = resolveEntry(catalog.entries, query);
    if (!entry) {
      const hint =
        suggestions.length > 0
          ? ` Closest matches: ${suggestions
              .map((candidate) => `${candidate.name} (\`${candidate.id}\`)`)
              .join(", ")}.`
          : "";
      return {
        error: `No Store connector matched "${query}".${hint} If no connector fits, proceed via the browser/computer fallback.`,
      };
    }

    const state = await getNativeConnectorReadiness(
      options.stellaDataDir,
      entry,
    );
    const toolCount = state.toolCount;
    const executable = state.executable;
    const diagnostics = {
      id: entry.id,
      catalogSource: catalog.sources[entry.id] ?? catalog.source,
      provider: entry.provider,
      enabled: state.enabled,
      providerStatus: state.authStatus,
      accountVerified: state.accountVerified,
      toolCount,
      executable,
    };
    if (executable) {
      return {
        result: `${connectorConnectedText(entry.name, entry.id)}${state.accountVerified ? "" : " Its account link is managed by the backend and was not verified here."}`,
        details: { ...diagnostics, status: "executable" },
      };
    }

    if (toolCount === 0) {
      const incompleteLocal =
        entry.provider === "oauth-catalog" &&
        entry.localExecution !== "production-ready";
      return {
        result: connectorNotConnectedText(
          entry.name,
          incompleteLocal
            ? "its Store catalog is unavailable and the bundled version can't run"
            : "it has no tools it can run",
        ),
        details: { ...diagnostics, status: "not_executable" },
      };
    }

    if (!entry.connectable || !options.requestConnectorConnection) {
      return {
        result: connectorNotConnectedText(entry.name, "it can't be connected from here"),
        details: {
          ...diagnostics,
          status: "not_connected",
          reason: "flow_unavailable",
        },
      };
    }

    const outcome = await options.requestConnectorConnection(
      {
        id: entry.id,
        name: entry.name,
        ...(entry.description ? { description: entry.description } : {}),
        ...(entry.iconUrl ? { iconUrl: entry.iconUrl } : {}),
        ...(entry.category ? { category: entry.category } : {}),
        ...(reason ? { reason } : {}),
        ...(context?.conversationId
          ? { conversationId: context.conversationId }
          : {}),
      },
      extras?.signal,
    );

    if (outcome.ok) {
      return {
        result: `${connectorConnectedText(entry.name, entry.id)} The user approved the card.`,
        details: { id: entry.id, status: "connected" },
      };
    }
    if (outcome.reason === "declined") {
      return {
        result: connectorNotConnectedText(entry.name, "the user declined"),
        details: { id: entry.id, status: "declined" },
      };
    }
    if (outcome.reason === "cancelled" && extras?.signal?.aborted) {
      return {
        result: connectorNotConnectedText(entry.name, "the turn was canceled"),
        details: {
          id: entry.id,
          status: "not_connected",
          reason: "turn_cancelled",
        },
      };
    }
    if (outcome.reason === "cancelled" || outcome.reason === "timeout") {
      return {
        result: connectorNotConnectedText(
          entry.name,
          outcome.reason === "timeout" ? "the card went unanswered" : "the user dismissed the card",
        ),
        details: {
          id: entry.id,
          status: "not_connected",
          reason: outcome.reason === "timeout" ? "timeout" : "dismissed",
        },
      };
    }
    return {
      error: connectorNotConnectedText(entry.name, `the connect flow failed (${outcome.reason})`),
      details: {
        id: entry.id,
        status: "not_connected",
        reason: outcome.reason,
      },
    };
  },
});
