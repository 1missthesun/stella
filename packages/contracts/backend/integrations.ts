import type {
  CloudConnectorConnectDecision,
  CloudConnectorConnectDecisionResult,
  CloudConnectorConnectRequest,
} from "../cloud-connector-connect.js";

export const X_OAUTH_CALLBACK_PATH = "/api/x/oauth_callback";

export type IntegrationConnector = {
  type: "composio";
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
    result: { connections: Array<{ id: string; connected: boolean }> };
  };
  "integrations.status": {
    args: { id: string };
    result: { connected: boolean };
  };
  "integrations.connectLink": {
    args: { id: string };
    result: { url: string };
  };
  "integrations.run": {
    args: { id: string; action: string; input: Record<string, unknown>; requestId: string };
    result: unknown;
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
