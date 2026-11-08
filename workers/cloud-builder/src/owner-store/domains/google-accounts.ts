/**
 * Google accounts connected through Stella's own Google app: tokens live in
 * the owner's store, one row per Google account. One sign-in covers every
 * Google service whose scope the user granted.
 */
import type { IntegrationAccount } from "@stella/contracts/backend/integrations";
import { GOOGLE_OAUTH_CALLBACK_PATH } from "@stella/contracts/backend/integrations";
import {
  GOOGLE_OAUTH_SCOPES,
  GOOGLE_OAUTH_STATE_TTL_MS,
  GOOGLE_STATE_KIND,
  GoogleApiError,
  buildGoogleAuthorizationUrl,
  googleClient,
  googleServiceOf,
  parseGoogleScope,
  readGoogleIdentity,
  requestGoogleToken,
  revokeGoogleToken,
  runGoogleAction,
} from "../../integrations/google.js";
import { signOAuthState } from "../../oauth-state.js";
import { object, optional, string } from "../args.js";
import { issueOAuthClaim, redeemOAuthClaim } from "../oauth-claims.js";
import { enforceOwnerRateLimit } from "../rate-limit.js";
import { RpcError } from "../errors.js";
import type { OwnerContext, OwnerDbReader } from "../registry.js";

