import {
  PAIRING_MAX_ATTEMPTS,
  PAIRING_TTL_MS,
  REVIEW_PAIRING_DEFAULT_DAYS,
  REVIEW_PAIRING_MAX_DAYS,
  formatPairingLink,
  type PairingClaimRequest,
  type PairingClaimResponse,
  type PairingStartResponse,
  type PairingStatusResponse,
} from "@stella/contracts/self-host";
import { makeSignature } from "better-auth/crypto";
import { bearerCredential } from "../../../shared/bearer.js";
import { adminAccessDenied } from "../admin/access.js";
import { createAuth, backendUrl, ownerInternalCall } from "../auth/auth.js";
import { verifyUserToken } from "../auth-jwt.js";
import { fail, json } from "../http/response.js";
import { fixedWorkSha256SecretEqual } from "../service-bearer.js";
import { serverDiscovery } from "./discovery.js";
import { ownerModeEnabled } from "./owner-mode.js";
import { readServerIdentity, type ServerIdentity } from "./owner.js";

export const DEVICE_PAIRING_PREFIX = "/api/auth/device-pairing/";

const CLAIM_WINDOW_MS = 10 * 60_000;
const CLAIMS_PER_IP_PER_WINDOW = 10;
const STARTS_PER_WINDOW = 30;
const DEVICE_NAME_MAX = 80;
const PLATFORMS = new Set(["ios", "android", "macos", "windows", "linux", "web", "cli"]);
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/u;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{32,128}$/u;

type PairingRow = {
  id: string;
  owner_user_id: string;
  secret_hash: string;
  status: string;
  attempts: number;
  expires_at: number;
  device_name: string | null;
  claimed_at: number | null;
  reusable: number;
  uses: number;
};

const DAY_MS = 24 * 60 * 60_000;

const reviewPairingEnabled = (env: Cloudflare.Env): boolean =>
  (env as unknown as Record<string, unknown>).STELLA_REVIEW_PAIRING === "1";

const readStart = async (request: Request): Promise<{ review: boolean; days: number } | null> => {
  const text = await request.text().catch(() => "");
  if (!text.trim()) return { review: false, days: 0 };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object") return null;
  const { review, days } = body as { review?: unknown; days?: unknown };
  if (review !== undefined && typeof review !== "boolean") return null;
  if (!review) return { review: false, days: 0 };
  if (days === undefined) return { review: true, days: REVIEW_PAIRING_DEFAULT_DAYS };
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > REVIEW_PAIRING_MAX_DAYS) return null;
  return { review: true, days };
};

const db = (env: Cloudflare.Env): D1Database => {
  if (!env.DB) throw new Error("D1 is not bound.");
  return env.DB;
};

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");

const randomToken = (bytes: number): string => base64url(crypto.getRandomValues(new Uint8Array(bytes)));

const sha256Hex = async (value: string): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

const constantTimeEqual = (left: string, right: string): boolean => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
};

const refuse = (status: number, code: string, error: string): Response => fail(status, error, { code });

const clientIp = (request: Request): string =>
  request.headers.get("cf-connecting-ip")?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown";

const rateKeyForIp = (ip: string): string => {
  if (!ip.includes(":")) return ip;
  const [head = "", tail = ""] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  return `${groups.slice(0, 4).join(":")}::/64`;
};

const withinRate = async (env: Cloudflare.Env, key: string, limit: number, now: number): Promise<boolean> => {
  const windowStart = now - (now % CLAIM_WINDOW_MS);
  const row = await db(env)
    .prepare(
      `INSERT INTO device_pairing_rate (key, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN window_start = excluded.window_start THEN count + 1 ELSE 1 END,
         window_start = excluded.window_start
       RETURNING count`,
    )
    .bind(key, windowStart)
    .first<{ count: number }>();
  return (row?.count ?? 0) <= limit;
};

type Starter = { kind: "admin" } | { kind: "owner"; sessionId: string };

