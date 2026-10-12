import {
  sendMediaRequest,
  type MediaHttpResult,
  type MediaOperation,
} from "../kernel/cli/media-request.js";
import {
  sendXApiRequest,
  type XApiHttpResult,
  type XApiOperation,
} from "../kernel/cli/x-api-request.js";
import { jwtStatus } from "./backend-connector-action-broker.js";

type SiteAuth = { baseUrl: string; authToken: string };
type HttpResult = { status: number; body: unknown };

export type BackendSessionBrokerOptions = {
  getSiteAuth: () => SiteAuth | null;
  refreshSiteAuth: () => Promise<SiteAuth | null>;
};

const signedOut = (error: string): HttpResult => ({
  status: 401,
  body: { error, code: "auth_required" },
});

/**
 * One backend call made with the worker's live Stella session, so a CLI
 * whose shell environment holds an expired token (a long wait, an agent
 * started long ago) still reaches the backend. A token the backend rejects
 * is refreshed from the host once and the call retried.
 */
const withLiveSiteAuth = async (
  options: BackendSessionBrokerOptions,
  signedOutMessage: string,
  send: (auth: SiteAuth) => Promise<HttpResult>,
): Promise<HttpResult> => {
  let auth = options.getSiteAuth();
  const status = auth ? jwtStatus(auth.authToken) : "expired";
  if (!auth || status === "expired" || status === "malformed") {
    auth = (await options.refreshSiteAuth()) ?? auth;
  }
  if (!auth?.baseUrl.trim() || !auth.authToken.trim()) {
    return signedOut(signedOutMessage);
  }
  const result = await send(auth);
  if (result.status !== 401) return result;
  const refreshed = await options.refreshSiteAuth();
  if (!refreshed || refreshed.authToken === auth.authToken) return result;
  return await send(refreshed);
};

/** `stella-media` calls (`media.request` on the CLI bridge). */
export const createBackendMediaBroker =
  (options: BackendSessionBrokerOptions) =>
  async (
    params: MediaOperation & { deviceId?: string; signal?: AbortSignal },
  ): Promise<MediaHttpResult> => {
    const { deviceId, signal, ...operation } = params;
    return await withLiveSiteAuth(
      options,
      "Sign in to Stella to use media generation.",
      (auth) =>
        sendMediaRequest(
          { ...auth, ...(deviceId ? { deviceId } : {}) },
          operation as MediaOperation,
          signal,
        ),
    );
  };

/** `stella-x-api` calls (`x.request` on the CLI bridge). */
export const createBackendXApiBroker =
  (options: BackendSessionBrokerOptions) =>
  async (
    params: XApiOperation & { signal?: AbortSignal },
  ): Promise<XApiHttpResult> => {
    const { signal, ...operation } = params;
    return await withLiveSiteAuth(
      options,
      "stella-x-api requires Stella sign-in. Open Stella and finish signing in, then retry.",
      (auth) => sendXApiRequest(auth, operation as XApiOperation, signal),
    );
  };
