export const JWKS_TTL_MS = 10 * 60_000;
export const JWKS_MIN_REFETCH_MS = 60_000;
export const CLOCK_SKEW_S = 60;

export type VerifiedToken = {
  ownerId: string;
  subject: string;
  sessionId: string;
  issuedAtMs: number;
  expiresAtMs: number;
  testAccount: boolean;
};

export type VerifyResult =
  | { ok: true; token: VerifiedToken }
  | {
      ok: false;
      reason: string;
      retryable: boolean;
    };

const JWKS_PATH = "/api/auth/jwks";

export const jwksUrlFor = (issuer: string): string =>
  `${issuer.replace(/\/+$/, "")}${JWKS_PATH}`;

type JwkEntry = { kid: string; jwk: JsonWebKey };

type JwksCacheEntry = {
  keys: JwkEntry[];
  fetchedAtMs: number;
  imported: Map<string, CryptoKey>;
};

const jwksCache = new Map<string, JwksCacheEntry>();
const jwksInflight = new Map<string, Promise<JwksCacheEntry>>();

const fetchJwks = async (
  url: string,
  fetchImpl: typeof fetch,
): Promise<JwksCacheEntry> => {
  const inflight = jwksInflight.get(url);
  if (inflight) return inflight;
  const pending = (async (): Promise<JwksCacheEntry> => {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`JWKS fetch failed with ${response.status}.`);
    }
    const body = (await response.json()) as { keys?: unknown };
    const keys: JwkEntry[] = [];
    if (Array.isArray(body.keys)) {
      for (const raw of body.keys) {
        if (typeof raw !== "object" || raw === null) continue;
        const jwk = raw as JsonWebKey & { kid?: unknown; kty?: unknown };
        if (typeof jwk.kid !== "string" || jwk.kty !== "RSA") continue;
        keys.push({ kid: jwk.kid, jwk });
      }
    }
    const entry: JwksCacheEntry = {
      keys,
      fetchedAtMs: Date.now(),
      imported: new Map(),
    };
    jwksCache.set(url, entry);
    return entry;
  })().finally(() => {
    jwksInflight.delete(url);
  });
  jwksInflight.set(url, pending);
  return pending;
};

const resolveJwks = async (
  url: string,
  wantedKid: string,
  fetchImpl: typeof fetch,
): Promise<JwksCacheEntry> => {
  const cached = jwksCache.get(url);
  const now = Date.now();
  if (!cached) return await fetchJwks(url, fetchImpl);
  const stale = now - cached.fetchedAtMs >= JWKS_TTL_MS;
  const missing = !cached.keys.some((key) => key.kid === wantedKid);
  const mayRefetch = now - cached.fetchedAtMs >= JWKS_MIN_REFETCH_MS;
  if (stale || (missing && mayRefetch)) {
    try {
      return await fetchJwks(url, fetchImpl);
    } catch (error) {
      if (!missing) return cached;
      throw error;
    }
  }
  return cached;
};

const importKey = async (
  entry: JwksCacheEntry,
  kid: string,
): Promise<CryptoKey | null> => {
  const existing = entry.imported.get(kid);
  if (existing) return existing;
  const found = entry.keys.find((key) => key.kid === kid);
  if (!found) return null;
  const key = await crypto.subtle.importKey(
    "jwk",
    found.jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  entry.imported.set(kid, key);
  return key;
};

const base64UrlToBytes = (value: string): Uint8Array => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const decodeSegment = (segment: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(segment)),
    );
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const audienceMatches = (audience: unknown, expected: string): boolean => {
  if (typeof audience === "string") return audience === expected;
  if (Array.isArray(audience)) {
    return audience.some((entry) => entry === expected);
  }
  return false;
};

const fail = (reason: string, retryable = false): VerifyResult => ({
  ok: false,
  reason,
  retryable,
});

export const verifyUserToken = async (
  token: string,
  issuer: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifyResult> => {
  const pinnedIssuer = issuer.replace(/\/+$/, "");
  if (!pinnedIssuer) return fail("no_issuer_configured", true);
  const parts = token.split(".");
  if (parts.length !== 3) return fail("malformed");

  const header = decodeSegment(parts[0]!);
  const payload = decodeSegment(parts[1]!);
  if (!header || !payload) return fail("malformed");

  if (header.alg !== "RS256") return fail("unsupported_alg");
  const kid = typeof header.kid === "string" ? header.kid : "";
  if (!kid) return fail("no_kid");

  const nowSeconds = Math.floor(Date.now() / 1000);
  const exp = typeof payload.exp === "number" ? payload.exp : null;
  if (exp === null) return fail("no_exp");
  if (nowSeconds > exp + CLOCK_SKEW_S) return fail("expired");
  if (
    typeof payload.nbf === "number" &&
    nowSeconds < payload.nbf - CLOCK_SKEW_S
  ) {
    return fail("not_yet_valid");
  }
  if (
    typeof payload.iat === "number" &&
    nowSeconds < payload.iat - CLOCK_SKEW_S
  ) {
    return fail("issued_in_future");
  }
  if (payload.iss !== pinnedIssuer) return fail("wrong_issuer");
  if (!audienceMatches(payload.aud, "stella")) return fail("wrong_audience");
  const subject = typeof payload.sub === "string" ? payload.sub.trim() : "";
  if (!subject) return fail("no_subject");

  let key: CryptoKey | null;
  try {
    const jwks = await resolveJwks(jwksUrlFor(pinnedIssuer), kid, fetchImpl);
    key = await importKey(jwks, kid);
  } catch (error) {
    return fail(
      `jwks_unavailable:${error instanceof Error ? error.message : "unknown"}`,
      true,
    );
  }
  if (!key) return fail("unknown_kid", true);

  const signature = base64UrlToBytes(parts[2]!);
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      signature.buffer as ArrayBuffer,
      signed.buffer as ArrayBuffer,
    );
  } catch {
    return fail("verify_threw");
  }
  if (!valid) return fail("bad_signature");
  if (payload.anon === true) return fail("anonymous");

  return {
    ok: true,
    token: {
      ownerId: subject,
      subject,
      sessionId: typeof payload.sid === "string" ? payload.sid : "",
      issuedAtMs: typeof payload.iat === "number" ? payload.iat * 1000 : 0,
      expiresAtMs: exp * 1000,
      testAccount: payload.tst === true,
    },
  };
};

const PREVIEW_HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

export const sessionIssuerFor = (
  token: string,
  pinnedIssuer: string,
  previewHostSuffix: string | undefined,
): { issuer: string; preview: boolean } => {
  const pinned = { issuer: pinnedIssuer, preview: false };
  const suffix = previewHostSuffix?.trim() ?? "";
  if (!suffix.startsWith("-") || !suffix.includes(".")) return pinned;
  const payload = decodeSegment(token.split(".")[1] ?? "");
  const claimed = typeof payload?.iss === "string" ? payload.iss : "";
  let url: URL;
  try {
    url = new URL(claimed);
  } catch {
    return pinned;
  }
  if (url.protocol !== "https:" || url.origin !== claimed) return pinned;
  if (!url.hostname.endsWith(suffix)) return pinned;
  const label = url.hostname.slice(0, -suffix.length);
  if (!PREVIEW_HOST_LABEL.test(label)) return pinned;
  return { issuer: url.origin, preview: true };
};
