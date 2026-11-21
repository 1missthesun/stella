/**
 * Model-provider sign-ins and model lists the app's Settings asks for. They
 * run in the runtime, which already carries the provider code (pi-ai, the
 * Antigravity provider, the model catalog), so Electron main never loads it.
 * Main keeps only what needs the OS keychain: it stores the credentials a
 * sign-in returns, and asks resolveLlmOAuthApiKey to refresh them.
 */
import type { OAuthCredentials } from "../../kernel/storage/llm-oauth-credentials.js";
import type { ChatGptRegistration } from "@stella/contracts/chatgpt-siwc";
import type {
  ChatGptLoopback,
  ChatGptSavedRegistration,
} from "../../kernel/integrations/chatgpt-sign-in.js";

const loadProviders = () => import("../../kernel/storage/llm-oauth-providers.js");

export type LlmSignInNotice =
  | { type: "auth_url"; url: string }
  | { type: "device_code"; verificationUri: string; userCode: string }
  | { type: "registration"; clientId: string };

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

const loadChatGptSignIn = () => import("../../kernel/integrations/chatgpt-sign-in.js");

/** Sign in to a ChatGPT account on this computer (Sign in with ChatGPT). */
export const signInChatGpt = async (
  request:
    | {
        loginId?: unknown;
        hostId?: unknown;
        saved?: unknown;
        reconsent?: unknown;
      }
    | null
    | undefined,
  notify: (notice: LlmSignInNotice) => Promise<void>,
): Promise<ChatGptRegistration> => {
  const loginId = typeof request?.loginId === "string" ? request.loginId : "";
  const hostId = typeof request?.hostId === "string" ? request.hostId : "";
  if (!loginId || !hostId) throw new Error("A sign-in id and host id are required.");
  const saved =
    request?.saved && typeof request.saved === "object"
      ? (request.saved as ChatGptSavedRegistration)
      : undefined;
  const { loginChatGpt } = await loadChatGptSignIn();
  activeSignIns.get(loginId)?.abort();
  const controller = new AbortController();
  activeSignIns.set(loginId, controller);
  try {
    return await loginChatGpt({
      hostId,
      ...(saved ? { saved } : {}),
      reconsent: request?.reconsent === true,
      openUrl: (url) => void notify({ type: "auth_url", url }),
      onRegistration: (clientId) => notify({ type: "registration", clientId }),
      signal: controller.signal,
    });
  } finally {
    if (activeSignIns.get(loginId) === controller) activeSignIns.delete(loginId);
  }
};

const chatGptListeners = new Map<string, ChatGptLoopback>();

/**
 * The loopback page ChatGPT redirects to, for the cloud connect, whose other
 * steps go through Stella's backend from main: open it, wait for the callback,
 * close it.
 */
export const openChatGptCallbackListener = async (
  request: { listenerId?: unknown } | null | undefined,
): Promise<{ port: number; redirectUri: string }> => {
  const listenerId = typeof request?.listenerId === "string" ? request.listenerId : "";
  if (!listenerId) throw new Error("A listener id is required.");
  chatGptListeners.get(listenerId)?.close();
  const { listenForChatGptCallback } = await loadChatGptSignIn();
  const listener = await listenForChatGptCallback();
  chatGptListeners.set(listenerId, listener);
  return { port: listener.port, redirectUri: listener.redirectUri };
};

export const waitForChatGptCallback = async (
  request: { listenerId?: unknown; state?: unknown } | null | undefined,
): Promise<string> => {
  const listener = chatGptListeners.get(
    typeof request?.listenerId === "string" ? request.listenerId : "",
  );
  if (!listener) throw new Error("ChatGPT sign-in was canceled.");
  return await listener.waitForCallback(typeof request?.state === "string" ? request.state : "");
};

export const closeChatGptCallbackListener = (
  request: { listenerId?: unknown } | null | undefined,
): { closed: boolean } => {
  const listenerId = typeof request?.listenerId === "string" ? request.listenerId : "";
  const listener = chatGptListeners.get(listenerId);
  chatGptListeners.delete(listenerId);
  listener?.close();
  return { closed: Boolean(listener) };
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
