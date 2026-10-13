/**
 * Connector client engine behind the node_repl `connect` client
 * (`createReplConnectClient`): discovering and managing connectors, and
 * listing and running enabled connectors' actions, which the code runtime
 * offers as deferred tools (`connector-tools.ts`).
 *
 * Everything here throws plain Errors (the broker's message included);
 * the REPL kernel serializes them across the worker boundary so agent
 * code sees a thrown Error.
 *
 * Backend Composio actions run through the same trusted path as always:
 * CLI bridge UDS → worker `backend-connector-action-broker` (Ajv input
 * validation + tiered action allowlist) → stella.sh backend.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { callApiConnector } from "./api-client.js";
import {
  resolveNativeConnectorCatalog,
  type NativeCatalogSource,
  type ResolvedNativeCatalog,
} from "./catalog-cache.js";
import { getNativeConnectorReadiness } from "./connection-status.js";
import {
  isLocalMcpUrl,
  mcpServerReach,
  type McpServerPut,
  type McpServerRecord,
} from "@stella/contracts/backend/mcp-servers";
import {
  requestAccountMcpFromBridge,
  requestBackendConnectorActionFromBridge,
  requestBackendConnectorActionsFromBridge,
  cancelConnectorCredentialFromBridge,
  requestConnectorCredentialFromBridge,
  type BackendConnectorActionResult,
  type ConnectorCredentialResult,
} from "./cli-broker-client.js";
import { discoverConnectors } from "./discovery.js";
import {
  callConnectorBridgeTool,
  closeConnectorBridgeSessions,
  ConnectorAuthError,
  probeConnectorBridgeTools,
  type ConnectorBridgeProbe,
} from "./connector-bridge.js";
import {
  getConnectorStateRoot,
  listConfiguredApiConnectors,
  listConfiguredConnectorCommands,
  removeConfiguredConnector,
  saveConfiguredConnectorCommands,
} from "./state.js";
import {
  deleteConnectorAccessTokens,
  loadConnectorAccessToken,
  loadConnectorTokenPayload,
} from "./oauth.js";
import {
  getNativeOAuthProviderConfig,
  type NativeOAuthProviderConfig,
} from "./native-oauth-provider-config.js";
import {
  backendIntegrationRunToolName,
  getNativeConnectorCatalogEntry,
  getNativeConnectorTools,
  isNativeConnectorEnabled,
  listEnabledNativeConnectorIds,
  listNativeConnectors,
  nativeOAuthApiRequestToolName,
  type NativeConnectorCatalogEntry,
} from "./native-integrations.js";
import type {
  ApiConnectorConfig,
  ConnectorCommandConfig,
  ConnectorToolInfo,
} from "./types.js";
import {
  API_REQUEST_ACTION,
  MCP_AUTHORIZE_ACTION,
  buildConnectorToolEntries,
  invalidConnectorToolArgsMessage,
  requireConnectorTool,
  validateConnectorToolArgs,
  type ConnectorActionSource,
  type ConnectorToolEntry,
  type ConnectorToolSource,
} from "./connector-tools.js";
import {
  parseAddMcpOptions,
  validateMcpConnectorId,
} from "./mcp-add-options.js";
import { loadGoogleWorkspaceTools } from "../google-workspace/load-google-workspace-tools.js";

/** Who made a connector call, so a credential card opens in their chat. */
export type ConnectorCaller = {
  conversationId?: string;
  agentId?: string;
  toolCallId?: string;
};

export type ConnectClientOptions = {
  stellaAppDir: string;
  /** The conversation, agent and tool call a credential card belongs to. */
  caller?: ConnectorCaller;
  /** Runs while the user answers a credential card (the code cell's clock stops). */
  awaitUser?: <T>(task: () => Promise<T>) => Promise<T>;
  /** The caller's run stopped: an open credential card is withdrawn. */
  signal?: AbortSignal;
  /** UDS path of the worker's CLI bridge (credential cards + broker). */
  cliBridgeSocketPath?: string;
  /** Non-fatal bridge diagnostics (logged by the host). */
  onBridgeUnreachable?: (message: string) => void;
  /** This computer's device id, which the account's MCP registry names it by. */
  deviceId?: string;
};

/**
 * Broker refusals/failures surface as this error so callers can branch on
 * `reason` without parsing the message. The message carries the broker's
 * own text plus status/request diagnostics.
 */
export class ConnectorBrokerActionError extends Error {
  constructor(
    message: string,
    readonly reason: string,
    readonly status?: number,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ConnectorBrokerActionError";
  }
}

export type ConnectorAuthHints = {
  authType: "api_key" | "oauth" | undefined;
  resourceUrl?: string;
  oauthClientId?: string;
  oauthResource?: string;
  scopes?: string[];
  preregisteredOAuth?: {
    clientId: string;
    authorizationEndpoint: string;
    tokenEndpoint?: string;
    responseType?: "code" | "token";
    resourceUrl?: string;
    oauthResource?: string | null;
    callbackUrl?: string;
    callbackId?: string;
    callbackMode?: "local" | "external";
    scopeSeparator?: string;
    usesPkce?: boolean;
    authorizationClientIdParam?: string;
    authorizationRedirectParam?: string;
    authorizationParams?: Record<string, string>;
    tokenRedirectParam?: string;
    tokenAuth?: "body" | "basic";
    tokenExchange?: {
      type: "backend";
      provider: string;
    };
  };
};

export const nativeOAuthAuthHints = (
  id: string,
  config: NativeOAuthProviderConfig | null,
): ConnectorAuthHints | undefined => {
  if (!config) return undefined;
  if (config.flow !== "authorization_code") {
    return {
      authType: "oauth",
      resourceUrl: config.resourceUrl,
      oauthClientId: config.clientId,
      oauthResource: config.oauthResource ?? undefined,
      scopes: config.scopes,
    };
  }
  return {
    authType: "oauth",
    resourceUrl: config.resourceUrl ?? config.authorizationEndpoint,
    oauthClientId: config.clientId,
    oauthResource: config.oauthResource ?? undefined,
    scopes: config.scopes,
    preregisteredOAuth: {
      clientId: config.clientId,
      authorizationEndpoint: config.authorizationEndpoint,
      tokenEndpoint: config.tokenEndpoint,
      responseType: config.responseType,
      resourceUrl: config.resourceUrl,
      oauthResource: config.oauthResource,
      callbackUrl: config.callbackUrl,
      callbackId: config.callbackId,
      callbackMode: config.callbackMode,
      scopeSeparator: config.scopeSeparator,
      usesPkce: config.usesPkce,
      authorizationClientIdParam: config.authorizationClientIdParam,
      authorizationRedirectParam: config.authorizationRedirectParam,
      authorizationParams: config.authorizationParams,
      tokenRedirectParam: config.tokenRedirectParam,
      tokenAuth: config.tokenAuth,
      tokenExchange:
        config.tokenExchange?.type === "backend"
          ? {
              type: "backend",
              provider: config.tokenExchange.provider ?? id,
            }
          : undefined,
    },
  };
};

export const resolveConnectorAuthHints = async (
  stellaAppDir: string,
  serverDisplayName: string,
): Promise<ConnectorAuthHints> => {
  const commands = await listConfiguredConnectorCommands(stellaAppDir).catch(
    () => [],
  );
  const apis = await listConfiguredApiConnectors(stellaAppDir).catch(() => []);
  const command = commands.find(
    (entry) => entry.displayName === serverDisplayName,
  );
  if (command) {
    return {
      authType: command.auth?.type === "oauth" ? "oauth" : "api_key",
      resourceUrl: command.url,
      oauthClientId: command.auth?.clientId,
      oauthResource: command.auth?.resource,
      scopes: command.auth?.scopes,
    };
  }
  const api = apis.find((entry) => entry.displayName === serverDisplayName);
  if (api) {
    return {
      authType: api.auth?.type === "oauth" ? "oauth" : "api_key",
      resourceUrl: api.baseUrl,
      oauthClientId: api.auth?.clientId,
      oauthResource: api.auth?.resource,
      scopes: api.auth?.scopes,
    };
  }
  return { authType: undefined };
};

/**
 * Run `attempt`. If it throws `ConnectorAuthError` AND the bridge socket
 * is wired AND the error carries a `tokenKey`, dial the bridge to ask the
 * user with a credential card; on `{ ok: true }` retry once. Anything else (no
 * socket, no tokenKey, user cancel/timeout, second auth failure) rethrows
 * to the caller. Single retry is intentional: a second auth failure means
 * a bad key, not that another round-trip would help.
 */
