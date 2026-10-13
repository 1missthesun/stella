import { promises as fs } from "node:fs";
import path from "node:path";

import {
  GOOGLE_WORKSPACE_TOOL_ALLOWLIST,
  type GoogleWorkspaceToolName,
} from "../google-workspace/tool-allowlist.js";
import { GOOGLE_WORKSPACE_TOOL_METADATA } from "../google-workspace/google-workspace-tool-metadata.js";
import {
  getNativeOAuthProviderConfig,
  getNativeOAuthProviderSetupGroup,
  hasNativeOAuthProviderClientIdOverride,
  hasNativeOAuthProviderTemplate,
  isNativeOAuthLocalExecutionProductionReady,
  isNativeOAuthProviderConfigReady,
  type NativeOAuthProviderConfig,
  type NativeOAuthProviderConfigOptions,
} from "./native-oauth-provider-config.js";
import {
  getOAuthCatalogProviderTools,
  getOAuthProviderSummaries,
} from "./oauth-provider-catalog.js";
import { getConnectorStateRoot } from "./state.js";
import type { ConnectorToolInfo } from "./types.js";

export type NativeConnectorAvailability = "ready";

export type NativeConnectorCatalogEntry = {
  id: string;
  name: string;
  category: string;
  auth: readonly string[];
  catalogToolCount: number;
  availability: NativeConnectorAvailability;
  provider: "google-workspace" | "oauth-catalog" | "backend-composio";
  /** Bundled execution is opt-in. Recovered OAuth entries are metadata only. */
  localExecution?: "production-ready" | "incomplete";
  toolPrefix?: string;
  description: string;
  sourceUrl?: string;
  iconUrl?: string;
  connectable: boolean;
  backendConnector?: {
    type: "composio";
    toolkit: string;
  };
  /** Authoritative executable action map supplied by the Store catalog. */
  actions?: readonly NativeConnectorCatalogAction[];
  oauthConfig?: NativeOAuthProviderConfig;
  oauthSetupGroup?: {
    id: string;
    name: string;
  };
  oauthProviderTemplate?: boolean;
};

export type NativeConnectorCatalogAction = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type NativeConnectorCatalogOverride =
  readonly NativeConnectorCatalogEntry[];

type NativeConnectorStateEntry = {
  enabled: boolean;
  enabledAt?: number;
  updatedAt: number;
  source?: "store" | "cli";
};

type NativeConnectorStateFile = {
  version: 1;
  integrations: Record<string, NativeConnectorStateEntry>;
};

const STATE_FILE = "native-integrations.json";
const EXISTING_GOOGLE_INTEGRATION_IDS = new Set([
  "gmail",
  "google_admin",
  "google_analytics",
  "google_classroom",
  "google_maps",
  "google_search_console",
  "googleads",
  "googlebigquery",
  "googlecalendar",
  "googledocs",
  "googledrive",
  "googlemeet",
  "googlephotos",
  "googlesheets",
  "googleslides",
  "googlesuper",
  "googletasks",
]);

const isExistingGoogleIntegration = (id: string) =>
  EXISTING_GOOGLE_INTEGRATION_IDS.has(id) || id.startsWith("google");

const BACKEND_OWNED_COMMUNICATION_INTEGRATION_IDS = new Set([
  "discord",
  "discordbot",
  "microsoft_teams",
  "slack",
  "slackbot",
  "whatsapp",
]);

const isBackendOwnedCommunicationIntegration = (id: string) =>
  BACKEND_OWNED_COMMUNICATION_INTEGRATION_IDS.has(id);

const API_KEY_ONLY_INTEGRATION_IDS = new Set([
  "borneo",
  "clockify",
  "epic_games",
  "insighto_ai",
  "lodgify",
  "matterport",
  "parma",
  "pinecone",
  "recruitee",
  "scheduleonce",
  "sendloop",
  "tally",
  "ticketmaster",
  "trello",
  "wix",
  "zoominfo",
]);

const isApiKeyOnlyIntegration = (id: string) =>
  API_KEY_ONLY_INTEGRATION_IDS.has(id);

