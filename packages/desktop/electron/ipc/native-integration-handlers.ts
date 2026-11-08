import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";

import {
  disableNativeConnector,
  enableNativeConnector,
  getNativeConnectorCatalogEntry,
  getNativeConnectorOAuthConfig,
  listNativeConnectors,
  type NativeConnectorCatalogEntry,
} from "@stella/runtime/kernel/connectors/native-integrations";
import {
  resolveNativeConnectorCatalog,
  type ResolvedNativeCatalog,
} from "@stella/runtime/kernel/connectors/catalog-cache";
import {
  hasNativeOAuthProviderClientIdOverride,
  isNativeOAuthBlockedOnSelfHostedServer,
  isNativeOAuthProviderConfigReady,
} from "@stella/runtime/kernel/connectors/native-oauth-provider-config";
import {
  deleteConnectorAccessTokens,
  loadConnectorAccessToken,
} from "@stella/runtime/kernel/connectors/oauth";
import {
  hasConnectorAccount,
  listConnectorAccounts,
  recordConnectorAccount,
  removeConnectorAccount,
  setPrimaryConnectorAccount,
} from "@stella/runtime/kernel/connectors/accounts";
import {
  fetchBackendConnections,
  forgetBackendConnections,
  removeBackendAccount,
  setBackendPrimaryAccount,
} from "@stella/runtime/kernel/connectors/backend-accounts";
import {
  GOOGLE_WORKSPACE_ACCOUNTS,
  newGoogleWorkspacePendingTokenKey,
} from "@stella/runtime/kernel/google-workspace/accounts";
import { integrationSupportsMultipleAccounts } from "@stella/contracts/backend/integrations";
import {
  connectedAccountCountOf,
  waitForBackendIntegrationConnection,
} from "./backend-integration-status.js";
import { loadConfig } from "@stella/runtime/kernel/google-workspace/config";
import { SCOPES as GOOGLE_WORKSPACE_SCOPES } from "@stella/runtime/kernel/google-workspace/scopes";
import { assertPrivilegedRequest } from "./privileged-ipc.js";
import {
  IPC_NATIVE_INTEGRATIONS_LIST,
  IPC_NATIVE_INTEGRATIONS_ENABLE,
  IPC_NATIVE_INTEGRATIONS_DISABLE,
  IPC_NATIVE_INTEGRATIONS_ADD_ACCOUNT,
  IPC_NATIVE_INTEGRATIONS_SET_PRIMARY_ACCOUNT,
  IPC_NATIVE_INTEGRATIONS_REMOVE_ACCOUNT,
} from "@stella/contracts/desktop/ipc-channels";
import type { NativeIntegrationAccount } from "@stella/contracts/desktop/ipc-contract";
import { handleIpc } from "./typed-ipc.js";

export type NativeIntegrationHandlersOptions = {
  getStellaAppDir: () => string | null;
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
  }) => Promise<
    | { ok: true }
    | { ok: false; reason: "cancelled" | "timeout" | "unsupported" | string }
  >;
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
  }) => Promise<
    | { ok: true }
    | { ok: false; reason: "cancelled" | "timeout" | "unsupported" | string }
  >;
  requestExternalOAuthApproval?: (payload: {
    tokenKey: string;
    displayName: string;
    resourceUrl: string;
    description?: string;
  }) => Promise<
    | { ok: true }
    | { ok: false; reason: "cancelled" | "timeout" | "unsupported" | string }
  >;
  disconnectGoogleWorkspace?: () => Promise<{ ok: boolean }>;
  getAuthToken?: () => Promise<string | null>;
  getBackendUrl?: () => string | null;
  assertPrivilegedSender: (
    event: IpcMainEvent | IpcMainInvokeEvent,
    channel: string,
  ) => boolean;
};

export type NativeCredentialFlowOptions = Pick<
  NativeIntegrationHandlersOptions,
  | "requestPreregisteredOAuth"
  | "requestDeviceOAuth"
  | "requestExternalOAuthApproval"
  | "getAuthToken"
  | "getBackendUrl"