export const withAuthRetry = async <T>(
  options: ConnectClientOptions,
  attempt: () => Promise<T>,
  explicitHints?: ConnectorAuthHints,
): Promise<T> => {
  try {
    return await attempt();
  } catch (error) {
    if (!(error instanceof ConnectorAuthError)) throw error;
    const socketPath = options.cliBridgeSocketPath;
    const tokenKey = error.tokenKey;
    if (!socketPath || !tokenKey) throw error;

    const hints =
      explicitHints ??
      (await resolveConnectorAuthHints(
        options.stellaAppDir,
        error.serverDisplayName,
      ));

    let result: ConnectorCredentialResult;
    try {
      // No `description`: the host's canonical copy is used instead of
      // leaking the upstream HTTP status / generic-error verbiage into a
      // user-facing card.
      const ask = () => requestConnectorCredentialFromBridge({
        socketPath,
        tokenKey,
        displayName: error.serverDisplayName,
        authType: hints.authType,
        resourceUrl: hints.resourceUrl,
        oauthClientId: hints.oauthClientId,
        oauthResource: hints.oauthResource,
        scopes: hints.scopes,
        preregisteredOAuth: hints.preregisteredOAuth,
        ...(options.caller ? { caller: options.caller } : {}),
      });
      const caller = options.caller;
      const withdraw = () => {
        if (caller?.toolCallId) {
          void cancelConnectorCredentialFromBridge({ socketPath, caller }).catch(() => undefined);
        }
      };
      options.signal?.addEventListener("abort", withdraw, { once: true });
      try {
        result = options.awaitUser ? await options.awaitUser(ask) : await ask();
      } finally {
        options.signal?.removeEventListener("abort", withdraw);
      }
    } catch (bridgeError) {
      // The bridge was advertised but isn't reachable — fall through to
      // the original auth error so the agent gets a clean signal rather
      // than a confusing "socket refused" string.
      options.onBridgeUnreachable?.(
        `cli-bridge unreachable: ${(bridgeError as Error).message}`,
      );
      throw error;
    }

    if (!result.ok) throw error;
    return await attempt();
  }
};

export const findConnectorCommand = async (
  stellaAppDir: string,
  id: string,
) => {
  const commands = await listConfiguredConnectorCommands(stellaAppDir);
  return commands.find((entry) => entry.id === id);
};

export const findConnectorApi = async (stellaAppDir: string, id: string) => {
  const apis = await listConfiguredApiConnectors(stellaAppDir);
  return apis.find((entry) => entry.id === id);
};

export const withConnectorBridgeCleanup = async <T>(
  stellaAppDir: string,
  command: ConnectorCommandConfig,
  attempt: () => Promise<T>,
): Promise<T> => {
  try {
    return await attempt();
  } finally {
    await closeConnectorBridgeSessions(stellaAppDir, [command.id]);
  }
};

export const connectorAuthStatus = async (
  stellaAppDir: string,
  auth: ConnectorCommandConfig["auth"],
) => {
  if (!auth || auth.type === "none") return "unsupported" as const;
  if (!auth.tokenKey) return "not_logged_in" as const;
  return (await loadConnectorAccessToken(stellaAppDir, auth.tokenKey))
    ? "connected"
    : "not_logged_in";
};

export const nativeCatalogDiagnostics = (
  entry: NativeConnectorCatalogEntry,
  catalogSource: NativeCatalogSource,
) => {
  const toolCount = getNativeConnectorTools(entry).length;
  return {
    catalogSource,
    provider: entry.provider,
    toolCount,
  };
};

/**
 * Catalog policy shared by every consumer here: disk cache / bundled
 * fallback, never a network fetch (the connect client must stay fast and
 * offline-capable; the broker re-resolves the live catalog server-side
 * before running anything).
 */
export const loadConnectCatalog = async (
  stellaAppDir: string,
): Promise<ResolvedNativeCatalog> =>
  resolveNativeConnectorCatalog({ stellaDataDir: stellaAppDir });

export const callBackendNativeIntegration = async (
  options: ConnectClientOptions,
  id: string,
  action: string,
  input: Record<string, unknown>,
): Promise<unknown> => {
  const socketPath = options.cliBridgeSocketPath?.trim();
  if (!socketPath) {
    throw new Error(
      process.platform === "win32"
        ? "Secure connector action brokering is unavailable on Windows."
        : "The Stella connector action broker is unavailable.",
    );
  }
  const result: BackendConnectorActionResult =
    await requestBackendConnectorActionFromBridge({
      socketPath,
      connectorId: id,
      action,
      input,
    }).catch(() => ({
      ok: false as const,
      reason: "bridge_unavailable",
      message: "The Stella connector broker is unavailable.",
    }));
  if (result.ok) return result.result;
  const diagnosticSuffix = result.status
    ? ` (status ${result.status}${result.requestId ? `, request ${result.requestId}` : ""})`
    : "";
  throw new ConnectorBrokerActionError(
    `${
      result.message ??
      (result.reason === "not_signed_in"
        ? "Sign in to Stella before using this integration."
        : result.reason === "auth_expired"
          ? "Stella sign-in expired. Sign in again before using this integration."
          : "The Stella connector broker could not run this action.")
    }${diagnosticSuffix}`,
    result.reason,
    result.status,
    result.requestId,
  );
};

export const ensureNativeEnabled = async (
  options: ConnectClientOptions,
  id: string,
  catalogEntries: readonly NativeConnectorCatalogEntry[],
): Promise<NativeConnectorCatalogEntry | null> => {
  const entry = getNativeConnectorCatalogEntry(id, catalogEntries);
  if (!entry) return null;
  if (!(await isNativeConnectorEnabled(options.stellaAppDir, id))) {
    throw new Error(
      `${entry.name} is disabled. Enable it in the Store before calling it.`,
    );
  }
  return entry;
};

export type NativeConnectorCallArgs = {
  body: Record<string, unknown>;
  method?: string;
  query?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
};

