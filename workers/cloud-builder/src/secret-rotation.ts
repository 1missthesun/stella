import type { SecretConfig } from "better-auth/crypto";

const raw = (env: unknown, name: string): string | undefined => {
  const value = (env as Record<string, unknown> | null | undefined)?.[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const trimmed = (env: unknown, name: string): string | undefined => {
  const value = raw(env, name)?.trim();
  return value || undefined;
};

const distinct = (values: Array<string | undefined>): string[] =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value))));

export const BUILDER_SERVICE_SECRET_V2 = "BUILDER_SERVICE_SECRET_V2";
export const BETTER_AUTH_SECRET_V2 = "BETTER_AUTH_SECRET_V2";
export const OWNER_SECRETS_KEK_V2 = "OWNER_SECRETS_KEK_V2";

export const builderServiceSecret = (env: unknown): string =>
  raw(env, BUILDER_SERVICE_SECRET_V2) ?? raw(env, "BUILDER_SERVICE_SECRET") ?? "";

export const builderServiceSecrets = (env: unknown): string[] =>
  distinct([builderServiceSecret(env)]);

export type BetterAuthKeys = { current: string; previous: string | undefined; versioned: boolean };

export const betterAuthKeys = (env: unknown): BetterAuthKeys | null => {
  const legacy = trimmed(env, "BETTER_AUTH_SECRET");
  const next = trimmed(env, BETTER_AUTH_SECRET_V2);
  if (next) return { current: next, previous: legacy && legacy !== next ? legacy : undefined, versioned: true };
  return legacy ? { current: legacy, previous: undefined, versioned: false } : null;
};

export const betterAuthCipherKey = (keys: BetterAuthKeys): string | SecretConfig =>
  keys.versioned
    ? {
        keys: new Map([[2, keys.current]]),
        currentVersion: 2,
        ...(keys.previous ? { legacySecret: keys.previous } : {}),
      }
    : keys.current;

export type OwnerKekTag = "v1" | "v2";

export type OwnerKeks = { current: OwnerKekTag; v1: string | undefined; v2: string | undefined };

export const ownerKeks = (env: unknown): OwnerKeks | null => {
  const v1 = trimmed(env, "OWNER_SECRETS_KEK");
  const v2 = trimmed(env, OWNER_SECRETS_KEK_V2);
  if (!v1 && !v2) return null;
  return { current: v2 ? "v2" : "v1", v1, v2 };
};

export const plaintextStorageAllowed = (env: unknown): boolean =>
  trimmed(env, "STELLA_PLAINTEXT_STORAGE") === "1";

/** Keys for conversation storage: required unless the deployment declares STELLA_PLAINTEXT_STORAGE=1. */
export const storageKeks = (env: unknown): OwnerKeks | null => {
  const keks = ownerKeks(env);
  if (keks || plaintextStorageAllowed(env)) return keks;
  throw new Error(
    "OWNER_SECRETS_KEK is not configured, so conversation storage would be unencrypted. Set it, or set STELLA_PLAINTEXT_STORAGE=1 for a deliberately unencrypted deployment.",
  );
};

export const ownerKekFor = (keks: OwnerKeks, tag: string): string | undefined =>
  tag === "v2" ? keks.v2 : tag === "v1" ? keks.v1 : undefined;
