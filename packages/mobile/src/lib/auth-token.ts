import { REQUEST_BUDGET_MS, withDeadline } from "@stella/contracts/request-deadline";
import { authClient } from "./auth-client";
import { assert } from "./assert";
import {
  decodeTokenOwner,
  resolveTokenOwner,
  type AuthenticatedTokenOwner,
} from "./token-owner";

let cachedToken = "";
let cachedTokenExpiresAt = 0;
let inflightTokenPromise: Promise<string> | null = null;
let cacheGeneration = 0;

const REFRESH_MARGIN_MS = 60_000;

async function loadAuthToken() {
  const generation = cacheGeneration;
  const result = await authClient.token();
  const token = result.data?.token;
  assert(token, "You need to sign in again.");
  if (generation === cacheGeneration) {
    const claims = decodeTokenOwner(token);
    cachedToken = token;
    cachedTokenExpiresAt = claims.expiresAtSeconds * 1000 - REFRESH_MARGIN_MS;
  }
  return token;
}

export async function getAuthToken(
  options: {
    forceRefresh?: boolean;
  } = {},
): Promise<string> {
  if (options.forceRefresh) {
    clearCachedToken();
  }
  if (cachedToken && Date.now() < cachedTokenExpiresAt) {
    return cachedToken;
  }

  if (inflightTokenPromise) {
    return inflightTokenPromise;
  }

  const request = withDeadline(
    { label: "Refreshing your sign-in", timeoutMs: REQUEST_BUDGET_MS.call },
    loadAuthToken,
  );
  const tracked = request.finally(() => {
    if (inflightTokenPromise === tracked) inflightTokenPromise = null;
  });
  inflightTokenPromise = tracked;
  return tracked;
}

export async function getAuthTokenForSubject(
  expectedSubject: string,
): Promise<string> {
  return (await getTokenOwnerForSubject(expectedSubject)).token;
}

export type { AuthenticatedTokenOwner } from "./token-owner";

export async function getTokenOwnerForSubject(
  expectedSubject: string,
): Promise<AuthenticatedTokenOwner> {
  return await resolveTokenOwner({
    expectedSubject,
    getToken: ({ forceRefresh }) => getAuthToken({ forceRefresh }),
  });
}

export function clearCachedToken() {
  cachedToken = "";
  cachedTokenExpiresAt = 0;
  inflightTokenPromise = null;
  cacheGeneration += 1;
}