const GOOGLE_WORKSPACE_CONNECTOR_CATALOG: NativeConnectorCatalogEntry[] = [
  {
    id: "gmail",
    name: "Gmail",
    category: "email",
    auth: ["OAUTH2"],
    catalogToolCount: 63,
    availability: "ready",
    provider: "google-workspace",
    localExecution: "production-ready",
    toolPrefix: "gmail.",
    connectable: true,
    description: "Search, read, label, draft, and send Gmail messages.",
  },
  {
    id: "googlecalendar",
    name: "Google Calendar",
    category: "scheduling & booking",
    auth: ["OAUTH2"],
    catalogToolCount: 48,
    availability: "ready",
    provider: "google-workspace",
    localExecution: "production-ready",
    toolPrefix: "calendar.",
    connectable: true,
    description:
      "List calendars, create events, update events, and find free time.",
  },
  {
    id: "googledocs",
    name: "Google Docs",
    category: "documents",
    auth: ["OAUTH2"],
    catalogToolCount: 35,
    availability: "ready",
    provider: "google-workspace",
    localExecution: "production-ready",
    toolPrefix: "docs.",
    connectable: true,
    description: "Create, read, edit, comment on, and format Google Docs.",
  },
  {
    id: "googledrive",
    name: "Google Drive",
    category: "file management & storage",
    auth: ["OAUTH2"],
    catalogToolCount: 89,
    availability: "ready",
    provider: "google-workspace",
    localExecution: "production-ready",
    toolPrefix: "drive.",
    connectable: true,
    description:
      "Search Drive, create folders, download files, and rename files.",
  },
];

// Lazily derived from the OAuth catalog's summary sidecar (~50KB; no `tools`),
// so listing/matching connectors never parses the ~12MB full catalog. Memoized
// after first build.
let cachedNativeConnectorCatalog: NativeConnectorCatalogEntry[] | null = null;

const getNativeConnectorCatalog = (): NativeConnectorCatalogEntry[] => {
  if (cachedNativeConnectorCatalog) {
    return cachedNativeConnectorCatalog;
  }
  const fallbackOAuthCatalog: NativeConnectorCatalogEntry[] =
    getOAuthProviderSummaries()
      .filter(
        (entry) =>
          !isExistingGoogleIntegration(entry.id) &&
          !isBackendOwnedCommunicationIntegration(entry.id) &&
          !isApiKeyOnlyIntegration(entry.id),
      )
      .map((entry) => ({
        id: entry.id,
        name: entry.name,
        category: entry.category,
        auth: entry.auth,
        catalogToolCount: entry.catalogToolCount,
        availability: "ready" as const,
        provider: "oauth-catalog" as const,
        localExecution: isNativeOAuthLocalExecutionProductionReady(entry.id)
          ? ("production-ready" as const)
          : ("incomplete" as const),
        description: entry.description,
        sourceUrl: entry.sourceUrl,
        connectable: false,
      }));
  cachedNativeConnectorCatalog = [
    ...GOOGLE_WORKSPACE_CONNECTOR_CATALOG,
    ...fallbackOAuthCatalog,
  ];
  return cachedNativeConnectorCatalog;
};

/**
 * Bundled catalog with optional server entries overlaid (server wins by
 * id; new server entries are appended). The overlay deliberately does
 * NOT replace the bundled catalog: locally-owned entries (Google
 * Workspace, recovered OAuth providers) must stay resolvable even when
 * the backend catalog only carries its Composio set — otherwise Gmail
 * could be offered by discovery yet fail to resolve in the Store/connect
 * paths that pass the server catalog through.
 */
export const buildNativeConnectorCatalog = (
  serverCatalog?: NativeConnectorCatalogOverride,
): NativeConnectorCatalogEntry[] => {
  const base = getNativeConnectorCatalog();
  if (serverCatalog === undefined || serverCatalog.length === 0) {
    return [...base];
  }
  const byId = new Map(base.map((entry) => [entry.id, entry]));
  for (const entry of serverCatalog) {
    byId.set(entry.id, entry);
  }
  return [...byId.values()];
};

const statePath = (stellaAppDir: string) =>
  path.join(getConnectorStateRoot(stellaAppDir), STATE_FILE);

const readState = async (
  stellaAppDir: string,
): Promise<NativeConnectorStateFile> => {
  try {
    const parsed = JSON.parse(
      await fs.readFile(statePath(stellaAppDir), "utf-8"),
    ) as NativeConnectorStateFile;
    if (parsed?.version === 1 && parsed.integrations) return parsed;
  } catch {
    // Empty state is valid.
  }
  return { version: 1, integrations: {} };
};

