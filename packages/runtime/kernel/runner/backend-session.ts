import {
  type BackendClient,
  backendTokenExpiryMs,
} from "@stella/contracts/backend/client";
import {
  leaseBackendClient,
  type BackendClientLease,
} from "@stella/contracts/backend/shared-client";
import type { OwnerIdentity } from "@stella/contracts/backend/conversations";
import { raceWithTimeoutError } from "./cloud-effect-runtime.js";

const OWNER_IDENTITY_TIMEOUT_MS = 15_000;

type BackendSessionState = {
  backendUrl: string | null;
  authToken: string | null;
};

const sanitizeBackendUrl = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
};

const tokenSubject = (token: string | null): string | null => {
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const json = JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as { sub?: unknown };
    return typeof json.sub === "string" ? json.sub : null;
  } catch {
    return null;
  }
};

export type BackendSession = ReturnType<typeof createBackendSession>;

export const createBackendSession = (
  getState: () => BackendSessionState,
  mintToken?: () => Promise<string | null>,
) => {
  let lease: BackendClientLease | null = null;
  let clientUrl: string | null = null;
  let subject: string | null = null;
  let identity: { subject: string | null; value: Promise<OwnerIdentity> } | null = null;
  let forcing: Promise<string> | null = null;

  const cachedToken = (): string | null => getState().authToken?.trim() || null;

  const mintNewerToken = async (): Promise<string> => {
    const previous = cachedToken();
    const previousExpiry = backendTokenExpiryMs(previous);
    const minted = (await mintToken?.())?.trim() || null;
    const next = minted ?? cachedToken();
    const nextExpiry = backendTokenExpiryMs(next);
    const isNewer =
      next !== null &&
      next !== previous &&
      (previousExpiry === null || nextExpiry === null || nextExpiry > previousExpiry);
    if (!isNewer) {
      throw new Error("Stella could not mint a newer cloud token.");
    }
    return next;
  };

  const forceToken = async (): Promise<string> => {
    if (forcing) return await forcing;
    const attempt = mintNewerToken();
    forcing = attempt;
    try {
      return await attempt;
    } finally {
      if (forcing === attempt) forcing = null;
    }
  };

  const get = (): BackendClient | null => {
    const url = getState().backendUrl;
    if (!url) return null;
    if (lease && clientUrl === url) return lease.client;
    lease?.release();
    lease = leaseBackendClient({
      baseUrl: url,
      getToken: async (options) =>
        options?.force ? await forceToken() : cachedToken(),
    });
    clientUrl = url;
    return lease.client;
  };

  return {
    client: get,
    require(): BackendClient {
      const current = get();
      if (!current) throw new Error("Stella's cloud is not configured on this device yet.");
      return current;
    },
    setBackendUrl(value: string | null): void {
      getState().backendUrl =
        sanitizeBackendUrl(value) ?? sanitizeBackendUrl(process.env.STELLA_BACKEND_URL);
    },
    noteAuthToken(): void {
      const next = tokenSubject(getState().authToken);
      if (next === subject) return;
      subject = next;
      identity = null;
      lease?.noteAuthToken(getState().authToken);
    },
    async ownerIdentity(): Promise<OwnerIdentity> {
      if (identity && identity.subject === subject) return await identity.value;
      const value = raceWithTimeoutError(
        this.require().call("owner.identity", {}),
        OWNER_IDENTITY_TIMEOUT_MS,
        () => new Error("Stella's cloud did not confirm your account in time. Try again in a moment."),
      );
      identity = { subject, value };
      try {
        return await value;
      } catch (error) {
        if (identity?.value === value) identity = null;
        throw error;
      }
    },
    forgetOwnerIdentity(): void {
      identity = null;
    },
    dispose(): void {
      lease?.release();
      lease = null;
      clientUrl = null;
    },
  };
};

export const initialBackendUrl = (): string | null =>
  sanitizeBackendUrl(process.env.STELLA_BACKEND_URL);