export const callNativeConnector = async (
  options: ConnectClientOptions,
  id: string,
  action: string,
  args: NativeConnectorCallArgs,
  catalogEntries: readonly NativeConnectorCatalogEntry[],
): Promise<unknown> => {
  const { stellaAppDir } = options;
  const locallyEnabled = await isNativeConnectorEnabled(stellaAppDir, id);
  const locallyResolved = getNativeConnectorCatalogEntry(id, catalogEntries);
  // A freshly authenticated desktop may have a live authoritative Store
  // entry before this process has a disk cache. Do not reinterpret bundled
  // metadata as executable, but allow the trusted broker to resolve and
  // authorize the canonical backend identity for an already-enabled id.
  if (
    locallyEnabled &&
    options.cliBridgeSocketPath?.trim() &&
    (!locallyResolved ||
      (locallyResolved.provider !== "backend-composio" &&
        locallyResolved.localExecution !== "production-ready"))
  ) {
    const runAction = backendIntegrationRunToolName(id);
    if (action === runAction) {
      const nestedAction = args.body.action;
      if (typeof nestedAction !== "string" || !nestedAction.trim()) {
        throw new Error(`${runAction} requires an action string.`);
      }
      const nestedArgs = args.body.arguments;
      return await callBackendNativeIntegration(
        options,
        id,
        nestedAction.trim(),
        nestedArgs &&
          typeof nestedArgs === "object" &&
          !Array.isArray(nestedArgs)
          ? (nestedArgs as Record<string, unknown>)
          : {},
      );
    }
    return await callBackendNativeIntegration(options, id, action, args.body);
  }
  const entry = await ensureNativeEnabled(options, id, catalogEntries);
  if (!entry) return null;
  if (
    entry.provider !== "backend-composio" &&
    entry.localExecution !== "production-ready"
  ) {
    throw new Error(
      `${entry.name} local execution is incomplete. A live or cached authoritative Store catalog entry is required.`,
    );
  }
  if (entry.provider === "backend-composio") {
    const runAction = backendIntegrationRunToolName(id);
    if (action === runAction) {
      const nestedAction = args.body.action;
      if (typeof nestedAction !== "string" || !nestedAction.trim()) {
        throw new Error(`${runAction} requires an action string.`);
      }
      const nestedArgs = args.body.arguments;
      return await callBackendNativeIntegration(
        options,
        id,
        nestedAction.trim(),
        nestedArgs &&
          typeof nestedArgs === "object" &&
          !Array.isArray(nestedArgs)
          ? (nestedArgs as Record<string, unknown>)
          : {},
      );
    }
    return await callBackendNativeIntegration(options, id, action, args.body);
  }
  const allowedTools = new Set(
    getNativeConnectorTools(entry).map((tool) => tool.name),
  );
  if (
    entry.provider === "oauth-catalog" &&
    id === "linear" &&
    action === "LINEAR_RUN_QUERY_OR_MUTATION"
  ) {
    if (typeof args.body.query !== "string" || !args.body.query.trim()) {
      throw new Error(
        "LINEAR_RUN_QUERY_OR_MUTATION requires a GraphQL `query` string.",
      );
    }
    const config = getNativeOAuthProviderConfig(id);
    const tokenPayload = config?.tokenKey
      ? await loadConnectorTokenPayload(stellaAppDir, config.tokenKey)
      : null;
    const baseUrl = tokenPayload?.resourceUrl ?? config?.resourceUrl;
    const tokenKey = config?.tokenKey;
    if (!baseUrl || !tokenKey) {
      throw new Error(
        `${entry.name} does not expose a native GraphQL endpoint yet.`,
      );
    }
    return await withAuthRetry(
      options,
      () =>
        callApiConnector(
          stellaAppDir,
          {
            id,
            displayName: entry.name,
            baseUrl,
            auth: {
              type: "oauth",
              tokenKey,
              scheme: "bearer",
              headerName: "Authorization",
            },
          },
          {
            method: "POST",
            path: "/graphql",
            body: args.body,
          },
        ),
      nativeOAuthAuthHints(id, config),
    );
  }
  const callNativeOAuthApiPath = async (
    path: string,
    pathOptions: {
      method?: string;
      query?: Record<string, string | number | boolean>;
      body?: Record<string, unknown>;
      headers?: Record<string, string>;
    },
  ) => {
    const config = getNativeOAuthProviderConfig(id);
    const tokenKey = config?.tokenKey;
    if (!tokenKey) {
      throw new Error(
        `${entry.name} does not expose a native REST endpoint yet.`,
      );
    }
    const tokenInQuery = config?.apiAuthPlacement === "access_token_query";
    const attempt = async () => {
      const tokenPayload = await loadConnectorTokenPayload(
        stellaAppDir,
        tokenKey,
      );
      const baseUrl = tokenPayload?.resourceUrl ?? config?.resourceUrl;
      if (!baseUrl) {
        throw new Error(
          `${entry.name} does not expose a native REST endpoint yet.`,
        );
      }
      if (tokenInQuery && !tokenPayload?.accessToken) {
        throw new ConnectorAuthError(
          0,
          entry.name,
          tokenKey,
          `${entry.name} is not connected yet.`,
        );
      }
      const queryAccessToken =
        tokenInQuery && tokenPayload?.accessToken
          ? tokenPayload.accessToken
          : null;
      return await callApiConnector(
        stellaAppDir,
        {
          id,
          displayName: entry.name,
          baseUrl,
          auth: tokenInQuery
            ? { type: "none" }
            : {
                type: "oauth",
                tokenKey,
                scheme: config?.apiAuthScheme ?? "bearer",
                headerName: "Authorization",
              },
        },
        {
          method: pathOptions.method,
          path,
          query: {
            ...(config?.apiQueryParams ?? {}),
            ...(queryAccessToken ? { access_token: queryAccessToken } : {}),
            ...(pathOptions.query ?? {}),
          },
          body:
            pathOptions.body && Object.keys(pathOptions.body).length
              ? pathOptions.body
              : undefined,
          headers: pathOptions.headers,
        },
      );
    };
    return await withAuthRetry(
      options,
      attempt,
      nativeOAuthAuthHints(id, config),
    );
  };
  if (entry.provider === "oauth-catalog" && action.startsWith("/")) {
    return await callNativeOAuthApiPath(action, {
      method: args.method,
      query: args.query,
      body: args.body,
      headers: args.headers,
    });
  }
  if (
    entry.provider === "oauth-catalog" &&
    action === nativeOAuthApiRequestToolName(id)
  ) {
    const path = args.body.path;
    if (typeof path !== "string" || !path.startsWith("/")) {
      throw new Error(`${action} requires a \`path\` string beginning with /.`);
    }
    const method = args.body.method;
    const query = args.body.query;
    const body = args.body.body;
    const headers = args.body.headers;
    return await callNativeOAuthApiPath(path, {
      method: typeof method === "string" ? method : args.method,
      query:
        query && typeof query === "object" && !Array.isArray(query)
          ? (query as Record<string, string | number | boolean>)
          : args.query,
      body:
        body && typeof body === "object" && !Array.isArray(body)
          ? (body as Record<string, unknown>)
          : {},
      headers:
        headers && typeof headers === "object" && !Array.isArray(headers)
          ? Object.fromEntries(
              Object.entries(headers).flatMap(([key, value]) =>
                typeof value === "string" ? [[key, value]] : [],
              ),
            )
          : args.headers,
    });
  }
  if (!allowedTools.has(action)) {
    throw new Error(
      `${entry.name} does not expose ${action}. Find its tools with tools.$search({ query: "${entry.name}" }).`,
    );
  }
  if (entry.provider !== "google-workspace") {
    throw new Error(
      `${entry.name} is connected for OAuth catalog metadata, but Stella does not have a native tool dispatcher for it yet.`,
    );
  }
  const { callTool, disconnect } = await loadGoogleWorkspaceTools({
    stellaAppDir,
  });
  try {
    if (callTool) return await callTool(action, args.body);
    throw new Error("Google Workspace tools are unavailable.");
  } finally {
    await disconnect().catch(() => undefined);
  }
};

// ---------------------------------------------------------------------------
// MCP connector management (connect.addMcp / connect.remove)
// ---------------------------------------------------------------------------

const MCP_TOOLS_CACHE_FILE = "mcp-tools.json";
const MCP_TOOLS_REFRESH_MS = 60 * 60_000;
const MCP_PROBE_RETRY_MS = 60_000;
const MCP_PROBE_TIMEOUT_MS = 8_000;

type McpToolsCacheFile = {
  version: 1;
  connectors: Record<string, { tools: ConnectorToolInfo[]; updatedAt: number }>;
};

const mcpToolsCachePath = (stellaAppDir: string) =>
  path.join(getConnectorStateRoot(stellaAppDir), MCP_TOOLS_CACHE_FILE);

const readMcpToolsCache = async (
  stellaAppDir: string,
): Promise<McpToolsCacheFile> => {
  try {
    const parsed = JSON.parse(
      await fs.readFile(mcpToolsCachePath(stellaAppDir), "utf-8"),
    ) as McpToolsCacheFile;
    if (parsed?.version === 1 && isPlainRecord(parsed.connectors)) {
      return parsed;
    }
  } catch {}
  return { version: 1, connectors: {} };
};

