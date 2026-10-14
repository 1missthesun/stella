// The passkey stack's tsyringe needs this evaluating ahead of it in this chunk.
import "reflect-metadata";
import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { bearer, jwt, magicLink, oneTimeToken } from "better-auth/plugins";
import { expo } from "@better-auth/expo";

// Loaded after this module's static imports (reflect-metadata first): the
// SimpleWebAuthn stack's tsyringe container throws at evaluation time when
// the Reflect polyfill has not run yet, and bundler chunk order does not
// otherwise guarantee it.
const { passkey } = await import("@better-auth/passkey");
import { importPKCS8, SignJWT } from "jose";
import { bearerCredential } from "../../../shared/bearer.js";
import { isDisposableEmail } from "./disposable-email-domains.js";
import {
  buildMagicLinkEmail,
  buildNewSignInAlertEmail,
  getMagicLinkSubject,
  NEW_SIGN_IN_SUBJECT,
} from "./email-templates.js";
import { stellaHandoff, type HandoffApi } from "./handoff.js";
import { integrityErrorMessage, integrityPurposeForPath, verifyAuthRequestProof } from "./integrity.js";
import { oauthStateBinding } from "./oauth-binding.js";
import { ottCookieHeader } from "./ott-cookie.js";
import { ownerGateStub } from "../rpc-release.js";
import { ownerModeEnabled, ownerModeRefusesAuthPath } from "../selfhost/owner-mode.js";
import { betterAuthCipherKey, betterAuthKeys } from "../secret-rotation.js";

type AuthEnv = Cloudflare.Env;

const isSelfHostOwner = async (env: AuthEnv, userId: string): Promise<boolean> => {
  if (!ownerModeEnabled(env) || !env.DB) return false;
  const row = await env.DB.prepare("SELECT 1 AS owner FROM selfhost_server WHERE owner_user_id = ?")
    .bind(userId)
    .first<{ owner: number }>();
  return row !== null;
};

const DAY_SECONDS = 24 * 60 * 60;
const APPLE_CLIENT_SECRET_TTL_SECONDS = 180 * DAY_SECONDS;
const TEST_ACCOUNT_EMAIL_SUFFIX = "@test.stella.local";
const DEFAULT_WEBSITE_URL = "https://stella.sh";

const configured = (env: unknown, name: string): string | undefined => {
  const value = (env as Record<string, unknown>)[name];
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || undefined;
};

export const backendUrl = (env: Pick<AuthEnv, "CLOUD_BUILDER_PUBLIC_URL">): string =>
  (env.CLOUD_BUILDER_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");

export const authUrl = (env: AuthEnv): string =>
  (configured(env, "STELLA_AUTH_URL") ?? backendUrl(env)).replace(/\/+$/, "");

const localDevOriginsEnabled = (env: unknown): boolean => configured(env, "STELLA_LOCAL_DEV_ORIGINS") === "1";

export const websiteUrl = (env: unknown): string =>
  (configured(env, "STELLA_WEBSITE_URL") ?? DEFAULT_WEBSITE_URL).replace(/\/+$/, "");

/** Origins of Stella's own browser-hosted clients; both auth and CORS trust exactly these. */
export const browserClientOrigins = (env: unknown): string[] => [
  websiteUrl(env),
  DEFAULT_WEBSITE_URL,
  ...(localDevOriginsEnabled(env) ? ["http://localhost:3000", "http://localhost:57314"] : []),
  "http://127.0.0.1:57314",
  "stella-app://desktop",
];

export const testAccountsEnabled = (env: unknown): boolean => configured(env, "STELLA_TEST_ACCOUNTS") === "1";

export const trustedOrigins = (env: AuthEnv): string[] => {
  const scheme = configured(env, "STELLA_MOBILE_SCHEME") ?? "stella-mobile";
  return Array.from(
    new Set([
      backendUrl(env),
      authUrl(env),
      ...browserClientOrigins(env),
      // Native callbacks; platforms serialize the empty path with two or three slashes.
      `${scheme}://`,
      `${scheme}:///`,
      "https://appleid.apple.com",
    ]),
  );
};

const appleProvider = async (env: AuthEnv) => {
  const clientId = configured(env, "APPLE_CLIENT_ID");
  const teamId = configured(env, "APPLE_TEAM_ID");
  const keyId = configured(env, "APPLE_KEY_ID");
  const privateKey = configured(env, "APPLE_PRIVATE_KEY");
  const enabled = Boolean(clientId && teamId && keyId && privateKey);
  let clientSecret = "";
  if (enabled) {
    const key = await importPKCS8(privateKey!.replace(/\\n/g, "\n"), "ES256");
    const now = Math.floor(Date.now() / 1000);
    clientSecret = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: keyId! })
      .setIssuer(teamId!)
      .setSubject(clientId!)
      .setAudience("https://appleid.apple.com")
      .setIssuedAt(now)
      .setExpirationTime(now + APPLE_CLIENT_SECRET_TTL_SECONDS)
      .sign(key);
  }
  return {
    clientId: clientId ?? "",
    clientSecret,
    appBundleIdentifier: configured(env, "APPLE_APP_BUNDLE_IDENTIFIER") ?? "com.stella.mobile",
    enabled,
  };
};