export const GOOGLE_ACCOUNTS_MIGRATION = {
  id: "integrations.4-google-accounts",
  statements: [
    `CREATE TABLE google_accounts (
       email TEXT PRIMARY KEY,
       google_user_id TEXT,
       access_token TEXT NOT NULL,
       refresh_token TEXT,
       scopes TEXT NOT NULL,
       access_token_expires_at INTEGER,
       is_primary INTEGER NOT NULL DEFAULT 0,
       needs_reconnect INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
  ],
};

type GoogleAccountRow = {
  email: string;
  google_user_id: string | null;
  access_token: string;
  refresh_token: string | null;
  scopes: string;
  access_token_expires_at: number | null;
  is_primary: number;
  needs_reconnect: number;
  created_at: number;
  updated_at: number;
};

const REFRESH_SKEW_MS = 60_000;
const NOT_CONNECTED = "Google isn't connected. Connect it, then try again.";

const scopesOf = (row: GoogleAccountRow): string[] => {
  try {
    const parsed = JSON.parse(row.scopes) as unknown;
    return Array.isArray(parsed) ? parsed.filter((scope): scope is string => typeof scope === "string") : [];
  } catch {
    return [];
  }
};

const grants = (row: GoogleAccountRow, integrationId: string): boolean => {
  const service = googleServiceOf(integrationId);
  return Boolean(service && scopesOf(row).includes(service.scope));
};

const rowsOf = (db: OwnerDbReader): GoogleAccountRow[] =>
  db.all<GoogleAccountRow>("SELECT * FROM google_accounts ORDER BY is_primary DESC, created_at ASC");

/** Every Google account the user connected through Stella, whatever it granted. */
export const hasStellaGoogleAccounts = (db: OwnerDbReader): boolean =>
  Boolean(db.one("SELECT 1 AS found FROM google_accounts LIMIT 1"));

/** Accounts that granted this integration's scope, primary first. */
export const stellaGoogleAccounts = (db: OwnerDbReader, integrationId: string): IntegrationAccount[] =>
  rowsOf(db)
    .filter((row) => grants(row, integrationId))
    .map((row) => ({
      id: row.email,
      email: row.email,
      label: row.email,
      primary: row.is_primary === 1,
      connected: row.needs_reconnect === 0,
    }));

const redirectUriOf = (env: Cloudflare.Env): string => {
  const base = env.CLOUD_BUILDER_PUBLIC_URL?.replace(/\/+$/u, "");
  if (!base) throw new RpcError("UNAVAILABLE", "Google isn't set up on this server.");
  return `${base}${GOOGLE_OAUTH_CALLBACK_PATH}`;
};

const requireClient = (env: Cloudflare.Env) => {
  const client = googleClient(env);
  if (!client) throw new RpcError("UNAVAILABLE", "Google isn't set up on this server.");
  return { client, redirectUri: redirectUriOf(env) };
};

let reportedUnavailable = false;

export const stellaGoogleAvailable = (env: Cloudflare.Env): boolean => {
  const available = Boolean(googleClient(env) && env.CLOUD_BUILDER_PUBLIC_URL);
  if (!available && !reportedUnavailable) {
    reportedUnavailable = true;
    const raw = (env as unknown as Record<string, unknown>).GOOGLE_CLOUD_OAUTH_CLIENT_JSON;
    console.warn(JSON.stringify({
      event: "google_cloud_client_unavailable",
      clientJsonType: typeof raw,
      clientJsonLength: typeof raw === "string" ? raw.length : 0,
      clientParsed: Boolean(googleClient(env)),
      publicUrl: Boolean(env.CLOUD_BUILDER_PUBLIC_URL),
    }));
  }
  return available;
};

/** A Google sign-in link for this owner. */
export const stellaGoogleConnectUrl = async (ctx: OwnerContext, options: { loginHint?: string } = {}): Promise<string> => {
  const { client, redirectUri } = requireClient(ctx.env);
  const nonce = crypto.randomUUID();
  const expiresAt = ctx.now + GOOGLE_OAUTH_STATE_TTL_MS;
  ctx.db.run("DELETE FROM oauth_nonces WHERE expires_at <= ?", ctx.now);
  ctx.db.run(
    "INSERT INTO oauth_nonces (nonce, kind, data, expires_at) VALUES (?, ?, NULL, ?)",
    nonce,
    GOOGLE_STATE_KIND,
    expiresAt,
  );
  const state = await signOAuthState(ctx.env, { ownerId: ctx.ownerId, kind: GOOGLE_STATE_KIND, nonce, exp: expiresAt });
  return buildGoogleAuthorizationUrl({
    clientId: client.clientId,
    redirectUri,
    state,
    ...(options.loginHint ? { loginHint: options.loginHint } : {}),
  });
};

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

const expiresAtOf = (expiresIn: unknown, issuedAt: number): number | null =>
  typeof expiresIn === "number" && Number.isFinite(expiresIn) ? issuedAt + Math.floor(expiresIn) * 1000 : null;

const parseComplete = object({
  nonce: string({ min: 1, max: 128 }),
  code: optional(string({ max: 2_048 })),
  error: optional(string({ max: 512 })),
});

/** Finishes a Google sign-in from the OAuth callback and stores the account. */
export const completeStellaGoogleOAuth = async (
  ctx: OwnerContext,
  raw: unknown,
): Promise<{ email: string; connectCode: string }> => {
  const args = parseComplete(raw);
  const nonce = ctx.db.one<{ expires_at: number }>(
    "SELECT expires_at FROM oauth_nonces WHERE nonce = ? AND kind = ?",
    args.nonce,
    GOOGLE_STATE_KIND,
  );
  ctx.db.run("DELETE FROM oauth_nonces WHERE nonce = ?", args.nonce);
  if (!nonce || nonce.expires_at <= ctx.now) {
    throw new RpcError("CONFLICT", "This link expired. Start connecting Google again from Stella.");
  }
  if (args.error) throw new RpcError("BAD_REQUEST", "Google sign-in was cancelled.");
  if (!args.code) throw new RpcError("BAD_REQUEST", "Google didn't send a sign-in code. Try again.");
  const { client, redirectUri } = requireClient(ctx.env);
  const token = await requestGoogleToken(client, {
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: redirectUri,
  });
  const accessToken = text(token.body.access_token);
  if (!token.ok || !accessToken) {
    console.error(JSON.stringify({ event: "google_token_exchange_failed", status: token.status, error: text(token.body.error) }));
    throw new RpcError("BAD_REQUEST", "Google sign-in didn't finish. Try again.");
  }
  const identity = await readGoogleIdentity(accessToken);
  if (!identity) throw new RpcError("BAD_REQUEST", "Couldn't read which Google account this is. Try again.");
  const granted = parseGoogleScope(token.body.scope);
  const scopes = granted.length > 0 ? granted : [...GOOGLE_OAUTH_SCOPES];
  // Whoever approved at Google may not be the Stella user who started the
  // link, so nothing attaches yet: the result waits under a one-time code
  // that only the approver's own Stella app receives and redeems.
  const connectCode = issueOAuthClaim(ctx, "google", {
    email: identity.email,
    googleUserId: identity.googleUserId,
    accessToken,
    refreshToken: text(token.body.refresh_token),
    scopes,
    accessTokenExpiresAt: expiresAtOf(token.body.expires_in, Date.now()),
  });
  return { email: identity.email, connectCode };
};

/** Redeems a connect code in the caller's own store; a code issued to another Stella user isn't there. */
export const finishStellaGoogleConnect = (ctx: OwnerContext, connectCode: string): { email: string } => {
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    "integrations.finishConnect",
    { count: 20, windowMs: 10 * 60_000 },
    "Too many connect attempts. Wait a few minutes and try again.",
  );
  const claim = redeemOAuthClaim(ctx, "google", connectCode);
  const email = text(claim?.email);
  const accessToken = text(claim?.accessToken);
  if (!claim || !email || !accessToken) {
    throw new RpcError(
      "CONFLICT",
      "That code has expired, was already used, or was made for a different Stella account. Start connecting Google again from this account.",
    );
  }
  const scopes = Array.isArray(claim.scopes)
    ? claim.scopes.filter((scope): scope is string => typeof scope === "string")
    : [...GOOGLE_OAUTH_SCOPES];
  const now = Date.now();
  const first = !hasStellaGoogleAccounts(ctx.db);
  ctx.db.run(
    `INSERT INTO google_accounts (email, google_user_id, access_token, refresh_token, scopes,
       access_token_expires_at, is_primary, needs_reconnect, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
     ON CONFLICT (email) DO UPDATE SET google_user_id = excluded.google_user_id,
       access_token = excluded.access_token,
       refresh_token = COALESCE(excluded.refresh_token, google_accounts.refresh_token),
       scopes = excluded.scopes, access_token_expires_at = excluded.access_token_expires_at,
       needs_reconnect = 0, updated_at = excluded.updated_at`,
    email,
    text(claim.googleUserId),
    accessToken,
    text(claim.refreshToken),
    JSON.stringify(scopes),
    typeof claim.accessTokenExpiresAt === "number" ? claim.accessTokenExpiresAt : null,
    first ? 1 : 0,
    now,
    now,
  );
  return { email };
};

const refreshing = new Map<string, Promise<string>>();

const markNeedsReconnect = (ctx: OwnerContext, email: string) => {
  ctx.db.run("UPDATE google_accounts SET needs_reconnect = 1, updated_at = ? WHERE email = ?", Date.now(), email);
};

const freshAccess = (row: GoogleAccountRow): string | null =>
  row.access_token_expires_at === null || row.access_token_expires_at > Date.now() + REFRESH_SKEW_MS
    ? row.access_token
    : null;

const refreshAccess = async (ctx: OwnerContext, row: GoogleAccountRow): Promise<string> => {
  const client = googleClient(ctx.env);
  const expired = `${row.email} needs reconnecting to Google. Reconnect it in Stella.`;
  if (!client || !row.refresh_token) {
    markNeedsReconnect(ctx, row.email);
    throw new RpcError("CONFLICT", expired, { reason: "not_connected" });
  }
  const token = await requestGoogleToken(client, { grant_type: "refresh_token", refresh_token: row.refresh_token });
  const accessToken = text(token.body.access_token);
  if (!token.ok || !accessToken) {
    if (text(token.body.error) === "invalid_grant") markNeedsReconnect(ctx, row.email);
    console.error(JSON.stringify({ event: "google_token_refresh_failed", status: token.status, error: text(token.body.error) }));
    throw new RpcError("CONFLICT", expired, { reason: "not_connected" });
  }
  const now = Date.now();
  const scopes = parseGoogleScope(token.body.scope);
  ctx.db.run(
    `UPDATE google_accounts SET access_token = ?, refresh_token = COALESCE(?, refresh_token),
       scopes = COALESCE(?, scopes), access_token_expires_at = ?, needs_reconnect = 0, updated_at = ?
     WHERE email = ?`,
    accessToken,
    text(token.body.refresh_token),
    scopes.length > 0 ? JSON.stringify(scopes) : null,
    expiresAtOf(token.body.expires_in, now),
    now,
    row.email,
  );
  return accessToken;
};

const accessTokenOf = async (ctx: OwnerContext, row: GoogleAccountRow, force = false): Promise<string> => {
  const fresh = force ? null : freshAccess(row);
  if (fresh) return fresh;
  const key = `${ctx.ownerId}\0${row.email}`;
  let run = refreshing.get(key);
  if (!run) {
    run = refreshAccess(ctx, row).finally(() => refreshing.delete(key));
    refreshing.set(key, run);
  }
  return await run;
};

/** The account to use: the one named (by email), else the primary. */
const resolveRow = (ctx: OwnerContext, integrationId: string, account?: string): GoogleAccountRow => {
  const rows = rowsOf(ctx.db).filter((row) => grants(row, integrationId));
  if (rows.length === 0) throw new RpcError("CONFLICT", NOT_CONNECTED, { reason: "not_connected" });
  if (!account) return rows.find((row) => row.is_primary === 1) ?? rows[0]!;
  const wanted = account.trim().toLowerCase();
  const found = rows.find((row) => row.email === wanted);
  if (!found) {
    throw new RpcError(
      "BAD_REQUEST",
      `${account} isn't connected. Connected: ${rows.map((row) => row.email).join(", ")}.`,
    );
  }
  return found;
};

