import type { AppServiceContext } from "./index.js";
import {
  addNativeIntegrationAccount,
  changeNativeIntegrationAccountAndList,
  connectConnectorOffer,
  describeConnectorOffer,
  disableNativeIntegration,
  enableNativeIntegration,
  listNativeIntegrationsWithAccounts,
  type NativeCredentialFlowOptions,
} from "./native-integrations.js";

type IntegrationRequest = {
  flowId?: unknown;
  auth?: { backendUrl?: unknown; authToken?: unknown } | null;
  [key: string]: unknown;
} | null | undefined;

const flows = new Map<string, AbortController>();

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * The flow options the moved integration code expects: Stella's backend
 * auth comes with the request (main holds the session), and each sign-in step
 * that needs a window goes back to the app as requestConnectorSignIn.
 */
const flowOptions = (
  context: AppServiceContext,
  request: IntegrationRequest,
  signal: AbortSignal,
): NativeCredentialFlowOptions => {
  const flowId = text(request?.flowId);
  const backendUrl = text(request?.auth?.backendUrl).replace(/\/+$/u, "");
  const authToken = text(request?.auth?.authToken);
  const ask =
    (kind: "preregistered" | "device" | "external") =>
    async (payload: unknown) => {
      const handler = context.hostHandlers.requestConnectorSignIn;
      if (!handler) return { ok: false as const, reason: "unsupported" };
      return await handler({ flowId, kind, payload });
    };
  return {
    getBackendUrl: () => backendUrl || null,
    getAuthToken: async () => authToken || null,
    requestPreregisteredOAuth: ask("preregistered"),
    requestDeviceOAuth: ask("device"),
    requestExternalOAuthApproval: ask("external"),
    abortSignal: signal,
  };
};

const runFlow = async <T>(
  context: AppServiceContext,
  request: IntegrationRequest,
  run: (options: NativeCredentialFlowOptions, stellaDataDir: string) => Promise<T>,
): Promise<T> => {
  const flowId = text(request?.flowId);
  const controller = new AbortController();
  if (flowId) {
    flows.get(flowId)?.abort(new Error("Connection replaced."));
    flows.set(flowId, controller);
  }
  try {
    return await run(
      flowOptions(context, request, controller.signal),
      context.initializeParams.stellaDataDirPath,
    );
  } finally {
    if (flowId && flows.get(flowId) === controller) flows.delete(flowId);
  }
};

export const integrationCalls = {
  listNativeIntegrations: (context: AppServiceContext, request: IntegrationRequest) =>
    runFlow(context, request, (options, dir) => listNativeIntegrationsWithAccounts(options, dir)),
  enableNativeIntegration: (context: AppServiceContext, request: IntegrationRequest) =>
    runFlow(context, request, (options, dir) => enableNativeIntegration(options, dir, request)),
  disableNativeIntegration: (context: AppServiceContext, request: IntegrationRequest) =>
    runFlow(context, request, (options, dir) =>
      disableNativeIntegration(
        {
          ...options,
          disconnectGoogleWorkspace: async () =>
            await context.host?.googleWorkspaceDisconnect?.(),
        },
        dir,
        request,
      ),
    ),
  addNativeIntegrationAccount: (context: AppServiceContext, request: IntegrationRequest) =>
    runFlow(context, request, (options, dir) => addNativeIntegrationAccount(options, dir, request)),
  setPrimaryNativeIntegrationAccount: (
    context: AppServiceContext,
    request: IntegrationRequest,
  ) =>
    runFlow(context, request, (options, dir) =>
      changeNativeIntegrationAccountAndList(options, dir, request, "primary"),
    ),
  removeNativeIntegrationAccount: (context: AppServiceContext, request: IntegrationRequest) =>
    runFlow(context, request, (options, dir) =>
      changeNativeIntegrationAccountAndList(options, dir, request, "remove"),
    ),
  describeConnectorOffer: (context: AppServiceContext, request: IntegrationRequest) =>
    runFlow(context, request, (options, dir) =>
      describeConnectorOffer(options, dir, text(request?.id).toLowerCase()),
    ),
  connectConnectorOffer: (context: AppServiceContext, request: IntegrationRequest) =>
    runFlow(context, request, (options, dir) =>
      connectConnectorOffer(options, dir, {
        id: text(request?.id),
        name: text(request?.name),
        ...(typeof request?.fingerprint === "string" ? { fingerprint: request.fingerprint } : {}),
        addAccount: request?.addAccount === true,
      }),
    ),
  cancelIntegrationFlow: (_context: AppServiceContext, request: IntegrationRequest) => {
    const flowId = text(request?.flowId);
    const controller = flows.get(flowId);
    flows.delete(flowId);
    controller?.abort(new Error("Connection cancelled."));
    return { canceled: Boolean(controller) };
  },
};
