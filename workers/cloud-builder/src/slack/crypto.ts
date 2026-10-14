import { BETTER_AUTH_SECRET_V2 } from "../secret-rotation.js";

const encoder = new TextEncoder();

const b64url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
};

const fromB64url = (value: string): Uint8Array => {
  const padded = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const tokenKeyFrom = async (secret: string): Promise<CryptoKey> => {
  const base = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("stella-slack"),
      info: encoder.encode("bot-token-v1"),
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
};

const rawSecret = (env: Cloudflare.Env, name: string): string | undefined => {
  const value = (env as unknown as Record<string, unknown>)[name];
  return typeof value === "string" && value ? value : undefined;
};

const currentTokenKey = (env: Cloudflare.Env): { version: "v1" | "v2"; secret: string } => {
  const next = rawSecret(env, BETTER_AUTH_SECRET_V2);
  if (next) return { version: "v2", secret: next };
  const legacy = rawSecret(env, "BETTER_AUTH_SECRET");
  if (!legacy) throw new Error("BETTER_AUTH_SECRET is not configured.");
  return { version: "v1", secret: legacy };
};

const tokenKeyFor = async (env: Cloudflare.Env, version: string): Promise<CryptoKey> => {
  const secret = rawSecret(env, version === "v2" ? BETTER_AUTH_SECRET_V2 : "BETTER_AUTH_SECRET");
  if (!secret) throw new Error(`${version === "v2" ? BETTER_AUTH_SECRET_V2 : "BETTER_AUTH_SECRET"} is not configured.`);
  return await tokenKeyFrom(secret);
};

export const encryptToken = async (
  env: Cloudflare.Env,
  token: string,
): Promise<string> => {
  const key = currentTokenKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await tokenKeyFrom(key.secret),
    encoder.encode(token),
  );
  return `${key.version}.${b64url(iv)}.${b64url(new Uint8Array(sealed))}`;
};

export const decryptToken = async (
  env: Cloudflare.Env,
  sealed: string,
): Promise<string> => {
  const [version, iv, body] = sealed.split(".");
  if ((version !== "v1" && version !== "v2") || !iv || !body)
    throw new Error("Unrecognized Slack token format.");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64url(iv) },
    await tokenKeyFor(env, version),
    fromB64url(body),
  );
  return new TextDecoder().decode(plain);
};

export const isCurrentTokenVersion = (env: Cloudflare.Env, sealed: string): boolean =>
  sealed.startsWith(`${currentTokenKey(env).version}.`);

const hmacHex = async (secret: string, message: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(message)),
  );
  return Array.from(signature, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};

const constantTimeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1)
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

/** Slack's `v0` request signature, with a five-minute replay window. */
export const verifySlackSignature = async (
  signingSecret: string,
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  nowMs = Date.now(),
): Promise<boolean> => {
  if (!timestamp || !signature || !/^\d{1,12}$/u.test(timestamp)) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > 300) return false;
  const expected = `v0=${await hmacHex(signingSecret, `v0:${timestamp}:${rawBody}`)}`;
  return constantTimeEqual(expected, signature);
};

export const sha256Short = async (
  value: string,
  length = 40,
): Promise<string> => {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
};
