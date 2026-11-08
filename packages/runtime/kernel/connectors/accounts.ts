import { promises as fs } from "node:fs";
import path from "node:path";

import {
  deleteConnectorAccessTokens,
  loadConnectorTokenPayload,
  saveConnectorTokenPayload,
  type ConnectorTokenPayload,
} from "./oauth.js";
import { getConnectorStateRoot } from "./state.js";
import { writePrivateFile } from "../shared/private-fs.js";

export type ConnectorAccount = {
  id: string;
  email?: string;
  tokenKey: string;
  addedAt: number;
};

export type ConnectorAccountSummary = {
  id: string;
  email?: string;
  label: string;
  primary: boolean;
};

type ProviderAccounts = {
  primary?: string;
  accounts: ConnectorAccount[];
};

type AccountsFile = {
  version: 1;
  providers: Record<string, ProviderAccounts>;
};

export type ConnectorAccountProvider = {
  provider: string;
  legacyTokenKey: string;
  displayName: string;
  resolveEmail: (payload: ConnectorTokenPayload) => Promise<string | null>;
};

const ACCOUNTS_FILE = "accounts.json";
const LEGACY_ACCOUNT_ID = "default";

const accountsPath = (stellaAppDir: string) =>
  path.join(getConnectorStateRoot(stellaAppDir), ACCOUNTS_FILE);

const normalizeEmail = (value: string) => value.trim().toLowerCase();

export const connectorAccountTokenKey = (provider: string, email: string) =>
  `${provider}:${normalizeEmail(email)}`;

const readAccounts = async (stellaAppDir: string): Promise<AccountsFile> => {
  try {
    const parsed = JSON.parse(
      await fs.readFile(accountsPath(stellaAppDir), "utf-8"),
    ) as AccountsFile;
    if (parsed?.version === 1 && parsed.providers) return parsed;
  } catch {
    // Missing or unreadable index: start empty.
  }
  return { version: 1, providers: {} };
};

const writeAccounts = async (stellaAppDir: string, file: AccountsFile) => {
  await writePrivateFile(
    accountsPath(stellaAppDir),
    `${JSON.stringify(file, null, 2)}\n`,
  );
};

const queues = new Map<string, Promise<unknown>>();

const withAccounts = async <T>(
  stellaAppDir: string,
  update: (file: AccountsFile) => Promise<T> | T,
): Promise<T> => {
  const key = accountsPath(stellaAppDir);
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(async () => {
      const file = await readAccounts(stellaAppDir);
      const before = JSON.stringify(file);
      const result = await update(file);
      if (JSON.stringify(file) !== before) {
        await writeAccounts(stellaAppDir, file);
      }
      return result;
    });
  queues.set(key, run);
  try {
    return await run;
  } finally {
    if (queues.get(key) === run) queues.delete(key);
  }
};

const ensurePrimary = (entry: ProviderAccounts) => {
  if (
    entry.primary &&
    entry.accounts.some((account) => account.id === entry.primary)
  ) {
    return;
  }
  entry.primary = entry.accounts[0]?.id;
};

const accountLabel = (account: ConnectorAccount, displayName: string) =>
  account.email ?? `${displayName} account`;

const summarize = (
  entry: ProviderAccounts | undefined,
  displayName: string,
): ConnectorAccountSummary[] =>
  (entry?.accounts ?? []).map((account) => ({
    id: account.id,
    ...(account.email ? { email: account.email } : {}),
    label: accountLabel(account, displayName),
    primary: account.id === entry?.primary,
  }));