const updateMcpToolsCache = async (
  stellaAppDir: string,
  update: (cache: McpToolsCacheFile) => void,
): Promise<void> => {
  const cache = await readMcpToolsCache(stellaAppDir);
  update(cache);
  const filePath = mcpToolsCachePath(stellaAppDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(cache, null, 2)}\n`, "utf-8");
};

const rememberMcpTools = (
  stellaAppDir: string,
  id: string,
  tools: readonly ConnectorToolInfo[],
): Promise<void> =>
  updateMcpToolsCache(stellaAppDir, (cache) => {
    cache.connectors[id] = {
      tools: tools.map((tool) => ({
        name: tool.name,
        ...(tool.title ? { title: tool.title } : {}),
        ...(tool.description ? { description: tool.description } : {}),
        ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
      })),
      updatedAt: Date.now(),
    };
  });

export type AddMcpResult = {
  imported: ConnectorCommandConfig;
  toolCount: number;
  tools: string[];
  where: string;
  probeDeferred?: true;
  hint?: string;
};

export type RemoveConnectorResult = {
  removed: { commands: number; apis: number };
  deletedTokenKeys: string[];
  /** The account's copy: gone everywhere, or retried on the next check. */
  account: "removed" | "pending" | "none";
};

const ADD_MCP_TOOL_NAMES_SHOWN = 30;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const probeMcpConnector = async (
  options: ConnectClientOptions,
  command: ConnectorCommandConfig,
): Promise<ConnectorBridgeProbe> => {
  const probe = await withConnectorBridgeCleanup(
    options.stellaAppDir,
    command,
    () =>
      withAuthRetry(options, () =>
        probeConnectorBridgeTools(options.stellaAppDir, command),
      ),
  );
  await rememberMcpTools(options.stellaAppDir, command.id, probe.tools).catch(
    () => undefined,
  );
  await reportMcpTools(options, command, probe.tools, true).catch(() => undefined);
  return probe;
};

export const addMcpConnector = async (
  options: ConnectClientOptions,
  raw: Record<string, unknown>,
  reservedToolNames: ReadonlySet<string> = new Set(),
): Promise<AddMcpResult> => {
  const { stellaAppDir } = options;
  const { command } = parseAddMcpOptions(raw);

  let probe: ConnectorBridgeProbe = { tools: [] };
  let probeDeferred = false;
  let probeDeferredReason: string | undefined;
  try {
    probe = await withConnectorBridgeCleanup(stellaAppDir, command, () =>
      withAuthRetry(
        options,
        () => probeConnectorBridgeTools(stellaAppDir, command),
        {
          authType: command.auth?.type === "oauth" ? "oauth" : "api_key",
          resourceUrl: command.url,
        },
      ),
    );
  } catch (error) {
    if (
      error instanceof ConnectorAuthError &&
      command.auth &&
      command.auth.type !== "none"
    ) {
      probeDeferred = true;
      probeDeferredReason = error.message;
    } else {
      throw error;
    }
  }

  const existing = await listConfiguredConnectorCommands(stellaAppDir);
  const next = new Map(existing.map((entry) => [entry.id, entry]));
  next.set(command.id, command);
  await saveConfiguredConnectorCommands(
    stellaAppDir,
    [...next.values()].sort((left, right) =>
      left.displayName.localeCompare(right.displayName),
    ),
  );
  if (probeDeferred) {
    await updateMcpToolsCache(stellaAppDir, (cache) => {
      delete cache.connectors[command.id];
    }).catch(() => undefined);
  } else {
    await rememberMcpTools(stellaAppDir, command.id, probe.tools);
  }
  mcpProbeFailures.delete(mcpProbeKey(stellaAppDir, command.id));
  const onAccount = await putOnAccount(options, command, {
    tools: probe.tools,
    needsAuth: probeDeferred,
    holdsCredential: !probeDeferred,
  });
  const toolNames = buildConnectorToolEntries(
    [
      {
        id: command.id,
        name: command.displayName,
        kind: "mcp",
        actions: probe.tools,
      },
    ],
    reservedToolNames,
  ).map((entry) => entry.name);
  return {
    imported: command,
    toolCount: probe.tools.length,
    tools: toolNames.slice(0, ADD_MCP_TOOL_NAMES_SHOWN),
    where: onAccount
      ? localWhere(command)
      : "Saved on this computer only for now (the account couldn't be reached); it syncs to the account on the next connector check.",
    ...(probeDeferred
      ? {
          probeDeferred: true as const,
          hint: `The server requires auth (${collapseLine(probeDeferredReason, 200)}). The connector was saved anyway: its tools appear in tools.$search once it is authorized, and calling one asks the user for the credential.`,
        }
      : {
          hint:
            toolNames.length > ADD_MCP_TOOL_NAMES_SHOWN
              ? `${toolNames.length} tools; find the rest with await tools.$search({ query: "${command.displayName}" }).`
              : "Call them as tools.<name>(args); tools.$describe(name) shows each input schema.",
        }),
  };
};

export const removeMcpConnector = async (
  options: ConnectClientOptions,
  rawId: string,
  resolved: ResolvedNativeCatalog,
): Promise<RemoveConnectorResult> => {
  const { stellaAppDir } = options;
  const id = validateMcpConnectorId(rawId);
  if (getNativeConnectorCatalogEntry(id, resolved.entries)) {
    throw new Error(
      `${id} is a native Store integration. Disable it in the Store instead of connect.remove.`,
    );
  }
  const [command, api, listing] = await Promise.all([
    findConnectorCommand(stellaAppDir, id),
    findConnectorApi(stellaAppDir, id),
    accountMcpListing(options),
  ]);
  const onAccount = listing?.servers.some((server) => server.id === id) ?? false;
  if (!command && !api && !onAccount) {
    throw new Error(
      `Connector is not installed: ${id}. List installed connectors with connect.connectors().`,
    );
  }
  const removed = await removeLocalMcp(stellaAppDir, id);
  let account: "removed" | "pending" | "none" = "none";
  if (onAccount || command) {
    const ok = await accountMcpCall(options, "remove", { id })
      .then(() => true)
      .catch(() => false);
    account = ok ? "removed" : "pending";
    await updateAccountMcpState(stellaAppDir, (state) => {
      state.synced = state.synced.filter((entry) => entry !== id);
      if (!ok) state.pendingRemovals.push(id);
    }).catch(() => undefined);
    forgetAccountListing(stellaAppDir);
  }

  return {
    removed: {
      commands: removed.removedCommands.length,
      apis: removed.removedApis.length,
    },
    deletedTokenKeys: removed.tokenKeys,
    account,
  };
};

// ---------------------------------------------------------------------------
// Account sync: every MCP server belongs to the account
// ---------------------------------------------------------------------------
//
// The account's registry (`mcpServers.*`) is the source of truth while this
// computer is signed in and online. A remote server added anywhere is copied
// into this computer's commands; a stdio (or local-network) server stays on
// the computer that added it, with only its name and tools on the account,
// and other places reach it through that computer. `synced` records which
// local servers the account has seen, so one removed elsewhere is removed
// here too; `pendingRemovals` retries a removal the account missed.

const ACCOUNT_MCP_STATE_FILE = "account-mcp.json";
const ACCOUNT_MCP_TTL_MS = 15_000;
const ACCOUNT_MCP_LIST_TIMEOUT_MS = 8_000;

type AccountMcpState = {
  version: 1;
  synced: string[];
  pendingRemovals: string[];
};

type AccountMcpDevice = {
  deviceId: string;
  label?: string;
  online: boolean;
  acceptsWork: boolean;
};

type AccountMcpListing = {
  servers: McpServerRecord[];
  devices: AccountMcpDevice[];
};

const accountMcpStatePath = (stellaAppDir: string) =>
  path.join(getConnectorStateRoot(stellaAppDir), ACCOUNT_MCP_STATE_FILE);

const readAccountMcpState = async (
  stellaAppDir: string,
): Promise<AccountMcpState> => {
  try {
    const parsed = JSON.parse(
      await fs.readFile(accountMcpStatePath(stellaAppDir), "utf-8"),
    ) as Partial<AccountMcpState>;
    if (parsed?.version === 1) {
      return {
        version: 1,
        synced: isStringArray(parsed.synced) ? parsed.synced : [],
        pendingRemovals: isStringArray(parsed.pendingRemovals)
          ? parsed.pendingRemovals
          : [],
      };
    }
  } catch {}
  return { version: 1, synced: [], pendingRemovals: [] };
};

const writeAccountMcpState = async (
  stellaAppDir: string,
  state: AccountMcpState,
): Promise<void> => {
  const filePath = accountMcpStatePath(stellaAppDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    `${JSON.stringify(
      {
        version: 1,
        synced: [...new Set(state.synced)].sort(),
        pendingRemovals: [...new Set(state.pendingRemovals)].sort(),
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
};

const updateAccountMcpState = async (
  stellaAppDir: string,
  update: (state: AccountMcpState) => void,
): Promise<void> => {
  const state = await readAccountMcpState(stellaAppDir);
  update(state);
  await writeAccountMcpState(stellaAppDir, state);
};

const accountMcpSocket = (options: ConnectClientOptions) =>
  options.cliBridgeSocketPath?.trim() || undefined;

const accountMcpCall = async (
  options: ConnectClientOptions,
  op: "list" | "put" | "remove" | "call",
  args: Record<string, unknown>,
): Promise<unknown> => {
  const socketPath = accountMcpSocket(options);
  if (!socketPath) {
    throw new Error("This computer can't reach the account's MCP servers right now.");
  }
  return await requestAccountMcpFromBridge({ socketPath, op, args });
};

const readAccountListing = (value: unknown): AccountMcpListing | null => {
  if (!isPlainRecord(value) || !Array.isArray(value.servers)) return null;
  return {
    servers: value.servers.filter(
      (entry): entry is McpServerRecord =>
        isPlainRecord(entry) &&
        typeof entry.id === "string" &&
        typeof entry.name === "string" &&
        (entry.transport === "stdio" || entry.transport === "streamable_http") &&
        isPlainRecord(entry.auth),
    ),
    devices: Array.isArray(value.devices)
      ? value.devices.filter(
          (entry): entry is AccountMcpDevice =>
            isPlainRecord(entry) && typeof entry.deviceId === "string",
        )
      : [],
  };
};

const accountListings = new Map<
  string,
  { at: number; listing: Promise<AccountMcpListing | null> }
>();

const forgetAccountListing = (stellaAppDir: string) => {
  accountListings.delete(stellaAppDir);
};

/** The account's MCP servers, or null while the account can't be reached. */
const accountMcpListing = (
  options: ConnectClientOptions,
): Promise<AccountMcpListing | null> => {
  if (!accountMcpSocket(options)) return Promise.resolve(null);
  const cached = accountListings.get(options.stellaAppDir);
  if (cached && Date.now() - cached.at < ACCOUNT_MCP_TTL_MS) {
    return cached.listing;
  }
  const socketPath = accountMcpSocket(options)!;
  const listing = requestAccountMcpFromBridge({
    socketPath,
    op: "list",
    args: {},
    timeoutMs: ACCOUNT_MCP_LIST_TIMEOUT_MS,
  })
    .then(readAccountListing)
    .catch((error: unknown) => {
      options.onBridgeUnreachable?.(
        `account MCP servers unavailable: ${(error as Error)?.message ?? String(error)}`,
      );
      if (accountListings.get(options.stellaAppDir)?.listing === listing) {
        accountListings.delete(options.stellaAppDir);
      }
      return null;
    });
  accountListings.set(options.stellaAppDir, { at: Date.now(), listing });
  return listing;
};

/** Where this computer runs a server, for the account: stdio and local URLs. */
const runsOnlyHere = (command: ConnectorCommandConfig) =>
  command.transport === "stdio" || isLocalMcpUrl(command.url);

const commandAuth = (command: ConnectorCommandConfig): McpServerPut["auth"] => ({
  type: command.auth?.type ?? "none",
  ...(command.auth?.tokenKey ? { tokenKey: command.auth.tokenKey } : {}),
  ...(command.auth?.headerName ? { headerName: command.auth.headerName } : {}),
  ...(command.auth?.scheme ? { scheme: command.auth.scheme } : {}),
});

const accountPut = (
  options: ConnectClientOptions,
  command: ConnectorCommandConfig,
  extra: {
    tools?: readonly ConnectorToolInfo[];
    needsAuth?: boolean;
    /** This computer holds the credential the account should route through. */
    holdsCredential?: boolean;
  },
): McpServerPut => {
  const auth = commandAuth(command);
  const routeHere =
    runsOnlyHere(command) || (auth.type !== "none" && extra.holdsCredential === true);
  return {
    id: command.id,
    name: command.displayName,
    ...(command.description ? { description: command.description } : {}),
    transport: command.transport,
    ...(command.transport === "stdio" || !command.url ? {} : { url: command.url }),
    auth,
    ...(routeHere && options.deviceId ? { deviceId: options.deviceId } : {}),
    ...(extra.tools
      ? {
          tools: extra.tools.map((tool) => ({
            name: tool.name,
            ...(tool.title ? { title: tool.title } : {}),
            ...(tool.description ? { description: tool.description } : {}),
            ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
            ...(tool.annotations ? { annotations: tool.annotations } : {}),
          })),
        }
      : {}),
    ...(extra.needsAuth !== undefined ? { needsAuth: extra.needsAuth } : {}),
  };
};

/** Tell the account about a server this computer added, probed or signed in to. */
const putOnAccount = async (
  options: ConnectClientOptions,
  command: ConnectorCommandConfig,
  extra: Parameters<typeof accountPut>[2],
): Promise<boolean> => {
  if (!accountMcpSocket(options)) return false;
  try {
    await accountMcpCall(options, "put", accountPut(options, command, extra));
    await updateAccountMcpState(options.stellaAppDir, (state) => {
      state.synced.push(command.id);
      state.pendingRemovals = state.pendingRemovals.filter((id) => id !== command.id);
    });
    forgetAccountListing(options.stellaAppDir);
    return true;
  } catch (error) {
    options.onBridgeUnreachable?.(
      `account MCP sync failed for ${command.id}: ${(error as Error)?.message ?? String(error)}`,
    );
    return false;
  }
};

/**
 * A fresh tool listing from this computer. Shared with the account when it
 * changed, or when this computer now holds the credential the cloud should
 * route through.
 */
const reportMcpTools = async (
  options: ConnectClientOptions,
  command: ConnectorCommandConfig,
  tools: readonly ConnectorToolInfo[],
  holdsCredential: boolean,
): Promise<void> => {
  const listing = await accountMcpListing(options);
  if (!listing) return;
  const record = listing.servers.find((server) => server.id === command.id);
  if (!record) return;
  const authed = (command.auth?.type ?? "none") !== "none";
  const wantsRoute =
    authed && holdsCredential && !runsOnlyHere(command) && record.deviceId !== options.deviceId &&
    (!record.deviceId || record.needsAuth || !listing.devices.some((device) => device.deviceId === record.deviceId && device.online));
  const sameTools =
    JSON.stringify((record.tools ?? []).map((tool) => tool.name).sort()) ===
    JSON.stringify(tools.map((tool) => tool.name).sort());
  if (sameTools && !wantsRoute && !(record.needsAuth && !authed)) return;
  await putOnAccount(options, command, {
    tools,
    needsAuth: false,
    holdsCredential: wantsRoute || record.deviceId === options.deviceId,
  });
};

const removeLocalMcp = async (
  stellaAppDir: string,
  id: string,
): Promise<{ removedCommands: ConnectorCommandConfig[]; removedApis: ApiConnectorConfig[]; tokenKeys: string[] }> => {
  const removed = await removeConfiguredConnector(stellaAppDir, id);
  await closeConnectorBridgeSessions(stellaAppDir, [id]);
  await updateMcpToolsCache(stellaAppDir, (cache) => {
    delete cache.connectors[id];
  }).catch(() => undefined);
  mcpProbeFailures.delete(mcpProbeKey(stellaAppDir, id));
  const tokenKeys = [
    ...new Set(
      [
        ...removed.removedCommands.map((entry) => entry.auth?.tokenKey),
        ...removed.removedApis.map((entry) => entry.auth?.tokenKey),
      ].filter((key): key is string => Boolean(key)),
    ),
  ];
  await deleteConnectorAccessTokens(stellaAppDir, tokenKeys);
  return { ...removed, tokenKeys };
};

const recordToCommand = (record: McpServerRecord): ConnectorCommandConfig => ({
  id: record.id,
  displayName: record.name,
  ...(record.description ? { description: record.description } : {}),
  transport: "streamable_http",
  ...(record.url ? { url: record.url } : {}),
  auth:
    record.auth.type === "none"
      ? { type: "none" }
      : {
          type: record.auth.type,
          tokenKey: record.auth.tokenKey ?? record.id,
          ...(record.auth.headerName ? { headerName: record.auth.headerName } : {}),
          ...(record.auth.scheme ? { scheme: record.auth.scheme } : {}),
        },
});

/** A server on the account that this computer reaches through another one. */
export type ElsewhereMcpServer = {
  record: McpServerRecord;
  deviceName: string;
  online: boolean;
  acceptsWork: boolean;
};

const reconciling = new Map<string, Promise<ElsewhereMcpServer[]>>();

/**
 * Bring this computer's MCP servers and the account's into line, and return
 * the account's servers that run on another computer. Offline, nothing
 * changes and nothing is returned.
 */
export const reconcileAccountMcp = (
  options: ConnectClientOptions,
): Promise<ElsewhereMcpServer[]> => {
  const running = reconciling.get(options.stellaAppDir);
  if (running) return running;
  const task = (async () => {
    const listing = await accountMcpListing(options);
    if (!listing) return [];
    const { stellaAppDir } = options;
    const state = await readAccountMcpState(stellaAppDir);
    let servers = listing.servers;
    let changed = false;

    for (const id of [...state.pendingRemovals]) {
      try {
        await accountMcpCall(options, "remove", { id });
        state.pendingRemovals = state.pendingRemovals.filter((entry) => entry !== id);
        servers = servers.filter((server) => server.id !== id);
        changed = true;
      } catch {}
    }
    const pending = new Set(state.pendingRemovals);
    servers = servers.filter((server) => !pending.has(server.id));

    const byId = new Map(servers.map((server) => [server.id, server]));
    const local = await listConfiguredConnectorCommands(stellaAppDir);
    const localIds = new Set(local.map((command) => command.id));
    const synced = new Set(state.synced);
    const mcpCache = await readMcpToolsCache(stellaAppDir);

    for (const command of local) {
      const record = byId.get(command.id);
      if (record) {
        const sameServer =
          !runsOnlyHere(command) || record.deviceId === options.deviceId;
        if (sameServer && !synced.has(command.id)) {
          synced.add(command.id);
          changed = true;
        }
        continue;
      }
      if (synced.has(command.id)) {
        await removeLocalMcp(stellaAppDir, command.id);
        localIds.delete(command.id);
        synced.delete(command.id);
        changed = true;
        continue;
      }
      const cachedTools = mcpCache.connectors[command.id]?.tools;
      const ok = await accountMcpCall(
        options,
        "put",
        accountPut(options, command, {
          ...(cachedTools ? { tools: cachedTools } : {}),
          holdsCredential: Boolean(
            cachedTools && (await connectorAuthStatus(stellaAppDir, command.auth)) === "connected",
          ),
        }),
      )
        .then(() => true)
        .catch(() => false);
      if (ok) {
        synced.add(command.id);
        changed = true;
      }
    }

    const additions: ConnectorCommandConfig[] = [];
    const elsewhere: ElsewhereMcpServer[] = [];
    for (const record of servers) {
      if (localIds.has(record.id)) continue;
      const reach = mcpServerReach(record);
      const onlyThere = reach.kind === "device" && reach.reason === "local";
      if (record.transport === "streamable_http" && record.url && !onlyThere) {
        additions.push(recordToCommand(record));
        synced.add(record.id);
        changed = true;
        continue;
      }
      if (reach.kind === "device" && reach.deviceId === options.deviceId) {
        if (synced.has(record.id)) {
          await accountMcpCall(options, "remove", { id: record.id }).catch(() => undefined);
          synced.delete(record.id);
          changed = true;
        }
        continue;
      }
      if (reach.kind === "device") {
        const device = listing.devices.find((entry) => entry.deviceId === reach.deviceId);
        elsewhere.push({
          record,
          deviceName: device?.label ?? "another computer",
          online: device?.online === true,
          acceptsWork: device?.acceptsWork === true,
        });
      }
    }
    if (additions.length > 0) {
      const current = await listConfiguredConnectorCommands(stellaAppDir);
      const next = new Map(current.map((entry) => [entry.id, entry]));
      for (const command of additions) next.set(command.id, command);
      await saveConfiguredConnectorCommands(
        stellaAppDir,
        [...next.values()].sort((left, right) =>
          left.displayName.localeCompare(right.displayName),
        ),
      );
      await updateMcpToolsCache(stellaAppDir, (cache) => {
        for (const command of additions) {
          const record = byId.get(command.id);
          if (record?.tools && record.auth.type === "none") {
            cache.connectors[command.id] = {
              tools: record.tools,
              updatedAt: record.toolsUpdatedAt ?? Date.now(),
            };
          }
        }
      }).catch(() => undefined);
    }
    if (changed) {
      state.synced = [...synced];
      await writeAccountMcpState(stellaAppDir, state).catch(() => undefined);
    }
    return elsewhere;
  })()
    .catch((error: unknown) => {
      options.onBridgeUnreachable?.(
        `account MCP reconcile failed: ${(error as Error)?.message ?? String(error)}`,
      );
      return [];
    })
    .finally(() => {
      reconciling.delete(options.stellaAppDir);
    });
  reconciling.set(options.stellaAppDir, task);
  return task;
};

const elsewhereWhere = (server: ElsewhereMcpServer): string => {
  const state = !server.online
    ? "offline now"
    : !server.acceptsWork
      ? "online, but not accepting work from other devices"
      : "online";
  return server.record.transport === "stdio" || isLocalMcpUrl(server.record.url)
    ? `Device-only: runs on ${server.deviceName} (${state}); reached through it while it is online.`
    : `Signed in on ${server.deviceName} (${state}); reached through it while it is online.`;
};

const localWhere = (command: ConnectorCommandConfig): string =>
  runsOnlyHere(command)
    ? "Device-only: runs on this computer; the cloud and your other computers reach it through here while Stella is open."
    : "Remote server on the account: works here, in the cloud, and on your other computers.";

/**
 * The cloud asks this computer to list or run one of its MCP servers' tools
 * for an agent elsewhere on the account. No credential card opens here: the
 * user is not at this computer's chat.
 */
export const serveRelayedMcpRequest = async (
  options: ConnectClientOptions,
  method: unknown,
  params: unknown,
): Promise<unknown> => {
  const request = isPlainRecord(params) ? params : {};
  const id = typeof request.id === "string" ? request.id.trim().toLowerCase() : "";
  if (!id) throw new Error("An MCP request needs the server's id.");
  const command = await findConnectorCommand(options.stellaAppDir, id);
  if (!command) {
    throw new Error(`${id} isn't on this computer anymore.`);
  }
  const relayed: ConnectClientOptions = {
    stellaAppDir: options.stellaAppDir,
    ...(options.deviceId ? { deviceId: options.deviceId } : {}),
    ...(options.cliBridgeSocketPath ? { cliBridgeSocketPath: options.cliBridgeSocketPath } : {}),
  };
  try {
    if (method === "mcp.listTools") {
      const probe = await withConnectorBridgeCleanup(options.stellaAppDir, command, () =>
        probeConnectorBridgeTools(options.stellaAppDir, command),
      );
      await rememberMcpTools(options.stellaAppDir, command.id, probe.tools).catch(() => undefined);
      void putOnAccount(relayed, command, {
        tools: probe.tools,
        needsAuth: false,
        holdsCredential: true,
      });
      return { tools: probe.tools };
    }
    if (method === "mcp.callTool") {
      const tool = typeof request.tool === "string" ? request.tool : "";
      if (!tool) throw new Error("An MCP tool call needs the tool's name.");
      const args = isPlainRecord(request.args) ? request.args : {};
      return {
        result: await withConnectorBridgeCleanup(options.stellaAppDir, command, () =>
          callConnectorBridgeTool(options.stellaAppDir, command, tool, args),
        ),
      };
    }
  } catch (error) {
    if (error instanceof ConnectorAuthError) {
      throw new Error(
        `${command.displayName} needs sign-in again on this computer: have an agent here call its _authorize tool.`,
      );
    }
    throw error;
  }
  throw new Error("Unknown MCP request.");
};

// ---------------------------------------------------------------------------
// Discovery / listing surface (shared by the CLI and the REPL client)
// ---------------------------------------------------------------------------

export type DetailedDiscoveryMatch = {
  id: string;
  name: string;
  kind: "native" | "mcp" | "api";
  category?: string;
  description: string;
  enabled: boolean;
  connected: boolean;
  next: string;
  catalogSource?: NativeCatalogSource;
  provider?: NativeConnectorCatalogEntry["provider"];
  toolCount?: number;
  providerStatus?: string;
  accountVerified?: boolean;
  executable?: boolean;
};

/**
 * Discovery enriched with live connection state and a `next` hint per
 * match, so `connect.discover` tells the agent what to do with each
 * result instead of leaving it to guess.
 */
export const discoverConnectorsDetailed = async (
  options: ConnectClientOptions,
  query: string,
  resolved: ResolvedNativeCatalog,
): Promise<DetailedDiscoveryMatch[]> => {
  const { stellaAppDir } = options;
  await reconcileAccountMcp(options);
  const native = await listNativeConnectors(stellaAppDir, {}, resolved.entries);
  const enabledNativeIds = new Set(
    native.filter((entry) => entry.enabled).map((entry) => entry.id),
  );
  const matches = await discoverConnectors(stellaAppDir, query, {
    catalogOverride: resolved.entries,
    enabledNativeIds,
  });
  return await Promise.all(
    matches.map(async (match) => {
      let connected = false;
      let nativeEntry: NativeConnectorCatalogEntry | undefined;
      let nativeReadiness:
        | Awaited<ReturnType<typeof getNativeConnectorReadiness>>
        | undefined;
      if (match.kind === "native") {
        nativeEntry = getNativeConnectorCatalogEntry(
          match.id,
          resolved.entries,
        );
        nativeReadiness = nativeEntry
          ? await getNativeConnectorReadiness(stellaAppDir, nativeEntry)
          : undefined;
        connected = nativeReadiness?.executable ?? false;
      } else {
        const config =
          match.kind === "mcp"
            ? await findConnectorCommand(stellaAppDir, match.id)
            : await findConnectorApi(stellaAppDir, match.id);
        const authStatus = await connectorAuthStatus(
          stellaAppDir,
          config?.auth,
        );
        // "unsupported" means the connector needs no credential — it is
        // usable as-is.
        connected = authStatus === "connected" || authStatus === "unsupported";
      }
      const next = connected
        ? match.enabled
          ? `Ready. Its actions are tools: await tools.$search({ query: "${match.name}" }).`
          : `Connected but not enabled here. Enable it in the Store to get its tools.`
        : match.kind === "native"
          ? `Not connected. Connect offers are handled by the orchestrator's connector_status tool (inline connect card) or the Store — do not initiate one from here unless the user explicitly asked this turn. Proceed via the browser/computer fallback meanwhile.`
          : `Configured but not authorized. Its tools are in tools.$search once it is authorized; calling one asks the user for the credential.`;
      return {
        id: match.id,
        name: match.name,
        kind: match.kind,
        ...(match.category ? { category: match.category } : {}),
        description: match.description,
        enabled: match.enabled,
        connected,
        ...(match.kind === "native" && nativeEntry
          ? {
              ...nativeCatalogDiagnostics(
                nativeEntry,
                resolved.sources[nativeEntry.id] ?? resolved.source,
              ),
              providerStatus: nativeReadiness?.authStatus,
              accountVerified: nativeReadiness?.accountVerified ?? false,
              executable: nativeReadiness?.executable ?? false,
            }
          : {}),
        next,
      };
    }),
  );
};

const collapseLine = (value: string | undefined, max = 140): string => {
  const collapsed = (value ?? "").replace(/\s+/gu, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1)}…`;
};

export type ConnectorSummary = {
  id: string;
  name: string;
  kind: "native" | "mcp" | "api";
  connected: boolean;
  description: string;
  transport?: "stdio" | "streamable_http";
  /** MCP servers: where they run, for the agent and the user. */
  reach?: "anywhere" | "this-device" | "other-device";
  where?: string;
};

/** Enabled/connected connectors as one-liners (REPL `connect.connectors()`). */
export const listEnabledConnectorSummaries = async (
  options: ConnectClientOptions,
  resolved: ResolvedNativeCatalog,
): Promise<ConnectorSummary[]> => {
  const { stellaAppDir } = options;
  const elsewhere = await reconcileAccountMcp(options);
  const [native, commands, apis] = await Promise.all([
    listNativeConnectors(stellaAppDir, {}, resolved.entries),
    listConfiguredConnectorCommands(stellaAppDir).catch(() => []),
    listConfiguredApiConnectors(stellaAppDir).catch(() => []),
  ]);
  const summaries: ConnectorSummary[] = await Promise.all(
    native
      .filter((entry) => entry.enabled)
      .map(async (entry) => {
        const readiness = await getNativeConnectorReadiness(
          stellaAppDir,
          entry,
        );
        return {
          id: entry.id,
          name: entry.name,
          kind: "native" as const,
          connected: readiness.executable,
          description: collapseLine(entry.description),
        };
      }),
  );
  for (const command of commands) {
    const authStatus = await connectorAuthStatus(stellaAppDir, command.auth);
    summaries.push({
      id: command.id,
      name: command.displayName,
      kind: "mcp",
      connected: authStatus === "connected" || authStatus === "unsupported",
      description: collapseLine(command.description ?? command.url),
      transport: command.transport,
      reach: runsOnlyHere(command) ? "this-device" : "anywhere",
      where: localWhere(command),
    });
  }
  for (const server of elsewhere) {
    summaries.push({
      id: server.record.id,
      name: server.record.name,
      kind: "mcp",
      connected: server.online && server.acceptsWork,
      description: collapseLine(server.record.description ?? server.record.url),
      transport: server.record.transport,
      reach: "other-device",
      where: elsewhereWhere(server),
    });
  }
  for (const api of apis) {
    const authStatus = await connectorAuthStatus(stellaAppDir, api.auth);
    summaries.push({
      id: api.id,
      name: api.displayName,
      kind: "api",
      connected: authStatus === "connected" || authStatus === "unsupported",
      description: collapseLine(api.description),
    });
  }
  return summaries;
};

const BACKEND_ACTIONS_TTL_MS = 10 * 60_000;
const BACKEND_ACTIONS_MAX_PAGES = 50;
const backendActionsCache = new Map<
  string,
  { at: number; actions: Promise<ConnectorActionSource[]> }
>();
const mcpProbeFailures = new Map<string, { at: number; needsAuth: boolean }>();
const mcpProbeKey = (stellaAppDir: string, id: string) => `${stellaAppDir}\0${id}`;

const fetchBackendActions = async (
  socketPath: string,
  connectorId: string,
): Promise<ConnectorActionSource[]> => {
  const actions: ConnectorActionSource[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < BACKEND_ACTIONS_MAX_PAGES; page += 1) {
    const result = await requestBackendConnectorActionsFromBridge({
      socketPath,
      connectorId,
      limit: 100,
      timeoutMs: 20_000,
      ...(cursor ? { cursor } : {}),
    });
    if (!result.ok) {
      throw new Error(
        result.message ?? `The ${connectorId} action catalog is unavailable.`,
      );
    }
    actions.push(...result.actions);
    if (!result.nextCursor || result.actions.length === 0) break;
    cursor = result.nextCursor;
  }
  return actions;
};

const backendActions = (
  socketPath: string,
  connectorId: string,
): Promise<ConnectorActionSource[]> => {
  const key = `${socketPath}\0${connectorId}`;
  const cached = backendActionsCache.get(key);
  if (cached && Date.now() - cached.at < BACKEND_ACTIONS_TTL_MS) {
    return cached.actions;
  }
  const actions = fetchBackendActions(socketPath, connectorId);
  backendActionsCache.set(key, { at: Date.now(), actions });
  actions.catch(() => {
    if (backendActionsCache.get(key)?.actions === actions) {
      backendActionsCache.delete(key);
    }
  });
  return actions;
};

const withTimeout = <T>(task: Promise<T>, timeoutMs: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out")),
      timeoutMs,
    );
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

type McpToolsListing =
  | { tools: ConnectorToolInfo[] }
  | { needsAuth: true }
  | null;

const mcpToolsFor = async (
  options: ConnectClientOptions,
  command: ConnectorCommandConfig,
  cache: McpToolsCacheFile,
): Promise<McpToolsListing> => {
  const cached = cache.connectors[command.id];
  const key = mcpProbeKey(options.stellaAppDir, command.id);
  if (cached && Date.now() - cached.updatedAt < MCP_TOOLS_REFRESH_MS) {
    return { tools: cached.tools };
  }
  const failure = mcpProbeFailures.get(key);
  if (failure && Date.now() - failure.at < MCP_PROBE_RETRY_MS) {
    return cached ? { tools: cached.tools } : failure.needsAuth ? { needsAuth: true } : null;
  }
  try {
    const probe = await withTimeout(
      withConnectorBridgeCleanup(options.stellaAppDir, command, () =>
        probeConnectorBridgeTools(options.stellaAppDir, command),
      ),
      MCP_PROBE_TIMEOUT_MS,
    );
    mcpProbeFailures.delete(key);
    await rememberMcpTools(options.stellaAppDir, command.id, probe.tools).catch(
      () => undefined,
    );
    void reportMcpTools(
      options,
      command,
      probe.tools,
      (command.auth?.type ?? "none") !== "none",
    ).catch(() => undefined);
    return { tools: probe.tools };
  } catch (error) {
    const needsAuth = error instanceof ConnectorAuthError;
    mcpProbeFailures.set(key, { at: Date.now(), needsAuth });
    if (cached) return { tools: cached.tools };
    return needsAuth ? { needsAuth: true } : null;
  }
};

const isExecutableNativeTool = (
  entry: NativeConnectorCatalogEntry,
  tool: ConnectorToolInfo,
) => tool.name !== backendIntegrationRunToolName(entry.id);

export const listConnectorToolSources = async (
  options: ConnectClientOptions,
  resolved: ResolvedNativeCatalog,
): Promise<ConnectorToolSource[]> => {
  const { stellaAppDir } = options;
  const socketPath = options.cliBridgeSocketPath?.trim();
  const elsewhere = await reconcileAccountMcp(options);
  const [native, enabledIds, commands, apis, mcpCache] = await Promise.all([
    listNativeConnectors(stellaAppDir, {}, resolved.entries),
    listEnabledNativeConnectorIds(stellaAppDir),
    listConfiguredConnectorCommands(stellaAppDir).catch(() => []),
    listConfiguredApiConnectors(stellaAppDir).catch(() => []),
    readMcpToolsCache(stellaAppDir),
  ]);
  const nativeById = new Map(native.map((entry) => [entry.id, entry]));
  const nativeSources = await Promise.all(
    enabledIds.map(async (id): Promise<ConnectorToolSource | null> => {
      const entry = nativeById.get(id);
      if (!entry || entry.provider === "backend-composio") {
        if (entry?.actions?.length) {
          return { id, name: entry.name, kind: "native", actions: entry.actions };
        }
        if (!socketPath) return null;
        const actions = await backendActions(socketPath, id).catch(() => null);
        return actions
          ? { id, name: entry?.name ?? id, kind: "native", actions }
          : null;
      }
      if (entry.localExecution !== "production-ready") return null;
      const tools = getNativeConnectorTools(entry).filter((tool) =>
        isExecutableNativeTool(entry, tool),
      );
      if (tools.length === 0) return null;
      return {
        id,
        name: entry.name,
        kind: "native",
        actions: tools,
        ...(entry.toolPrefix
          ? { stripPrefixes: [entry.toolPrefix.replace(/\.+$/u, "")] }
          : {}),
      };
    }),
  );
  const mcpSources = await Promise.all(
    commands.map(async (command): Promise<ConnectorToolSource | null> => {
      const listing = await mcpToolsFor(options, command, mcpCache);
      if (!listing) return null;
      return {
        id: command.id,
        name: command.displayName,
        kind: "mcp",
        actions:
          "tools" in listing
            ? listing.tools
            : [
                {
                  name: MCP_AUTHORIZE_ACTION,
                  title: `Authorize ${command.displayName}`,
                  description: `Sign in to ${command.displayName} so its tools appear: asks the user for its credential, then returns the tool names.`,
                },
              ],
      };
    }),
  );
  const apiSources: ConnectorToolSource[] = apis.map((api) => ({
    id: api.id,
    name: api.displayName,
    kind: "api",
    actions: [
      {
        name: API_REQUEST_ACTION,
        title: `${api.displayName} API request`,
        description: `Call the ${api.displayName} API (${api.baseUrl}) with the connector's credential: path, method, query, body.`,
      },
    ],
  }));
  const elsewhereSources: ConnectorToolSource[] = elsewhere.map((server) => ({
    id: server.record.id,
    name: server.record.name,
    kind: "mcp",
    actions: server.record.tools?.length
      ? server.record.tools
      : [
          {
            name: MCP_AUTHORIZE_ACTION,
            title: `Authorize ${server.record.name}`,
            description: `${server.record.name} runs on ${server.deviceName}; its tools appear once that computer lists them.`,
          },
        ],
  }));
  return [...nativeSources, ...mcpSources, ...elsewhereSources, ...apiSources].filter(
    (source): source is ConnectorToolSource => source !== null,
  );
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const toStringRecord = (value: unknown): Record<string, string> | undefined =>
  isPlainRecord(value)
    ? Object.fromEntries(
        Object.entries(value).flatMap(([key, entry]) =>
          typeof entry === "string" ? [[key, entry]] : [],
        ),
      )
    : undefined;

