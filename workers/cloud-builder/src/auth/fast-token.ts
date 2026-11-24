import { makeSignature, symmetricDecrypt, type SecretConfig } from "better-auth/crypto";
import { importJWK, SignJWT } from "jose";
import { bearerCredential } from "../../../shared/bearer.js";
import type { BetterAuthKeys } from "../secret-rotation.js";
import { ownerModeRefusesAuthPath } from "../selfhost/owner-mode.js";
import {
  backendUrl,
  SESSION_EXPIRES_IN_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
  STELLA_JWT_AUDIENCE,
  STELLA_JWT_TTL_SECONDS,
  stellaJwtClaims,
} from "./config.js";

/**
 * `GET /api/auth/token` for a signed `Authorization: Bearer` session token,
 * answered without building Better Auth: the same HMAC check as its bearer()
 * plugin, one D1 round trip (session + user, and the JWKS rows), and the
 * decrypted signing key kept in the isolate.
 *
 * It mints exactly the JWT Better Auth's jwt() plugin would (same key choice,
 * header, claims and claim order; RS256 is deterministic, so the bytes match)
 * and only for a session Better Auth would answer without writing. Anything
 * else returns `null` and Better Auth answers: no or unsigned bearer, a bad
 * signature, an unknown, expired or user-less session, a session due for its
 * daily sliding refresh (Better Auth extends it and sends `set-auth-token`),
 * and a JWKS with no live RS256 key (Better Auth mints one).
 *
 * The signing key is chosen from the rows read on every request, as Better
 * Auth's resolveSigningKey does; only the decrypted CryptoKey is cached, keyed
 * by key id, ciphertext and the secret, so a rotated, removed or re-encrypted
 * key is never used after D1 changes.
 *
 * Unlike Better Auth's handler, the request is not counted by its per-IP
 * limiter (100 per 10 s on /token). Only a caller holding a validly signed,
 * live session reaches this path; everyone else still goes through it.
 */

const SESSION_EXPIRES_IN_MS = SESSION_EXPIRES_IN_SECONDS * 1000;
const SESSION_UPDATE_AGE_MS = SESSION_UPDATE_AGE_SECONDS * 1000;
const SIGNING_ALG = "RS256";
const SIGNED_BEARER = /^([^.]+)\.([A-Za-z0-9+/]{43}=)$/u;

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
    const parsed = new Date(value).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

/** Better Auth's `secretConfig` for the options auth.ts passes (`secret` + versioned `secrets`). */
const betterAuthSecretConfig = (keys: BetterAuthKeys): string | SecretConfig => {
  if (!keys.versioned) return keys.current;
  return {
    keys: new Map([[2, keys.current]]),
    currentVersion: 2,
    legacySecret: keys.previous ?? keys.current,
  };
};

type JwksRow = {
  id: string;
  privateKey: string;
  alg: string | null;
  createdAt: string | number | null;
  expiresAt: string | number | null;
};

/** Better Auth's resolveSigningKey with no overrides: newest live RS256 (or alg-less) key. */
const latestSigningRow = (rows: JwksRow[], nowMs: number): JwksRow | null => {
  const live = rows.filter((row) => {
    if (row.alg !== SIGNING_ALG && row.alg != null) return false;
    if (row.expiresAt == null) return true;
    const expiresAtMs = parseDbTimeMs(row.expiresAt);
    return expiresAtMs !== null && expiresAtMs > nowMs;
  });
  const createdAt = (row: JwksRow) => parseDbTimeMs(row.createdAt) ?? Number.NaN;
  if (live.some((row) => !Number.isFinite(createdAt(row)))) return null;
  return [...live].sort((a, b) => createdAt(b) - createdAt(a))[0] ?? null;
};

type SigningKey = {
  kid: string;
  ciphertext: string;
  current: string;
  previous: string | undefined;
  versioned: boolean;
  privateKey: CryptoKey;
};

let signingKeyCache: SigningKey | null = null;

