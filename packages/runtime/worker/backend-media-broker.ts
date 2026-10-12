import {
  sendMediaRequest,
  type MediaHttpResult,
  type MediaOperation,
} from "../kernel/cli/media-request.js";
import { jwtStatus } from "./backend-connector-action-broker.js";

type SiteAuth = { baseUrl: string; authToken: string };

export type BackendMediaBrokerOptions = {
  getSiteAuth: () => SiteAuth | null;
  refreshSiteAuth: () => Promise<SiteAuth | null>;
};

const SIGNED_OUT: MediaHttpResult = {
  status: 401,
  body: {
    error: "Sign in to Stella to use media generation.",
    code: "auth_required",
  },
};

/**
 * `stella-media` calls made with the worker's live Stella session, so a
 * shell whose environment token has expired (a long `--wait`, an agent
 * started long ago) still reaches the media API. A token the backend
 * rejects is refreshed from the host once and the call retried.
 */
export const createBackendMediaBroker =
  (options: BackendMediaBrokerOptions) =>
  async (
    params: MediaOperation & { deviceId?: string; signal?: AbortSignal },
  ): Promise<MediaHttpResult> => {
    const { deviceId, signal, ...operation } = params;
    let auth = options.getSiteAuth();
    const status = auth ? jwtStatus(auth.authToken) : "expired";
    if (!auth || status === "expired" || status === "malformed") {
      auth = (await options.refreshSiteAuth()) ?? auth;
    }
    if (!auth?.baseUrl.trim() || !auth.authToken.trim()) return SIGNED_OUT;
    const send = (current: SiteAuth) =>
      sendMediaRequest(
        { ...current, ...(deviceId ? { deviceId } : {}) },
        operation as MediaOperation,
        signal,
      );
    const result = await send(auth);
    if (result.status !== 401) return result;
    const refreshed = await options.refreshSiteAuth();
    if (!refreshed || refreshed.authToken === auth.authToken) return result;
    return await send(refreshed);
  };
