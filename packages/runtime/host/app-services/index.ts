import type { RuntimeAppServiceCall } from "../client-protocol.js";
import type { StellaRuntimeHostOptions } from "../index.js";
import {
  cancelLlmOAuthSignIn,
  closeChatGptCallbackListener,
  openChatGptCallbackListener,
  signInChatGpt,
  waitForChatGptCallback,
  listChatGptCatalogModels,
  listClaudeCodeModelsForApp,
  listLlmOAuthProviders,
  resolveLlmOAuthApiKeyForApp,
  signInLlmOAuth,
  type LlmSignInNotice,
} from "./llm-sign-in.js";

export type AppServiceContext = Pick<
  StellaRuntimeHostOptions,
  "hostHandlers" | "initializeParams"
>;

type AppServiceCall = (context: AppServiceContext, ...args: any[]) => unknown;

/** Tell the app what a running sign-in needs it to do (open a page, record a profile). */
const reportSignInProgress = async (
  context: AppServiceContext,
  request: { loginId?: unknown; provider?: unknown } | null | undefined,
  notice: LlmSignInNotice,
): Promise<void> => {
  try {
    await context.hostHandlers.signInProgress?.({
      loginId: request?.loginId,
      provider: request?.provider,
      notice,
    });
  } catch {
    // The app is gone or restarting; the sign-in times out on its own.
  }
};

/**
 * The runtime's side of RUNTIME_APP_SERVICE_CALLS. StellaRuntimeHost exposes
 * each as a method of the same name, so the app reaches it with a host call.
 */
export const appServiceCalls: Record<RuntimeAppServiceCall, AppServiceCall> = {
  listLlmOAuthProviders: () => listLlmOAuthProviders(),
  signInLlmOAuth: (context, request) =>
    signInLlmOAuth(request, (notice) => {
      void reportSignInProgress(context, request, notice);
    }),
  signInChatGpt: (context, request) =>
    signInChatGpt(request, (notice) => reportSignInProgress(context, request, notice)),
  openChatGptCallbackListener: (_context, request) => openChatGptCallbackListener(request),
  waitForChatGptCallback: (_context, request) => waitForChatGptCallback(request),
  closeChatGptCallbackListener: (_context, request) => closeChatGptCallbackListener(request),
  cancelLlmOAuthSignIn: (_context, request) => cancelLlmOAuthSignIn(request),
  resolveLlmOAuthApiKey: (_context, request) => resolveLlmOAuthApiKeyForApp(request),
  listChatGptCatalogModels: () => listChatGptCatalogModels(),
  listClaudeCodeModels: (context, request) =>
    listClaudeCodeModelsForApp({
      apiKey: request?.apiKey,
      stellaAppDir: context.initializeParams.stellaDataDirPath,
    }),
};