const signingKeyFor = async (row: JwksRow, keys: BetterAuthKeys): Promise<SigningKey | null> => {
  const cached = signingKeyCache;
  if (
    cached &&
    cached.kid === row.id &&
    cached.ciphertext === row.privateKey &&
    cached.current === keys.current &&
    cached.previous === keys.previous &&
    cached.versioned === keys.versioned
  ) {
    return cached;
  }
  const privateWebKey = await symmetricDecrypt({
    key: betterAuthSecretConfig(keys),
    data: JSON.parse(row.privateKey),
  });
  const imported = await importJWK(JSON.parse(privateWebKey), SIGNING_ALG);
  if (!(imported instanceof CryptoKey)) return null;
  const entry: SigningKey = {
    kid: row.id,
    ciphertext: row.privateKey,
    current: keys.current,
    previous: keys.previous,
    versioned: keys.versioned,
    privateKey: imported,
  };
  signingKeyCache = entry;
  return entry;
};

type SessionUserRow = {
  sessionId: string;
  expiresAt: string | number;
  userId: string;
  email: string | null;
  isAnonymous: number | boolean | null;
  identityLevel: number | null;
};

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

  // Better Auth's bearer({ requireSignature: true }): `<token>.<HMAC-SHA256>`
  // under its current secret. A bearer signed with the previous secret was
  // re-signed by resignLegacySessionCredentials before this runs.
  const presented = bearerCredential(request.headers.get("authorization"));
  if (!presented) return null;
  const decoded = decodeBearer(presented);
  if (!decoded) return null;
  const match = SIGNED_BEARER.exec(decoded);
  if (!match) return null;
  const [, sessionToken, presentedSig] = match as unknown as [string, string, string];
  const expectedSig = await makeSignature(sessionToken, keys.current);
  if (!constantTimeEqual(presentedSig, expectedSig)) return null;

  const [sessionResult, jwksResult] = await env.DB.batch([
    env.DB.prepare(
      'SELECT s."id" AS sessionId, s."expiresAt" AS expiresAt, u."id" AS userId, u."email" AS email, u."isAnonymous" AS isAnonymous, u."identityLevel" AS identityLevel FROM "session" s INNER JOIN "user" u ON u."id" = s."userId" WHERE s."token" = ? LIMIT 1',
    ).bind(sessionToken),
    env.DB.prepare('SELECT "id", "privateKey", "alg", "createdAt", "expiresAt" FROM "jwks"'),
  ]);
  const row = (sessionResult?.results?.[0] ?? null) as SessionUserRow | null;
  if (!row) return null;
  const nowMs = Date.now();

  // Better Auth's getSession: an expired session is deleted and refused, and
  // one past `updateAge` is extended (a write plus a new set-auth-token).
  const expiresAtMs = parseDbTimeMs(row.expiresAt);
  if (expiresAtMs === null || expiresAtMs < nowMs) return null;
  if (expiresAtMs - SESSION_EXPIRES_IN_MS + SESSION_UPDATE_AGE_MS <= nowMs) return null;

  const signingRow = latestSigningRow((jwksResult?.results ?? []) as JwksRow[], nowMs);
  if (!signingRow?.id || !signingRow.privateKey) return null;
  const signingKey = await signingKeyFor(signingRow, keys);
  if (!signingKey) return null;

  // Better Auth's getJwtToken + signJWT, claim for claim and in its order.
  const iat = Math.floor(nowMs / 1000);
  const user = {
    isAnonymous: row.isAnonymous === 1 || row.isAnonymous === true,
    identityLevel: row.identityLevel,
    email: row.email,
  };
  const token = await new SignJWT({
    iat,
    ...stellaJwtClaims(env, user, { id: row.sessionId }),
    sub: row.userId,
  })
    .setProtectedHeader({ alg: SIGNING_ALG, kid: signingKey.kid })
    .setExpirationTime(iat + STELLA_JWT_TTL_SECONDS)
    .setIssuer(issuer)
    .setAudience(STELLA_JWT_AUDIENCE)
    .setIssuedAt(iat)
    .setSubject(row.userId)
    .sign(signingKey.privateKey);

  return Response.json({ token }, { status: 200, headers: { "cache-control": "no-store" } });
};