> & {
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

const requireRoot = (options: NativeIntegrationHandlersOptions) => {
  const stellaAppDir = options.getStellaAppDir();
  if (!stellaAppDir) throw new Error("Stella root is unavailable.");
  return stellaAppDir;
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
  options: NativeIntegrationHandlersOptions,
  payload: unknown,
  change: "primary" | "remove",
) => {
  const stellaAppDir = requireRoot(options);
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

export const registerNativeIntegrationHandlers = (
  options: NativeIntegrationHandlersOptions,
) => {
  handleIpc(IPC_NATIVE_INTEGRATIONS_LIST, async (event) => {
    assertPrivilegedRequest(options, event, IPC_NATIVE_INTEGRATIONS_LIST);
    const configuredOAuthProviders =
      await loadConfiguredOAuthProviders(options);
    const catalog = await resolveDesktopNativeConnectorCatalog(
      options,
      requireRoot(options),
    );
    return await listWithAccounts(
      options,
      requireRoot(options),
      await listNativeConnectors(
        requireRoot(options),
        {
          configuredBackendProviders: configuredOAuthProviders.backend,
          configuredExternalCallbackProviders:
            configuredOAuthProviders.externalCallback,
        },
        catalog.entries,
      ),
    );
  });

  const refreshedEntry = async (stellaAppDir: string, id: string) => {
    const configuredOAuthProviders =
      await loadConfiguredOAuthProviders(options);
    const catalog = await resolveDesktopNativeConnectorCatalog(
      options,
      stellaAppDir,
    );
    const list = await listNativeConnectors(
      stellaAppDir,
      {
        configuredBackendProviders: configuredOAuthProviders.backend,
        configuredExternalCallbackProviders:
          configuredOAuthProviders.externalCallback,
      },
      catalog.entries,
    );
    const entry = list.find((candidate) => candidate.id === id);
    if (!entry) throw new Error("Unknown integration.");
    return (await listWithAccounts(options, stellaAppDir, [entry]))[0]!;
  };

  handleIpc(
    IPC_NATIVE_INTEGRATIONS_ADD_ACCOUNT,
    async (event, payload: unknown) => {
      assertPrivilegedRequest(
        options,
        event,
        IPC_NATIVE_INTEGRATIONS_ADD_ACCOUNT,
      );
      const stellaAppDir = requireRoot(options);
      const id = readId(payload);
      await ensureNativeCredential(options, stellaAppDir, id, undefined, {
        addAccount: true,
      });
      return await refreshedEntry(stellaAppDir, id);
    },
  );

  handleIpc(
    IPC_NATIVE_INTEGRATIONS_SET_PRIMARY_ACCOUNT,
    async (event, payload: unknown) => {
      assertPrivilegedRequest(
        options,
        event,
        IPC_NATIVE_INTEGRATIONS_SET_PRIMARY_ACCOUNT,
      );
      const stellaAppDir = requireRoot(options);
      await changeNativeIntegrationAccount(options, payload, "primary");
      return await refreshedEntry(stellaAppDir, readId(payload));
    },
  );

  handleIpc(
    IPC_NATIVE_INTEGRATIONS_REMOVE_ACCOUNT,
    async (event, payload: unknown) => {
      assertPrivilegedRequest(
        options,
        event,
        IPC_NATIVE_INTEGRATIONS_REMOVE_ACCOUNT,
      );
      const stellaAppDir = requireRoot(options);
      await changeNativeIntegrationAccount(options, payload, "remove");
      return await refreshedEntry(stellaAppDir, readId(payload));
    },
  );

  handleIpc(IPC_NATIVE_INTEGRATIONS_ENABLE, async (event, payload: unknown) => {
    assertPrivilegedRequest(options, event, IPC_NATIVE_INTEGRATIONS_ENABLE);
    const stellaAppDir = requireRoot(options);
    const id = readId(payload);
    await ensureNativeCredential(options, stellaAppDir, id);
    const configuredOAuthProviders =
      await loadConfiguredOAuthProviders(options);
    const catalog = await resolveDesktopNativeConnectorCatalog(
      options,
      stellaAppDir,
    );
    const enabled = await enableNativeConnector(
      stellaAppDir,
      id,
      "store",
      {
        configuredBackendProviders: configuredOAuthProviders.backend,
        configuredExternalCallbackProviders:
          configuredOAuthProviders.externalCallback,
      },
      catalog.entries,
    );
    return (await listWithAccounts(options, stellaAppDir, [enabled]))[0]!;
  });

  handleIpc(
    IPC_NATIVE_INTEGRATIONS_DISABLE,
    async (event, payload: unknown) => {
      assertPrivilegedRequest(options, event, IPC_NATIVE_INTEGRATIONS_DISABLE);
      const stellaAppDir = requireRoot(options);
      const id = readId(payload);
      const configuredOAuthProviders =
        await loadConfiguredOAuthProviders(options);
      const catalog = await resolveDesktopNativeConnectorCatalog(
        options,
        stellaAppDir,
      );
      const result = await disableNativeConnector(
        stellaAppDir,
        id,
        {
          configuredBackendProviders: configuredOAuthProviders.backend,
          configuredExternalCallbackProviders:
            configuredOAuthProviders.externalCallback,
        },
        catalog.entries,
      );
      const entry = getNativeConnectorCatalogEntry(id, catalog.entries);
      if (
        entry?.provider === "google-workspace" &&
        options.disconnectGoogleWorkspace
      ) {
        const remaining = await listNativeConnectors(
          stellaAppDir,
          {},
          catalog.entries,
        );
        const stillEnabledGoogle = remaining.some(
          (connector) =>
            connector.provider === "google-workspace" && connector.enabled,
        );
        if (!stillEnabledGoogle) {
          await options.disconnectGoogleWorkspace();
        }
      }
      return (await listWithAccounts(options, stellaAppDir, [result]))[0]!;
    },
  );
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
