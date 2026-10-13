/**
 * Host-side `connect` client for the cloud orchestrator's code sandbox.
 *
 * Same surface as the device kernel's `connect` (see
 * `connectors/connect-worker-api.ts`), plus the connected integrations'
 * actions as code tools (`connectors/connector-tools.ts`), backed by the Store's Composio
 * integrations: the global catalog in D1 and the owner object's
 * `integrations.*` internals, instead of a local catalog cache and CLI
 * bridge. Connectors belong to the account, not the device, so a service
 * connected anywhere is usable here.
 *
 * Custom MCP/API connectors (`addMcp`/`remove`) are device-local — stdio
 * processes, generated skills, on-disk credentials — and stay that way.
 */

import {
  scoreConnectorMatch,
  tokenizeConnectorQuery,
} from "@stella/runtime/kernel/connectors/discovery-score.js";
import {
  redactSensitiveText,
  sanitizeSensitiveData,
} from "@stella/contracts/sensitive-data";
import type {
  IntegrationActionsPage,
  IntegrationCatalogEntry,
} from "@stella/contracts/backend/integrations";
import {
  buildConnectorToolEntries,
  invalidConnectorToolArgsMessage,
  requireConnectorTool,
  validateConnectorToolArgs,
  type ConnectorToolSource,
} from "@stella/runtime/kernel/connectors/connector-tools.js";
import type { CloudConnectClient } from "./cloud-code-tool.js";
import { RpcError } from "./owner-store/errors.js";

/**
 * Where the directory reads: the global catalog (D1) and the owner's
 * connections and runs (the owner object's `integrations.*` internals).
 */
export type CloudConnectorSource = Readonly<{
  catalog(): Promise<readonly IntegrationCatalogEntry[]>;
  actions(args: {
    id: string;
    action?: string;
    query?: string;
    cursor?: string;
    limit?: number;
  }): Promise<IntegrationActionsPage | null>;
  connections(): Promise<{ connections: ReadonlyArray<{ id: string; connected: boolean }> }>;
  run(args: {
    id: string;
    action: string;
    input: Record<string, unknown>;
    requestId: string;
  }): Promise<unknown>;
}>;

export type CloudConnectClientContext = Readonly<{
  source: CloudConnectorSource;
}>;

export type CloudConnectorCatalogEntry = Readonly<{
  id: string;
  name: string;
  category: string;
  description: string;
  iconUrl?: string;
  sourceUrl?: string;
  catalogToolCount: number;
  toolkit: string;
}>;

export type CloudConnectorConnection = Readonly<{
  id: string;
  connected: boolean;
}>;