const adoptLegacyToken = async (
  stellaAppDir: string,
  config: ConnectorAccountProvider,
) => {
  const legacy = await loadConnectorTokenPayload(
    stellaAppDir,
    config.legacyTokenKey,
  ).catch(() => null);
  if (!legacy?.accessToken) return;
  const email = await config.resolveEmail(legacy).catch(() => null);
  if (email) {
    const tokenKey = connectorAccountTokenKey(config.provider, email);
    await saveConnectorTokenPayload(stellaAppDir, tokenKey, legacy);
    await withAccounts(stellaAppDir, (file) => {
      const entry = (file.providers[config.provider] ??= { accounts: [] });
      const id = normalizeEmail(email);
      entry.accounts = entry.accounts.filter(
        (account) =>
          account.id !== id && account.tokenKey !== config.legacyTokenKey,
      );
      entry.accounts.unshift({ id, email: id, tokenKey, addedAt: Date.now() });
      entry.primary = id;
    });
    await deleteConnectorAccessTokens(stellaAppDir, [config.legacyTokenKey]);
    return;
  }
  await withAccounts(stellaAppDir, (file) => {
    const entry = (file.providers[config.provider] ??= { accounts: [] });
    if (entry.accounts.some((a) => a.tokenKey === config.legacyTokenKey)) {
      return;
    }
    entry.accounts.unshift({
      id: LEGACY_ACCOUNT_ID,
      tokenKey: config.legacyTokenKey,
      addedAt: Date.now(),
    });
    ensurePrimary(entry);
  });
};

const migrations = new Map<string, Promise<void>>();
const legacyAttempts = new Map<string, number>();
const LEGACY_RETRY_MS = 5 * 60_000;

/**
 * A single pre-multi-account credential stored under the provider's legacy
 * key becomes the primary account: moved to `<provider>:<email>` once its
 * email is known, or kept under the legacy key until it can be resolved.
 */
const migrateLegacy = async (
  stellaAppDir: string,
  config: ConnectorAccountProvider,
) => {
  const file = await readAccounts(stellaAppDir);
  const entry = file.providers[config.provider];
  const pendingLegacy = entry?.accounts.find(
    (account) => account.tokenKey === config.legacyTokenKey,
  );
  if (entry && entry.accounts.length > 0 && !pendingLegacy) return;
  const key = `${stellaAppDir}\0${config.provider}`;
  let run = migrations.get(key);
  if (!run) {
    const lastAttempt = legacyAttempts.get(key) ?? 0;
    if (pendingLegacy && Date.now() - lastAttempt < LEGACY_RETRY_MS) return;
    legacyAttempts.set(key, Date.now());
    run = adoptLegacyToken(stellaAppDir, config).finally(() =>
      migrations.delete(key),
    );
    migrations.set(key, run);
  }
  await run;
};

export const listConnectorAccounts = async (
  stellaAppDir: string,
  config: ConnectorAccountProvider,
): Promise<ConnectorAccountSummary[]> => {
  await migrateLegacy(stellaAppDir, config);
  const file = await readAccounts(stellaAppDir);
  return summarize(file.providers[config.provider], config.displayName);
};

export const hasConnectorAccount = async (
  stellaAppDir: string,
  config: ConnectorAccountProvider,
): Promise<boolean> =>
  (await listConnectorAccounts(stellaAppDir, config)).length > 0;

export const resolveConnectorAccount = async (
  stellaAppDir: string,
  config: ConnectorAccountProvider,
  requested?: string,
): Promise<ConnectorAccount> => {
  await migrateLegacy(stellaAppDir, config);
  const entry = (await readAccounts(stellaAppDir)).providers[config.provider];
  const accounts = entry?.accounts ?? [];
  if (accounts.length === 0) {
    throw new Error(`${config.displayName} is not connected.`);
  }
  const wanted = requested?.trim() ? normalizeEmail(requested) : "";
  if (!wanted) {
    return (
      accounts.find((account) => account.id === entry?.primary) ?? accounts[0]!
    );
  }
  const match = accounts.find(
    (account) =>
      account.id === wanted ||
      (account.email && normalizeEmail(account.email) === wanted),
  );
  if (match) return match;
  const known = summarize(entry, config.displayName)
    .map((account) => `${account.label}${account.primary ? " (primary)" : ""}`)
    .join(", ");
  throw new Error(
    `No connected ${config.displayName} account matches "${requested}". Connected: ${known}.`,
  );
};

