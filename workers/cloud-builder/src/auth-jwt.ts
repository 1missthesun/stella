import type { IdentityLevel } from "@stella/contracts/gateway/api";
import { CLOCK_SKEW_S, JWKS_MIN_REFETCH_MS } from "./conversation-types.js";
import { withInfrastructureDeadline } from "./build-session/shared/keys.js";
import { admitSession, ownerGateRevocations, type RevocationSource } from "./session-revocation.js";

export type VerifiedToken = {
  ownerId: string;
  subject: string;
  sessionId: string;
  expiresAtMs: number;
  identityLevel: IdentityLevel;
  issuedAtMs: number;
};

export type VerifyResult =
  | { ok: true; token: VerifiedToken }
  | {
      ok: false;
      reason: string;
      retryable: boolean;
    };

type JwkEntry = { kid: string; jwk: JsonWebKey };

const parsePublicKeys = (body: unknown): JwkEntry[] => {
  if (
    !body ||
    typeof body !== "object" ||
    !("keys" in body) ||
    !Array.isArray(body.keys)
  )
    return [];
  const keys: JwkEntry[] = [];
  for (const raw of body.keys) {
    if (
      !raw ||
      typeof raw !== "object" ||
      !("kid" in raw) ||
      typeof raw.kid !== "string" ||
      !("kty" in raw) ||
      raw.kty !== "RSA" ||
      !("n" in raw) ||
      typeof raw.n !== "string" ||
      !("e" in raw) ||
      typeof raw.e !== "string"
    )
      continue;
    if (
      ("alg" in raw && raw.alg !== "RS256") ||
      ("use" in raw && raw.use !== "sig") ||
      ("key_ops" in raw &&
        (!Array.isArray(raw.key_ops) || !raw.key_ops.includes("verify")))
    )
      continue;
    keys.push({ kid: raw.kid, jwk: { kty: "RSA", n: raw.n, e: raw.e } });
  }
  return keys;
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

type UserKeys = { keys: Map<string, CryptoKey>; fetchedAtMs: number };

const USER_KEYS_LOAD_TIMEOUT_MS = 5_000;

let userKeys: UserKeys | null = null;

const importUserKeys = async (jwks: unknown): Promise<UserKeys> => {
  const keys = new Map<string, CryptoKey>();
  for (const { kid, jwk } of parsePublicKeys(jwks)) {
    keys.set(
      kid,
      await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]),
    );
  }
  return { keys, fetchedAtMs: Date.now() };
};

const JWKS_GRACE_PERIOD_MS = 3600 * 24 * 30 * 1000;

const loadPublicJwksDirect = async (env: Cloudflare.Env): Promise<{ keys: unknown[] } | null> => {
  if (!env.DB) return null;
  const rows = await env.DB.prepare(
    'SELECT "id", "publicKey", "alg", "crv", "expiresAt" FROM "jwks"',
  ).all<{
    id: string;
    publicKey: string;
    alg: string | null;
    crv: string | null;
    expiresAt: string | number | null;
  }>();
  if (!rows.results?.length) return null;
  const now = Date.now();
  const keys: unknown[] = [];
  for (const row of rows.results) {
    if (row.expiresAt != null) {
      const expMs = typeof row.expiresAt === "number" ? row.expiresAt : Date.parse(String(row.expiresAt));
      if (Number.isFinite(expMs) && expMs + JWKS_GRACE_PERIOD_MS <= now) continue;
    }
    try {
      const pub = JSON.parse(row.publicKey) as Record<string, unknown>;
      keys.push({
        alg: row.alg ?? "RS256",
        ...(row.crv ? { crv: row.crv } : {}),
        ...pub,
        kid: row.id,
      });
    } catch {
      continue;
    }
  }
  return keys.length > 0 ? { keys } : null;
};

const loadUserKeys = async (env: Cloudflare.Env): Promise<UserKeys> => {
  const load = (async () => {
    const direct = await loadPublicJwksDirect(env).catch(() => null);
    if (direct) return importUserKeys(direct);
    const { createAuth } = await import("./auth/auth.js");
    return importUserKeys(await createAuth(env).api.getJwks());
  })();
  const loaded = await withInfrastructureDeadline(load, USER_KEYS_LOAD_TIMEOUT_MS, "jwks_load_timeout");
  userKeys = loaded;
  return loaded;
};

const userKey = async (env: Cloudflare.Env, kid: string): Promise<CryptoKey | null> => {
  const cached = userKeys;
  const found = cached?.keys.get(kid);
  if (found) return found;
  if (cached && Date.now() - cached.fetchedAtMs < JWKS_MIN_REFETCH_MS) return null;
  return (await loadUserKeys(env)).keys.get(kid) ?? null;
};

export const verifyUserToken = async (
  token: string,
  env: Cloudflare.Env,
  revocations: RevocationSource = ownerGateRevocations(env),
): Promise<VerifyResult> => {
  const verified = await verifySignedUserToken(token, env);
  return verified.ok ? await admitSession(verified.token, revocations) : verified;
};

export const verifySignedUserToken = async (token: string, env: Cloudflare.Env): Promise<VerifyResult> => {
  const issuer = (env.CLOUD_BUILDER_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
  if (!issuer) return fail("no_issuer_configured", true);
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
  if (typeof payload.nbf === "number" && nowSeconds < payload.nbf - CLOCK_SKEW_S) return fail("not_yet_valid");
  const iat = typeof payload.iat === "number" ? payload.iat : 0;
  if (nowSeconds < iat - CLOCK_SKEW_S) return fail("issued_in_future");
  if (payload.iss !== issuer) return fail("wrong_issuer");
  if (!audienceMatches(payload.aud, "stella")) return fail("wrong_audience");
  const subject = typeof payload.sub === "string" ? payload.sub.trim() : "";
  if (!subject) return fail("no_subject");

  let key: CryptoKey | null;
  try {
    key = await userKey(env, kid);
  } catch (error) {
    return fail(`jwks_unavailable:${error instanceof Error ? error.message : "unknown"}`, true);
  }
  if (!key) return fail("unknown_kid", true);
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      base64UrlToBytes(parts[2]!).buffer as ArrayBuffer,
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`).buffer as ArrayBuffer,
    );
  } catch {
    return fail("verify_threw");
  }
  if (!valid) return fail("bad_signature");
  if (payload.anon === true) return fail("anonymous");
  const idl = payload.idl;
  return {
    ok: true,
    token: {
      ownerId: subject,
      subject,
      sessionId: typeof payload.sid === "string" ? payload.sid : "",
      expiresAtMs: exp * 1000,
      identityLevel: idl === 1 || idl === 2 || idl === 3 ? idl : 1,
      issuedAtMs: iat * 1000,
    },
  };
};
