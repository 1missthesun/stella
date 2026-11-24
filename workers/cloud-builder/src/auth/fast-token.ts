import { makeSignature, symmetricDecrypt, type SecretConfig } from "better-auth/crypto";
import { importJWK, SignJWT } from "jose";
import { bearerCredential } from "../../../shared/bearer.js";
import type { BetterAuthKeys } from "../secret-rotation.js";
import { ownerModeRefusesAuthPath } from "../selfhost/owner-mode.js";
import { backendUrl, testAccountsEnabled } from "./auth.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN_TTL_SECONDS = 15 * 60;
const SIGNING_KEY_CACHE_MS = 5 * 60 * 1000;
const TEST_ACCOUNT_EMAIL_SUFFIX = "@test.stella.local";
const SIGNED_BEARER = /^([^.]+)\.([A-Za-z0-9+/]{43}=)$/u;

type CachedSigningKey = {
  kid: string;
  alg: string;
  privateKey: CryptoKey;
  expiresAtMs: number | null;
  secretFingerprint: string;
  cachedAtMs: number;
};

let signingKeyCache: CachedSigningKey | null = null;

const constantTimeEqual = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
};

const decodeBearer = (value: string): string | null => {
  if (!value.includes("%")) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

const parseDbTimeMs = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const buildSecretConfig = (keys: BetterAuthKeys): string | SecretConfig => {
  if (!keys.versioned) return keys.current;
  return {
    currentVersion: 2,
    keys: new Map([[2, keys.current]]),
    ...(keys.previous ? { legacySecret: keys.previous } : {}),
  };
};

const loadSigningKey = async (
  db: D1Database,
  keys: BetterAuthKeys,
  nowMs: number,
): Promise<CachedSigningKey | null> => {
  const fingerprint = `${keys.versioned ? "v2" : "v1"}:${keys.current.length}:${keys.previous?.length ?? 0}`;
  if (
    signingKeyCache &&
    signingKeyCache.secretFingerprint === fingerprint &&
    nowMs - signingKeyCache.cachedAtMs < SIGNING_KEY_CACHE_MS &&
    (signingKeyCache.expiresAtMs === null || signingKeyCache.expiresAtMs > nowMs)
  ) {
    return signingKeyCache;
  }
  const row = await db
    .prepare(
      'SELECT "id", "privateKey", "alg", "expiresAt" FROM "jwks" WHERE ("alg" = \'RS256\' OR "alg" IS NULL) ORDER BY "createdAt" DESC LIMIT 1',
    )
    .first<{
      id: string;
      privateKey: string;
      alg: string | null;
      expiresAt: string | number | null;
    }>();
  if (!row?.id || !row.privateKey) return null;
  const expiresAtMs = row.expiresAt != null ? parseDbTimeMs(row.expiresAt) : null;
  if (expiresAtMs !== null && expiresAtMs <= nowMs) return null;
  const alg = row.alg || "RS256";
  const privateWebKey = await symmetricDecrypt({
    key: buildSecretConfig(keys),
    data: JSON.parse(row.privateKey),
  });
  const imported = await importJWK(JSON.parse(privateWebKey), alg);
  if (!(imported instanceof CryptoKey)) return null;
  const entry: CachedSigningKey = {
    kid: row.id,
    alg,
    privateKey: imported,
    expiresAtMs,
    secretFingerprint: fingerprint,
    cachedAtMs: nowMs,
  };
  signingKeyCache = entry;
  return entry;
};

type SessionUserRow = {
  sessionId: string;
  expiresAt: string | number;
  updatedAt: string | number;
  userId: string;
  email: string | null;
  isAnonymous: number | boolean | null;
  identityLevel: number | null;
};

/**
 * Fast path for `GET /api/auth/token` with a signed `Authorization: Bearer`
 * session token. Verifies the HMAC signature in-process, performs one D1 JOIN
 * for session+user, and signs with the in-isolate cached RS256 signing key.
 * Returns `null` for any case that should fall through to Better Auth
 * (cookies, missing/expired/stale sessions, uninitialized JWKS).
 */
export const tryFastAuthToken = async (
  request: Request,
  env: Cloudflare.Env,
  keys: BetterAuthKeys,
): Promise<Response | null> => {
  if (request.method !== "GET") return null;
  if (new URL(request.url).pathname !== "/api/auth/token") return null;
  if (ownerModeRefusesAuthPath(env, "/token")) return null;
  if (!env.DB) return null;
  const issuer = backendUrl(env);
  if (!issuer) return null;

  const presented = bearerCredential(request.headers.get("authorization"));
  if (!presented) return null;
  const decoded = decodeBearer(presented);
  if (!decoded) return null;
  const match = SIGNED_BEARER.exec(decoded);
  if (!match) return null;
  const [, sessionToken, presentedSig] = match as unknown as [string, string, string];
  const expectedSig = await makeSignature(sessionToken, keys.current);
  if (!constantTimeEqual(presentedSig, expectedSig)) return null;

  const nowMs = Date.now();
  const [row, signingKey] = await Promise.all([
    env.DB.prepare(
      'SELECT s."id" AS sessionId, s."expiresAt" AS expiresAt, s."updatedAt" AS updatedAt, u."id" AS userId, u."email" AS email, u."isAnonymous" AS isAnonymous, u."identityLevel" AS identityLevel FROM "session" s INNER JOIN "user" u ON u."id" = s."userId" WHERE s."token" = ? LIMIT 1',
    )
      .bind(sessionToken)
      .first<SessionUserRow>(),
    loadSigningKey(env.DB, keys, nowMs).catch(() => null),
  ]);
  if (!row || !signingKey) return null;

  const expiresAtMs = parseDbTimeMs(row.expiresAt);
  const updatedAtMs = parseDbTimeMs(row.updatedAt);
  if (expiresAtMs === null || expiresAtMs <= nowMs) return null;
  // Let Better Auth handle the once-per-day sliding session expiry update.
  if (updatedAtMs === null || nowMs - updatedAtMs >= DAY_MS) return null;

  const nowSeconds = Math.floor(nowMs / 1000);
  const isAnonymous = row.isAnonymous === 1 || row.isAnonymous === true;
  const identityLevel =
    typeof row.identityLevel === "number" && Number.isFinite(row.identityLevel)
      ? row.identityLevel
      : 0;
  const isTestAccount =
    testAccountsEnabled(env) &&
    typeof row.email === "string" &&
    row.email.endsWith(TEST_ACCOUNT_EMAIL_SUFFIX);

  const payload: Record<string, unknown> = {
    sid: row.sessionId,
    ...(isAnonymous ? { anon: true } : {}),
    idl: identityLevel,
    ...(isTestAccount ? { tst: true } : {}),
  };

  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: signingKey.alg, kid: signingKey.kid })
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + TOKEN_TTL_SECONDS)
    .setIssuer(issuer)
    .setAudience("stella")
    .setSubject(row.userId)
    .sign(signingKey.privateKey);

  return Response.json(
    { token },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
};
