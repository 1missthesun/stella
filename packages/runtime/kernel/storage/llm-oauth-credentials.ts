import fs from "fs";
import path from "path";
import type { OAuthCredentials } from "./llm-oauth-providers.js";
import {
  deleteProtectedValue,
  protectValue,
  unprotectValue,
} from "../shared/protected-storage.js";
import {
  ensurePrivateDirSync,
  writePrivateFileSync,
} from "../shared/private-fs.js";

const LLM_OAUTH_CREDENTIALS_FILE = "llm_oauth_credentials.json";
const LLM_OAUTH_SCOPE_PREFIX = "llm-oauth-credential";
const RETIRED_LLM_OAUTH_PROVIDERS = new Set([
  "google-antigravity",
  "google-gemini-cli",
  "openai-codex",
  "chatgpt",
  "anthropic",
]);

type StoredLlmOAuthCredentialRecord = {
  provider: string;
  label: string;
  valueProtected: string;
  createdAt: number;
  updatedAt: number;
  refreshRequired?: true;
};

type StoredLlmOAuthCredentialFile = {
  version: 1;
  credentials: Record<string, StoredLlmOAuthCredentialRecord>;
};

export type LocalLlmOAuthCredentialSummary = {
  provider: string;
  label: string;
  status: "active";
  updatedAt: number;
};

const normalizeProvider = (provider: string) => provider.trim().toLowerCase();

const credentialScope = (provider: string) =>
  `${LLM_OAUTH_SCOPE_PREFIX}:${normalizeProvider(provider)}`;

const getStatePath = (stellaAppDir: string) => stellaAppDir;

export const getLlmOAuthCredentialStorePath = (stellaAppDir: string) =>
  path.join(getStatePath(stellaAppDir), LLM_OAUTH_CREDENTIALS_FILE);

const readCredentialFile = (
  stellaAppDir: string,
): StoredLlmOAuthCredentialFile => {
  const filePath = getLlmOAuthCredentialStorePath(stellaAppDir);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as StoredLlmOAuthCredentialFile;
    if (
      parsed &&
      parsed.version === 1 &&
      parsed.credentials &&
      typeof parsed.credentials === "object"
    ) {
      return pruneRetiredLlmOAuthCredentials(stellaAppDir, parsed);
    }
  } catch {
    // Fall through to empty store.
  }

  return {
    version: 1,
    credentials: {},
  };
};

const writeCredentialFile = (
  stellaAppDir: string,
  payload: StoredLlmOAuthCredentialFile,
): void => {
  const filePath = getLlmOAuthCredentialStorePath(stellaAppDir);
  ensurePrivateDirSync(path.dirname(filePath));
  writePrivateFileSync(filePath, JSON.stringify(payload, null, 2));
};

const pruneRetiredLlmOAuthCredentials = (
  stellaAppDir: string,
  payload: StoredLlmOAuthCredentialFile,
): StoredLlmOAuthCredentialFile => {
  const removed: Array<{
    provider: string;
    record: StoredLlmOAuthCredentialRecord;
  }> = [];
  const credentials = { ...payload.credentials };

  for (const [key, record] of Object.entries(credentials)) {
    const provider = normalizeProvider(
      typeof record.provider === "string" ? record.provider : key,
    );
    if (!RETIRED_LLM_OAUTH_PROVIDERS.has(provider)) continue;
    delete credentials[key];
    removed.push({ provider, record });
  }

  if (removed.length === 0) return payload;

  const next: StoredLlmOAuthCredentialFile = {
    ...payload,
    credentials,
  };
  try {
    writeCredentialFile(stellaAppDir, next);
  } catch {
    // Keep retired providers unavailable in memory and retry the durable
    // cleanup the next time the credential store is read.
    return next;
  }

  for (const { provider, record } of removed) {
    try {
      deleteProtectedValue(credentialScope(provider), record.valueProtected);
    } catch {
      // The credential record is already gone, so a protected-storage cleanup
      // failure cannot make the retired provider usable again.
    }
  }
  return next;
};

const decodeCredentials = (
  provider: string,
  valueProtected: string,
): OAuthCredentials | null => {
  try {
    const raw = unprotectValue(credentialScope(provider), valueProtected);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as OAuthCredentials;
    if (
      parsed &&
      typeof parsed.access === "string" &&
      typeof parsed.refresh === "string" &&
      typeof parsed.expires === "number"
    ) {
      return parsed;
    }
  } catch {
    // Treat corrupt records as missing.
  }
  return null;
};

