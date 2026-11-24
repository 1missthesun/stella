import type { ConnectorTokenPayload } from "@stella/node-shared/connectors/token-store.js";

export type ConnectorTokenStoreBroker = {
  load: (tokenKey: string) => Promise<ConnectorTokenPayload | null>;
  save: (tokenKey: string, payload: ConnectorTokenPayload) => Promise<void>;
  delete: (tokenKeys: string[]) => Promise<void>;
};

let tokenStoreBroker: ConnectorTokenStoreBroker | null = null;

/**
 * Node-mode sidecar CLIs must not touch OS protected storage themselves:
 * macOS binds Electron Safe Storage access to the signed app identity and
 * otherwise presents a login-keychain password dialog that a background CLI
 * cannot service. The desktop installs an in-memory broker before reading any
 * connector credentials so encryption/decryption stays in the desktop host
 * and its configured stable protected-storage owner.
 */
export const setConnectorTokenStoreBroker = (
  broker: ConnectorTokenStoreBroker | null,
) => {
  tokenStoreBroker = broker;
};

export const getConnectorTokenStoreBroker = (): ConnectorTokenStoreBroker | null =>
  tokenStoreBroker;

export const hasConnectorTokenStoreBroker = (): boolean =>
  tokenStoreBroker !== null;
