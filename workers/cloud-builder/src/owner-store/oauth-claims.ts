import type { OwnerContext } from "./registry.js";

/**
 * An OAuth callback is finished by whoever approves at the provider, in any
 * browser, so it never attaches the result to the owner named in the state.
 * It parks the result here under a fresh one-time code that only that browser
 * receives, and the owner's own signed-in session redeems it. Someone who sends
 * their connect link to another person never sees the code.
 *
 * Claims live in the integrations domain's `oauth_nonces` table, so its purge
 * removes them.
 */

export type OAuthClaimKind = "x" | "slack_install";

export const OAUTH_CLAIM_TTL_MS = 10 * 60_000;
export const CONNECT_CODE_LENGTH = 12;
const CONNECT_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const randomConnectCode = (): string =>
  [...crypto.getRandomValues(new Uint8Array(CONNECT_CODE_LENGTH))]
    .map((byte) => CONNECT_CODE_ALPHABET[byte & 31])
    .join("");

export const normalizeConnectCode = (input: string): string =>
  input
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");

export const formatConnectCode = (code: string): string => code.match(/.{1,4}/g)?.join("-") ?? code;

const claimKind = (kind: OAuthClaimKind) => `claim:${kind}`;

export const issueOAuthClaim = (ctx: OwnerContext, kind: OAuthClaimKind, data: Record<string, unknown>): string => {
  ctx.db.run("DELETE FROM oauth_nonces WHERE expires_at <= ?", ctx.now);
  const code = randomConnectCode();
  ctx.db.run(
    "INSERT INTO oauth_nonces (nonce, kind, data, expires_at) VALUES (?, ?, ?, ?)",
    code,
    claimKind(kind),
    JSON.stringify(data),
    ctx.now + OAUTH_CLAIM_TTL_MS,
  );
  return code;
};

export const redeemOAuthClaim = (
  ctx: OwnerContext,
  kind: OAuthClaimKind,
  input: string,
): Record<string, unknown> | null => {
  const code = normalizeConnectCode(input);
  if (code.length !== CONNECT_CODE_LENGTH) return null;
  const row = ctx.db.one<{ data: string | null; expires_at: number }>(
    "SELECT data, expires_at FROM oauth_nonces WHERE nonce = ? AND kind = ?",
    code,
    claimKind(kind),
  );
  if (!row) return null;
  ctx.db.run("DELETE FROM oauth_nonces WHERE nonce = ?", code);
  if (row.expires_at <= ctx.now) return null;
  const data = JSON.parse(row.data ?? "null") as unknown;
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
};