const authorizeStarter = async (
  request: Request,
  env: Cloudflare.Env,
  identity: ServerIdentity,
): Promise<Starter | Response> => {
  const credential = bearerCredential(request.headers.get("authorization")) ?? "";
  if (!credential) return refuse(401, "unauthenticated", "Sign in to connect a device.");
  const rawSecret = (env as unknown as Record<string, unknown>).STELLA_ADMIN_API_SECRET;
  const adminSecret = typeof rawSecret === "string" ? rawSecret.trim() : "";
  if (adminSecret && (await fixedWorkSha256SecretEqual(credential, adminSecret))) {
    const denied = await adminAccessDenied(request, env);
    return denied ?? { kind: "admin" };
  }
  if (credential.split(".").length === 3) {
    const verified = await verifyUserToken(credential, env);
    if (verified.ok && verified.token.ownerId === identity.ownerUserId) {
      return { kind: "owner", sessionId: verified.token.sessionId };
    }
    if (!verified.ok && verified.retryable) return refuse(503, "unavailable", "Couldn't check your sign-in. Try again.");
  } else {
    const session = (await createAuth(env)
      .api.getSession({ headers: new Headers({ authorization: `Bearer ${credential}` }) })
      .catch(() => null)) as { user?: { id?: string }; session?: { id?: string } } | null;
    if (session?.user?.id === identity.ownerUserId && session.session?.id) {
      return { kind: "owner", sessionId: session.session.id };
    }
  }
  return refuse(403, "forbidden", "Only this server's owner can connect devices.");
};

const ownerIdentity = async (env: Cloudflare.Env): Promise<ServerIdentity | Response> => {
  if (!ownerModeEnabled(env)) return refuse(404, "owner_mode_off", "This server doesn't use device pairing.");
  const identity = await readServerIdentity(env, true);
  return identity ?? refuse(409, "owner_missing", "This server has no owner yet. Run setup first.");
};

const start = async (request: Request, env: Cloudflare.Env): Promise<Response> => {
  const identity = await ownerIdentity(env);
  if (identity instanceof Response) return identity;
  const starter = await authorizeStarter(request, env, identity);
  if (starter instanceof Response) return starter;
  const options = await readStart(request);
  if (!options) {
    return refuse(400, "bad_request", `Send {} or {"review": true, "days": 1-${REVIEW_PAIRING_MAX_DAYS}}.`);
  }
  if (options.review && !reviewPairingEnabled(env)) {
    return refuse(403, "review_pairing_off", "Reusable review codes are off on this server (STELLA_REVIEW_PAIRING).");
  }
  if (options.review && starter.kind !== "admin") {
    return refuse(403, "forbidden", "Only the server's admin key can make a review code.");
  }
  const now = Date.now();
  if (!(await withinRate(env, `start:${identity.ownerUserId}`, STARTS_PER_WINDOW, now))) {
    return refuse(429, "pairing_rate_limited", "Too many pairing codes. Wait a few minutes.");
  }
  const pairingId = randomToken(16);
  const secret = randomToken(32);
  const expiresAt = now + (options.review ? options.days * DAY_MS : PAIRING_TTL_MS);
  await db(env)
    .prepare(
      `INSERT INTO device_pairings (id, owner_user_id, secret_hash, status, attempts, created_by, created_at, expires_at, reusable)
       VALUES (?, ?, ?, 'pending', 0, ?, ?, ?, ?)`,
    )
    .bind(
      pairingId,
      identity.ownerUserId,
      await sha256Hex(secret),
      starter.kind === "admin" ? "admin" : `session:${starter.sessionId}`,
      now,
      expiresAt,
      options.review ? 1 : 0,
    )
    .run();
  console.log(JSON.stringify({ event: "device_pairing_started", by: starter.kind, review: options.review }));
  const body: PairingStartResponse = {
    pairingId,
    secret,
    expiresAt,
    link: formatPairingLink({ server: backendUrl(env), pairingId, secret }),
    ...(options.review ? { reusable: true } : {}),
  };
  return json(body);
};

