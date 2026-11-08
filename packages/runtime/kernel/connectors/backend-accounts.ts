import type {
  GoogleConnectionProvider,
  GoogleProviderState,
  IntegrationAccount,
  IntegrationConnection,
} from "@stella/contracts/backend/integrations";

export type BackendSiteAuth = { baseUrl: string; authToken: string };

const CONNECTIONS_TTL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 30_000;

const cache = new Map<
  string,
  { at: number; connections: Promise<IntegrationConnection[]> }
>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const readAccount = (value: unknown): IntegrationAccount | null => {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    ...(typeof value.email === "string" && value.email
      ? { email: value.email }
      : {}),
    label:
      typeof value.label === "string" && value.label ? value.label : value.id,
    primary: value.primary === true,
    connected: value.connected === true,
  };
};

export const readBackendConnections = (
  payload: unknown,
): IntegrationConnection[] => {
  const rows =
    isRecord(payload) && Array.isArray(payload.connections)
      ? payload.connections
      : [];
  return rows.flatMap((row): IntegrationConnection[] => {
    if (!isRecord(row) || typeof row.id !== "string") return [];
    const accounts = Array.isArray(row.accounts)
      ? row.accounts
          .map(readAccount)
          .filter((account): account is IntegrationAccount => account !== null)
      : undefined;
    return [
      {
        id: row.id,
        connected: row.connected === true,
        ...(row.multiAccount === true ? { multiAccount: true } : {}),
        ...(accounts ? { accounts } : {}),
      },
    ];
  });
};

const backendRequest = async (
  auth: BackendSiteAuth,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown } = { method: "GET" },
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> => {
  const response = await fetchImpl(
    `${auth.baseUrl.replace(/\/+$/u, "")}${path}`,
    {
      method: init.method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${auth.authToken}`,
        ...(init.body !== undefined
          ? { "content-type": "application/json" }
          : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.error === "string" && payload.error
        ? payload.error
        : `Stella's backend answered ${response.status}.`;
    throw new Error(message);
  }
  return payload;
};

/** The signed-in account's Store connections, with each multi-account integration's accounts. */
export const fetchBackendConnections = (
  auth: BackendSiteAuth,
  options: { fresh?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<IntegrationConnection[]> => {
  const key = `${auth.baseUrl}\0${auth.authToken.slice(-16)}`;
  const cached = cache.get(key);
  if (!options.fresh && cached && Date.now() - cached.at < CONNECTIONS_TTL_MS) {
    return cached.connections;
  }
  const connections = backendRequest(
    auth,
    "/api/native-integrations/connections",
    { method: "GET" },
    options.fetchImpl,
  ).then(readBackendConnections);
  cache.set(key, { at: Date.now(), connections });
  connections.catch(() => {
    if (cache.get(key)?.connections === connections) cache.delete(key);
  });
  return connections;
};

export const forgetBackendConnections = () => cache.clear();

export const setBackendPrimaryAccount = async (
  auth: BackendSiteAuth,
  id: string,
  account: string,
): Promise<IntegrationAccount[]> => {
  const payload = await backendRequest(
    auth,
    "/api/native-integrations/accounts/primary",
    {
      method: "POST",
      body: { id, account },
    },
  );
  forgetBackendConnections();
  return isRecord(payload) && Array.isArray(payload.accounts)
    ? payload.accounts
        .map(readAccount)
        .filter((entry): entry is IntegrationAccount => entry !== null)
    : [];
};

export const removeBackendAccount = async (
  auth: BackendSiteAuth,
  id: string,
  account: string,
): Promise<IntegrationAccount[]> => {
  const payload = await backendRequest(
    auth,
    "/api/native-integrations/accounts/remove",
    {
      method: "POST",
      body: { id, account },
    },
  );
  forgetBackendConnections();
  return isRecord(payload) && Array.isArray(payload.accounts)
    ? payload.accounts
        .map(readAccount)
        .filter((entry): entry is IntegrationAccount => entry !== null)
    : [];
};

const readGoogleProviderState = (payload: unknown): GoogleProviderState => ({
  provider:
    isRecord(payload) && payload.provider === "composio"
      ? "composio"
      : "stella",
  composioConnected:
    isRecord(payload) && Array.isArray(payload.composioConnected)
      ? payload.composioConnected.filter(
          (id): id is string => typeof id === "string",
        )
      : [],
});

const googleProviderCache = new Map<
  string,
  { at: number; state: Promise<GoogleProviderState> }
>();

/** Whether this user connects Google through Stella's own app (default) or Composio. */
export const fetchGoogleProviderState = (
  auth: BackendSiteAuth,
  options: { fresh?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<GoogleProviderState> => {
  const key = `${auth.baseUrl}\0${auth.authToken.slice(-16)}`;
  const cached = googleProviderCache.get(key);
  if (!options.fresh && cached && Date.now() - cached.at < CONNECTIONS_TTL_MS) {
    return cached.state;
  }
  const state = backendRequest(
    auth,
    "/api/native-integrations/google-provider",
    { method: "GET" },
    options.fetchImpl,
  ).then(readGoogleProviderState);
  googleProviderCache.set(key, { at: Date.now(), state });
  state.catch(() => {
    if (googleProviderCache.get(key)?.state === state) {
      googleProviderCache.delete(key);
    }
  });
  return state;
};

export const setGoogleProvider = async (
  auth: BackendSiteAuth,
  provider: GoogleConnectionProvider,
): Promise<GoogleProviderState> => {
  const state = readGoogleProviderState(
    await backendRequest(auth, "/api/native-integrations/google-provider", {
      method: "POST",
      body: { provider },
    }),
  );
  googleProviderCache.clear();
  return state;
};