const toQueryRecord = (
  value: unknown,
): Record<string, string | number | boolean> | undefined =>
  isPlainRecord(value)
    ? (Object.fromEntries(
        Object.entries(value).flatMap(([key, entry]) =>
          typeof entry === "string" ||
          typeof entry === "number" ||
          typeof entry === "boolean"
            ? [[key, entry]]
            : [],
        ),
      ) as Record<string, string | number | boolean>)
    : undefined;

/**
 * Execute a connector action with REPL-shaped arguments. `target` is an
 * action name, or (for REST-capable connectors) an API path beginning with
 * "/" whose `args` may carry `{ method, query, body, headers }`.
 */
export const callConnectorAction = async (
  options: ConnectClientOptions,
  id: string,
  target: string,
  args: Record<string, unknown>,
  resolved: ResolvedNativeCatalog,
): Promise<unknown> => {
  const pathArgs = () => {
    const { method, query, headers, body, ...rest } = args;
    return {
      body: isPlainRecord(body) ? body : rest,
      method: typeof method === "string" ? method : undefined,
      query: toQueryRecord(query),
      headers: toStringRecord(headers),
    };
  };
  const isKnownNative =
    getNativeConnectorCatalogEntry(id, resolved.entries) !== undefined;
  // An enabled id with a bridge socket may execute through the trusted
  // broker even when the local catalog cannot resolve it (fresh desktop
  // sign-in before the disk cache exists).
  const brokerEligible =
    !isKnownNative &&
    options.cliBridgeSocketPath?.trim() &&
    (await isNativeConnectorEnabled(options.stellaAppDir, id));
  if (isKnownNative || brokerEligible) {
    if (target.startsWith("/")) {
      return await callNativeConnector(
        options,
        id,
        target,
        pathArgs(),
        resolved.entries,
      );
    }
    return await callNativeConnector(
      options,
      id,
      target,
      { body: args },
      resolved.entries,
    );
  }
  if (target.startsWith("/")) {
    const api = await findConnectorApi(options.stellaAppDir, id);
    if (!api) throw new Error(`API connector is not installed: ${id}`);
    const { body, method, query, headers } = pathArgs();
    return await withAuthRetry(options, () =>
      callApiConnector(options.stellaAppDir, api, {
        method,
        path: target,
        query: query ?? {},
        body: Object.keys(body).length ? body : undefined,
        headers: headers ?? {},
      }),
    );
  }
  const command = await findConnectorCommand(options.stellaAppDir, id);
  if (!command) {
    throw new Error(
      `Connector is not installed: ${id}. Search with connect.discover("<keywords>").`,
    );
  }
  return await withConnectorBridgeCleanup(options.stellaAppDir, command, () =>
    withAuthRetry(options, () =>
      callConnectorBridgeTool(options.stellaAppDir, command, target, args),
    ),
  );
};