const DISCOVER_MAX_MATCHES = 8;
const ACTIONS_PAGE_LIMIT = 100;
const ACTIONS_MAX_PAGES = 50;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const collapseLine = (value: string | undefined, max = 140): string => {
  const collapsed = (value ?? "").replace(/\s+/gu, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1)}…`;
};

const sourceErrorMessage = (error: unknown, fallback: string): string =>
  redactSensitiveText(
    error instanceof Error && error.message.trim()
      ? error.message.slice(0, 1_000)
      : fallback,
  );

type ActionRecord = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};

const readActionRecord = (value: unknown): ActionRecord | null => {
  if (!isRecord(value) || typeof value.name !== "string") return null;
  return {
    name: value.name,
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.description === "string"
      ? { description: value.description }
      : {}),
    ...(isRecord(value.inputSchema) ? { inputSchema: value.inputSchema } : {}),
    ...(isRecord(value.annotations) ? { annotations: value.annotations } : {}),
  };
};

export const readCloudConnectorCatalogEntry = (
  value: unknown,
): CloudConnectorCatalogEntry | null => {
  if (!isRecord(value)) return null;
  const connector = isRecord(value.connector) ? value.connector : null;
  if (connector?.type !== "composio") return null;
  const id = typeof value.id === "string" ? value.id.trim().toLowerCase() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const description =
    typeof value.description === "string" ? value.description.trim() : "";
  const toolkit =
    typeof connector.toolkit === "string"
      ? connector.toolkit.trim().toUpperCase()
      : "";
  if (!id || !name || !description || !toolkit) return null;
  return {
    id,
    name,
    description,
    toolkit,
    category:
      typeof value.category === "string" && value.category.trim()
        ? value.category.trim()
        : "integrations",
    catalogToolCount:
      typeof value.catalogToolCount === "number" ? value.catalogToolCount : 0,
    ...(typeof value.iconUrl === "string" && value.iconUrl.trim()
      ? { iconUrl: value.iconUrl.trim() }
      : {}),
    ...(typeof value.sourceUrl === "string" && value.sourceUrl.trim()
      ? { sourceUrl: value.sourceUrl.trim() }
      : {}),
  };
};

/**
 * Resolve a connector id or display name against the catalog the way the
 * device `connector_status` tool does: exact id/name first, then the shared
 * scorer with the same acceptance threshold.
 */
export const resolveCloudConnectorEntry = (
  catalog: readonly CloudConnectorCatalogEntry[],
  query: string,
): {
  entry: CloudConnectorCatalogEntry | null;
  suggestions: CloudConnectorCatalogEntry[];
} => {
  const normalized = query.trim().toLowerCase();
  const exact = catalog.find(
    (entry) =>
      entry.id === normalized || entry.name.trim().toLowerCase() === normalized,
  );
  if (exact) return { entry: exact, suggestions: [] };
  const tokens = tokenizeConnectorQuery(query);
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

/**
 * The account's connector state for one turn: the Store catalog plus the
 * owner's live connections. Both are memoized per turn; connector tools and
 * `connector_status` re-read connections after a connect card resolves.
 */
export class CloudConnectorDirectory {
  #catalog: Promise<readonly CloudConnectorCatalogEntry[]> | undefined;
  #connections: Promise<readonly CloudConnectorConnection[]> | undefined;
  readonly #actions = new Map<string, Promise<readonly ActionRecord[]>>();
  readonly #context: CloudConnectClientContext;

  constructor(context: CloudConnectClientContext) {
    this.#context = context;
  }

  catalog(): Promise<readonly CloudConnectorCatalogEntry[]> {
    return (this.#catalog ??= (async () => {
      const entries = await this.#context.source.catalog();
      return Object.freeze(
        entries
          .map(readCloudConnectorCatalogEntry)
          .filter(
            (entry): entry is CloudConnectorCatalogEntry => entry !== null,
          ),
      );
    })().catch((error) => {
      this.#catalog = undefined;
      throw new Error(sourceErrorMessage(error, "The integration catalog is unavailable."));
    }));
  }

  connections(options?: {
    refresh?: boolean;
  }): Promise<readonly CloudConnectorConnection[]> {
    if (options?.refresh) this.#connections = undefined;
    return (this.#connections ??= (async () => {
      const { connections } = await this.#context.source.connections();
      return Object.freeze(
        connections.map((entry) => ({ id: entry.id, connected: entry.connected === true })),
      );
    })().catch((error) => {
      this.#connections = undefined;
      throw new Error(sourceErrorMessage(error, "Connected integrations are unavailable."));
    }));
  }

  async isConnected(id: string, options?: { refresh?: boolean }): Promise<boolean> {
    const connections = await this.connections(options);
    return connections.some((entry) => entry.id === id && entry.connected);
  }

  allActions(id: string): Promise<readonly ActionRecord[]> {
    let actions = this.#actions.get(id);
    if (!actions) {
      actions = this.#loadAllActions(id);
      this.#actions.set(id, actions);
      actions.catch(() => this.#actions.delete(id));
    }
    return actions;
  }

  async #loadAllActions(id: string): Promise<readonly ActionRecord[]> {
    const actions: ActionRecord[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < ACTIONS_MAX_PAGES; page += 1) {
      const result: IntegrationActionsPage | null = await this.#context.source
        .actions({ id, limit: ACTIONS_PAGE_LIMIT, ...(cursor ? { cursor } : {}) })
        .catch((error: unknown) => {
          throw new Error(sourceErrorMessage(error, "Integration action catalog failed."));
        });
      if (!result) return actions;
      for (const raw of result.actions) {
        const action = readActionRecord(raw);
        if (action) actions.push(action);
      }
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    return actions;
  }

  async run(
    id: string,
    action: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      return sanitizeSensitiveData(
        await this.#context.source.run({ id, action, input, requestId: crypto.randomUUID() }),
      );
    } catch (error) {
      if (error instanceof RpcError && error.reason === "not_connected") {
        throw new Error(
          `${id} is not connected for this account. Offer the inline connect card with tools.connector_status({ connector: "${id}" }) (or the Store), then retry.`,
        );
      }
      throw new Error(sourceErrorMessage(error, "Integration action failed."));
    }
  }
}

const nextHint = (
  entry: CloudConnectorCatalogEntry,
  connected: boolean,
): string =>
  connected
    ? `Ready. Its actions are tools: await tools.$search({ query: "${entry.name}" }).`
    : `Not connected. Connect offers are handled by the orchestrator's connector_status tool (inline connect card) or the Store — do not initiate one from here unless the user explicitly asked this turn. Proceed via the browser/computer fallback meanwhile.`;

