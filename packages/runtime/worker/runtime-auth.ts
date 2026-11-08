import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import type { RuntimeServerIdentity } from "./server-identity.js";

/**
 * The runtime endpoint is authenticated in both directions with a per-install
 * key that only this OS user can read. On Windows the endpoint is a named pipe
 * in a machine-global namespace that another local user can create first, so
 * the client must not trust whoever answers until it proves the key.
 */
export const STELLA_RUNTIME_AUTH_METHOD = "internal.worker.authenticate";

const KEY_BYTES = 32;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

const decodeKey = (raw: string): Buffer | null => {
  const key = Buffer.from(raw.trim(), "base64url");
  return key.length === KEY_BYTES ? key : null;
};

const readPrivateKey = async (keyFile: string): Promise<Buffer | null> => {
  let stat;
  try {
    stat = await fs.lstat(keyFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const expectedUid =
    typeof process.getuid === "function" ? process.getuid() : null;
  const privateFile =
    stat.isFile() &&
    (expectedUid == null ||
      (stat.uid === expectedUid && (stat.mode & 0o077) === 0));
  const key = privateFile ? decodeKey(await fs.readFile(keyFile, "utf-8")) : null;
  if (key) return key;
  await fs.unlink(keyFile).catch(() => undefined);
  return null;
};

export const ensureRuntimeAuthKey = async (keyFile: string): Promise<Buffer> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existing = await readPrivateKey(keyFile);
    if (existing) return existing;
    const tempFile = `${keyFile}.${process.pid}.${randomBytes(6).toString("hex")}`;
    await fs.writeFile(tempFile, randomBytes(KEY_BYTES).toString("base64url"), {
      mode: 0o600,
      flag: "wx",
    });
    try {
      await fs.link(tempFile, keyFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally {
      await fs.unlink(tempFile).catch(() => undefined);
    }
  }
  throw new Error(`Could not create the runtime auth key at ${keyFile}.`);
};

export const createRuntimeAuthNonce = (): string =>
  randomBytes(32).toString("base64url");

export const isRuntimeAuthNonce = (value: unknown): value is string =>
  typeof value === "string" && NONCE_PATTERN.test(value);

const mac = (key: Buffer, parts: string[]): string =>
  createHmac("sha256", key).update(JSON.stringify(parts)).digest("base64url");

export type RuntimeAuthNonces = { clientNonce: string; serverNonce: string };

export const runtimeServerProof = (
  key: Buffer,
  nonces: RuntimeAuthNonces,
  identity: RuntimeServerIdentity,
): string =>
  mac(key, [
    "stella-runtime-server-v1",
    nonces.clientNonce,
    nonces.serverNonce,
    identity.serverId,
    identity.rootHash,
    String(identity.pid),
    identity.protocolVersion,
  ]);

export const runtimeClientProof = (
  key: Buffer,
  nonces: RuntimeAuthNonces,
): string =>
  mac(key, ["stella-runtime-client-v1", nonces.clientNonce, nonces.serverNonce]);

export const runtimeProofMatches = (expected: string, actual: unknown): boolean => {
  if (typeof actual !== "string") return false;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return (
    expectedBytes.length === actualBytes.length &&
    timingSafeEqual(expectedBytes, actualBytes)
  );
};
