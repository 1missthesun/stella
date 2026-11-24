import { promises as fs } from "node:fs";
import path from "node:path";

import {
  deleteProtectedValue,
  protectValue,
  unprotectValue,
} from "../shared/protected-storage.js";
import { writePrivateFile } from "../shared/private-fs.js";

type TokenStore = {
  version: 2;
  tokens: Record<string, StoredConnectorTokenRecord>;
};

type StoredConnectorTokenRecord = {
  valueProtected: string;
  expiresAt?: number;
  clientId?: string;
  tokenEndpoint?: string;
  resourceUrl?: string;
  scopes?: string[];
};

export type ConnectorTokenPayload = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  clientId?: string;
  tokenEndpoint?: string;
  tokenExchange?: {
    type: "backend";
    endpoint: string;
    provider: string;
  };
  resourceUrl?: string;
  scopes?: string[];
};

const CONNECTOR_TOKEN_SCOPE_PREFIX = "connector-token";

const tokenFile = (stellaAppDir: string) =>
  path.join(stellaAppDir, "connectors", ".credentials.json");

const credentialScope = (tokenKey: string) =>
  `${CONNECTOR_TOKEN_SCOPE_PREFIX}:${tokenKey.trim().toLowerCase()}`;

const emptyStore = (): TokenStore => ({ version: 2, tokens: {} });

const isTokenStore = (value: unknown): value is TokenStore =>
  Boolean(
    value &&
      typeof value === "object" &&
      (value as TokenStore).version === 2 &&
      (value as TokenStore).tokens &&
      typeof (value as TokenStore).tokens === "object",
  );

const readTokenStore = async (stellaAppDir: string): Promise<TokenStore> => {
  const file = tokenFile(stellaAppDir);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw error;
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (isTokenStore(parsed)) return parsed;
  const quarantined = `${file}.corrupt-${Date.now()}`;
  await fs.rename(file, quarantined);
  console.warn("[connectors] Moved an unreadable credential store aside.", {
    quarantined: path.basename(quarantined),
    bytes: raw.length,
  });
  return emptyStore();
};

const writeTokenStore = (stellaAppDir: string, store: TokenStore) =>
  writePrivateFile(tokenFile(stellaAppDir), `${JSON.stringify(store, null, 2)}\n`);

const decodeTokenPayload = (
  tokenKey: string,
  record?: StoredConnectorTokenRecord,
): ConnectorTokenPayload | null => {
  if (!record?.valueProtected) return null;
  try {
    const raw = unprotectValue(credentialScope(tokenKey), record.valueProtected);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConnectorTokenPayload;
    if (parsed?.accessToken) return parsed;
  } catch {}
  return null;
};

export const readStoredConnectorToken = async (
  stellaAppDir: string,
  tokenKey: string,
): Promise<ConnectorTokenPayload | null> => {
  const store = await readTokenStore(stellaAppDir);
  return decodeTokenPayload(tokenKey, store.tokens[tokenKey]);
};

export const writeStoredConnectorToken = async (
  stellaAppDir: string,
  tokenKey: string,
  payload: ConnectorTokenPayload,
): Promise<void> => {
  const store = await readTokenStore(stellaAppDir);
  const existing = store.tokens[tokenKey];
  const valueProtected = protectValue(credentialScope(tokenKey), JSON.stringify(payload));
  store.tokens[tokenKey] = {
    valueProtected,
    ...(payload.expiresAt ? { expiresAt: payload.expiresAt } : {}),
    ...(payload.clientId ? { clientId: payload.clientId } : {}),
    ...(payload.tokenEndpoint ? { tokenEndpoint: payload.tokenEndpoint } : {}),
    ...(payload.resourceUrl ? { resourceUrl: payload.resourceUrl } : {}),
    ...(payload.scopes?.length ? { scopes: payload.scopes } : {}),
  };
  await writeTokenStore(stellaAppDir, store);
  if (existing?.valueProtected && existing.valueProtected !== valueProtected) {
    deleteProtectedValue(credentialScope(tokenKey), existing.valueProtected);
  }
};

export const deleteStoredConnectorTokens = async (
  stellaAppDir: string,
  tokenKeys: Iterable<string | undefined>,
): Promise<void> => {
  const keys = [...new Set([...tokenKeys].filter((key): key is string => Boolean(key)))];
  if (keys.length === 0) return;
  const store = await readTokenStore(stellaAppDir);
  let changed = false;
  for (const key of keys) {
    const existing = store.tokens[key];
    if (!existing) continue;
    deleteProtectedValue(credentialScope(key), existing.valueProtected);
    delete store.tokens[key];
    changed = true;
  }
  if (changed) await writeTokenStore(stellaAppDir, store);
};

export const saveConnectorAccessToken = (
  stellaAppDir: string,
  tokenKey: string,
  accessToken: string,
  expiresAt?: number,
) => writeStoredConnectorToken(stellaAppDir, tokenKey, { accessToken, expiresAt });
