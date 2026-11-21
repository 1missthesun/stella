import type { RuntimeAppServiceCall } from "../client-protocol.js";
import type { StellaRuntimeHostOptions } from "../index.js";
import {
  cancelLlmOAuthSignIn,
  listChatGptCatalogModels,
  listClaudeCodeModelsForApp,
  listLlmOAuthProviders,
  resolveLlmOAuthApiKeyForApp,
  signInLlmOAuth,
} from "./llm-sign-in.js";

export type AppServiceContext = Pick<
  StellaRuntimeHostOptions,
  "hostHandlers" | "initializeParams"
>;

type AppServiceCall = (context: AppServiceContext, ...args: any[]) => unknown;

/**
 * The runtime's side of RUNTIME_APP_SERVICE_CALLS. StellaRuntimeHost exposes
 * each as a method of the same name, so the app reaches it with a host call.
 */
export const appServiceCalls: Record<RuntimeAppServiceCall, AppServiceCall> = {
  listLlmOAuthProviders: () => listLlmOAuthProviders(),
  signInLlmOAuth: (context, request) =>
    signInLlmOAuth(request, (notice) => {
      void Promise.resolve(
        context.hostHandlers.signInProgress?.({
          loginId: request?.loginId,
          provider: request?.provider,
          notice,
        }),
      ).catch(() => undefined);
    }),
  cancelLlmOAuthSignIn: (_context, request) => cancelLlmOAuthSignIn(request),
  resolveLlmOAuthApiKey: (_context, request) => resolveLlmOAuthApiKeyForApp(request),
  listChatGptCatalogModels: () => listChatGptCatalogModels(),
  listClaudeCodeModels: (context, request) =>
    listClaudeCodeModelsForApp({
      apiKey: request?.apiKey,
      stellaAppDir: context.initializeParams.stellaDataDirPath,
    }),
};
