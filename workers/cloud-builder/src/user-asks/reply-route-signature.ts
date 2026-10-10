const encoder = new TextEncoder();

const base64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
};

const secretOf = (env: Cloudflare.Env): string | null => {
  const value = (env as unknown as Record<string, unknown>).OAUTH_STATE_SECRET;
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const signWith = async (secret: string, ownerId: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`stella-user-ask-reply-route:${ownerId}`),
  );
  return base64Url(new Uint8Array(signature));
};

export const signUserAskReplyRoute = async (
  env: Cloudflare.Env,
  ownerId: string,
): Promise<string | null> => {
  const secret = secretOf(env);
  return secret ? await signWith(secret, ownerId) : null;
};

export const verifyUserAskReplyRoute = async (
  env: Cloudflare.Env,
  ownerId: string,
  signature: string,
): Promise<boolean> => {
  const expected = await signUserAskReplyRoute(env, ownerId);
  if (!expected || expected.length !== signature.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  return difference === 0;
};
