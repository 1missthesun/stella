import { REQUEST_BUDGET_MS, withDeadline } from "@stella/contracts/request-deadline";
import {
  GATEWAY_SESSION_CAPABILITY_PATH,
  type GatewayErrorBody,
  type GatewaySessionCapabilityRequest,
  type GatewaySessionCapabilityResponse,
} from "@stella/contracts/gateway/api";
import {
  GATEWAY_DPOP_ALG_HEADER,
  GATEWAY_DPOP_HEADER,
  GATEWAY_DPOP_KEY_HEADER,
  GATEWAY_DPOP_TS_HEADER,
  base64UrlEncode,
  deviceExchangeSigningInput,
  dpopSigningInput,
  type GatewayDeviceKeyProof,
} from "@stella/contracts/gateway/dpop";
import { normalizeStellaSiteUrl } from "@stella/contracts/stella-api";
import type { DeviceSigner } from "./home/device.js";

export const GATEWAY_SESSION_CAPABILITY_REFRESH_SKEW_MS = 60_000;
const GATEWAY_SESSION_EXCHANGE_TIMEOUT_MS = 15_000;

export const STELLA_GATEWAY_UNCONFIGURED_MESSAGE =
  "Stella model gateway is not configured: the model catalog did not advertise gateway.origin (MODEL_GATEWAY_URL on the backend).";
export const STELLA_GATEWAY_CHALLENGE_REQUIRED_MESSAGE =
  "Stella needs to verify you're human before continuing.";
export const STELLA_GATEWAY_DEVICE_VERIFICATION_MESSAGE =
  "This device could not be verified. Restart Stella and try again.";

const knownGatewayOrigins = new Map<string, string>();

const siteKey = (siteBaseUrl: string): string =>
  normalizeStellaSiteUrl(siteBaseUrl);

export const normalizeGatewayOrigin = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.search || url.hash) return null;
    return trimmed;
  } catch {
    return null;
  }
};

export const rememberStellaGatewayOrigin = (
  siteBaseUrl: string,
  gatewayOrigin: string,
): void => {
  const normalized = normalizeGatewayOrigin(gatewayOrigin);
  if (!normalized) {
    throw new Error(`Invalid Stella model gateway origin: ${gatewayOrigin}`);
  }
  knownGatewayOrigins.set(siteKey(siteBaseUrl), normalized);
};

export const getRememberedStellaGatewayOrigin = (
  siteBaseUrl: string | null | undefined,
): string | null =>
  siteBaseUrl ? (knownGatewayOrigins.get(siteKey(siteBaseUrl)) ?? null) : null;

type CapabilityCacheEntry = {
  capability: string;
  expiresAt: number;
};

const capabilityCache = new Map<string, CapabilityCacheEntry>();
const inFlightExchanges = new Map<string, Promise<CapabilityCacheEntry>>();

