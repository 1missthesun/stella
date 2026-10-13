/**
 * Small signed tokens for Stella for Slack: `<prefix>.<payload>.<signature>`,
 * an HMAC-SHA256 over a per-kind domain string with BUILDER_SERVICE_SECRET.
 * The payload is JSON with an `exp` (epoch ms); expired tokens don't verify.
 */

const base64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

const fromBase64Url = (value: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
};

const hmacKey = async (env: Cloudflare.Env, usage: "sign" | "verify"): Promise<CryptoKey> => {
  const secret = env.BUILDER_SERVICE_SECRET;
  if (!secret || secret.length < 32) throw new Error("BUILDER_SERVICE_SECRET is not configured.");
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
};

export type TokenKind = { prefix: string; domain: string };

export const signToken = async <T extends object>(
  env: Cloudflare.Env,
  kind: TokenKind,
  claims: T,
  ttlMs: number,
): Promise<string> => {
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({ ...claims, exp: Date.now() + ttlMs })));
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", await hmacKey(env, "sign"), new TextEncoder().encode(`${kind.domain}.${payload}`)),
  );
  return `${kind.prefix}.${payload}.${base64Url(signature)}`;
};

export const verifyToken = async <T extends object>(
  env: Cloudflare.Env,
  kind: TokenKind,
  token: string,
): Promise<(T & { exp: number }) | null> => {
  const [prefix, payload, signature, ...rest] = token.split(".");
  if (prefix !== kind.prefix || !payload || !signature || rest.length || token.length > 4_000) return null;
  const signatureBytes = fromBase64Url(signature);
  const payloadBytes = fromBase64Url(payload);
  if (!signatureBytes || !payloadBytes) return null;
  const valid = await crypto.subtle
    .verify("HMAC", await hmacKey(env, "verify"), signatureBytes, new TextEncoder().encode(`${kind.domain}.${payload}`))
    .catch(() => false);
  if (!valid) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(payloadBytes)) as T & { exp?: unknown };
    return typeof claims.exp === "number" && claims.exp > Date.now() ? (claims as T & { exp: number }) : null;
  } catch {
    return null;
  }
};