const statusOf = (row: PairingRow, now: number): PairingStatusResponse["status"] => {
  if (row.status === "claimed") return "claimed";
  if (row.status === "canceled") return "canceled";
  if (row.expires_at <= now || row.attempts >= PAIRING_MAX_ATTEMPTS) return "expired";
  return "pending";
};

const loadPairing = async (env: Cloudflare.Env, pairingId: string, ownerUserId: string): Promise<PairingRow | null> =>
  await db(env)
    .prepare("SELECT * FROM device_pairings WHERE id = ? AND owner_user_id = ?")
    .bind(pairingId, ownerUserId)
    .first<PairingRow>();

const status = async (request: Request, env: Cloudflare.Env): Promise<Response> => {
  const identity = await ownerIdentity(env);
  if (identity instanceof Response) return identity;
  const starter = await authorizeStarter(request, env, identity);
  if (starter instanceof Response) return starter;
  const pairingId = new URL(request.url).searchParams.get("pairingId") ?? "";
  if (!ID_PATTERN.test(pairingId)) return refuse(400, "bad_request", "Missing pairingId.");
  const row = await loadPairing(env, pairingId, identity.ownerUserId);
  if (!row) return refuse(404, "pairing_invalid", "No such pairing.");
  const body: PairingStatusResponse = {
    status: statusOf(row, Date.now()),
    deviceName: row.device_name,
    claimedAt: row.claimed_at,
    ...(row.reusable ? { reusable: true, uses: row.uses } : {}),
  };
  return json(body);
};

const cancel = async (request: Request, env: Cloudflare.Env): Promise<Response> => {
  const identity = await ownerIdentity(env);
  if (identity instanceof Response) return identity;
  const starter = await authorizeStarter(request, env, identity);
  if (starter instanceof Response) return starter;
  const body = (await request.json().catch(() => null)) as { pairingId?: unknown } | null;
  const pairingId = typeof body?.pairingId === "string" ? body.pairingId : "";
  if (!ID_PATTERN.test(pairingId)) return refuse(400, "bad_request", "Missing pairingId.");
  const result = await db(env)
    .prepare("UPDATE device_pairings SET status = 'canceled' WHERE id = ? AND owner_user_id = ? AND status = 'pending'")
    .bind(pairingId, identity.ownerUserId)
    .run();
  const signedOut = await revokePairingSessions(env, pairingId, identity.ownerUserId);
  return json({ canceled: Boolean(result.meta.changes), ...(signedOut ? { signedOut } : {}) });
};

const revokePairingSessions = async (env: Cloudflare.Env, pairingId: string, ownerUserId: string): Promise<number> => {
  const { results } = await db(env)
    .prepare(
      `SELECT s.session_id FROM device_pairing_sessions s
       JOIN device_pairings p ON p.id = s.pairing_id
       WHERE s.pairing_id = ? AND p.owner_user_id = ? AND p.reusable = 1`,
    )
    .bind(pairingId, ownerUserId)
    .all<{ session_id: string }>();
  for (const { session_id: sessionId } of results) {
    await db(env).prepare(`DELETE FROM "session" WHERE "id" = ? AND "userId" = ?`).bind(sessionId, ownerUserId).run();
    await ownerInternalCall(env, ownerUserId, "account.sessionRevoked", { sessionId }).catch(() => undefined);
    await ownerInternalCall(env, ownerUserId, "devices.pushSessionEnded", { sessionId }).catch(() => undefined);
  }
  await db(env).prepare("DELETE FROM device_pairing_sessions WHERE pairing_id = ?").bind(pairingId).run();
  return results.length;
};

const signedSessionToken = async (env: Cloudflare.Env, token: string): Promise<string> => {
  const context = await createAuth(env).$context;
  return encodeURIComponent(`${token}.${await makeSignature(token, context.secret)}`);
};

