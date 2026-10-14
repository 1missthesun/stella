export type OAuthState = {
  ownerId: string;
  kind: string;
  nonce: string;
  exp: number;
  extra?: Record<string, string>;
};

const MAX_TOKEN_LENGTH = 1_024;

const encoder = new TextEncoder();

const base64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
};

const fromBase64Url = (value: string): string => {
  const padded = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
};

const secretOf = (env: Cloudflare.Env): string => {
  const value = (env as unknown as Record<string, unknown>).OAUTH_STATE_SECRET;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("OAUTH_STATE_SECRET is not configured.");
  }
  return value.trim();
};

const sign = async (secret: string, message: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message))));
};

const constantTimeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

export const signOAuthState = async (env: Cloudflare.Env, state: OAuthState): Promise<string> => {
  const payload = base64Url(
    encoder.encode(
      JSON.stringify({
        ownerId: state.ownerId,
        kind: state.kind,
        nonce: state.nonce,
        exp: state.exp,
        ...(state.extra ? { extra: state.extra } : {}),
      }),
    ),
  );
  return `${payload}.${await sign(secretOf(env), payload)}`;
};

export const verifyOAuthState = async (
  env: Cloudflare.Env,
  token: string,
  now = Date.now(),
): Promise<OAuthState | null> => {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  let secret: string;
  try {
    secret = secretOf(env);
  } catch {
    return null;
  }
  if (!constantTimeEqual(await sign(secret, payload), signature)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(payload));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.ownerId !== "string" ||
    !record.ownerId ||
    typeof record.kind !== "string" ||
    typeof record.nonce !== "string" ||
    !record.nonce ||
    typeof record.exp !== "number" ||
    record.exp <= now
  ) {
    return null;
  }
  const extra =
    record.extra && typeof record.extra === "object" && !Array.isArray(record.extra)
      ? Object.fromEntries(
          Object.entries(record.extra as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : undefined;
  return {
    ownerId: record.ownerId,
    kind: record.kind,
    nonce: record.nonce,
    exp: record.exp,
    ...(extra ? { extra } : {}),
  };
};
