import { getLocalLlmCredential } from "./llm-credentials.js";
import {
  getLocalLlmOAuthApiKey,
  hasLocalLlmOAuthCredential,
} from "./llm-oauth-credentials.js";

export type LocalLlmOAuthApiKeyAccessOptions = {
  forceRefresh?: boolean;
};

export type LocalLlmCredentialAccessBroker = {
  hasApiKey(provider: string): boolean;
  hasOAuth(provider: string): boolean;
  getApiKey(provider: string): Promise<string | null>;
  getOAuthApiKey(
    provider: string,
    options?: LocalLlmOAuthApiKeyAccessOptions,
  ): Promise<string | null>;
  getClaudeCodeConfig?(options?: ClaudeCodeConfigRequest): Promise<ClaudeCodeConfigAccess>;
};

export type ClaudeCodeConfigRequest = {
  recheck?: boolean;
  cached?: boolean;
  /** Anthropic refused the login in this config directory (null: Claude Code's own). */
  rejectedConfigDir?: string | null;
};

export type ClaudeCodeConfigAccess = {
  configDir: string | null;
  email?: string;
  signedIn: boolean;
};

let broker: LocalLlmCredentialAccessBroker | null = null;

const normalizeProvider = (provider: string) => provider.trim().toLowerCase();

export const setLocalLlmCredentialAccessBroker = (
  value: LocalLlmCredentialAccessBroker | null,
): void => {
  broker = value;
};

export const hasAccessibleLocalLlmApiKey = (
  stellaDataDirPath: string,
  provider: string,
): boolean => {
  const normalized = normalizeProvider(provider);
  return broker
    ? broker.hasApiKey(normalized)
    : Boolean(getLocalLlmCredential(stellaDataDirPath, normalized));
};

export const hasAccessibleLocalLlmOAuthCredential = (
  stellaDataDirPath: string,
  provider: string,
): boolean => {
  const normalized = normalizeProvider(provider);
  return broker
    ? broker.hasOAuth(normalized)
    : hasLocalLlmOAuthCredential(stellaDataDirPath, normalized);
};

export const getAccessibleLocalLlmApiKey = async (
  stellaDataDirPath: string,
  provider: string,
): Promise<string | null> => {
  const normalized = normalizeProvider(provider);
  if (!broker) return getLocalLlmCredential(stellaDataDirPath, normalized);
  return broker.hasApiKey(normalized)
    ? await broker.getApiKey(normalized)
    : null;
};

export const getClaudeCodeConfig = async (
  options?: ClaudeCodeConfigRequest,
): Promise<ClaudeCodeConfigAccess> => {
  const fallback: ClaudeCodeConfigAccess = { configDir: null, signedIn: true };
  if (!broker?.getClaudeCodeConfig) return fallback;
  try {
    return await broker.getClaudeCodeConfig(options);
  } catch {
    return fallback;
  }
};

export const getAccessibleLocalLlmOAuthApiKey = async (
  stellaDataDirPath: string,
  provider: string,
  options: LocalLlmOAuthApiKeyAccessOptions = {},
): Promise<string | null> => {
  const normalized = normalizeProvider(provider);
  if (!broker) {
    return await getLocalLlmOAuthApiKey(stellaDataDirPath, normalized, options);
  }
  return broker.hasOAuth(normalized)
    ? await broker.getOAuthApiKey(normalized, options)
    : null;
};
