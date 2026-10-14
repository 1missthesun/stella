import { createRequire } from "module";

type SafeStorageLike = {
  isEncryptionAvailable: () => boolean;
  encryptString: (plaintext: string) => Buffer;
  decryptString: (ciphertext: Buffer) => string;
};

const require = createRequire(import.meta.url);
const PROTECTED_PREFIX = "stella-protected";

let safeStorageCache: SafeStorageLike | null | undefined;

export const setProtectedStorageProviderOverride = (
  provider: SafeStorageLike | null,
): void => {
  safeStorageCache = provider;
};

const getSafeStorage = (): SafeStorageLike => {
  if (safeStorageCache) {
    return safeStorageCache;
  }
  if (safeStorageCache === null) {
    throw new Error("Protected storage is unavailable.");
  }
  if (!process.versions.electron) {
    safeStorageCache = null;
    throw new Error("Protected storage requires Electron runtime.");
  }

  const electronModule = require("electron") as
    | { safeStorage?: SafeStorageLike }
    | string;
  const safeStorage =
    typeof electronModule === "string" ? undefined : electronModule.safeStorage;

  if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
    safeStorageCache = null;
    throw new Error("OS protected storage is unavailable.");
  }

  safeStorageCache = safeStorage;
  return safeStorage;
};

const prefixForScope = (scope: string) => `${PROTECTED_PREFIX}:${scope}:v1:`;

export const protectValue = (scope: string, plaintext: string): string => {
  const safeStorage = getSafeStorage();
  const encrypted = safeStorage.encryptString(plaintext);
  return `${prefixForScope(scope)}${encrypted.toString("base64url")}`;
};

export type ProtectedValueRead =
  | { ok: true; value: string }
  | { ok: false; reason: "unavailable" | "undecryptable" };

export const readProtectedValue = (scope: string, value: string): ProtectedValueRead => {
  const prefix = prefixForScope(scope);
  const encoded =
    typeof value === "string" && value.startsWith(prefix) ? value.slice(prefix.length) : "";
  if (!encoded) return { ok: false, reason: "undecryptable" };
  let safeStorage: SafeStorageLike;
  try {
    safeStorage = getSafeStorage();
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  try {
    return { ok: true, value: safeStorage.decryptString(Buffer.from(encoded, "base64url")) };
  } catch {
    return { ok: false, reason: "undecryptable" };
  }
};

export const unprotectValue = (scope: string, value: string): string | null => {
  const read = readProtectedValue(scope, value);
  return read.ok ? read.value : null;
};

export const deleteProtectedValue = (scope: string, value: string): void => {
  void scope;
  void value;
};