// ---------------------------------------------------------------------------
// node_repl `connect` client
// ---------------------------------------------------------------------------

export type ReplConnectClient = {
  discover(query: string): Promise<unknown>;
  connectors(): Promise<unknown>;
  addMcp(options: Record<string, unknown>): Promise<unknown>;
  remove(id: string): Promise<unknown>;
  tools(): Promise<ConnectorToolEntry[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  forCaller?(
    caller: ConnectorCaller,
    run?: Pick<ConnectClientOptions, "awaitUser" | "signal">,
  ): ReplConnectClient;
};

export type ReplConnectClientOptions = ConnectClientOptions & {
  reservedToolNames?: () => ReadonlySet<string>;
};

export const createReplConnectClient = (
  options: ReplConnectClientOptions,
): ReplConnectClient => {
  const catalog = () => loadConnectCatalog(options.stellaAppDir);
  const reserved = () => options.reservedToolNames?.() ?? new Set<string>();
  const tools = async () =>
    buildConnectorToolEntries(
      await listConnectorToolSources(options, await catalog()),
      reserved(),
    );
  return {
    forCaller: (caller, run) =>
      createReplConnectClient({ ...options, caller, ...run }),
    discover: async (query) => {
      const trimmed = typeof query === "string" ? query.trim() : "";
      if (!trimmed) {
        throw new Error("connect.discover requires a non-empty query string.");
      }
      const matches = await discoverConnectorsDetailed(
        options,
        trimmed,
        await catalog(),
      );
      return { query: trimmed, matches };
    },
    connectors: async () =>
      await listEnabledConnectorSummaries(options, await catalog()),
    tools,
    callTool: async (name, args) => {
      const entry = requireConnectorTool(await tools(), name);
      if (!isPlainRecord(args)) {
        throw new Error(invalidConnectorToolArgsMessage(name, "pass one plain object"));
      }
      const problem = validateConnectorToolArgs(entry.parameters, args);
      if (problem) {
        throw new Error(invalidConnectorToolArgsMessage(name, problem));
      }
      if (
        entry.kind === "mcp" &&
        !(await findConnectorCommand(options.stellaAppDir, entry.connector))
      ) {
        const elsewhere = (await reconcileAccountMcp(options)).find(
          (server) => server.record.id === entry.connector,
        );
        if (elsewhere) {
          if (entry.action === MCP_AUTHORIZE_ACTION) {
            throw new Error(
              `${entry.connectorName} runs on ${elsewhere.deviceName}; its tools appear here once that computer lists them (open Stella there).`,
            );
          }
          const value = await accountMcpCall(options, "call", {
            id: entry.connector,
            tool: entry.action,
            args,
          });
          return isPlainRecord(value) && "result" in value ? value.result : value;
        }
      }
      if (entry.action === MCP_AUTHORIZE_ACTION) {
        const command = await findConnectorCommand(
          options.stellaAppDir,
          entry.connector,
        );
        if (!command) throw new Error(`${entry.connectorName} is not installed.`);
        const probe = await probeMcpConnector(options, command);
        mcpProbeFailures.delete(mcpProbeKey(options.stellaAppDir, command.id));
        return {
          authorized: true,
          tools: buildConnectorToolEntries(
            [{ id: command.id, name: command.displayName, kind: "mcp", actions: probe.tools }],
            reserved(),
          ).map((tool) => tool.name),
        };
      }
      if (entry.action === API_REQUEST_ACTION) {
        const { path: apiPath, ...rest } = args as { path: string };
        if (!apiPath.startsWith("/")) {
          throw new Error(
            invalidConnectorToolArgsMessage(name, "args.path must begin with /"),
          );
        }
        return await callConnectorAction(
          options,
          entry.connector,
          apiPath,
          rest,
          await catalog(),
        );
      }
      return await callConnectorAction(
        options,
        entry.connector,
        entry.action,
        args,
        await catalog(),
      );
    },
    addMcp: async (addOptions) => {
      if (!isPlainRecord(addOptions)) {
        throw new Error("connect.addMcp requires an options object.");
      }
      return await addMcpConnector(options, addOptions, reserved());
    },
    remove: async (id) => {
      if (typeof id !== "string" || !id.trim()) {
        throw new Error("connect.remove requires a connector id.");
      }
      return await removeMcpConnector(options, id.trim(), await catalog());
    },
  };
};
