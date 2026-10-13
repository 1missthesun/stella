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
 * Custom MCP servers belong to the account too (the owner object's
 * `mcp.*` internals): `addMcp` and `remove` work here, a remote server that
 * needs no sign-in is called directly, and one that runs on (or signed in
 * on) a computer is reached through that computer while it is online.
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
  mcpServerReach,
  type McpServerRecord,
} from "@stella/contracts/backend/mcp-servers";
import {
  MCP_AUTHORIZE_ACTION,
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

export type CloudMcpDevice = Readonly<{
  deviceId: string;
  label?: string;
  online: boolean;
  acceptsWork: boolean;
}>;

/** The account's custom MCP servers (the owner object's `mcp.*` internals). */
export type CloudMcpSource = Readonly<{
  list(options: { refresh: boolean }): Promise<{
    servers: readonly McpServerRecord[];
    devices: readonly CloudMcpDevice[];
  }>;
  add(options: Record<string, unknown>): Promise<{
    server: McpServerRecord;
    probeDeferred?: true;
    hint?: string;
  }>;
  remove(id: string): Promise<{ removed: boolean }>;
  call(args: { id: string; tool: string; args: Record<string, unknown> }): Promise<{ result: unknown }>;
  authorize(id: string): Promise<{ server: McpServerRecord }>;
}>;

export const ownerMcpSource = (
  ownerInternal: (name: string, args: unknown) => Promise<unknown>,
): CloudMcpSource => ({
  list: async (options) =>
    (await ownerInternal("mcp.list", options)) as Awaited<ReturnType<CloudMcpSource["list"]>>,
  add: async (options) =>
    (await ownerInternal("mcp.add", { options })) as Awaited<ReturnType<CloudMcpSource["add"]>>,
  remove: async (id) =>
    (await ownerInternal("mcp.remove", { id })) as { removed: boolean },
  call: async (args) => (await ownerInternal("mcp.call", args)) as { result: unknown },
  authorize: async (id) =>
    (await ownerInternal("mcp.authorize", { id })) as { server: McpServerRecord },
});

export type CloudConnectClientContext = Readonly<{
  source: CloudConnectorSource;
  /** Absent (Slack conversations): no custom MCP servers at all. */
  mcp?: CloudMcpSource;
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
const MCP_LIST_TTL_MS = 10_000;
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

  #mcp:
    | { at: number; listing: ReturnType<CloudMcpSource["list"]> }
    | undefined;

  constructor(context: CloudConnectClientContext) {
    this.#context = context;
  }

  get mcpSource(): CloudMcpSource | undefined {
    return this.#context.mcp;
  }

  /** The account's MCP servers, re-read at most every few seconds. */
  mcpServers(options?: { fresh?: boolean }): ReturnType<CloudMcpSource["list"]> {
    const source = this.#context.mcp;
    if (!source) return Promise.resolve({ servers: [], devices: [] });
    const cached = this.#mcp;
    if (!options?.fresh && cached && Date.now() - cached.at < MCP_LIST_TTL_MS) {
      return cached.listing;
    }
    const listing = source.list({ refresh: true }).catch((error: unknown) => {
      if (this.#mcp?.listing === listing) this.#mcp = undefined;
      throw new Error(sourceErrorMessage(error, "Custom MCP servers are unavailable."));
    });
    this.#mcp = { at: Date.now(), listing };
    return listing;
  }

  forgetMcpServers(): void {
    this.#mcp = undefined;
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

type McpListing = Awaited<ReturnType<CloudMcpSource["list"]>>;

const deviceName = (listing: McpListing, deviceId: string): string =>
  listing.devices.find((device) => device.deviceId === deviceId)?.label ?? "your computer";

/** Where an MCP server is reached from, in one line an agent can act on. */
export const mcpWhere = (record: McpServerRecord, listing: McpListing): {
  reach: "anywhere" | "device" | "unreachable";
  deviceId?: string;
  deviceName?: string;
  online?: boolean;
  acceptsWork?: boolean;
  where: string;
} => {
  const reach = mcpServerReach(record);
  if (reach.kind === "anywhere") {
    return { reach: "anywhere", where: "Remote server: callable from the cloud and every computer." };
  }
  if (reach.kind === "unreachable") {
    return {
      reach: "unreachable",
      where:
        reach.reason === "needs_sign_in"
          ? "Needs sign-in, which happens on one of the user's computers (the cloud keeps no credentials)."
          : "Runs on a computer that is not recorded; add it again from that computer.",
    };
  }
  const device = listing.devices.find((entry) => entry.deviceId === reach.deviceId);
  const name = deviceName(listing, reach.deviceId);
  const state = !device
    ? "no longer signed in"
    : !device.online
      ? "offline now"
      : !device.acceptsWork
        ? "online, but not accepting work from other devices"
        : "online";
  return {
    reach: "device",
    deviceId: reach.deviceId,
    deviceName: name,
    online: device?.online === true,
    acceptsWork: device?.acceptsWork === true,
    where:
      reach.reason === "local"
        ? `Device-only: runs on ${name} (${state}); reached through it while it is online.`
        : `Signed in on ${name} (${state}); reached through it while it is online.`,
  };
};

const mcpSource = (
  record: McpServerRecord,
  listing: McpListing,
): ConnectorToolSource => {
  const reach = mcpServerReach(record);
  const tools = record.tools ?? [];
  if (tools.length > 0 && !(record.needsAuth && reach.kind !== "device")) {
    return { id: record.id, name: record.name, kind: "mcp", actions: tools };
  }
  const where = reach.kind === "device" ? deviceName(listing, reach.deviceId) : undefined;
  return {
    id: record.id,
    name: record.name,
    kind: "mcp",
    actions: [
      {
        name: MCP_AUTHORIZE_ACTION,
        title: `Authorize ${record.name}`,
        description:
          reach.kind === "device"
            ? `List ${record.name}'s tools through ${where}, where it ${reach.reason === "local" ? "runs" : "is signed in"}; returns the tool names.`
            : `Sign in to ${record.name} so its tools appear. Sign-in happens on one of the user's computers; from the cloud this explains how.`,
      },
    ],
  };
};

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
  const mcp = directory.mcpSource
    ? await directory.mcpServers().catch(() => null)
    : null;
  return [
    ...sources.filter((source): source is ConnectorToolSource => source !== null),
    ...(mcp ? mcp.servers.map((record) => mcpSource(record, mcp)) : []),
  ];
};

const mcpSummary = (record: McpServerRecord, listing: McpListing) => {
  const where = mcpWhere(record, listing);
  const usable =
    where.reach === "anywhere"
      ? !record.needsAuth
      : where.reach === "device"
        ? where.online === true && where.acceptsWork === true
        : false;
  return {
    id: record.id,
    name: record.name,
    kind: "mcp" as const,
    connected: usable,
    description: collapseLine(record.description ?? record.url ?? ""),
    transport: record.transport,
    ...(record.url ? { url: record.url } : {}),
    ...where,
    toolCount: record.tools?.length ?? 0,
  };
};

const requireMcp = (directory: CloudConnectorDirectory): CloudMcpSource => {
  const source = directory.mcpSource;
  if (!source) {
    throw new Error("Custom MCP servers aren't available in this conversation.");
  }
  return source;
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
      const mcp = directory.mcpSource
        ? await directory.mcpServers().catch(() => null)
        : null;
      const mcpMatches = (mcp?.servers ?? [])
        .map((record) => ({
          record,
          score: scoreConnectorMatch(tokens, {
            id: record.id,
            name: record.name,
            description: record.description ?? "",
          }),
        }))
        .filter(({ score }) => score > 0)
        .sort((left, right) => right.score - left.score)
        .map(({ record }) => {
          const summary = mcpSummary(record, mcp!);
          return {
            ...summary,
            enabled: true,
            next: summary.connected
              ? `Ready. Its actions are tools: await tools.$search({ query: "${record.name}" }).`
              : summary.where,
          };
        });
      return { query: trimmed, matches: [...mcpMatches, ...matches].slice(0, DISCOVER_MAX_MATCHES) };
    },
    connectors: async () => {
      const [catalog, connections, mcp] = await Promise.all([
        directory.catalog(),
        directory.connections(),
        directory.mcpSource ? directory.mcpServers().catch(() => null) : null,
      ]);
      const servers = mcp ? mcp.servers.map((record) => mcpSummary(record, mcp)) : [];
      return [...servers, ...connections.flatMap((connection) => {
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
      })];
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
      if (entry.kind === "mcp") {
        const source = requireMcp(directory);
        try {
          if (entry.action === MCP_AUTHORIZE_ACTION) {
            const { server } = await source.authorize(entry.connector);
            directory.forgetMcpServers();
            return {
              authorized: true,
              tools: buildConnectorToolEntries(
                [{ id: server.id, name: server.name, kind: "mcp", actions: server.tools ?? [] }],
                reserved,
              ).map((tool) => tool.name),
            };
          }
          const { result } = await source.call({
            id: entry.connector,
            tool: entry.action,
            args,
          });
          return sanitizeSensitiveData(result);
        } catch (error) {
          throw new Error(sourceErrorMessage(error, `${entry.connectorName} could not run ${entry.action}.`));
        }
      }
      return await directory.run(entry.connector, entry.action, args);
    },
    addMcp: async (options) => {
      const source = requireMcp(directory);
      const added = await source.add({ ...options }).catch((error: unknown) => {
        throw new Error(sourceErrorMessage(error, "connect.addMcp failed."));
      });
      directory.forgetMcpServers();
      const { server } = added;
      const toolNames = buildConnectorToolEntries(
        [{ id: server.id, name: server.name, kind: "mcp", actions: server.tools ?? [] }],
        undefined,
      ).map((tool) => tool.name);
      return {
        imported: {
          id: server.id,
          displayName: server.name,
          ...(server.description ? { description: server.description } : {}),
          transport: server.transport,
          ...(server.url ? { url: server.url } : {}),
          auth: server.auth,
        },
        toolCount: server.tools?.length ?? 0,
        tools: toolNames.slice(0, 30),
        where: mcpWhere(server, { servers: [server], devices: [] }).where,
        ...(added.probeDeferred
          ? { probeDeferred: true as const, hint: added.hint }
          : {
              hint:
                toolNames.length > 30
                  ? `${toolNames.length} tools; find the rest with await tools.$search({ query: "${server.name}" }).`
                  : "Saved to the account: usable from the cloud and the user's computers. Call them as tools.<name>(args); tools.$describe(name) shows each input schema.",
            }),
      };
    },
    remove: async (id) => {
      const source = requireMcp(directory);
      const trimmed = id.trim().toLowerCase();
      if (!trimmed) throw new Error("connect.remove requires a connector id.");
      const catalog = await directory.catalog().catch(() => []);
      if (catalog.some((entry) => entry.id === trimmed)) {
        throw new Error(
          `${trimmed} is a Store integration. Disconnect it from the Store instead of connect.remove.`,
        );
      }
      const result = await source.remove(trimmed).catch((error: unknown) => {
        throw new Error(sourceErrorMessage(error, "connect.remove failed."));
      });
      directory.forgetMcpServers();
      return {
        removed: { mcp: result.removed ? 1 : 0 },
        note: "Removed from the account: its tools are gone here, and each computer drops its copy on its next connector check.",
      };
    },
  };
};