const escapeHtmlAttribute = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const sendMagicLinkEmail = async (env: AuthEnv, email: string, url: string): Promise<void> => {
  if (isDisposableEmail(email)) {
    throw new APIError("BAD_REQUEST", { message: "That email provider isn't supported. Use a different address." });
  }
  if (testAccountsEnabled(env) && email.endsWith(TEST_ACCOUNT_EMAIL_SUFFIX)) {
    console.log(JSON.stringify({ event: "auth_magic_link_test_account", email, url }));
    return;
  }
  const binding = (env as { EMAIL?: SendEmail }).EMAIL;
  const cloudflareFrom = binding ? configured(env, "STELLA_EMAIL_FROM") : undefined;
  const resendKey = configured(env, "RESEND_API_KEY");
  const resendFrom = resendKey ? configured(env, "RESEND_FROM") ?? configured(env, "STELLA_EMAIL_FROM") : undefined;
  if (!cloudflareFrom && !resendFrom) {
    throw new APIError("SERVICE_UNAVAILABLE", { message: "Email sign-in isn't set up on this Stella." });
  }
  const logo = configured(env, "STELLA_EMAIL_LOGO_URL") ?? `${websiteUrl(env)}/stella-logo.png`;
  const message = {
    subject: getMagicLinkSubject(undefined),
    html: buildMagicLinkEmail(escapeHtmlAttribute(logo), escapeHtmlAttribute(url), undefined),
  };
  if (binding && cloudflareFrom) {
    try {
      const sent = await binding.send({ from: parseMailbox(cloudflareFrom), to: email, ...message });
      console.log(JSON.stringify({ event: "auth_magic_link_sent", provider: "cloudflare", messageId: sent.messageId }));
      return;
    } catch (error) {
      const { code, message: detail } = error as { code?: unknown; message?: unknown };
      console.error(JSON.stringify({
        event: "auth_magic_link_email_service_failed",
        code: typeof code === "string" ? code : null,
        detail: typeof detail === "string" ? detail.slice(0, 300) : null,
      }));
      if (!resendFrom) {
        throw new APIError("SERVICE_UNAVAILABLE", { message: "Stella couldn't send the sign-in email. Try again in a moment." });
      }
    }
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: resendFrom, to: email, ...message }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Resend refused the magic link (${response.status}).`);
  console.log(JSON.stringify({ event: "auth_magic_link_sent", provider: "resend" }));
};

const sendNewSignInAlertEmail = async (
  env: AuthEnv,
  email: string,
  userAgent: string | null,
  ipAddress: string | null,
): Promise<void> => {
  try {
    const binding = (env as { EMAIL?: SendEmail }).EMAIL;
    const cloudflareFrom = binding ? configured(env, "STELLA_EMAIL_FROM") : undefined;
    const resendKey = configured(env, "RESEND_API_KEY");
    const resendFrom = resendKey ? configured(env, "RESEND_FROM") ?? configured(env, "STELLA_EMAIL_FROM") : undefined;
    if (!cloudflareFrom && !resendFrom) return;
    const logo = configured(env, "STELLA_EMAIL_LOGO_URL") ?? `${websiteUrl(env)}/stella-logo.png`;
    const device = [userAgent, ipAddress].filter(Boolean).join(" · ") || "Unknown device";
    const message = {
      subject: NEW_SIGN_IN_SUBJECT,
      html: buildNewSignInAlertEmail(
        escapeHtmlAttribute(logo),
        escapeHtmlAttribute(device),
        escapeHtmlAttribute(new Date().toUTCString()),
      ),
    };
    if (binding && cloudflareFrom) {
      await binding.send({ from: parseMailbox(cloudflareFrom), to: email, ...message });
    } else if (resendKey && resendFrom) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: resendFrom, to: email, ...message }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Resend refused the alert (${response.status}).`);
    }
    console.log(JSON.stringify({ event: "auth_new_sign_in_alert_sent" }));
  } catch (error) {
    console.error(JSON.stringify({
      event: "auth_new_sign_in_alert_failed",
      detail: error instanceof Error ? error.message.slice(0, 300) : null,
    }));
  }
};