export const listLocalLlmOAuthCredentials = (
  stellaAppDir: string,
): LocalLlmOAuthCredentialSummary[] => {
  const file = readCredentialFile(stellaAppDir);
  return Object.values(file.credentials)
    .map((record) => ({
      provider: record.provider,
      label: record.label,
      status: "active" as const,
      updatedAt: record.updatedAt,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
};

export const cleanupRetiredLocalLlmOAuthCredentials = (
  stellaAppDir: string,
): void => {
  readCredentialFile(stellaAppDir);
};

export const hasLocalLlmOAuthCredential = (
  stellaAppDir: string,
  provider: string,
): boolean => {
  const normalizedProvider = normalizeProvider(provider);
  const file = readCredentialFile(stellaAppDir);
  return Boolean(file.credentials[normalizedProvider]);
};

export const saveLocalLlmOAuthCredential = (
  stellaAppDir: string,
  payload: {
    provider: string;
    label: string;
    credentials: OAuthCredentials;
  },
): LocalLlmOAuthCredentialSummary => {
  const provider = normalizeProvider(payload.provider);
  if (!provider) {
    throw new Error("Unsupported OAuth provider.");
  }

  const label = payload.label.trim() || provider;
  const file = readCredentialFile(stellaAppDir);
  const now = Date.now();
  const existing = file.credentials[provider];
  const valueProtected = protectValue(
    credentialScope(provider),
    JSON.stringify(payload.credentials),
  );
  file.credentials[provider] = {
    provider,
    label,
    valueProtected,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  writeCredentialFile(stellaAppDir, file);
  if (existing && existing.valueProtected !== valueProtected) {
    deleteProtectedValue(credentialScope(provider), existing.valueProtected);
  }

  return {
    provider,
    label,
    status: "active",
    updatedAt: now,
  };
};

export const deleteLocalLlmOAuthCredential = (
  stellaAppDir: string,
  provider: string,
): { removed: boolean } => {
  const normalizedProvider = normalizeProvider(provider);
  if (!normalizedProvider) return { removed: false };

  const file = readCredentialFile(stellaAppDir);
  const existing = file.credentials[normalizedProvider];
  if (!existing) {
    return { removed: false };
  }

  delete file.credentials[normalizedProvider];
  writeCredentialFile(stellaAppDir, file);
  deleteProtectedValue(credentialScope(normalizedProvider), existing.valueProtected);
  return { removed: true };
};

export type GetLocalLlmOAuthApiKeyOptions = {
  forceRefresh?: boolean;
};

const updateRecordIfUnchanged = (
  stellaAppDir: string,
  provider: string,
  expectedValueProtected: string,
  next: (record: StoredLlmOAuthCredentialRecord) => StoredLlmOAuthCredentialRecord,
): void => {
  const file = readCredentialFile(stellaAppDir);
  const current = file.credentials[provider];
  if (!current || current.valueProtected !== expectedValueProtected) return;
  const updated = next(current);
  file.credentials[provider] = updated;
  writeCredentialFile(stellaAppDir, file);
  if (updated.valueProtected !== current.valueProtected) {
    deleteProtectedValue(credentialScope(provider), current.valueProtected);
  }
};

const inflightKeys = new Map<string, Promise<string>>();

export const getLocalLlmOAuthApiKey = async (
  stellaAppDir: string,
  provider: string,
  options: GetLocalLlmOAuthApiKeyOptions = {},
): Promise<string | null> => {
  const normalizedProvider = normalizeProvider(provider);
  const file = readCredentialFile(stellaAppDir);
  const record = file.credentials[normalizedProvider];
  if (!record) return null;

  const credentials = decodeCredentials(
    normalizedProvider,
    record.valueProtected,
  );
  if (!credentials) return null;

  const { getLlmOAuthApiKey, getLlmOAuthProvider } = await import(
    "./llm-oauth-providers.js"
  );
  const oauthProvider = getLlmOAuthProvider(normalizedProvider);
  if (!oauthProvider) {
    throw new Error(`Unknown OAuth provider: ${normalizedProvider}`);
  }
  const forceRefresh =
    options.forceRefresh === true || record.refreshRequired === true;
  const flightKey = `${normalizedProvider}\n${record.valueProtected}\n${forceRefresh}`;
  const inflight = inflightKeys.get(flightKey);
  if (inflight) return await inflight;

  const run = (async () => {
    let result: Awaited<ReturnType<typeof getLlmOAuthApiKey>>;
    try {
      result = await getLlmOAuthApiKey(oauthProvider, credentials, {
        forceRefresh,
      });
    } catch (error) {
      if (forceRefresh && !record.refreshRequired) {
        updateRecordIfUnchanged(
          stellaAppDir,
          normalizedProvider,
          record.valueProtected,
          (current) => ({ ...current, refreshRequired: true }),
        );
      }
      throw error;
    }
    if (result.credentials !== credentials || record.refreshRequired) {
      updateRecordIfUnchanged(
        stellaAppDir,
        normalizedProvider,
        record.valueProtected,
        ({ refreshRequired: _cleared, ...current }) => ({
          ...current,
          valueProtected:
            result.credentials === credentials
              ? current.valueProtected
              : protectValue(
                  credentialScope(normalizedProvider),
                  JSON.stringify(result.credentials),
                ),
          updatedAt: Date.now(),
        }),
      );
    }
    return result.apiKey;
  })();
  inflightKeys.set(flightKey, run);
  try {
    return await run;
  } finally {
    inflightKeys.delete(flightKey);
  }
};