/** Runs a Google action as one connected account, refreshing the token once if Google rejects it. */
export const runStellaGoogleAction = async (
  ctx: OwnerContext,
  integrationId: string,
  action: string,
  input: Record<string, unknown>,
  account?: string,
): Promise<unknown> => {
  const row = resolveRow(ctx, integrationId, account);
  if (row.needs_reconnect === 1) {
    throw new RpcError("CONFLICT", `${row.email} needs reconnecting to Google. Reconnect it in Stella.`, {
      reason: "not_connected",
    });
  }
  const attempt = async (force: boolean) =>
    await runGoogleAction(await accessTokenOf(ctx, row, force), integrationId, action, input);
  try {
    try {
      return await attempt(false);
    } catch (error) {
      if (error instanceof GoogleApiError && error.status === 401) return await attempt(true);
      throw error;
    }
  } catch (error) {
    if (error instanceof RpcError) throw error;
    if (error instanceof GoogleApiError) {
      throw new RpcError(
        error.status === 404 ? "NOT_FOUND" : error.status === 429 ? "RATE_LIMITED" : "BAD_REQUEST",
        `Google: ${error.message}`,
        { retryable: error.status === 429 || error.status >= 500 },
      );
    }
    throw error;
  }
};

/** Live access tokens for every connected account that granted Gmail, for the digest. */
export const stellaGmailTokens = async (
  ctx: OwnerContext,
): Promise<{ email: string; primary: boolean; accessToken: () => Promise<string> }[]> =>
  rowsOf(ctx.db)
    .filter((row) => grants(row, "gmail") && row.needs_reconnect === 0)
    .map((row) => ({
      email: row.email,
      primary: row.is_primary === 1,
      accessToken: () => accessTokenOf(ctx, row),
    }));

