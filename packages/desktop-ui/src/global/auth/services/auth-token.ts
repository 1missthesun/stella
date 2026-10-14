import { configurePiRuntime } from "@/platform/electron/device";
import { getStellaInteriorBridge } from "@/platform/interior/interior-bridge";
import { getJwtExpMs, parseJwtPayload } from "@/shared/lib/jwt";
import { authClient } from "@/global/auth/lib/auth-client";

let cachedToken: string | null = null;
let tokenExpiresAt = 0;
let inflightTokenPromise: Promise<string | null> | null = null;
let tokenRequestVersion = 0;

const REFRESH_MARGIN_MS = 60_000;

type GetAuthTokenOptions = {
  forceRefresh?: boolean;
};

const invalidateTokenCache = (): void => {
  tokenRequestVersion += 1;
  cachedToken = null;
  tokenExpiresAt = 0;
  inflightTokenPromise = null;
};

export async function getAuthToken(
  options: GetAuthTokenOptions = {},
): Promise<string | null> {
  const forceRefresh = options.forceRefresh ?? false;

  if (forceRefresh) {
    invalidateTokenCache();
  }

  if (!forceRefresh && cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  if (inflightTokenPromise) {
    return inflightTokenPromise;
  }

  const requestVersion = tokenRequestVersion;
  inflightTokenPromise = (async () => {
    try {
      if (typeof window === "undefined") return null;
      const interiorBridge = getStellaInteriorBridge();
      const systemApi = window.electronAPI?.system;
      let token: string | null | undefined;
      let scopedTokenExpiresAt: number | null = null;
      if (interiorBridge) {
        const scoped = await interiorBridge.getToken({ forceRefresh });
        token = scoped.token;
        scopedTokenExpiresAt = scoped.expiresAt;
      } else if (systemApi?.getAuthToken) {
        await configurePiRuntime();
        token = await systemApi.getAuthToken();
      } else {
        const result = await authClient.token();
        token = result.data?.token ?? null;
      }
      if (!token) {
        if (requestVersion === tokenRequestVersion) {
          cachedToken = null;
          tokenExpiresAt = 0;
        }
        return null;
      }

      if (requestVersion !== tokenRequestVersion) {
        return token;
      }

      cachedToken = token;
      if (scopedTokenExpiresAt !== null) {
        if (scopedTokenExpiresAt <= Date.now()) {
          cachedToken = null;
          tokenExpiresAt = 0;
          return null;
        }
        tokenExpiresAt = Math.max(
          Date.now(),
          scopedTokenExpiresAt - REFRESH_MARGIN_MS,
        );
      } else {
        try {
          tokenExpiresAt = getJwtExpMs(token) - REFRESH_MARGIN_MS;
        } catch (err) {
          console.debug(
            "[auth-token] JWT parse failed, using 4-minute cache:",
            (err as Error).message,
          );
          tokenExpiresAt = Date.now() + 4 * 60 * 1000;
        }
      }

      return token;
    } catch (err) {
      console.debug("[auth-token] token fetch failed:", (err as Error).message);
      if (requestVersion === tokenRequestVersion) {
        cachedToken = null;
        tokenExpiresAt = 0;
      }
      return null;
    } finally {
      if (requestVersion === tokenRequestVersion) {
        inflightTokenPromise = null;
      }
    }
  })();

  return inflightTokenPromise;
}

const tokenSubject = (token: string): string | null => {
  try {
    const payload = parseJwtPayload<{ sub?: unknown }>(token);
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
};

export async function getAuthTokenForSubject(
  expectedSubject: string,
): Promise<string | null> {
  const expected = expectedSubject.trim();
  if (!expected || expected !== expectedSubject) return null;
  let token = await getAuthToken();
  if (getStellaInteriorBridge()) return token;
  if (token && tokenSubject(token) === expected) return token;
  token = await getAuthToken({ forceRefresh: true });
  return token && tokenSubject(token) === expected ? token : null;
}

export async function getAuthHeaders(
  extra?: Record<string, string>,
): Promise<Record<string, string>> {
  const token = await getAuthToken();
  return {
    ...extra,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function clearCachedToken(): void {
  invalidateTokenCache();
}
