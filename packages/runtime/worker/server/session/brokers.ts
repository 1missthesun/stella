import {
  METHOD_NAMES,
  type HostLlmCredentialsRequest,
  type HostLlmCredentialsResult,
} from "@stella/contracts/protocol";
import { setConnectorTokenStoreBroker } from "../../../kernel/connectors/token-store-broker.js";
import { setLocalLlmCredentialAccessBroker } from "../../../kernel/storage/local-llm-credential-access.js";
import type * as HostBus from "../host-bus.js";
import type { SessionFinalizer } from "./storage.js";

export interface Interface {
  readonly refreshLocalLlmCredentialAccess: () => Promise<void>;
}

export const make = async (args: {
  hostBus: HostBus.Interface;
  addFinalizer: (finalizer: SessionFinalizer) => void;
}): Promise<Interface> => {
  const { hostBus, addFinalizer } = args;

  const requestHostLlmCredentials = async (
    request: HostLlmCredentialsRequest,
  ): Promise<HostLlmCredentialsResult> =>
    await hostBus.request(METHOD_NAMES.HOST_LLM_CREDENTIALS_REQUEST, request, {
      retryOnDisconnect: true,
    });

  const refreshLocalLlmCredentialAccess = async (): Promise<void> => {
    const result = await requestHostLlmCredentials({ operation: "list" });
    if (
      !result.ok ||
      !("apiKeyProviders" in result) ||
      !("oauthProviders" in result)
    ) {
      throw new Error(
        `Desktop credential storage is unavailable: ${result.ok ? "invalid_response" : result.reason}`,
      );
    }
    const apiKeyProviders = new Set(
      result.apiKeyProviders.map((provider) => provider.trim().toLowerCase()),
    );
    const oauthProviders = new Set(
      result.oauthProviders.map((provider) => provider.trim().toLowerCase()),
    );
    setLocalLlmCredentialAccessBroker({
      hasApiKey: (provider) => apiKeyProviders.has(provider),
      hasOAuth: (provider) => oauthProviders.has(provider),
      getApiKey: async (provider) => {
        const value = await requestHostLlmCredentials({
          operation: "get",
          kind: "api-key",
          provider,
        });
        return value.ok && "value" in value ? value.value : null;
      },
      getOAuthApiKey: async (provider, options) => {
        const value = await requestHostLlmCredentials({
          operation: "get",
          kind: "oauth-api-key",
          provider,
          ...(options?.forceRefresh ? { forceRefresh: true } : {}),
        });
        return value.ok && "value" in value ? value.value : null;
      },
      getClaudeCodeConfig: async (options) => {
        const result = await requestHostLlmCredentials({
          operation: "claude-config",
          ...(options?.recheck ? { recheck: true } : {}),
          ...(options?.cached ? { cached: true } : {}),
          ...(options?.rejectedConfigDir !== undefined
            ? { rejectedConfigDir: options.rejectedConfigDir }
            : {}),
          ...(options?.retryRefused ? { retryRefused: true } : {}),
        });
        if (!result.ok || !("signedIn" in result)) {
          return { configDir: null, signedIn: true };
        }
        return {
          configDir: result.configDir,
          ...(result.email ? { email: result.email } : {}),
          signedIn: result.signedIn,
          ...(result.unreachable ? { unreachable: result.unreachable } : {}),
        };
      },
    });
  };

  await refreshLocalLlmCredentialAccess();

  addFinalizer(() => {
    setConnectorTokenStoreBroker(null);
    setLocalLlmCredentialAccessBroker(null);
  });

  return { refreshLocalLlmCredentialAccess };
};
