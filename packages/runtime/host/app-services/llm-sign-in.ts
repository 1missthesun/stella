/**
 * Model-provider sign-ins and model lists the app's Settings asks for. They
 * run in the runtime, which already carries the provider code (pi-ai, the
 * Antigravity provider, the model catalog), so Electron main never loads it.
 * Main keeps only what needs the OS keychain: it stores the credentials a
 * sign-in returns, and asks resolveLlmOAuthApiKey to refresh them.
 */
import type { OAuthCredentials } from "../../kernel/storage/llm-oauth-credentials.js";

const loadProviders = () => import("../../kernel/storage/llm-oauth-providers.js");

export type LlmSignInNotice =
  | { type: "auth_url"; url: string }
  | { type: "device_code"; verificationUri: string; userCode: string };

export type LlmSignInResult = {
  provider: string;
  label: string;
  credentials: OAuthCredentials;
  account?: string;
  plan?: string;
};

const activeSignIns = new Map<string, AbortController>();

export const listLlmOAuthProviders = async (): Promise<
  Array<{ provider: string; label: string }>
> => {
  const { getLlmOAuthProviders } = await loadProviders();
  return getLlmOAuthProviders().map((provider) => ({
    provider: provider.id,
    label: provider.name,
  }));
};

export const signInLlmOAuth = async (
  request: { loginId?: unknown; provider?: unknown } | null | undefined,
  notify: (notice: LlmSignInNotice) => void,
): Promise<LlmSignInResult> => {
  const loginId = typeof request?.loginId === "string" ? request.loginId : "";
  const providerId =
    typeof request?.provider === "string" ? request.provider.trim().toLowerCase() : "";
  if (!loginId) throw new Error("A sign-in id is required.");
  const { describeLlmOAuthCredential, getLlmOAuthProvider, loginLlmOAuth } =
    await loadProviders();
  const provider = getLlmOAuthProvider(providerId);
  if (!provider) throw new Error("Unsupported OAuth provider.");
  activeSignIns.get(loginId)?.abort();
  const controller = new AbortController();
  activeSignIns.set(loginId, controller);
  try {
    const credentials = await loginLlmOAuth(provider, {
      notify: (event) => {
        if (event.type === "auth_url") {
          notify({ type: "auth_url", url: event.url });
        } else if (event.type === "device_code") {
          notify({
            type: "device_code",
            verificationUri: event.verificationUri,
            userCode: event.userCode,
          });
        }
      },
      prompt: async () => "",
      signal: controller.signal,
    });
    if (controller.signal.aborted) {
      throw controller.signal.reason instanceof Error
        ? controller.signal.reason
        : new Error("OAuth login was canceled.");
    }
    return {
      provider: provider.id,
      label: provider.name,
      credentials: credentials as OAuthCredentials,
      ...describeLlmOAuthCredential(provider.id, credentials),
    };
  } finally {
    if (activeSignIns.get(loginId) === controller) activeSignIns.delete(loginId);
  }
};

export const cancelLlmOAuthSignIn = (
  request: { loginId?: unknown } | null | undefined,
): { canceled: boolean } => {
  const loginId = typeof request?.loginId === "string" ? request.loginId : "";
  const controller = activeSignIns.get(loginId);
  if (!controller) return { canceled: false };
  controller.abort(new Error("OAuth login was canceled."));
  activeSignIns.delete(loginId);
  return { canceled: true };
};

export const resolveLlmOAuthApiKeyForApp = async (
  request:
    | { provider?: unknown; credentials?: unknown; forceRefresh?: unknown }
    | null
    | undefined,
): Promise<{ credentials: OAuthCredentials; apiKey: string }> => {
  const provider = typeof request?.provider === "string" ? request.provider : "";
  const credentials = request?.credentials as OAuthCredentials | undefined;
  if (!provider || !credentials || typeof credentials !== "object") {
    throw new Error("A provider and its stored sign-in are required.");
  }
  const { resolveLlmOAuthApiKey } = await loadProviders();
  return await resolveLlmOAuthApiKey(provider, credentials, {
    forceRefresh: request?.forceRefresh === true,
  });
};

/** The catalog's ChatGPT models, for when no ChatGPT account is signed in. */
export const listChatGptCatalogModels = async (): Promise<
  Array<{ id: string; name: string }>
> => {
  const { getModels } = await import("../../kernel/model-catalog.js");
  return getModels("chatgpt").map((model) => ({ id: model.id, name: model.name }));
};

export const listClaudeCodeModelsForApp = async (
  request: { apiKey?: unknown; stellaAppDir?: unknown } | null | undefined,
) => {
  const apiKey = typeof request?.apiKey === "string" ? request.apiKey : undefined;
  const stellaAppDir =
    typeof request?.stellaAppDir === "string" ? request.stellaAppDir : undefined;
  const { listClaudeCodeModels } = await import(
    "../../kernel/integrations/claude-code-session-runtime.js"
  );
  return await listClaudeCodeModels(apiKey ? { apiKey } : null, stellaAppDir);
};
