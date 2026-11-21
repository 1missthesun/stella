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
import { integrationCalls } from "./integration-calls.js";
import {
  cancelClaudeCliInstall,
  checkClaudeCliUpdate,
  installClaudeCliForApp,
  selectClaudeCliForApp,
} from "./claude-cli.js";
import {
  beginConnectorDeviceOAuthForApp,
  cancelConnectorOAuthFlowForApp,
  runConnectorOAuthFlowForApp,
} from "./connector-oauth-flows.js";
import {
  deletePromptPresetForApp,
  listPromptPresetsForApp,
  readPromptPresetForApp,
  readRuntimePromptForApp,
  readSkillFrontmatter,
  resetCustomizationsForApp,
  savePromptPresetForApp,
  selectPromptPresetForApp,
} from "./customizations.js";

export type AppServiceContext = Pick<
  StellaRuntimeHostOptions,
  "hostHandlers" | "initializeParams"
> & {
  /** The host's own calls (e.g. googleWorkspaceDisconnect), for services that use them. */
  host?: { googleWorkspaceDisconnect?: () => Promise<unknown> };
};

const dataDir = (context: AppServiceContext) => context.initializeParams.stellaDataDirPath;

type AppServiceCall = (context: AppServiceContext, ...args: any[]) => unknown;

/** Tell the app what a running sign-in needs it to do (open a page, record a profile). */
const reportAppServiceProgress = async (
  context: AppServiceContext,
  request: { loginId?: unknown; provider?: unknown } | null | undefined,
  notice: LlmSignInNotice | { type: "install_progress"; progress: unknown },
): Promise<void> => {
  try {
    await context.hostHandlers.appServiceProgress?.({
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
      void reportAppServiceProgress(context, request, notice);
    }),
  signInChatGpt: (context, request) =>
    signInChatGpt(request, (notice) => reportAppServiceProgress(context, request, notice)),
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
  listPromptPresets: (context, request) =>
    listPromptPresetsForApp(dataDir(context), request),
  readPromptPreset: (context, request) => readPromptPresetForApp(dataDir(context), request),
  savePromptPreset: (context, request) => savePromptPresetForApp(dataDir(context), request),
  deletePromptPreset: (context, request) =>
    deletePromptPresetForApp(dataDir(context), request),
  selectPromptPreset: (context, request) =>
    selectPromptPresetForApp(dataDir(context), request),
  readRuntimePrompt: (_context, request) => readRuntimePromptForApp(request),
  resetCustomizations: (context) =>
    resetCustomizationsForApp(context.initializeParams.stellaAppDir, dataDir(context)),
  readSkillFrontmatter: (_context, request) => readSkillFrontmatter(request),
  ...integrationCalls,
  beginConnectorDeviceOAuth: (_context, request) => beginConnectorDeviceOAuthForApp(request),
  runConnectorOAuthFlow: (context, request) => runConnectorOAuthFlowForApp(context, request),
  cancelConnectorOAuthFlow: (_context, request) => cancelConnectorOAuthFlowForApp(request),
  selectClaudeCli: (_context, request) => selectClaudeCliForApp(request),
  installClaudeCli: (context, request) =>
    installClaudeCliForApp(request, (progress) => {
      void reportAppServiceProgress(
        context,
        { loginId: request?.installId },
        { type: "install_progress", progress },
      );
    }),
  cancelClaudeCliInstall: (_context, request) => cancelClaudeCliInstall(request),
  checkClaudeCliUpdate: (context, request) => checkClaudeCliUpdate(dataDir(context), request),
};
