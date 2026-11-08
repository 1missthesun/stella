import type {
  CloudConnectorConnectDecision,
  CloudConnectorConnectDecisionResult,
  CloudConnectorConnectRequest,
} from "../cloud-connector-connect.js";

export const X_OAUTH_CALLBACK_PATH = "/api/x/oauth_callback";
export const X_FINISH_CONNECT_PATH = "/api/x/finish";
export const GOOGLE_OAUTH_CALLBACK_PATH = "/api/google/oauth_callback";
export const FINISH_CONNECT_PATH = "/api/native-integrations/finish-connect";

/**
 * A finished Google sign-in waits under a one-time code until the Stella app
 * of whoever approved it redeems the code as its own signed-in user, so a
 * forwarded connect link can never attach someone else's account. The
 * callback page hands the code to the local app with this link.
 */
const CONNECT_CLAIM_HOST = "connect";
const CONNECT_CODE_PATTERN = /^[0-9A-Za-z]{4}(-?[0-9A-Za-z]{4}){2}$/u;

export const connectClaimLink = (code: string): string =>
  `stella://${CONNECT_CLAIM_HOST}?code=${encodeURIComponent(code)}`;

export const parseConnectClaimLink = (raw: string): string | null => {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const scheme = url.protocol.replace(/:$/u, "").toLowerCase();
  if (scheme !== "stella" && scheme !== "stella-mobile") return null;
  const host = url.hostname || url.pathname.replace(/^\/+/u, "").split("/")[0];
  if (host?.toLowerCase() !== CONNECT_CLAIM_HOST) return null;
  const code = (url.searchParams.get("code") ?? "").trim();
  return CONNECT_CODE_PATTERN.test(code) ? code : null;
};

export type IntegrationConnector = {
  /** "stella": Google services Stella connects with its own Google app. */
  type: "composio" | "stella";
  toolkit: string;
  actionNamespace?: string;
  provider?: string;
};

export type IntegrationCatalogEntry = {
  id: string;
  name: string;
  provider: string;
  category: string;
  auth: string[];
  catalogToolCount: number;
  description: string;
  sourceUrl?: string;
  iconUrl?: string;
  status: string;
  enabled: boolean;
  updatedAt: number;
  connector?: IntegrationConnector;
};

export type IntegrationAction = {
  name: string;
  title?: string;
  description?: string;
  annotations?: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    source: "composio_tool_tags";
  };
  revision: string;
  inputSchema: Record<string, unknown>;
};

export type IntegrationActionsPage = {
  id: string;
  actionCount: number;
  updatedAt: number;
  actions: IntegrationAction[];
  nextCursor: string | null;
};

export type XConnection = {
  xUserId: string;
  username: string;
  name?: string;
  scopes: string[];
  updatedAt: number;
  accessTokenExpiresAt?: number;
};

export type IntegrationAccount = {
  id: string;
  email?: string;
  label: string;
  primary: boolean;
  connected: boolean;
};

export type IntegrationConnection = {
  id: string;
  connected: boolean;
  multiAccount?: boolean;
  accounts?: IntegrationAccount[];
};

/** Integrations whose users may connect several accounts at once (one per email). */
export const integrationSupportsMultipleAccounts = (id: string): boolean => {
  const normalized = id.trim().toLowerCase();
  return normalized === "gmail" || (normalized.startsWith("google") && normalized !== "googleads");
};

/** Who connects a user's Google account: Stella's own Google app (default) or Composio. */
export type GoogleConnectionProvider = "stella" | "composio";

export type GoogleProviderState = {
  provider: GoogleConnectionProvider;
  /** Google integrations this user already connected through Composio; they keep working. */
  composioConnected: string[];
};

/** Google integrations Stella can connect with its own Google app instead of Composio. */
export const isGoogleIntegration = (id: string): boolean => {
  const normalized = id.trim().toLowerCase();
  return normalized === "gmail" || (normalized.startsWith("google") && normalized !== "googleads");
};

export type IntegrationCalls = {
  "integrations.catalog": {
    args: Record<string, never>;
    result: { integrations: IntegrationCatalogEntry[] };
  };
  "integrations.actions": {
    args: { id: string; action?: string; query?: string; cursor?: string; limit?: number };
    result: IntegrationActionsPage;
  };
  "integrations.connections": {
    args: Record<string, never>;
    result: { connections: IntegrationConnection[] };
  };
  "integrations.status": {
    args: { id: string };
    result: { connected: boolean; accounts?: IntegrationAccount[] };
  };
  "integrations.connectLink": {
    args: { id: string; addAccount?: boolean };
    result: { url: string };
  };
  "integrations.run": {
    args: {
      id: string;
      action: string;
      input: Record<string, unknown>;
      requestId: string;
      account?: string;
    };
    result: unknown;
  };
  "integrations.finishConnect": {
    args: { connectCode: string };
    result: { email: string };
  };
  "integrations.googleProvider": {
    args: Record<string, never>;
    result: GoogleProviderState;
  };
  "integrations.setGoogleProvider": {
    args: { provider: GoogleConnectionProvider };
    result: GoogleProviderState;
  };
  "integrations.setPrimaryAccount": {
    args: { id: string; account: string };
    result: { accounts: IntegrationAccount[] };
  };
  "integrations.removeAccount": {
    args: { id: string; account: string };
    result: { accounts: IntegrationAccount[] };
  };
  "connect.decide": {
    args: {
      requestId: string;
      expectedRevision: number;
      decisionRequestId: string;
      decision: CloudConnectorConnectDecision;
    };
    result: CloudConnectorConnectDecisionResult;
  };
  "x.connectUrl": {
    args: Record<string, never>;
    result: { url: string; expiresAt: number };
  };
  "x.finishConnect": {
    args: { connectCode: string };
    result: { username: string };
  };
  "slack.redeemInstallClaim": {
    args: { code: string };
    result: { teamId: string; installer: string } | null;
  };
  "x.connections": {
    args: Record<string, never>;
    result: { connections: XConnection[] };
  };
  "x.request": {
    args: {
      method?: string;
      path: string;
      query?: Record<string, unknown>;
      body?: unknown;
    };
    result: { status: number; payload: unknown };
  };
};

export type IntegrationViews = {
  "connect.pending": {
    args: Record<string, never>;
    result: CloudConnectorConnectRequest[];
  };
};
