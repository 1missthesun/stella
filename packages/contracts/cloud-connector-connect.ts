export const CLOUD_CONNECTOR_CONNECT_STATES = [
  "pending",
  "connecting",
  "connected",
  "declined",
  "canceled",
  "expired",
] as const;

export type CloudConnectorConnectState =
  (typeof CLOUD_CONNECTOR_CONNECT_STATES)[number];

export type CloudConnectorConnectDecision = "connect" | "decline";

export type CloudConnectorConnectRequest = Readonly<{
  schemaVersion: 1;
  requestId: string;
  conversationId: string;
  turnId: string;
  integrationId: string;
  name: string;
  description?: string;
  iconUrl?: string;
  category?: string;
  reason?: string;
  state: CloudConnectorConnectState;
  revision: number;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
}>;

export type CloudConnectorConnectDecisionResult = Readonly<{
  request: CloudConnectorConnectRequest;
  url?: string;
}>;
