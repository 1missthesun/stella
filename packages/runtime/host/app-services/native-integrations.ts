import {
  disableNativeConnector,
  enableNativeConnector,
  getNativeConnectorCatalogEntry,
  getNativeConnectorOAuthConfig,
  getNativeConnectorTools,
  listNativeConnectors,
  type NativeConnectorCatalogEntry,
} from "../../kernel/connectors/native-integrations.js";
import {
  resolveNativeConnectorCatalog,
  type ResolvedNativeCatalog,
} from "../../kernel/connectors/catalog-cache.js";
import {
  hasNativeOAuthProviderClientIdOverride,
  isNativeOAuthBlockedOnSelfHostedServer,
  isNativeOAuthProviderConfigReady,
} from "../../kernel/connectors/native-oauth-provider-config.js";
import {
  deleteConnectorAccessTokens,
  loadConnectorAccessToken,
} from "../../kernel/connectors/oauth.js";
import {
  hasConnectorAccount,
  listConnectorAccounts,
  recordConnectorAccount,
  removeConnectorAccount,
  setPrimaryConnectorAccount,
} from "../../kernel/connectors/accounts.js";
import {
  fetchBackendConnections,
  forgetBackendConnections,
  removeBackendAccount,
  setBackendPrimaryAccount,
} from "../../kernel/connectors/backend-accounts.js";
import {
  GOOGLE_WORKSPACE_ACCOUNTS,
  newGoogleWorkspacePendingTokenKey,
} from "../../kernel/google-workspace/accounts.js";
import { integrationSupportsMultipleAccounts } from "@stella/contracts/backend/integrations";
import {
  connectedAccountCountOf,
  waitForBackendIntegrationConnection,
} from "./backend-integration-status.js";
import { loadConfig } from "../../kernel/google-workspace/config.js";
import { SCOPES as GOOGLE_WORKSPACE_SCOPES } from "../../kernel/google-workspace/scopes.js";
import type { NativeIntegrationAccount } from "@stella/contracts/desktop/ipc-contract";

type SignInOutcome =
  | { ok: true }
  | { ok: false; reason: "cancelled" | "timeout" | "unsupported" | string };

export type NativeCredentialFlowOptions = {
  requestPreregisteredOAuth?: (payload: {
    tokenKey: string;
    displayName: string;
    clientId: string;
    authorizationEndpoint: string;
    tokenEndpoint?: string;
    responseType?: "code" | "token";
    scopes?: string[];
    resourceUrl?: string;
    oauthResource?: string | null;
    callbackUrl?: string;
    callbackId?: string;
    callbackMode?: "local" | "external";
    scopeSeparator?: string;
    usesPkce?: boolean;
    authorizationRedirectParam?: string;
    authorizationParams?: Record<string, string>;
    tokenRedirectParam?: string;
    tokenAuth?: "body" | "basic";
    tokenExchange?: {
      type: "backend";
      provider: string;
    };
    description?: string;
  }) => Promise<SignInOutcome>;
  requestDeviceOAuth?: (payload: {
    tokenKey: string;
    displayName: string;
    clientId: string;
    deviceAuthorizationEndpoint: string;
    tokenEndpoint: string;
    scopes?: string[];
    resourceUrl?: string;
    verificationUri?: string;
    description?: string;
  }) => Promise<SignInOutcome>;
  requestExternalOAuthApproval?: (payload: {
    tokenKey: string;
    displayName: string;
    resourceUrl: string;
    description?: string;
  }) => Promise<SignInOutcome>;
  getAuthToken?: () => Promise<string | null>;
  getBackendUrl?: () => string | null;
  abortSignal?: AbortSignal;
};

type BackendOAuthProvidersResponse = {
  providers?: Array<{
    id?: unknown;
    clientId?: unknown;
    externalCallbackReady?: unknown;
  }>;
};

type ConfiguredOAuthProviderSets = {
  backend: ReadonlySet<string>;
  externalCallback: ReadonlySet<string>;
};

const readId = (payload: unknown) => {
  const id =
    payload && typeof payload === "object"
      ? (payload as { id?: unknown }).id
      : undefined;
  if (typeof id !== "string" || !id.trim()) {
    throw new Error("Missing integration id.");
  }
  return id.trim();
};

