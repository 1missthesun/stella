/**
 * Connector sign-ins (device code, a provider's registered OAuth app, or
 * dynamic registration) run here. The app owns the approval UI and the
 * browser: it asks for a flow, opens the page each one names (signInProgress),
 * and hands back a callback that returned through a stella:// link
 * (waitForConnectorOAuthCallback). Tokens are saved through the app's
 * keychain-backed store (requestConnectorTokenStore).
 */
import type { AppServiceContext } from "./index.js";

const flows = new Map<string, AbortController>();

const loadOAuth = () => import("../../kernel/connectors/oauth.js");

const text = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * The worker installs a token store that goes through the app; when no worker
 * session has yet, install the same one so a sign-in never reaches for the OS
 * keychain, which this process can't use.
 */
const ensureTokenStore = async (context: AppServiceContext) => {
  const oauth = await loadOAuth();
  if (oauth.hasConnectorTokenStoreBroker()) return;
  const request = context.hostHandlers.requestConnectorTokenStore;
  if (!request) return;
  const call = async (payload: Record<string, unknown>) => {
    const result = (await request(payload)) as {
      ok?: boolean;
      reason?: string;
      payload?: unknown;
    };
    if (!result?.ok) throw new Error(result?.reason ?? "token_store_failed");
    return result;
  };
  oauth.setConnectorTokenStoreBroker({
    load: async (tokenKey) =>
      ((await call({ operation: "load", tokenKey })).payload ?? null) as never,
    save: async (tokenKey, payload) => {
      await call({ operation: "save", tokenKey, payload });
    },
    delete: async (tokenKeys) => {
      await call({ operation: "delete", tokenKeys });
    },
  });
};

export const beginConnectorDeviceOAuthForApp = async (
  request: { clientId?: unknown; deviceAuthorizationEndpoint?: unknown; scopes?: unknown } | null,
) => {
  const { beginConnectorDeviceOAuth } = await loadOAuth();
  return await beginConnectorDeviceOAuth({
    clientId: text(request?.clientId),
    deviceAuthorizationEndpoint: text(request?.deviceAuthorizationEndpoint),
    ...(Array.isArray(request?.scopes) ? { scopes: request.scopes as string[] } : {}),
    signal: AbortSignal.timeout(30_000),
  });
};

export const runConnectorOAuthFlowForApp = async (
  context: AppServiceContext,
  request: Record<string, any> | null | undefined,
): Promise<{ ok: true }> => {
  const flowId = text(request?.flowId);
  if (!flowId || !request) throw new Error("A flow id is required.");
  const controller = new AbortController();
  flows.get(flowId)?.abort(new Error("Connector authorization replaced."));
  flows.set(flowId, controller);
  const signal = controller.signal;
  const stellaDataDir = context.initializeParams.stellaDataDirPath;
  const openUrl = async (url: string) => {
    await context.hostHandlers.signInProgress?.({
      loginId: flowId,
      notice: { type: "auth_url", url },
    });
  };
  try {
    await ensureTokenStore(context);
    const oauth = await loadOAuth();
    if (request.type === "device") {
      await oauth.completeConnectorDeviceOAuth(stellaDataDir, {
        tokenKey: request.tokenKey,
        clientId: request.clientId,
        tokenEndpoint: request.tokenEndpoint,
        authorization: request.authorization,
        resourceUrl: request.resourceUrl,
        scopes: request.scopes,
        signal,
      });
    } else if (request.type === "preregistered") {
      await oauth.connectPreregisteredConnectorOAuth(stellaDataDir, {
        tokenKey: request.tokenKey,
        clientId: request.clientId,
        authorizationEndpoint: request.authorizationEndpoint,
        tokenEndpoint: request.tokenEndpoint,
        responseType: request.responseType,
        resourceUrl: request.resourceUrl,
        oauthResource: request.oauthResource,
        callbackUrl: request.callbackUrl,
        callbackId: request.callbackId,
        callbackWaiter:
          request.callbackMode === "external"
            ? async (args) => {
                const waitForCallback = Promise.resolve(
                  context.hostHandlers.waitForConnectorOAuthCallback?.({
                    flowId,
                    state: args.state,
                    redirectUri: args.redirectUri,
                    callbackId: args.callbackId,
                  }),
                ).then((callback) => {
                  if (!callback) throw new Error("Connector authorization is unavailable.");
                  return callback as { state: string; code?: string };
                });
                const waitForCode = waitForCallback.then((callback) => {
                  if (!callback.code) {
                    throw new Error("OAuth callback did not include a code.");
                  }
                  return callback.code;
                });
                void waitForCode.catch(() => undefined);
                return { waitForCallback, waitForCode };
              }
            : undefined,
        scopes: request.scopes,
        scopeSeparator: request.scopeSeparator,
        usesPkce: request.usesPkce,
        authorizationRedirectParam: request.authorizationRedirectParam,
        authorizationParams: request.authorizationParams,
        tokenRedirectParam: request.tokenRedirectParam,
        tokenAuth: request.tokenAuth,
        tokenExchange: request.tokenExchange,
        openUrl,
        signal,
      });
    } else {
      await oauth.connectConnectorOAuth(stellaDataDir, {
        tokenKey: request.tokenKey,
        resourceUrl: request.resourceUrl,
        oauthClientId: request.oauthClientId,
        oauthResource: request.oauthResource ?? undefined,
        callbackId: request.callbackId,
        scopes: request.scopes,
        openUrl,
        signal,
      });
    }
    return { ok: true };
  } finally {
    if (flows.get(flowId) === controller) flows.delete(flowId);
  }
};

export const cancelConnectorOAuthFlowForApp = (
  request: { flowId?: unknown } | null | undefined,
) => {
  const flowId = text(request?.flowId);
  const controller = flows.get(flowId);
  flows.delete(flowId);
  controller?.abort(new Error("Connector authorization cancelled."));
  return { canceled: Boolean(controller) };
};
