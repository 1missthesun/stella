/**
 * Whether a signed-in session was signed out, for every door that accepts a
 * Stella JWT or a socket ticket minted from one. The owner's OwnerGate holds
 * the state (`account` domain); other objects and the worker read it through
 * a per-isolate cache, so a revoked JWT is refused everywhere within
 * REVOCATION_CACHE_MS of the sign-out.
 */

import type { VerifiedToken, VerifyResult } from "./auth-jwt.js";
import { log, withInfrastructureDeadline } from "./build-session/shared/keys.js";
import { ownerGateStub } from "./rpc-release.js";

export type SessionRevocations = {
  minIatMs: number;
  sessionIds: readonly string[];
};

export type SessionRevocation = { minIatMs: number } | { sessionId: string };

export type SessionHolder = { issuedAtMs?: number; sessionId?: string };

export const sessionRevokedBy = (
  revocations: SessionRevocations,
  holder: SessionHolder,
): boolean => {
  // JWT `iat` has second precision.
  if (
    revocations.minIatMs > 0 &&
    (holder.issuedAtMs ?? 0) < Math.floor(revocations.minIatMs / 1000) * 1000
  )
    return true;
  return !!holder.sessionId && revocations.sessionIds.includes(holder.sessionId);
};

const REVOCATION_CACHE_MS = 5_000;
// An OwnerGate that has to start up first (it sleeps when idle) takes 3-6 s to
// answer; clients wait 10 s for a socket ticket, so the lookup waits for it
// rather than refusing every request that arrives while it wakes.
const REVOCATION_LOOKUP_TIMEOUT_MS = 8_000;
// When the OwnerGate can't answer in time, the revocations this isolate read
// within this window still stand in for them. A sign-out made in this isolate
// clears its copy, the OwnerGate closes the sockets of a signed-out session
// itself, and owner calls are still checked there.
const REVOCATION_STALE_FALLBACK_MS = 10 * 60_000;
const CACHE_MAX = 10_000;
const cache = new Map<string, { revocations: SessionRevocations; fetchedAtMs: number }>();

export const forgetSessionRevocations = (ownerId: string): void => {
  cache.delete(ownerId);
};

const NO_REVOCATIONS: SessionRevocations = { minIatMs: 0, sessionIds: [] };

const isMissingRevocationMethod = (error: unknown): boolean =>
  error instanceof Error &&
  error.message.includes('does not implement the method "sessionRevocations"');

const ownerSessionRevocations = async (
  env: Pick<Cloudflare.Env, "OWNER_GATES">,
  ownerId: string,
): Promise<SessionRevocations> => {
  const now = Date.now();
  const cached = cache.get(ownerId);
  if (cached && now - cached.fetchedAtMs < REVOCATION_CACHE_MS) return cached.revocations;
  let revocations: SessionRevocations;
  try {
    revocations = await withInfrastructureDeadline(
      ownerGateStub(env.OWNER_GATES, ownerId).sessionRevocations(),
      REVOCATION_LOOKUP_TIMEOUT_MS,
      "session revocation lookup timed out",
    );
  } catch (error) {
    // For a few minutes after a deploy, an OwnerGate still running code from
    // before sign-out revocation existed answers without this method. That
    // code never recorded a revocation, so it has none to report.
    if (isMissingRevocationMethod(error)) return NO_REVOCATIONS;
    const known = cache.get(ownerId);
    if (known && Date.now() - known.fetchedAtMs < REVOCATION_STALE_FALLBACK_MS) {
      log("info", "session_revocations_stale_used", {
        ownerId,
        ageMs: Date.now() - known.fetchedAtMs,
        message: error instanceof Error ? error.message : String(error),
      });
      return known.revocations;
    }
    throw error;
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(ownerId, { revocations, fetchedAtMs: now });
  return revocations;
};

export type RevocationSource = (ownerId: string) => SessionRevocations | Promise<SessionRevocations>;

export const ownerGateRevocations =
  (env: Pick<Cloudflare.Env, "OWNER_GATES">): RevocationSource =>
  (ownerId) =>
    ownerSessionRevocations(env, ownerId);

/** Refuses a verified token, or a ticket minted from one, whose session was signed out. */
export const admitSession = async (
  token: VerifiedToken,
  revocations: RevocationSource,
): Promise<VerifyResult> => {
  let current: SessionRevocations;
  try {
    current = await revocations(token.ownerId);
  } catch (error) {
    return {
      ok: false,
      reason: `revocation_unavailable:${error instanceof Error ? error.message : "unknown"}`,
      retryable: true,
    };
  }
  return sessionRevokedBy(current, token)
    ? { ok: false, reason: "session_revoked", retryable: false }
    : { ok: true, token };
};

/** Records a sign-out at the owner object, which also closes the sockets it reaches. */
export const revokeOwnerSessions = async (
  env: Pick<Cloudflare.Env, "OWNER_GATES">,
  ownerId: string,
  revocation: SessionRevocation,
): Promise<void> => {
  forgetSessionRevocations(ownerId);
  try {
    await ownerGateStub(env.OWNER_GATES, ownerId).revokeSessions(revocation);
  } finally {
    forgetSessionRevocations(ownerId);
  }
};