const emptyConfiguredOAuthProviders = (): ConfiguredOAuthProviderSets => ({
  backend: new Set(),
  externalCallback: new Set(),
});

export const loadConfiguredOAuthProviders = async (
  options: NativeCredentialFlowOptions,
) => {
  const backendUrl = options.getBackendUrl?.()?.trim().replace(/\/+$/u, "");
  if (!backendUrl) return emptyConfiguredOAuthProviders();
  const authToken = await options.getAuthToken?.();
  if (!authToken) return emptyConfiguredOAuthProviders();
  const response = await fetch(`${backendUrl}/api/native-oauth/providers`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${authToken}`,
    },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!response?.ok) return emptyConfiguredOAuthProviders();
  const payload = (await response
    .json()
    .catch(() => null)) as BackendOAuthProvidersResponse | null;
  const backend = new Set<string>();
  const externalCallback = new Set<string>();
  for (const provider of payload?.providers ?? []) {
    const id =
      typeof provider.id === "string" ? provider.id.trim().toLowerCase() : "";
    if (!id) continue;
    backend.add(id);
    if (provider.externalCallbackReady !== false) externalCallback.add(id);
  }
  return { backend, externalCallback };
};

const createBackendIntegrationConnectLink = async (
  auth: { backendUrl: string; authToken: string },
  id: string,
  signal?: AbortSignal,
  addAccount?: boolean,
) => {
  const { backendUrl, authToken } = auth;
  const timeout = AbortSignal.timeout(30_000);
  const response = await fetch(
    `${backendUrl}/api/native-integrations/connect-link`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ id, ...(addAccount ? { addAccount: true } : {}) }),
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
    },
  ).catch(() => {
    throw new Error(
      "Stella's backend did not respond while creating the connection link.",
    );
  });
  const payload = (await response.json().catch(() => null)) as {
    url?: unknown;
    error?: unknown;
    message?: unknown;
  } | null;
  if (!response.ok) {
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : typeof payload?.message === "string"
          ? payload.message
          : "Could not start this connection.";
    throw new Error(message);
  }
  const url = typeof payload?.url === "string" ? payload.url.trim() : "";
  if (!url) throw new Error("Stella backend did not return a connect link.");
  return url;
};

export const resolveDesktopNativeConnectorCatalog = async (
  options: NativeCredentialFlowOptions,
  stellaAppDir: string,
): Promise<ResolvedNativeCatalog> =>
  resolveNativeConnectorCatalog({
    stellaDataDir: stellaAppDir,
    getBackendAuth: async () => {
      const baseUrl = options.getBackendUrl?.()?.trim().replace(/\/+$/u, "");
      const authToken = (await options.getAuthToken?.())?.trim() ?? "";
      return baseUrl && authToken ? { baseUrl, authToken } : null;
    },
  });

export const resolveDesktopNativeConnectorEntry = async (
  options: NativeCredentialFlowOptions,
  stellaAppDir: string,
  id: string,
) => {
  const catalog = await resolveDesktopNativeConnectorCatalog(
    options,
    stellaAppDir,
  );
  return {
    catalog,
    entry: getNativeConnectorCatalogEntry(id, catalog.entries),
  };
};

export type ResolvedNativeCredentialTarget = {
  catalog: ResolvedNativeCatalog;
  entry: NativeConnectorCatalogEntry;
};

export const ensureNativeCredential = async (
  options: NativeCredentialFlowOptions,
  stellaAppDir: string,
  id: string,
  acceptedTarget?: ResolvedNativeCredentialTarget,
  flow: { addAccount?: boolean } = {},
) => {
  const configuredOAuthProviders = await loadConfiguredOAuthProviders(options);
  const entry = acceptedTarget
    ? acceptedTarget.entry
    : (await resolveDesktopNativeConnectorEntry(options, stellaAppDir, id))
        .entry;
  if (acceptedTarget && acceptedTarget.entry.id !== id) {
    throw new Error("Accepted connector snapshot does not match the request.");
  }
  if (entry?.provider === "google-workspace") {
    if (
      !flow.addAccount &&
      (await hasConnectorAccount(stellaAppDir, GOOGLE_WORKSPACE_ACCOUNTS))
    ) {
      return;
    }
    if (!options.requestPreregisteredOAuth) {
      throw new Error("Google Workspace connection is unavailable.");
    }
    const config = loadConfig();
    if (!configuredOAuthProviders.backend.has("google-workspace")) {
      throw new Error("Google Workspace secure connection is not ready yet.");
    }
    const pendingTokenKey = newGoogleWorkspacePendingTokenKey();
    const connected = await options.requestPreregisteredOAuth({
      tokenKey: pendingTokenKey,
      displayName: "Google Workspace",
      clientId: config.clientId,
      authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenEndpoint: "https://oauth2.googleapis.com/token",
      scopes: GOOGLE_WORKSPACE_SCOPES,
      authorizationParams: { prompt: "select_account consent" },
      tokenExchange: {
        type: "backend",
        provider: "google-workspace",
      },
      description:
        "Stella needs to open Google in your browser so you can sign in and approve Workspace access.",
    });
    if (!connected.ok) {
      await deleteConnectorAccessTokens(stellaAppDir, [pendingTokenKey]).catch(
        () => undefined,
      );
      throw new Error(
        `Could not connect Google Workspace: ${connected.reason}`,
      );
    }
    await recordConnectorAccount(
      stellaAppDir,
      GOOGLE_WORKSPACE_ACCOUNTS,
      pendingTokenKey,
    );
    return;
  }

  if (entry?.provider === "backend-composio") {
    if (!options.requestExternalOAuthApproval) {
      throw new Error(`${entry.name} connection is unavailable.`);
    }
    const backendUrl = options.getBackendUrl?.()?.trim().replace(/\/+$/u, "");
    if (!backendUrl) throw new Error("Stella backend is unavailable.");
    const authToken = await options.getAuthToken?.();
    if (!authToken) {
      throw new Error(`Sign in to Stella before connecting ${entry.name}.`);
    }
    const addAccount =
      flow.addAccount === true && integrationSupportsMultipleAccounts(id);
    const baseline = addAccount
      ? connectedAccountCountOf(
          (
            await fetchBackendConnections(
              { baseUrl: backendUrl, authToken },
              { fresh: true },
            ).catch(() => [])
          ).find((row) => row.id === id),
        )
      : 0;
    const url = await createBackendIntegrationConnectLink(
      { backendUrl, authToken },
      id,
      options.abortSignal,
      addAccount,
    );
    const approved = await options.requestExternalOAuthApproval({
      tokenKey: `backend-integration:${id}`,
      displayName: entry.name,
      resourceUrl: url,
      description: `Stella needs to open ${entry.name} in your browser so you can sign in and approve access.`,
    });
    if (!approved.ok) {
      throw new Error(`Could not connect ${entry.name}: ${approved.reason}`);
    }
    const wait = await waitForBackendIntegrationConnection({
      backendUrl,
      authToken,
      id,
      ...(addAccount ? { minConnectedAccounts: baseline + 1 } : {}),
      ...(options.abortSignal ? { signal: options.abortSignal } : {}),
    });
    forgetBackendConnections();
    if (wait === "connected") return;
    if (wait === "unsupported") {
      throw new Error(
        `This Stella server can't confirm ${entry.name} connections. Update the server, then try connecting again.`,
      );
    }
    if (wait === "cancelled") {
      throw new Error(`Could not connect ${entry.name}: cancelled`);
    }
    if (wait === "auth_unavailable") {
      throw new Error(
        `Could not confirm the ${entry.name} connection because Stella's sign-in expired. Sign in and try connecting again.`,
      );
    }
    throw new Error(
      `${entry.name} authorization was not completed in the browser. Finish signing in on the ${entry.name} page that opened, then try connecting again.`,
    );
  }

  if (entry?.provider === "oauth-catalog") {
    const config = getNativeConnectorOAuthConfig(entry);
    if (!config) {
      throw new Error(
        `${entry.name} supports OAuth, but Stella's provider setup is not ready yet.`,
      );
    }
    if (
      !isNativeOAuthProviderConfigReady(id, config, {
        configuredBackendProviders: configuredOAuthProviders.backend,
        configuredExternalCallbackProviders:
          configuredOAuthProviders.externalCallback,
      })
    ) {
      if (isNativeOAuthBlockedOnSelfHostedServer(config)) {
        throw new Error(
          `${entry.name} signs in through stella.sh, so it's off on your own server.`,
        );
      }
      if (config.tokenExchange?.type === "backend") {
        const tokenExchangeProvider = (config.tokenExchange.provider ?? id)
          .trim()
          .toLowerCase();
        const hasExplicitOAuthApp =
          hasNativeOAuthProviderClientIdOverride(id) ||
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
        config.flow === "authorization_code" &&
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
    if (await loadConnectorAccessToken(stellaAppDir, config.tokenKey)) return;
    const connected =
      config.flow === "device"
        ? await options.requestDeviceOAuth?.({
            tokenKey: config.tokenKey,
            displayName: entry.name,
            clientId: config.clientId,
            deviceAuthorizationEndpoint: config.deviceAuthorizationEndpoint,
            tokenEndpoint: config.tokenEndpoint!,
            scopes: config.scopes,
            resourceUrl: config.resourceUrl,
            verificationUri: config.verificationUri,
            description: `Stella needs to open ${entry.name} in your browser. Enter the code shown here to approve access.`,
          })
        : await options.requestPreregisteredOAuth?.({
            tokenKey: config.tokenKey,
            displayName: entry.name,
            clientId: config.clientId,
            authorizationEndpoint: config.authorizationEndpoint,
            tokenEndpoint: config.tokenEndpoint,
            responseType: config.responseType,
            scopes: config.scopes,
            resourceUrl: config.resourceUrl,
            oauthResource: config.oauthResource,
            callbackUrl: config.callbackUrl,
            callbackId: config.callbackId,
            callbackMode: config.callbackMode,
            scopeSeparator: config.scopeSeparator,
            usesPkce: config.usesPkce,
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
            description: `Stella needs to open ${entry.name} in your browser so you can sign in and approve access.`,
          });
    if (!connected) {
      throw new Error(`${entry.name} connection is unavailable.`);
    }
    if (!connected.ok) {
      throw new Error(`Could not connect ${entry.name}: ${connected.reason}`);
    }
    return;
  }

  throw new Error(
    `${entry?.name ?? id} is not available as an OAuth Store integration yet.`,
  );
};

const readAccountArg = (payload: unknown) => {
  const account =
    payload && typeof payload === "object"
      ? (payload as { account?: unknown }).account
      : undefined;
  if (typeof account !== "string" || !account.trim()) {
    throw new Error("Missing account.");
  }
  return account.trim();
};

const backendAuthOf = async (options: NativeCredentialFlowOptions) => {
  const baseUrl = options.getBackendUrl?.()?.trim().replace(/\/+$/u, "");
  const authToken = (await options.getAuthToken?.())?.trim();
  return baseUrl && authToken ? { baseUrl, authToken } : null;
};

export const listNativeIntegrationAccounts = async (
  options: NativeCredentialFlowOptions,
  stellaAppDir: string,
  entries: readonly NativeConnectorCatalogEntry[],
): Promise<Map<string, NativeIntegrationAccount[]>> => {
  const result = new Map<string, NativeIntegrationAccount[]>();
  const googleEntries = entries.filter(
    (entry) => entry.provider === "google-workspace",
  );
  if (googleEntries.length > 0) {
    const accounts = await listConnectorAccounts(
      stellaAppDir,
      GOOGLE_WORKSPACE_ACCOUNTS,
    ).catch(() => []);
    for (const entry of googleEntries) {
      result.set(
        entry.id,
        accounts.map((account) => ({
          id: account.id,
          ...(account.email ? { email: account.email } : {}),
          label: account.label,
          primary: account.primary,
          connected: true,
        })),
      );
    }
  }
  const backendEntries = entries.filter(
    (entry) =>
      entry.provider === "backend-composio" &&
      integrationSupportsMultipleAccounts(entry.id),
  );
  if (backendEntries.length > 0) {
    const auth = await backendAuthOf(options);
    const connections = auth
      ? await fetchBackendConnections(auth).catch(() => [])
      : [];
    for (const entry of backendEntries) {
      result.set(
        entry.id,
        connections.find((row) => row.id === entry.id)?.accounts ?? [],
      );
    }
  }
  return result;
};

const changeNativeIntegrationAccount = async (
  options: NativeCredentialFlowOptions,
  stellaAppDir: string,
  payload: unknown,
  change: "primary" | "remove",
) => {
  const id = readId(payload);
  const account = readAccountArg(payload);
  const { entry } = await resolveDesktopNativeConnectorEntry(
    options,
    stellaAppDir,
    id,
  );
  if (entry?.provider === "google-workspace") {
    if (change === "primary") {
      await setPrimaryConnectorAccount(
        stellaAppDir,
        GOOGLE_WORKSPACE_ACCOUNTS,
        account,
      );
    } else {
      await removeConnectorAccount(
        stellaAppDir,
        GOOGLE_WORKSPACE_ACCOUNTS,
        account,
      );
    }
    return;
  }
  if (
    entry?.provider === "backend-composio" &&
    integrationSupportsMultipleAccounts(id)
  ) {
    const auth = await backendAuthOf(options);
    if (!auth)
      throw new Error(
        `Sign in to Stella before changing ${entry.name} accounts.`,
      );
    if (change === "primary") {
      await setBackendPrimaryAccount(auth, id, account);
    } else {
      await removeBackendAccount(auth, id, account);
    }
    return;
  }
  throw new Error(`${entry?.name ?? id} connects a single account.`);
};

const listWithAccounts = async <T extends NativeConnectorCatalogEntry>(
  options: NativeCredentialFlowOptions,
  stellaAppDir: string,
  entries: T[],
): Promise<
  Array<T & { multiAccount?: boolean; accounts?: NativeIntegrationAccount[] }>
> => {
  const accounts = await listNativeIntegrationAccounts(
    options,
    stellaAppDir,
    entries,
  );
  return entries.map((entry) => {
    const list = accounts.get(entry.id);
    return list ? { ...entry, multiAccount: true, accounts: list } : entry;
  });
};

const configuredProviderSets = async (options: NativeCredentialFlowOptions) => {
  const configured = await loadConfiguredOAuthProviders(options);
  return {
    configuredBackendProviders: configured.backend,
    configuredExternalCallbackProviders: configured.externalCallback,
  };
};

export const listNativeIntegrationsWithAccounts = async (
  options: NativeCredentialFlowOptions,
  stellaAppDir: string,
) => {
  const configured = await configuredProviderSets(options);
  const catalog = await resolveDesktopNativeConnectorCatalog(options, stellaAppDir);
  return await listWithAccounts(
    options,
    stellaAppDir,
    await listNativeConnectors(stellaAppDir, configured, catalog.entries),
  );
};

const refreshedEntry = async (
  options: NativeCredentialFlowOptions,
  stellaAppDir: string,
  id: string,
) => {
  const list = await listNativeIntegrationsWithAccounts(options, stellaAppDir);
  const entry = list.find((candidate) => candidate.id === id);
  if (!entry) throw new Error("Unknown integration.");
  return entry;
};

export const addNativeIntegrationAccount = async (
  options: NativeCredentialFlowOptions,
  stellaAppDir: string,
  payload: unknown,
) => {
  const id = readId(payload);
  await ensureNativeCredential(options, stellaAppDir, id, undefined, { addAccount: true });
  return await refreshedEntry(options, stellaAppDir, id);
};

export const changeNativeIntegrationAccountAndList = async (
  options: NativeCredentialFlowOptions,
  stellaAppDir: string,
  payload: unknown,
  change: "primary" | "remove",
) => {
  await changeNativeIntegrationAccount(options, stellaAppDir, payload, change);
  return await refreshedEntry(options, stellaAppDir, readId(payload));
};

export const enableNativeIntegration = async (
  options: NativeCredentialFlowOptions,
  stellaAppDir: string,
  payload: unknown,
) => {
  const id = readId(payload);
  await ensureNativeCredential(options, stellaAppDir, id);
  const configured = await configuredProviderSets(options);
  const catalog = await resolveDesktopNativeConnectorCatalog(options, stellaAppDir);
  const enabled = await enableNativeConnector(
    stellaAppDir,
    id,
    "store",
    configured,
    catalog.entries,
  );
  return (await listWithAccounts(options, stellaAppDir, [enabled]))[0]!;
};

export const disableNativeIntegration = async (
  options: NativeCredentialFlowOptions & {
    disconnectGoogleWorkspace?: () => Promise<unknown>;
  },
  stellaAppDir: string,
  payload: unknown,
) => {
  const id = readId(payload);
  const configured = await configuredProviderSets(options);
  const catalog = await resolveDesktopNativeConnectorCatalog(options, stellaAppDir);
  const result = await disableNativeConnector(stellaAppDir, id, configured, catalog.entries);
  const entry = getNativeConnectorCatalogEntry(id, catalog.entries);
  if (entry?.provider === "google-workspace" && options.disconnectGoogleWorkspace) {
    const remaining = await listNativeConnectors(stellaAppDir, {}, catalog.entries);
    const stillEnabledGoogle = remaining.some(
      (connector) => connector.provider === "google-workspace" && connector.enabled,
    );
    if (!stillEnabledGoogle) await options.disconnectGoogleWorkspace();
  }
  return (await listWithAccounts(options, stellaAppDir, [result]))[0]!;
};

const isCanonicalConnectorConnectable = (entry: NativeConnectorCatalogEntry | undefined) =>
  Boolean(
    entry &&
      entry.connectable &&
      getNativeConnectorTools(entry).length > 0 &&
      (entry.provider === "backend-composio" || entry.localExecution === "production-ready"),
  );

const connectorIdentityFingerprint = (target: ResolvedNativeCredentialTarget) => {
  const { entry, catalog } = target;
  return JSON.stringify({
    id: entry.id,
    catalogSource: catalog.sources[entry.id] ?? catalog.source,
    provider: entry.provider,
    backendToolkit: entry.backendConnector?.toolkit ?? null,
    localExecution: entry.localExecution ?? null,
    toolPrefix: entry.toolPrefix ?? null,
    tools: getNativeConnectorTools(entry).map((tool) => tool.name),
    connectable: entry.connectable,
    auth: [...entry.auth],
    catalogToolCount: entry.catalogToolCount,
    oauthConfig: entry.oauthConfig ?? null,
  });
};

export const describeConnectorOffer = async (
  options: NativeCredentialFlowOptions,
  stellaAppDir: string,
  id: string,
) => {
  const target = await resolveDesktopNativeConnectorEntry(options, stellaAppDir, id);
  const { entry } = target;
  if (!entry || !isCanonicalConnectorConnectable(entry)) {
    return { ok: false as const, reason: "connector_unavailable" };
  }
  return {
    ok: true as const,
    entry: {
      id: entry.id,
      name: entry.name,
      description: entry.description,
      iconUrl: entry.iconUrl,
      category: entry.category,
    },
    fingerprint: connectorIdentityFingerprint({ catalog: target.catalog, entry }),
  };
};

export const connectConnectorOffer = async (
  options: NativeCredentialFlowOptions,
  stellaAppDir: string,
  request: { id: string; name: string; fingerprint?: string; addAccount?: boolean },
) => {
  const target = await resolveDesktopNativeConnectorEntry(options, stellaAppDir, request.id);
  const { catalog, entry } = target;
  if (!entry || !isCanonicalConnectorConnectable(entry)) {
    throw new Error(
      `${request.name} is no longer available through an executable Store integration.`,
    );
  }
  const acceptedTarget = { catalog, entry };
  if (!request.fingerprint || connectorIdentityFingerprint(acceptedTarget) !== request.fingerprint) {
    throw new Error(
      `${request.name} connector changed while the card was open. Retry the connection.`,
    );
  }
  await ensureNativeCredential(options, stellaAppDir, entry.id, acceptedTarget, {
    addAccount: request.addAccount === true,
  });
  const configured = await configuredProviderSets(options);
  await enableNativeConnector(stellaAppDir, entry.id, "store", configured, catalog.entries);
};
