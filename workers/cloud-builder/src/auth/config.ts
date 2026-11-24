type AuthEnv = Cloudflare.Env;

export const TEST_ACCOUNT_EMAIL_SUFFIX = "@test.stella.local";
const DEFAULT_WEBSITE_URL = "https://stella.sh";

export const configured = (env: unknown, name: string): string | undefined => {
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

const DAY_SECONDS = 24 * 60 * 60;
/** Session lifetime and sliding-refresh age; `fast-token.ts` mirrors Better Auth's refresh rule with these. */
export const SESSION_EXPIRES_IN_SECONDS = 7 * DAY_SECONDS;
export const SESSION_UPDATE_AGE_SECONDS = DAY_SECONDS;
export const STELLA_JWT_AUDIENCE = "stella";
/** Better Auth's `jwt.expirationTime` ("15m"), in seconds for the fast path. */
export const STELLA_JWT_TTL_SECONDS = 15 * 60;

/**
 * Stella's own claims in a user JWT. Better Auth's jwt() plugin and the
 * `/api/auth/token` fast path (fast-token.ts) both build them here, so the two
 * can never mint different tokens for the same session.
 */
export const stellaJwtClaims = (
  env: unknown,
  user: { isAnonymous?: unknown; identityLevel?: unknown; email?: string | null },
  session: { id: string },
): Record<string, unknown> => ({
  sid: session.id,
  ...(user.isAnonymous === true ? { anon: true } : {}),
  idl: typeof user.identityLevel === "number" ? user.identityLevel : 0,
  ...(testAccountsEnabled(env) && user.email?.endsWith(TEST_ACCOUNT_EMAIL_SUFFIX) ? { tst: true } : {}),
});

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

export const escapeHtmlAttribute = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export const parseMailbox = (value: string): string | { email: string; name: string } => {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value);
  if (!match) return value.trim();
  const name = match[1]!.trim();
  return name ? { email: match[2]!.trim(), name } : match[2]!.trim();
};

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
};

/** Sends through the Cloudflare Email Service binding, falling back to Resend. */
export const sendEmail = async (env: AuthEnv, message: OutgoingEmail): Promise<"cloudflare" | "resend"> => {
  const binding = (env as { EMAIL?: SendEmail }).EMAIL;
  const cloudflareFrom = binding ? configured(env, "STELLA_EMAIL_FROM") : undefined;
  const resendKey = configured(env, "RESEND_API_KEY");
  const resendFrom = resendKey ? configured(env, "RESEND_FROM") ?? configured(env, "STELLA_EMAIL_FROM") : undefined;
  if (!cloudflareFrom && !resendFrom) throw new Error("Email is not set up on this Stella.");
  const { replyTo, ...content } = message;
  if (binding && cloudflareFrom) {
    try {
      await binding.send({ from: parseMailbox(cloudflareFrom), ...content, ...(replyTo ? { replyTo } : {}) });
      return "cloudflare";
    } catch (error) {
      if (!resendFrom) throw error;
    }
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: resendFrom, ...content, ...(replyTo ? { reply_to: replyTo } : {}) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Resend refused the email (${response.status}).`);
  return "resend";
};

export const sendAccountEmail = async (
  env: AuthEnv,
  email: string,
  build: (logoSrc: string) => { subject: string; html: string },
  event: string,
): Promise<void> => {
  if (testAccountsEnabled(env) && email.endsWith(TEST_ACCOUNT_EMAIL_SUFFIX)) {
    console.log(JSON.stringify({ event, provider: "test_account_log", subject: build("").subject }));
    return;
  }
  const logo = configured(env, "STELLA_EMAIL_LOGO_URL") ?? `${websiteUrl(env)}/stella-logo.png`;
  const provider = await sendEmail(env, { to: email, ...build(escapeHtmlAttribute(logo)) });
  console.log(JSON.stringify({ event, provider }));
};