export const decodeJwtPayload = (
  token: string,
): Record<string, unknown> | null => {
  const [, payload] = token.split(".");
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const decoded = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return decoded && typeof decoded === "object"
      ? (decoded as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const jwtStringClaim = (
  payload: Record<string, unknown>,
  claim: string,
): string =>
  typeof payload[claim] === "string" ? payload[claim].trim() : "";

export const ownerIdFromBetterAuthToken = (token: string): string | null => {
  const payload = decodeJwtPayload(token);
  if (!payload) return null;
  return jwtStringClaim(payload, "sub") || null;
};

export const sessionCapabilityJti = (capability: string): string | null => {
  const payload = decodeJwtPayload(capability);
  if (!payload) return null;
  return jwtStringClaim(payload, "jti") || null;
};

const deviceKeyProofForSigner = async (args: {
  signer: DeviceSigner;
  ownerId: string;
  gatewayOrigin: string;
  now: number;
}): Promise<GatewayDeviceKeyProof> => ({
  alg: args.signer.alg,
  publicKey: base64UrlEncode(args.signer.rawPublicKey),
  signature: await args.signer.sign(
    deviceExchangeSigningInput({
      ownerId: args.ownerId,
      gatewayOrigin: args.gatewayOrigin,
      timestamp: args.now,
    }),
  ),
  timestamp: args.now,
});

export const dpopHeadersForSessionCapability = async (args: {
  signer: DeviceSigner;
  capability: string;
  method: string;
  pathname: string;
  requestId: string;
  now: number;
}): Promise<Record<string, string>> => {
  const jti = sessionCapabilityJti(args.capability);
  if (!jti) {
    throw new Error("Stella model gateway returned an invalid session capability.");
  }
  const timestamp = args.now;
  return {
    [GATEWAY_DPOP_HEADER]: await args.signer.sign(
      dpopSigningInput({
        method: args.method,
        pathname: args.pathname,
        jti,
        requestId: args.requestId,
        timestamp,
      }),
    ),
    [GATEWAY_DPOP_KEY_HEADER]: base64UrlEncode(args.signer.rawPublicKey),
    [GATEWAY_DPOP_TS_HEADER]: String(timestamp),
    [GATEWAY_DPOP_ALG_HEADER]: args.signer.alg,
  };
};

const authIdentity = (token: string): string => {
  const payload = decodeJwtPayload(token);
  if (!payload) return `token:${token}`;
  const audience = Array.isArray(payload.aud)
    ? payload.aud.join(",")
    : jwtStringClaim(payload, "aud");
  const anonymous =
    typeof payload.isAnonymous === "boolean" ? String(payload.isAnonymous) : "";
  return [
    "jwt",
    jwtStringClaim(payload, "iss"),
    jwtStringClaim(payload, "sub"),
    jwtStringClaim(payload, "tokenIdentifier"),
    audience,
    anonymous,
  ].join(":");
};

const cacheKey = (args: {
  gatewayOrigin: string;
  authToken: string;
  signer: DeviceSigner;
}): string =>
  [
    args.gatewayOrigin,
    authIdentity(args.authToken),
    base64UrlEncode(args.signer.rawPublicKey),
  ].join("|");

const readGatewayError = async (
  response: Response,
): Promise<{ code?: string; message?: string }> => {
  try {
    const body = (await response.json()) as Partial<GatewayErrorBody>;
    const error = body?.error;
    return {
      code: typeof error?.code === "string" ? error.code : undefined,
      message: typeof error?.message === "string" ? error.message : undefined,
    };
  } catch {
    return {};
  }
};

export class GatewaySessionExchangeError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, code?: string, message?: string) {
    super(
      `Stella model gateway refused the session capability exchange (HTTP ${status}${code ? ` ${code}` : ""}${message ? `: ${message}` : ""})`,
    );
    this.name = "GatewaySessionExchangeError";
    this.status = status;
    this.code = code;
  }
}

const isSessionCapabilityResponse = (
  value: unknown,
): value is GatewaySessionCapabilityResponse => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GatewaySessionCapabilityResponse>;
  return (
    typeof candidate.capability === "string" &&
    candidate.capability.length > 0 &&
    typeof candidate.expiresAt === "number" &&
    Number.isFinite(candidate.expiresAt)
  );
};