const parseMailbox = (value: string): string | { email: string; name: string } => {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value);
  if (!match) return value.trim();
  const name = match[1]!.trim();
  return name ? { email: match[2]!.trim(), name } : match[2]!.trim();
};

/**
 * Keep Expo's authorization proxy and origin handling without its after-hook,
 * which puts the session cookie in the native callback URL. The one-time
 * token below carries the native return instead.
 */
const expoOAuthProxy = (): BetterAuthPlugin => {
  const { hooks: _cookieRedirect, ...proxy } = expo();
  return proxy as BetterAuthPlugin;
};

const nativeOttRedirect = (): BetterAuthPlugin => ({
  id: "stella-native-ott-redirect",
  hooks: {
    after: [
      {
        matcher: (ctx) =>
          Boolean(
            ctx.path?.startsWith("/callback") ||
              ctx.path?.startsWith("/oauth2/callback") ||
              ctx.path?.startsWith("/magic-link/verify"),
          ),
        handler: createAuthMiddleware(async (ctx) => {
          const token = ctx.context.responseHeaders?.get("set-ott")?.trim();
          const redirectTo = ctx.context.responseHeaders?.get("location");
          if (!token || !redirectTo) return;
          const redirectUrl = new URL(redirectTo);
          ctx.context.responseHeaders?.delete("set-ott");
          const requestOrigin = ctx.request ? new URL(ctx.request.url).origin : new URL(ctx.context.baseURL).origin;
          if (redirectUrl.origin === requestOrigin) {
            ctx.context.responseHeaders?.append("set-cookie", ottCookieHeader(token));
          } else {
            const fragment = new URLSearchParams(redirectUrl.hash.replace(/^#/, ""));
            fragment.set("ott", token);
            redirectUrl.hash = fragment.toString();
          }
          throw ctx.redirect(redirectUrl.toString());
        }),
      },
    ],
  },
});

type EndingSession = { userId: string; sessionId: string };

const endingSession = async (ctx: {
  headers?: Headers | null;
  context: { internalAdapter: { findSession(token: string): Promise<unknown> } };
}): Promise<EndingSession | null> => {
  // Clients send the signed session token URI-encoded, as bearer() expects.
  const credential = bearerCredential(ctx.headers?.get("authorization")) ?? "";
  let bearer = "";
  try {
    bearer = decodeURIComponent(credential);
  } catch {
    // A malformed escape is no bearer; the context's own session still counts.
  }
  const resolved =
    (await getSessionFromCtx(ctx as never).catch(() => null)) ??
    (bearer ? await ctx.context.internalAdapter.findSession(bearer.split(".")[0]!).catch(() => null) : null);
  const record = resolved as { user?: { id?: unknown }; session?: { id?: unknown } } | null;
  const userId = typeof record?.user?.id === "string" ? record.user.id : "";
  const sessionId = typeof record?.session?.id === "string" ? record.session.id : "";
  if (!userId) return null;
  return { userId, sessionId };
};

export const ownerInternalCall = async (
  env: AuthEnv,
  userId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<void> => {
  const gate = ownerGateStub(env.OWNER_GATES, userId);
  const { ownerGeneration } = await gate.snapshot();
  await gate.ownerInternal({ name, args, ownerGeneration });
};

const revokedTokenFloor = (env: AuthEnv): BetterAuthPlugin => ({
  id: "stella-revoked-token-floor",
  hooks: {
    before: [
      {
        matcher: (ctx) => ctx.path === "/revoke-sessions",
        handler: createAuthMiddleware(async (ctx) => {
          // Before hooks can run ahead of bearer()'s, so fall back to the
          // bearer itself: `<session token>.<signature>`.
          const ending = await endingSession(ctx as never);
          if (!ending) {
            console.warn(JSON.stringify({ event: "auth_revoke_floor_skipped", reason: "no_session" }));
            return;
          }
          await ownerInternalCall(env, ending.userId, "account.sessionsRevoked", {
            minIatMs: Date.now(),
          });
          await ownerInternalCall(env, ending.userId, "devices.pushSessionsRevoked", {});
        }),
      },
    ],
  },
});

const revokedSessionTeardown = (env: AuthEnv): BetterAuthPlugin => ({
  id: "stella-revoked-session-teardown",
  hooks: {
    before: [
      {
        matcher: (ctx) => ctx.path === "/revoke-session",
        handler: createAuthMiddleware(async (ctx) => {
          const caller = await endingSession(ctx as never);
          const token = typeof (ctx.body as { token?: unknown } | undefined)?.token === "string"
            ? (ctx.body as { token: string }).token
            : "";
          if (!caller || !token) return;
          const target = (await ctx.context.internalAdapter.findSession(token).catch(() => null)) as
            | { session?: { id?: unknown; userId?: unknown } }
            | null;
          const sessionId = typeof target?.session?.id === "string" ? target.session.id : "";
          if (!sessionId || target?.session?.userId !== caller.userId) return;
          await ownerInternalCall(env, caller.userId, "account.sessionRevoked", { sessionId });
          await ownerInternalCall(env, caller.userId, "devices.pushSessionEnded", { sessionId }).catch(
            (error: unknown) => {
              console.error(
                JSON.stringify({
                  event: "auth_revoke_session_push_teardown_failed",
                  message: error instanceof Error ? error.message : String(error),
                }),
              );
            },
          );
        }),
      },
    ],
  },
});

const pushSignOutTeardown = (env: AuthEnv): BetterAuthPlugin => ({
  id: "stella-push-sign-out-teardown",
  hooks: {
    before: [
      {
        matcher: (ctx) => ctx.path === "/sign-out",
        handler: createAuthMiddleware(async (ctx) => {
          const ending = await endingSession(ctx as never);
          if (!ending?.sessionId) {
            console.warn(JSON.stringify({ event: "auth_push_teardown_skipped", reason: "no_session" }));
            return;
          }
          await ownerInternalCall(env, ending.userId, "account.sessionRevoked", {
            sessionId: ending.sessionId,
          }).catch(() => undefined);
          await ownerInternalCall(env, ending.userId, "devices.pushSessionEnded", {
            sessionId: ending.sessionId,
          }).catch((error: unknown) => {
            console.error(
              JSON.stringify({
                event: "auth_push_teardown_failed",
                message: error instanceof Error ? error.message : String(error),
              }),
            );
          });
        }),
      },
    ],
  },
});

const buildOptions = (env: AuthEnv) => {
  const backend = backendUrl(env);
  if (!backend) throw new Error("CLOUD_BUILDER_PUBLIC_URL is required for auth.");
  if (!env.DB) throw new Error("D1 is not bound.");
  const authKeys = betterAuthKeys(env);
  if (!authKeys) throw new Error("Missing required auth secret: BETTER_AUTH_SECRET");
  const googleClientSecret = configured(env, "GOOGLE_CLIENT_SECRET");
  const api = (): HandoffApi => (createAuth(env) as unknown as { api: HandoffApi }).api;

  return {
    appName: "Stella",
    secret: authKeys.previous ?? authKeys.current,
    ...(authKeys.versioned ? { secrets: [{ version: 2, value: authKeys.current }] } : {}),
    baseURL: authUrl(env),
    basePath: "/api/auth",
    database: env.DB,
    trustedOrigins: trustedOrigins(env),
    telemetry: { enabled: false },
    session: { expiresIn: 7 * DAY_SECONDS, updateAge: DAY_SECONDS },
    rateLimit: {
      enabled: true,
      storage: "database",
      customRules: {
        "/link/send": { window: 60 * 60, max: 10 },
        "/link/status": { window: 60, max: 60 },
        "/link/claim": { window: 60, max: 10 },
        "/desktop-social/start": { window: 60, max: 3 },
        "/browser-social/start": { window: 60, max: 3 },
        "/integrity/challenge": { window: 60, max: 30 },
      },
    },
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      database: { validateSchema: false },
    },
    user: {
      additionalFields: {
        isAnonymous: { type: "boolean", required: false, defaultValue: false, input: false },
        identityLevel: { type: "number", required: false, defaultValue: 0, input: false },
      },
      deleteUser: {
        enabled: true,
        beforeDelete: async (user) => {
          if (await isSelfHostOwner(env, user.id)) {
            throw new APIError("FORBIDDEN", {
              code: "owner_account",
              message:
                "This is the account that owns this Stella server, so it can't be deleted here. To remove everything, take the server down with the self-host CLI (selfhost.mjs destroy).",
            });
          }
          const closed = await ownerGateStub(env.OWNER_GATES, user.id).closeOwner();
          console.log(JSON.stringify({ event: "auth_user_owner_closed", pending: closed.pending }));
        },
      },
    },
    account: {
      // Desktop starts Google in the app and finishes in the system browser,
      // and the website sends no cookies, so Better Auth's state cookie never
      // comes back. State is checked against the verification table, and
      // oauthStateBinding() binds it to the browser with its own cookie.
      storeStateStrategy: "database",
      skipStateCookieCheck: true,
      accountLinking: { enabled: true, allowDifferentEmails: true },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ownerModeRefusesAuthPath(env, ctx.path)) {
          throw new APIError("FORBIDDEN", {
            code: "owner_mode",
            message: "This Stella server connects devices by pairing. Ask its owner for a pairing code.",
          });
        }
        const purpose = integrityPurposeForPath(ctx.path);
        if (!purpose || !ctx.request) return;
        const result = await verifyAuthRequestProof({ env, request: ctx.request, purpose });
        if (!result.ok) {
          throw new APIError(result.code === "integrity_required" ? "BAD_REQUEST" : "FORBIDDEN", {
            code: result.code,
            message: integrityErrorMessage(result.code),
          });
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, ctx) => {
            const social = ctx?.path?.startsWith("/callback") === true;
            return { data: { ...user, isAnonymous: false, identityLevel: social ? 2 : 1 } };
          },
        },
      },
      account: {
        create: {
          after: async (account, ctx) => {
            if (account.providerId !== "google" && account.providerId !== "apple") return;
            await ctx?.context.internalAdapter.updateUser(account.userId, { identityLevel: 2 });
          },
        },
      },
      session: {
        create: {
          after: async (session, ctx) => {
            try {
              const adapter = ctx?.context.internalAdapter as
                | {
                    listSessions(userId: string): Promise<Array<{ id: string; userAgent?: string | null }>>;
                    findUserById(userId: string): Promise<{ email?: string; isAnonymous?: boolean } | null>;
                  }
                | undefined;
              if (!adapter) return;
              const user = await adapter.findUserById(session.userId).catch(() => null);
              const email = typeof user?.email === "string" ? user.email : "";
              if (!email || user?.isAnonymous || email.endsWith(".stella.local")) return;
              if (testAccountsEnabled(env) && email.endsWith(TEST_ACCOUNT_EMAIL_SUFFIX)) return;
              const sessions = await adapter.listSessions(session.userId).catch(() => []);
              const prior = sessions.filter((candidate) => candidate.id !== session.id);
              if (prior.length === 0) return;
              const userAgent =
                typeof session.userAgent === "string" ? session.userAgent : null;
              if (userAgent && prior.some((candidate) => candidate.userAgent === userAgent)) return;
              const ipAddress =
                typeof session.ipAddress === "string" ? session.ipAddress : null;
              await sendNewSignInAlertEmail(env, email, userAgent, ipAddress);
            } catch {
              // Alerts never fail a sign-in.
            }
          },
        },
      },
    },
    socialProviders: {
      google: {
        clientId: configured(env, "GOOGLE_CLIENT_ID") ?? "",
        clientSecret: googleClientSecret ?? "",
        enabled: Boolean(googleClientSecret),
      },
      apple: () => appleProvider(env),
    },
    plugins: [
      expoOAuthProxy(),
      oauthStateBinding(),
      bearer({ requireSignature: true }),
      revokedTokenFloor(env),
      revokedSessionTeardown(env),
      pushSignOutTeardown(env),
      oneTimeToken({ storeToken: "hashed", expiresIn: 3, disableClientRequest: true, setOttHeaderOnNewSession: true }),
      nativeOttRedirect(),
      magicLink({ storeToken: "hashed", sendMagicLink: ({ email, url }) => sendMagicLinkEmail(env, email, url) }),
      jwt({
        jwks: { keyPairConfig: { alg: "RS256", modulusLength: 2048 } },
        jwt: {
          issuer: backend,
          audience: "stella",
          expirationTime: "15m",
          definePayload: ({ user, session }) => ({
            sid: session.id,
            ...(user.isAnonymous === true ? { anon: true } : {}),
            idl: typeof user.identityLevel === "number" ? user.identityLevel : 0,
            ...(testAccountsEnabled(env) && user.email?.endsWith(TEST_ACCOUNT_EMAIL_SUFFIX) ? { tst: true } : {}),
          }),
        },
      }),
      // Passkeys bind to the auth domain: enroll and sign in from the web
      // shell served on that origin. Desktop and mobile native sign-in are
      // unchanged; a passkey is an additional method, never the only one.
      passkey({
        rpID: (() => {
          try {
            return new URL(authUrl(env)).hostname;
          } catch {
            return "localhost";
          }
        })(),
        rpName: "Stella",
        origin: Array.from(
          new Set([authUrl(env), backend, websiteUrl(env)]),
        ),
      }),
      stellaHandoff({
        env,
        backendUrl: authUrl(env),
        websiteUrl: websiteUrl(env),
        cipherKey: betterAuthCipherKey(authKeys),
        api,
      }),
    ],
  } satisfies BetterAuthOptions;
};

const makeAuth = (env: AuthEnv) => betterAuth(buildOptions(env));

export type Auth = ReturnType<typeof makeAuth>;

let instance: Auth | undefined;

export const createAuth = (env: AuthEnv): Auth => (instance ??= makeAuth(env));