const readClaim = async (request: Request): Promise<PairingClaimRequest | null> => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.pairingId !== "string" || typeof body.secret !== "string") return null;
  if (!ID_PATTERN.test(body.pairingId) || !SECRET_PATTERN.test(body.secret)) return null;
  const deviceName =
    typeof body.deviceName === "string"
      ? body.deviceName.replace(/[\u0000-\u001f\u007f]/gu, "").trim().slice(0, DEVICE_NAME_MAX) || undefined
      : undefined;
  const platform =
    typeof body.platform === "string" && PLATFORMS.has(body.platform)
      ? (body.platform as PairingClaimRequest["platform"])
      : undefined;
  return {
    pairingId: body.pairingId,
    secret: body.secret,
    ...(deviceName ? { deviceName } : {}),
    ...(platform ? { platform } : {}),
  };
};

const claim = async (request: Request, env: Cloudflare.Env): Promise<Response> => {
  if (!ownerModeEnabled(env)) return refuse(404, "owner_mode_off", "This server doesn't use device pairing.");
  const now = Date.now();
  const ipKey = `claim:${await sha256Hex(rateKeyForIp(clientIp(request)))}`;
  if (!(await withinRate(env, ipKey, CLAIMS_PER_IP_PER_WINDOW, now))) {
    console.warn(JSON.stringify({ event: "device_pairing_rate_limited" }));
    return refuse(429, "pairing_rate_limited", "Too many tries. Wait a few minutes and scan a fresh code.");
  }
  const input = await readClaim(request);
  if (!input) return refuse(400, "bad_request", "That pairing code isn't valid.");
  const attempt = await db(env)
    .prepare(
      `UPDATE device_pairings SET attempts = attempts + 1
       WHERE id = ? AND status = 'pending' AND expires_at > ? AND attempts < ?
       RETURNING secret_hash, owner_user_id, attempts, reusable`,
    )
    .bind(input.pairingId, now, PAIRING_MAX_ATTEMPTS)
    .first<{ secret_hash: string; owner_user_id: string; attempts: number; reusable: number }>();
  const providedHash = await sha256Hex(input.secret);
  if (!attempt) {
    const row = await db(env).prepare("SELECT * FROM device_pairings WHERE id = ?").bind(input.pairingId).first<PairingRow>();
    if (!row) return refuse(404, "pairing_invalid", "That pairing code isn't valid.");
    const state = statusOf(row, now);
    if (state === "claimed") return refuse(410, "pairing_claimed", "This pairing code was already used.");
    if (state === "canceled") return refuse(410, "pairing_canceled", "This pairing code was canceled.");
    if (row.attempts >= PAIRING_MAX_ATTEMPTS) {
      return refuse(403, "pairing_too_many_attempts", "Too many wrong tries. Make a new pairing code.");
    }
    return refuse(410, "pairing_expired", "This pairing code expired. Make a new one.");
  }
  if (!constantTimeEqual(providedHash, attempt.secret_hash)) {
    console.warn(JSON.stringify({ event: "device_pairing_wrong_secret", attempts: attempt.attempts }));
    return attempt.attempts >= PAIRING_MAX_ATTEMPTS
      ? refuse(403, "pairing_too_many_attempts", "Too many wrong tries. Make a new pairing code.")
      : refuse(401, "pairing_invalid", "That pairing code isn't valid.");
  }
  const reusable = attempt.reusable === 1;
  const claimed = await db(env)
    .prepare(
      reusable
        ? `UPDATE device_pairings SET attempts = 0, uses = uses + 1, claimed_at = ?, device_name = ?, platform = ?
           WHERE id = ? AND status = 'pending' AND reusable = 1 AND secret_hash = ? RETURNING owner_user_id`
        : `UPDATE device_pairings SET status = 'claimed', claimed_at = ?, device_name = ?, platform = ?
           WHERE id = ? AND status = 'pending' AND secret_hash = ? RETURNING owner_user_id`,
    )
    .bind(now, input.deviceName ?? null, input.platform ?? null, input.pairingId, attempt.secret_hash)
    .first<{ owner_user_id: string }>();
  if (!claimed) return refuse(410, "pairing_claimed", "This pairing code was already used.");
  try {
    const context = await createAuth(env).$context;
    const session = (await context.internalAdapter.createSession(claimed.owner_user_id, false, {
      ipAddress: clientIp(request),
      userAgent: [input.deviceName, input.platform, request.headers.get("user-agent")]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 400),
    })) as { id: string; token: string } | null;
    if (!session?.token) throw new Error("No session was created.");
    await db(env)
      .prepare(
        reusable
          ? "INSERT INTO device_pairing_sessions (pairing_id, session_id, created_at) VALUES (?, ?, ?)"
          : "UPDATE device_pairings SET session_id = ? WHERE id = ?",
      )
      .bind(...(reusable ? [input.pairingId, session.id, now] : [session.id, input.pairingId]))
      .run();
    console.log(JSON.stringify({ event: "device_pairing_claimed", platform: input.platform ?? null, reusable }));
    const body: PairingClaimResponse = {
      sessionToken: await signedSessionToken(env, session.token),
      userId: claimed.owner_user_id,
      server: await serverDiscovery(env),
    };
    return json(body);
  } catch (error) {
    if (!reusable) {
      await db(env)
        .prepare("UPDATE device_pairings SET status = 'pending', claimed_at = NULL WHERE id = ? AND session_id IS NULL")
        .bind(input.pairingId)
        .run();
    }
    console.error(
      JSON.stringify({
        event: "device_pairing_claim_failed",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return refuse(503, "pairing_unavailable", "Couldn't finish connecting. Try again.");
  }
};

export const sweepDevicePairings = async (env: Cloudflare.Env, now = Date.now()): Promise<void> => {
  if (!ownerModeEnabled(env)) return;
  const { results: ended } = await db(env)
    .prepare(
      `SELECT DISTINCT p.id, p.owner_user_id FROM device_pairings p
       JOIN device_pairing_sessions s ON s.pairing_id = p.id
       WHERE p.reusable = 1 AND p.expires_at < ?`,
    )
    .bind(now)
    .all<{ id: string; owner_user_id: string }>();
  for (const pairing of ended) await revokePairingSessions(env, pairing.id, pairing.owner_user_id);
  await db(env).batch([
    db(env)
      .prepare("DELETE FROM device_pairing_sessions WHERE pairing_id IN (SELECT id FROM device_pairings WHERE expires_at < ?)")
      .bind(now - DAY_MS),
    db(env).prepare("DELETE FROM device_pairings WHERE expires_at < ?").bind(now - DAY_MS),
    db(env).prepare("DELETE FROM device_pairing_rate WHERE window_start < ?").bind(now - CLAIM_WINDOW_MS),
  ]);
};

const ROUTES: Record<string, { method: string; run: (request: Request, env: Cloudflare.Env) => Promise<Response> }> = {
  start: { method: "POST", run: start },
  status: { method: "GET", run: status },
  cancel: { method: "POST", run: cancel },
  claim: { method: "POST", run: claim },
};

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-max-age": "600",
};

export const handleDevicePairingRoute = async (request: Request, env: Cloudflare.Env): Promise<Response> => {
  const name = new URL(request.url).pathname.slice(DEVICE_PAIRING_PREFIX.length);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const route = ROUTES[name];
  let response: Response;
  if (!route) response = refuse(404, "not_found", "Not found.");
  else if (request.method !== route.method) response = refuse(405, "method_not_allowed", "Method not allowed.");
  else {
    try {
      response = await route.run(request, env);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "device_pairing_failed",
          route: name,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
      response = refuse(503, "pairing_unavailable", "Pairing is unavailable right now. Try again.");
    }
  }
  for (const [key, value] of Object.entries(CORS)) response.headers.set(key, value);
  return response;
};