const exchangeOnce = async (args: {
  gatewayOrigin: string;
  authToken: string;
  signer: DeviceSigner;
  fetchImpl: typeof fetch;
  now: () => number;
  turnstileToken?: string;
}): Promise<CapabilityCacheEntry> => {
  const ownerId = ownerIdFromBetterAuthToken(args.authToken);
  if (!ownerId) {
    throw new Error("Stella sign-in token is missing its owner identity.");
  }
  const deviceKey = await deviceKeyProofForSigner({
    signer: args.signer,
    ownerId,
    gatewayOrigin: new URL(args.gatewayOrigin).origin,
    now: args.now(),
  });
  const body: GatewaySessionCapabilityRequest = {
    deviceKey,
    ...(args.turnstileToken
      ? { turnstileToken: args.turnstileToken }
      : {}),
  };
  const response = await args.fetchImpl(
    `${args.gatewayOrigin}${GATEWAY_SESSION_CAPABILITY_PATH}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GATEWAY_SESSION_EXCHANGE_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    const { code, message } = await readGatewayError(response);
    if (
      (response.status === 400 || response.status === 401) &&
      code === "dpop_invalid"
    ) {
      throw new Error(STELLA_GATEWAY_DEVICE_VERIFICATION_MESSAGE);
    }
    throw new GatewaySessionExchangeError(response.status, code, message);
  }
  const payload = (await response.json()) as unknown;
  if (!isSessionCapabilityResponse(payload)) {
    throw new Error(
      "Stella model gateway returned a malformed session capability response",
    );
  }
  return { capability: payload.capability, expiresAt: payload.expiresAt };
};

export type GatewaySessionClientArgs = {
  gatewayOrigin: () => string | null;
  getAuthToken: () => Promise<string | undefined> | string | undefined;
  refreshAuthToken?: () => Promise<string | undefined> | string | undefined;
  getChallengeToken?: () => Promise<string | undefined>;
  getDeviceSigner: () => Promise<DeviceSigner> | DeviceSigner;
  fetch?: typeof fetch;
  now?: () => number;
};

export type GatewaySessionClient = {
  getCapability(): Promise<string | undefined>;
  refreshCapability(rejected?: string): Promise<string | undefined>;
  invalidate(): Promise<void>;
  getDeviceSigner(): Promise<DeviceSigner>;
};

export const createGatewaySessionClient = (
  args: GatewaySessionClientArgs,
): GatewaySessionClient => {
  const now = args.now ?? (() => Date.now());
  const fetchImpl = args.fetch ?? globalThis.fetch;
  let signerPromise: Promise<DeviceSigner> | null = null;

  const getDeviceSigner = (): Promise<DeviceSigner> => {
    if (signerPromise) return signerPromise;
    const pending = Promise.resolve(args.getDeviceSigner());
    signerPromise = pending;
    void pending.catch(() => {
      if (signerPromise === pending) signerPromise = null;
    });
    return pending;
  };

  const requireOrigin = (): string => {
    const origin = args.gatewayOrigin();
    if (!origin) throw new Error(STELLA_GATEWAY_UNCONFIGURED_MESSAGE);
    return origin;
  };

  const exchange = async (
    gatewayOrigin: string,
    authToken: string,
  ): Promise<CapabilityCacheEntry> => {
    const signer = await getDeviceSigner();
    const key = cacheKey({
      gatewayOrigin,
      authToken,
      signer,
    });
    const inFlight = inFlightExchanges.get(key);
    if (inFlight) return inFlight;
    const work = (async () => {
      let currentAuthToken = authToken;
      let refreshedAuth = false;
      let challenged = false;
      let turnstileToken: string | undefined;
      while (true) {
        try {
          return await exchangeOnce({
            gatewayOrigin,
            authToken: currentAuthToken,
            signer,
            fetchImpl,
            now,
            turnstileToken,
          });
        } catch (error) {
          if (
            error instanceof GatewaySessionExchangeError &&
            error.status === 401 &&
            !refreshedAuth &&
            !turnstileToken &&
            args.refreshAuthToken
          ) {
            refreshedAuth = true;
            const refresh = args.refreshAuthToken;
            const refreshed = (
              await withDeadline(
                { label: "Refreshing your Stella sign-in", timeoutMs: REQUEST_BUDGET_MS.lookup },
                async () => await refresh(),
              )
            )?.trim();
            if (refreshed && refreshed !== currentAuthToken) {
              currentAuthToken = refreshed;
              continue;
            }
          }
          if (
            error instanceof GatewaySessionExchangeError &&
            error.status === 403 &&
            error.code === "challenge_required" &&
            !challenged
          ) {
            challenged = true;
            try {
              turnstileToken = (await args.getChallengeToken?.())?.trim();
            } catch {
              throw new Error(STELLA_GATEWAY_CHALLENGE_REQUIRED_MESSAGE);
            }
            if (!turnstileToken) {
              throw new Error(STELLA_GATEWAY_CHALLENGE_REQUIRED_MESSAGE);
            }
            continue;
          }
          throw error;
        }
      }
    })();
    inFlightExchanges.set(key, work);
    try {
      const entry = await work;
      capabilityCache.set(key, entry);
      return entry;
    } finally {
      if (inFlightExchanges.get(key) === work) inFlightExchanges.delete(key);
    }
  };

  const getCapability = async (
    forceRefresh: boolean,
    rejected?: string,
  ): Promise<string | undefined> => {
    const gatewayOrigin = requireOrigin();
    const authToken = (await args.getAuthToken())?.trim();
    if (!authToken) return undefined;
    const signer = await getDeviceSigner();
    const key = cacheKey({
      gatewayOrigin,
      authToken,
      signer,
    });
    const replaced = rejected ? capabilityCache.get(key) : undefined;
    if (
      replaced &&
      replaced.capability !== rejected &&
      replaced.expiresAt - GATEWAY_SESSION_CAPABILITY_REFRESH_SKEW_MS > now()
    ) {
      return replaced.capability;
    }
    if (rejected) {
      const inFlight = inFlightExchanges.get(key);
      if (inFlight) return (await inFlight).capability;
    }
    if (forceRefresh) {
      capabilityCache.delete(key);
    } else {
      const cached = capabilityCache.get(key);
      if (
        cached &&
        cached.expiresAt - GATEWAY_SESSION_CAPABILITY_REFRESH_SKEW_MS > now()
      ) {
        return cached.capability;
      }
      capabilityCache.delete(key);
    }
    return (await exchange(gatewayOrigin, authToken)).capability;
  };

  return {
    getCapability: () => getCapability(false),
    refreshCapability: (rejected) => getCapability(true, rejected?.trim() || undefined),
    getDeviceSigner,
    invalidate: async () => {
      const gatewayOrigin = args.gatewayOrigin();
      const authToken = (await args.getAuthToken())?.trim();
      if (!gatewayOrigin || !authToken) return;
      const signer = await getDeviceSigner();
      capabilityCache.delete(cacheKey({ gatewayOrigin, authToken, signer }));
    },
  };
};
