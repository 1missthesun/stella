/**
 * Claude Code logins (desktop and cloud): reading whether a stored login
 * still works, and the one sentence a person sees when it doesn't.
 *
 * A claude.ai login lasts a fixed time from signing in (about four weeks);
 * using or refreshing it does not extend that. Claude Code records the end
 * as `refreshTokenExpiresAt`, and clears the refresh token (with
 * `loginEnded: "time_limit"` from 2.1.321) once Anthropic refuses it.
 */
export type StoredClaudeLogin = {
  /** A claude.ai login is stored (alive or not). */
  present: boolean;
  alive: boolean;
  /** When Anthropic ends it (epoch ms), when Claude Code knows. */
  expiresAt?: number;
};

/** Reads Claude Code's `.credentials.json` text without keeping any secret. */
export const readStoredClaudeLogin = (credentialsJson: string | null | undefined, now = Date.now()): StoredClaudeLogin => {
  if (!credentialsJson) return { present: false, alive: false };
  let oauth: Record<string, unknown> | undefined;
  try {
    const parsed = JSON.parse(credentialsJson) as { claudeAiOauth?: unknown };
    oauth =
      parsed.claudeAiOauth && typeof parsed.claudeAiOauth === "object"
        ? (parsed.claudeAiOauth as Record<string, unknown>)
        : undefined;
  } catch {
    return { present: false, alive: false };
  }
  if (!oauth) return { present: false, alive: false };
  const expiresAt =
    typeof oauth.refreshTokenExpiresAt === "number" && Number.isFinite(oauth.refreshTokenExpiresAt)
      ? oauth.refreshTokenExpiresAt
      : undefined;
  const alive =
    typeof oauth.refreshToken === "string" &&
    oauth.refreshToken.length > 0 &&
    oauth.loginEnded === undefined &&
    (expiresAt === undefined || expiresAt > now);
  return { present: true, alive, ...(expiresAt !== undefined ? { expiresAt } : {}) };
};

/**
 * Claude Code's wording when Anthropic refused the login (expired, time
 * limit, revoked, signed out, 401), as opposed to a usage limit.
 */
export const isClaudeLoginFailureText = (text: string): boolean =>
  /\bOAuth access token has been revoked\b|\btoken_(?:expired|revoked)\b|\bfailed to authenticate\b|\bauthentication_error\b|\bapi error:?\s*401\b|\b401\s+unauthorized\b|\binvalid bearer token\b|\bnot logged in\b|\bOAuth authentication (?:failed|is currently not supported)\b|\blogin expired\b|\breached its time limit\b|\bOAuth session expired\b/i.test(
    text,
  );

export const cloudClaudeLoginEndedText = (email: string | undefined): string =>
  email
    ? `Your Claude sign-in for ${email} in your cloud has ended. Sign in again in Settings › Account › Claude to continue.`
    : "Your Claude sign-in in your cloud has ended. Sign in again in Settings › Account › Claude to continue.";
