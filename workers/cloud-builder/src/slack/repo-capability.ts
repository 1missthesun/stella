import { builderServiceSecret, builderServiceSecrets } from "../secret-rotation.js";

const PREFIX = "sr1";
const DOMAIN = "stella.slack-repo.v1";
export const SLACK_REPO_CAPABILITY_TTL_MS = 12 * 60 * 60_000;

export type SlackRepoClaims = { team: string; repo: string; exp: number };

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

const key = async (secret: string, usage: "sign" | "verify"): Promise<CryptoKey> => {
  if (!secret || secret.length < 32) throw new Error("BUILDER_SERVICE_SECRET is not configured.");
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
};

const verifiedWithAny = async (env: Cloudflare.Env, signature: Uint8Array, data: Uint8Array): Promise<boolean> => {
  const secrets = builderServiceSecrets(env);
  for (const secret of secrets.length > 0 ? secrets : [""]) {
    if (await crypto.subtle.verify("HMAC", await key(secret, "verify"), signature as BufferSource, data as BufferSource)) {
      return true;
    }
  }
  return false;
};

const input = (payload: string): Uint8Array => new TextEncoder().encode(`${DOMAIN}.${payload}`);

export const issueSlackRepoCapability = async (
  env: Cloudflare.Env,
  claims: { team: string; repo: string },
): Promise<string> => {
  const payload = base64Url(
    new TextEncoder().encode(JSON.stringify({ ...claims, exp: Date.now() + SLACK_REPO_CAPABILITY_TTL_MS })),
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await key(builderServiceSecret(env), "sign"), input(payload)));
  return `${PREFIX}.${payload}.${base64Url(signature)}`;
};

export const verifySlackRepoCapability = async (
  env: Cloudflare.Env,
  token: string,
): Promise<SlackRepoClaims | null> => {
  const [prefix, payload, signature, ...rest] = token.split(".");
  if (prefix !== PREFIX || !payload || !signature || rest.length || token.length > 2_000) return null;
  const signatureBytes = fromBase64Url(signature);
  const payloadBytes = fromBase64Url(payload);
  if (!signatureBytes || !payloadBytes) return null;
  const valid = await verifiedWithAny(env, signatureBytes, input(payload)).catch(() => false);
  if (!valid) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(payloadBytes)) as Partial<SlackRepoClaims>;
    if (typeof claims.team !== "string" || typeof claims.repo !== "string" || typeof claims.exp !== "number") {
      return null;
    }
    return claims.exp > Date.now() ? { team: claims.team, repo: claims.repo, exp: claims.exp } : null;
  } catch {
    return null;
  }
};
