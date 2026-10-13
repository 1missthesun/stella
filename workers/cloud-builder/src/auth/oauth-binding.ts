import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, createAuthMiddleware } from "better-auth/api";

export const OAUTH_BINDING_COOKIE = "__Host-stella-oauth-state";

const BIND_PATH = "/oauth/bind";
const BIND_TTL_SECONDS = 10 * 60;
const PROVIDER_HOSTS = new Set(["accounts.google.com", "appleid.apple.com"]);
const STATE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

const cookieAttributes = (maxAge: number) => ({
  path: "/",
  secure: true,
  httpOnly: true,
  sameSite: "lax" as const,
  maxAge,
});

const bindIdentifier = (state: string) => `stella-oauth-bind:${state}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const providerAuthorization = (value: unknown): { url: URL; state: string } | null => {
  if (typeof value !== "string" || value.includes("#")) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !PROVIDER_HOSTS.has(url.hostname) || url.username || url.password) return null;
    const state = url.searchParams.get("state") ?? "";
    return STATE_PATTERN.test(state) ? { url, state } : null;
  } catch {
    return null;
  }
};

const logBinding = (event: string, detail: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ event, ...detail }));

export const oauthStateBinding = (): BetterAuthPlugin => ({
  id: "stella-oauth-state-binding",
  endpoints: {
    oauthBind: createAuthEndpoint(BIND_PATH, { method: "GET" }, async (ctx) => {
      const state = typeof ctx.query?.state === "string" ? ctx.query.state : "";
      const errorURL = `${ctx.context.baseURL}/error?error=state_not_found`;
      if (!STATE_PATTERN.test(state)) throw ctx.redirect(errorURL);
      const identifier = bindIdentifier(state);
      const stored = await ctx.context.internalAdapter.findVerificationValue(identifier);
      if (!stored) throw ctx.redirect(errorURL);
      await ctx.context.internalAdapter.deleteVerificationByIdentifier(identifier);
      const target = providerAuthorization(stored.value);
      if (!target || target.state !== state || new Date(stored.expiresAt).getTime() < Date.now()) {
        throw ctx.redirect(errorURL);
      }
      await ctx.setSignedCookie(OAUTH_BINDING_COOKIE, state, ctx.context.secret, cookieAttributes(BIND_TTL_SECONDS));
      throw ctx.redirect(target.url.toString());
    }),
  },
  hooks: {
    before: [
      {
        matcher: (ctx) => ctx.path === "/expo-authorization-proxy",
        handler: createAuthMiddleware(async (ctx) => {
          const raw = ctx.query?.authorizationURL;
          if (!providerAuthorization(raw)) {
            throw new APIError("BAD_REQUEST", { message: "Invalid authorizationURL" });
          }
        }),
      },
      {
        matcher: (ctx) => Boolean(ctx.path?.startsWith("/callback/")),
        handler: createAuthMiddleware(async (ctx) => {
          if (ctx.request?.method === "POST") return;
          const state = typeof ctx.query?.state === "string" ? ctx.query.state : "";
          if (!state) return;
          const bound = await ctx.getSignedCookie(OAUTH_BINDING_COOKIE, ctx.context.secret);
          if (bound !== state) {
            logBinding("auth_oauth_state_unbound", { cookie: bound ? "mismatch" : "missing" });
            throw ctx.redirect(`${ctx.context.baseURL}/error?error=state_mismatch`);
          }
          ctx.setCookie(OAUTH_BINDING_COOKIE, "", cookieAttributes(0));
        }),
      },
    ],
    after: [
      {
        matcher: (ctx) => ctx.path === "/sign-in/social" || ctx.path === "/link-social",
        handler: createAuthMiddleware(async (ctx) => {
          if (ctx.headers?.get("expo-origin")) return;
          const returned = ctx.context.returned;
          if (!isRecord(returned) || returned instanceof Error) return;
          const target = providerAuthorization(returned.url);
          if (!target) return;
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: bindIdentifier(target.state),
            value: target.url.toString(),
            expiresAt: new Date(Date.now() + BIND_TTL_SECONDS * 1000),
          });
          const bindURL = `${ctx.context.baseURL}${BIND_PATH}?state=${encodeURIComponent(target.state)}`;
          if (ctx.context.responseHeaders?.has("location")) ctx.setHeader("location", bindURL);
          return ctx.json({ ...returned, url: bindURL });
        }),
      },
      {
        matcher: (ctx) => ctx.path === "/expo-authorization-proxy",
        handler: createAuthMiddleware(async (ctx) => {
          const target = providerAuthorization(ctx.context.responseHeaders?.get("location"));
          if (!target) return;
          const pending = await ctx.context.internalAdapter.findVerificationValue(`auth-state:${target.state}`);
          if (!pending) return;
          await ctx.setSignedCookie(
            OAUTH_BINDING_COOKIE,
            target.state,
            ctx.context.secret,
            cookieAttributes(BIND_TTL_SECONDS),
          );
        }),
      },
    ],
  },
});