const writeState = async (
  stellaAppDir: string,
  state: NativeConnectorStateFile,
) => {
  const filePath = statePath(stellaAppDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
};

export const getNativeConnectorCatalogEntry = (
  id: string,
  catalog: NativeConnectorCatalogOverride = getNativeConnectorCatalog(),
) => catalog.find((entry) => entry.id === id);

export const getNativeConnectorOAuthConfig = (
  entry: NativeConnectorCatalogEntry,
) => entry.oauthConfig ?? getNativeOAuthProviderConfig(entry.id);

export const getNativeConnectorCatalogActions = (
  entry: NativeConnectorCatalogEntry,
): NativeConnectorCatalogAction[] => {
  if (
    entry.provider === "oauth-catalog" ||
    entry.provider === "backend-composio"
  ) {
    if (entry.provider === "backend-composio") {
      return [...(entry.actions ?? [])];
    }
    if (entry.oauthConfig) return [];
    return (getOAuthCatalogProviderTools(entry.id) ?? []).map((tool) => ({
      name: tool.name.trim(),
      ...(tool.title ? { title: tool.title } : {}),
      ...(tool.description ? { description: tool.description } : {}),
      ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
    }));
  }
  if (!entry.toolPrefix) return [];
  return GOOGLE_WORKSPACE_TOOL_ALLOWLIST.filter((toolName) =>
    toolName.startsWith(entry.toolPrefix!),
  ).map((toolName) => {
    const meta =
      GOOGLE_WORKSPACE_TOOL_METADATA[toolName as GoogleWorkspaceToolName];
    return {
      name: toolName,
      title: toolName,
      ...(meta?.description ? { description: meta.description } : {}),
    };
  });
};

export const nativeOAuthApiRequestToolName = (id: string) =>
  `${id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_REQUEST`;

export const backendIntegrationRunToolName = (id: string) =>
  `${id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_RUN_ACTION`;

export const getNativeConnectorTools = (
  entry: NativeConnectorCatalogEntry,
): ConnectorToolInfo[] => {
  if (entry.provider === "backend-composio") {
    return [
      {
        name: backendIntegrationRunToolName(entry.id),
        title: `Run ${entry.name} Action`,
        description: `Run a ${entry.name} action through Stella's connected integration account. Each action is also its own tool in code; find them with tools.$search.`,
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["action"],
          properties: {
            action: {
              type: "string",
              description:
                "Action slug from the connector's action catalog.",
            },
            arguments: {
              type: "object",
              additionalProperties: true,
            },
          },
        },
      },
    ];
  }
  if (entry.localExecution !== "production-ready") return [];
  if (entry.provider === "oauth-catalog") {
    const config = getNativeConnectorOAuthConfig(entry);
    if (!config?.resourceUrl) return [];
    const apiRequest: ConnectorToolInfo = {
      name: nativeOAuthApiRequestToolName(entry.id),
      title: `${entry.name} API Request`,
      description: `Call the ${entry.name} API with the connected OAuth account. Provide a path, method, optional query, and optional JSON body.`,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["path"],
        properties: {
          path: {
            type: "string",
            description: "API path beginning with /.",
          },
          method: {
            type: "string",
            description: "HTTP method. Defaults to GET.",
          },
          query: {
            type: "object",
            additionalProperties: {
              anyOf: [
                { type: "string" },
                { type: "number" },
                { type: "boolean" },
              ],
            },
          },
          body: {
            type: "object",
            additionalProperties: true,
          },
          headers: {
            type: "object",
            description:
              "Optional provider-specific headers. Stella always injects the OAuth Authorization header.",
            additionalProperties: {
              type: "string",
            },
          },
        },
      },
    };
    if (entry.id === "linear") {
      return [
        {
          name: "LINEAR_RUN_QUERY_OR_MUTATION",
          title: "Run Linear Query Or Mutation",
          description:
            "Run a Linear GraphQL query or mutation with the connected account.",
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["query"],
            properties: {
              query: {
                type: "string",
                description: "GraphQL query or mutation.",
              },
              variables: {
                type: "object",
                additionalProperties: true,
              },
            },
          },
        },
        apiRequest,
      ];
    }
    return [apiRequest];
  }
  if (!entry.toolPrefix) return [];
  return GOOGLE_WORKSPACE_TOOL_ALLOWLIST.filter((toolName) =>
    toolName.startsWith(entry.toolPrefix!),
  ).map((toolName) => {
    const meta =
      GOOGLE_WORKSPACE_TOOL_METADATA[toolName as GoogleWorkspaceToolName];
    return {
      name: toolName,
      title: toolName,
      description: meta?.description,
      inputSchema: meta?.parameters,
    };
  });
};