export const recordConnectorAccount = async (
  stellaAppDir: string,
  config: ConnectorAccountProvider,
  pendingTokenKey: string,
): Promise<ConnectorAccountSummary> => {
  await migrateLegacy(stellaAppDir, config);
  const payload = await loadConnectorTokenPayload(
    stellaAppDir,
    pendingTokenKey,
  );
  if (!payload?.accessToken) {
    throw new Error(`${config.displayName} did not return a credential.`);
  }
  const resolved = await config.resolveEmail(payload).catch(() => null);
  if (!resolved) {
    await deleteConnectorAccessTokens(stellaAppDir, [pendingTokenKey]);
    throw new Error(
      `Could not read which ${config.displayName} account was connected. Try connecting again.`,
    );
  }
  const email = normalizeEmail(resolved);
  const tokenKey = connectorAccountTokenKey(config.provider, email);
  if (tokenKey !== pendingTokenKey) {
    await saveConnectorTokenPayload(stellaAppDir, tokenKey, payload);
    await deleteConnectorAccessTokens(stellaAppDir, [pendingTokenKey]);
  }
  const replacedKeys = await withAccounts(stellaAppDir, (file) => {
    const entry = (file.providers[config.provider] ??= { accounts: [] });
    const replaced = entry.accounts.filter(
      (account) => account.id === email || account.email === email,
    );
    entry.accounts = entry.accounts.filter(
      (account) => !replaced.includes(account),
    );
    const wasPrimary = replaced.some((account) => account.id === entry.primary);
    entry.accounts.push({ id: email, email, tokenKey, addedAt: Date.now() });
    if (wasPrimary) entry.primary = email;
    ensurePrimary(entry);
    return replaced
      .map((account) => account.tokenKey)
      .filter((key) => key !== tokenKey);
  });
  await deleteConnectorAccessTokens(stellaAppDir, replacedKeys);
  const file = await readAccounts(stellaAppDir);
  return summarize(file.providers[config.provider], config.displayName).find(
    (account) => account.id === email,
  )!;
};

export const setPrimaryConnectorAccount = async (
  stellaAppDir: string,
  config: ConnectorAccountProvider,
  account: string,
): Promise<ConnectorAccountSummary[]> => {
  const target = await resolveConnectorAccount(stellaAppDir, config, account);
  await withAccounts(stellaAppDir, (file) => {
    const entry = file.providers[config.provider];
    if (entry) entry.primary = target.id;
  });
  return await listConnectorAccounts(stellaAppDir, config);
};

export const removeConnectorAccount = async (
  stellaAppDir: string,
  config: ConnectorAccountProvider,
  account: string,
): Promise<ConnectorAccountSummary[]> => {
  const target = await resolveConnectorAccount(stellaAppDir, config, account);
  await withAccounts(stellaAppDir, (file) => {
    const entry = file.providers[config.provider];
    if (!entry) return;
    entry.accounts = entry.accounts.filter((item) => item.id !== target.id);
    ensurePrimary(entry);
    if (entry.accounts.length === 0) delete file.providers[config.provider];
  });
  await deleteConnectorAccessTokens(stellaAppDir, [target.tokenKey]);
  return await listConnectorAccounts(stellaAppDir, config);
};

export const removeAllConnectorAccounts = async (
  stellaAppDir: string,
  config: ConnectorAccountProvider,
) => {
  const keys = await withAccounts(stellaAppDir, (file) => {
    const entry = file.providers[config.provider];
    delete file.providers[config.provider];
    return (entry?.accounts ?? []).map((account) => account.tokenKey);
  });
  await deleteConnectorAccessTokens(stellaAppDir, [
    ...keys,
    config.legacyTokenKey,
  ]);
};