export const setPrimaryStellaGoogleAccount = (ctx: OwnerContext, integrationId: string, account: string): IntegrationAccount[] => {
  const row = resolveRow(ctx, integrationId, account);
  ctx.db.run("UPDATE google_accounts SET is_primary = CASE WHEN email = ? THEN 1 ELSE 0 END", row.email);
  return stellaGoogleAccounts(ctx.db, integrationId);
};

/** Disconnects a Google account from every Google service and revokes Stella's access. */
export const removeStellaGoogleAccount = async (
  ctx: OwnerContext,
  integrationId: string,
  account: string,
): Promise<IntegrationAccount[]> => {
  const row = resolveRow(ctx, integrationId, account);
  ctx.db.run("DELETE FROM google_accounts WHERE email = ?", row.email);
  if (row.is_primary === 1) {
    ctx.db.run(
      "UPDATE google_accounts SET is_primary = 1 WHERE email = (SELECT email FROM google_accounts ORDER BY created_at ASC LIMIT 1)",
    );
  }
  await revokeGoogleToken(row.refresh_token ?? row.access_token);
  return stellaGoogleAccounts(ctx.db, integrationId);
};

/** Revokes and forgets every Google account (account deletion). */
export const purgeStellaGoogleAccounts = async (ctx: OwnerContext): Promise<void> => {
  for (const row of rowsOf(ctx.db)) {
    await revokeGoogleToken(row.refresh_token ?? row.access_token);
  }
  ctx.db.run("DELETE FROM google_accounts");
};