const getNativeConnectorOAuthSetup = (
  entry: NativeConnectorCatalogEntry,
  options: NativeOAuthProviderConfigOptions = {},
) => {
  if (entry.provider === "backend-composio") {
    return {
      connectable: true,
      oauthSetupStatus: "ready" as const,
      oauthSetupMessage: "Ready to connect.",
    };
  }
  if (entry.localExecution !== "production-ready") {
    return {
      connectable: false,
      oauthSetupStatus: "local_implementation_incomplete" as const,
      oauthSetupMessage:
        "This recovered catalog entry is metadata only. Stella currently relies on its authoritative Store provider for execution.",
    };
  }
  if (entry.connectable) {
    return {
      connectable: true,
      oauthSetupStatus: "ready" as const,
      oauthSetupMessage: "Ready to connect.",
    };
  }
  const config = getNativeConnectorOAuthConfig(entry);
  const setupGroup = getNativeOAuthProviderSetupGroup(entry.id);
  const hasProviderTemplate = hasNativeOAuthProviderTemplate(entry.id);
  if (!config) {
    return {
      connectable: false,
      oauthSetupStatus: "missing_oauth_app" as const,
      oauthSetupMessage: setupGroup
        ? `Stella has recovered this integration. Finish one ${setupGroup.name} connection setup to enable this and related integrations.`
        : hasProviderTemplate
          ? "Stella has the OAuth integration shape for this provider. Register the Stella OAuth app before it can be added."
          : "Stella has recovered this integration. Finish its provider setup before it can be added.",
      ...(setupGroup ? { oauthSetupGroup: setupGroup } : {}),
      ...(hasProviderTemplate ? { oauthProviderTemplate: true } : {}),
    };
  }
  if (isNativeOAuthProviderConfigReady(entry.id, config, options)) {
    return {
      connectable: true,
      oauthSetupStatus: "ready" as const,
      oauthSetupMessage: "Ready to connect.",
      ...(setupGroup ? { oauthSetupGroup: setupGroup } : {}),
    };
  }
  const tokenExchangeProvider = (config.tokenExchange?.provider ?? entry.id)
    .trim()
    .toLowerCase();
  const hasExplicitOAuthApp =
    hasNativeOAuthProviderClientIdOverride(entry.id) ||
    hasNativeOAuthProviderClientIdOverride(tokenExchangeProvider);
  if (config.tokenExchange?.type === "backend") {
    if (!hasExplicitOAuthApp) {
      return {
        connectable: false,
        oauthSetupStatus: "missing_oauth_app" as const,
        oauthSetupMessage: setupGroup
          ? `Stella has recovered this integration. Finish one ${setupGroup.name} connection setup to enable this and related integrations.`
          : "Stella has the OAuth integration shape for this provider. Register the Stella OAuth app before it can be added.",
        ...(setupGroup ? { oauthSetupGroup: setupGroup } : {}),
        oauthProviderTemplate: true,
      };
    }
    return {
      connectable: false,
      oauthSetupStatus: "missing_backend_exchange" as const,
      oauthSetupMessage: setupGroup
        ? `Stella has a ${setupGroup.name} connection setup for this integration family, but the secure server connection is not ready yet.`
        : "Stella has this provider setup, but the secure server connection is not ready yet.",
      ...(setupGroup ? { oauthSetupGroup: setupGroup } : {}),
    };
  }
  if (
    config.flow === "authorization_code" &&
    config.callbackMode === "external"
  ) {
    return {
      connectable: false,
      oauthSetupStatus: "missing_callback_bridge" as const,
      oauthSetupMessage:
        "Stella has this provider setup, but the browser return link is not ready yet.",
      ...(setupGroup ? { oauthSetupGroup: setupGroup } : {}),
    };
  }
  return {
    connectable: false,
    oauthSetupStatus: "missing_oauth_app" as const,
    oauthSetupMessage: setupGroup
      ? `Stella has recovered this integration. Finish one ${setupGroup.name} connection setup to enable this and related integrations.`
      : "Stella has recovered this integration. Finish its provider setup before it can be added.",
    ...(setupGroup ? { oauthSetupGroup: setupGroup } : {}),
  };
};

export const listNativeConnectors = async (
  stellaAppDir: string,
  options: NativeOAuthProviderConfigOptions = {},
  catalogOverride?: NativeConnectorCatalogOverride,
) => {
  const state = await readState(stellaAppDir);
  return buildNativeConnectorCatalog(catalogOverride).map((entry) => {
    const stored = state.integrations[entry.id];
    const setup = getNativeConnectorOAuthSetup(entry, options);
    return {
      ...entry,
      ...setup,
      enabled: stored?.enabled === true,
      enabledAt: stored?.enabledAt,
      toolCount: getNativeConnectorTools(entry).length,
      actionCount:
        entry.provider === "oauth-catalog" ||
        entry.provider === "backend-composio"
          ? entry.catalogToolCount
          : getNativeConnectorCatalogActions(entry).length,
    };
  });
};