const connectedSources = async (
  directory: CloudConnectorDirectory,
): Promise<ConnectorToolSource[]> => {
  const [catalog, connections] = await Promise.all([
    directory.catalog(),
    directory.connections(),
  ]);
  const sources = await Promise.all(
    connections
      .filter((connection) => connection.connected)
      .map(async (connection): Promise<ConnectorToolSource | null> => {
        const entry = catalog.find((candidate) => candidate.id === connection.id);
        if (!entry) return null;
        const actions = await directory.allActions(entry.id).catch(() => null);
        return actions
          ? { id: entry.id, name: entry.name, kind: "native", actions }
          : null;
      }),
  );
  return sources.filter((source): source is ConnectorToolSource => source !== null);
};

export const createCloudConnectClient = (
  directory: CloudConnectorDirectory,
): CloudConnectClient => {
  const tools = async (reserved?: ReadonlySet<string>) =>
    buildConnectorToolEntries(await connectedSources(directory), reserved);
  return {
    discover: async (query) => {
      const trimmed = query.trim();
      if (!trimmed) {
        throw new Error("connect.discover requires a non-empty query string.");
      }
      const [catalog, connections] = await Promise.all([
        directory.catalog(),
        directory.connections(),
      ]);
      const tokens = tokenizeConnectorQuery(trimmed);
      const ranked = catalog
        .map((entry) => ({ entry, score: scoreConnectorMatch(tokens, entry) }))
        .filter(({ score }) => score > 0)
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.entry.name.localeCompare(right.entry.name),
        )
        .slice(0, DISCOVER_MAX_MATCHES);
      const matches = ranked.map(({ entry }) => {
        const connection = connections.find((row) => row.id === entry.id);
        const connected = connection?.connected === true;
        return {
          id: entry.id,
          name: entry.name,
          kind: "native" as const,
          category: entry.category,
          description: collapseLine(entry.description),
          enabled: connection !== undefined,
          connected,
          provider: "backend-composio" as const,
          toolCount: entry.catalogToolCount,
          executable: connected,
          next: nextHint(entry, connected),
        };
      });
      return { query: trimmed, matches };
    },
    connectors: async () => {
      const [catalog, connections] = await Promise.all([
        directory.catalog(),
        directory.connections(),
      ]);
      return connections.flatMap((connection) => {
        const entry = catalog.find((candidate) => candidate.id === connection.id);
        if (!entry) return [];
        return [
          {
            id: entry.id,
            name: entry.name,
            kind: "native" as const,
            connected: connection.connected,
            description: collapseLine(entry.description),
          },
        ];
      });
    },
    tools,
    callTool: async (name, args, reserved) => {
      const entry = requireConnectorTool(await tools(reserved), name);
      if (!isRecord(args)) {
        throw new Error(invalidConnectorToolArgsMessage(name, "pass one plain object"));
      }
      const problem = validateConnectorToolArgs(entry.parameters, args);
      if (problem) {
        throw new Error(invalidConnectorToolArgsMessage(name, problem));
      }
      return await directory.run(entry.connector, entry.action, args);
    },
    addMcp: async () => {
      throw new Error(
        "connect.addMcp is desktop-only: custom MCP servers run on the user's computer. In the cloud, the Store integrations the account has connected are tools here.",
      );
    },
    remove: async () => {
      throw new Error(
        "connect.remove is desktop-only: custom connectors live on the user's computer. Store integrations are disconnected from the Store.",
      );
    },
  };
};
