/**
 * Whether a signed-in session was signed out, for every door that accepts a
 * Stella JWT or a socket ticket minted from one. The owner's OwnerGate holds
 * the state (`account` domain); other objects and the worker read it through
 * a per-isolate cache, so a revoked JWT is refused everywhere within
 * REVOCATION_CACHE_MS of the sign-out.
 */

import type { VerifiedToken, VerifyResult } from "./auth-jwt.js";
import { withInfrastructureDeadline } from "./build-session/shared/keys.js";
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
const REVOCATION_LOOKUP_TIMEOUT_MS = 3_000;
const CACHE_MAX = 10_000;
const cache = new Map<string, { revocations: SessionRevocations; fetchedAtMs: number }>();

export const forgetSessionRevocations = (ownerId: string): void => {
  cache.delete(ownerId);
};

const ownerSessionRevocations = async (
  env: Pick<Cloudflare.Env, "OWNER_GATES">,
  ownerId: string,
): Promise<SessionRevocations> => {
  const now = Date.now();
  const cached = cache.get(ownerId);
  if (cached && now - cached.fetchedAtMs < REVOCATION_CACHE_MS) return cached.revocations;
  const revocations = await withInfrastructureDeadline(
    ownerGateStub(env.OWNER_GATES, ownerId).sessionRevocations(),
    REVOCATION_LOOKUP_TIMEOUT_MS,
    "session revocation lookup timed out",
  );
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
