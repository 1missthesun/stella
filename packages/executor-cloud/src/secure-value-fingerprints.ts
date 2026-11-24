import { createHash, randomInt } from "node:crypto";
import { chmod, chown, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createSecretFingerprintParams,
  type SecretFingerprints,
} from "@stella/contracts/secret-redaction";
import { CLOUD_HOST_STATE } from "./cloud-process-isolation.js";

const FINGERPRINTS_ROOT = path.join(CLOUD_HOST_STATE, "secure-value-redaction");
const FINGERPRINTS_FILE = "fingerprints.json";

export const SANDBOX_FINGERPRINTS_VIEW = path.join(CLOUD_HOST_STATE, "secure-value-view");
export const SANDBOX_FINGERPRINTS_FILE = path.join(SANDBOX_FINGERPRINTS_VIEW, FINGERPRINTS_FILE);
export const SANDBOX_FINGERPRINTS_ENV = "STELLA_SANDBOX_FINGERPRINTS";

export const fingerprintsDirectory = (threadKey: string): string =>
  path.join(
    FINGERPRINTS_ROOT,
    createHash("sha256").update(threadKey).digest("hex").slice(0, 32),
  );

const freshFingerprints = (): SecretFingerprints => ({
  ...createSecretFingerprintParams(() => randomInt(0, 2 ** 32) / 2 ** 32),
  windows: [],
});

export const parseFingerprintsFile = (text: string): SecretFingerprints | null => {
  try {
    const value = JSON.parse(text) as Partial<SecretFingerprints> | null;
    if (
      !value ||
      !Number.isSafeInteger(value.baseA) ||
      !Number.isSafeInteger(value.baseB) ||
      !Array.isArray(value.windows)
    ) {
      return null;
    }
    return value as SecretFingerprints;
  } catch {
    return null;
  }
};

const writeAtomically = async (directory: string, value: SecretFingerprints) => {
  const target = path.join(directory, FINGERPRINTS_FILE);
  const staging = `${target}.${process.pid}.${randomInt(0, 2 ** 31)}`;
  await writeFile(staging, JSON.stringify(value), { mode: 0o444 });
  await chown(staging, 0, 0).catch(() => undefined);
  await chmod(staging, 0o444);
  await rename(staging, target);
};

export const ensureFingerprints = async (
  threadKey: string,
): Promise<{ directory: string; fingerprints: SecretFingerprints }> => {
  await mkdir(FINGERPRINTS_ROOT, { recursive: true, mode: 0o700 });
  await chmod(FINGERPRINTS_ROOT, 0o700);
  const directory = fingerprintsDirectory(threadKey);
  await mkdir(directory, { recursive: true, mode: 0o755 });
  await chmod(directory, 0o755);
  const held = parseFingerprintsFile(
    await readFile(path.join(directory, FINGERPRINTS_FILE), "utf8").catch(() => ""),
  );
  if (held) return { directory, fingerprints: held };
  const fingerprints = freshFingerprints();
  await writeAtomically(directory, fingerprints);
  return { directory, fingerprints };
};

export const storeFingerprints = async (
  threadKey: string,
  fingerprints: SecretFingerprints,
): Promise<void> => {
  await writeAtomically(fingerprintsDirectory(threadKey), fingerprints);
};