export const isNativeConnectorEnabled = async (
  stellaAppDir: string,
  id: string,
) => {
  const state = await readState(stellaAppDir);
  return state.integrations[id]?.enabled === true;
};

export const listEnabledNativeConnectorIds = async (
  stellaAppDir: string,
): Promise<string[]> => {
  const state = await readState(stellaAppDir);
  return Object.entries(state.integrations)
    .filter(([, entry]) => entry?.enabled === true)
    .map(([id]) => id)
    .sort();
};

export const enableNativeConnector = async (
  stellaAppDir: string,
  id: string,
  source: "store" | "cli" = "cli",
  options: NativeOAuthProviderConfigOptions = {},
  catalogOverride?: NativeConnectorCatalogOverride,
) => {
  const catalog = buildNativeConnectorCatalog(catalogOverride);
  const entry = getNativeConnectorCatalogEntry(id, catalog);
  if (!entry) throw new Error(`Unknown native integration: ${id}`);
  const setup = getNativeConnectorOAuthSetup(entry, options);
  if (!setup.connectable) {
    if (setup.oauthSetupStatus === "local_implementation_incomplete") {
      throw new Error(
        `${entry.name} local execution is incomplete; an authoritative Store catalog entry is required.`,
      );
    }
    const config = getNativeConnectorOAuthConfig(entry);
    if (config?.tokenExchange?.type === "backend") {
      const tokenExchangeProvider = (config.tokenExchange.provider ?? entry.id)
        .trim()
        .toLowerCase();
      const hasExplicitOAuthApp =
        hasNativeOAuthProviderClientIdOverride(entry.id) ||
        hasNativeOAuthProviderClientIdOverride(tokenExchangeProvider);
      if (!hasExplicitOAuthApp) {
        throw new Error(
          `${entry.name} supports OAuth, but Stella's provider setup is not ready yet.`,
        );
      }
      throw new Error(
        `${entry.name} supports OAuth, but Stella's secure server connection is not ready yet.`,
      );
    }
    if (
      config?.flow === "authorization_code" &&
      config.callbackMode === "external"
    ) {
      throw new Error(
        `${entry.name} supports OAuth, but Stella's browser return link is not ready yet.`,
      );
    }
    throw new Error(
      `${entry.name} supports OAuth, but Stella's provider setup is not ready yet.`,
    );
  }
  const state = await readState(stellaAppDir);
  const now = Date.now();
  state.integrations[id] = {
    enabled: true,
    enabledAt: state.integrations[id]?.enabledAt ?? now,
    updatedAt: now,
    source,
  };
  await writeState(stellaAppDir, state);
  // `toolCount` mirrors what `listNativeConnectors` returns so the
  // website can drop the updated entry straight into its local state
  // without re-listing. Omitting it would briefly render "undefined
  // actions" on the just-enabled card until the next list refresh.
  return {
    ...entry,
    ...setup,
    enabled: true,
    toolCount: getNativeConnectorTools(entry).length,
    actionCount:
      entry.provider === "oauth-catalog"
        ? entry.catalogToolCount
        : entry.provider === "backend-composio"
          ? entry.catalogToolCount
          : getNativeConnectorCatalogActions(entry).length,
  };
};

export const disableNativeConnector = async (
  stellaAppDir: string,
  id: string,
  options: NativeOAuthProviderConfigOptions = {},
  catalogOverride?: NativeConnectorCatalogOverride,
) => {
  const catalog = buildNativeConnectorCatalog(catalogOverride);
  const entry = getNativeConnectorCatalogEntry(id, catalog);
  if (!entry) throw new Error(`Unknown native integration: ${id}`);
  const state = await readState(stellaAppDir);
  const now = Date.now();
  state.integrations[id] = {
    ...(state.integrations[id] ?? { updatedAt: now }),
    enabled: false,
    updatedAt: now,
  };
  await writeState(stellaAppDir, state);
  return {
    ...entry,
    ...getNativeConnectorOAuthSetup(entry, options),
    enabled: false,
    toolCount: getNativeConnectorTools(entry).length,
    actionCount:
      entry.provider === "oauth-catalog"
        ? entry.catalogToolCount
        : entry.provider === "backend-composio"
          ? entry.catalogToolCount
          : getNativeConnectorCatalogActions(entry).length,
  };
};
