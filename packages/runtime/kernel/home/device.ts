import { promises as fs } from "fs";
import path from "path";
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as signBytes,
} from "crypto";

import { Effect } from "effect";

import {
  deleteProtectedValue,
  protectValue,
  readProtectedValue,
} from "../shared/protected-storage.js";
import { ensurePrivateDir, writePrivateFile } from "../shared/private-fs.js";
import { getFileLogger } from "../../observability/file-logger.js";
import { withHome } from "./home-runtime.js";

type DeviceRecord = {
  deviceId: string;
  publicKey?: string;
  privateKeyProtected?: string;
  supersededDeviceId?: string;
};

export type DeviceIdentity = {
  deviceId: string;
  publicKey: string;
  privateKey: string;
  supersededDeviceId?: string;
};

export type DeviceSigner = {
  alg: "ed25519";
  rawPublicKey: Uint8Array;
  sign(input: string): Promise<string>;
};

const DEVICE_FILE = "device.json";
const DEVICE_PRIVATE_KEY_SCOPE = "device-private-key";
const deviceSignerCache = new Map<string, DeviceSigner>();

type DeviceIdentityRegenerationReason =
  | "no-record"
  | "malformed-record"
  | "incomplete-record"
  | "undecryptable-private-key";

const logDeviceIdentityRegeneration = (
  reason: DeviceIdentityRegenerationReason,
  supersededDeviceId: string | undefined,
) => {
  if (reason === "no-record" && !supersededDeviceId) {
    return;
  }
  const logger = getFileLogger();
  if (logger) {
    logger.warn("device-identity.regenerated", {
      reason,
      ...(supersededDeviceId ? { supersededDeviceId } : {}),
    });
    return;
  }
  console.warn(
    `[device-identity] Minting a new device id; the stored identity could not be reused: ${reason}.` +
      (supersededDeviceId ? ` Superseding ${supersededDeviceId}.` : ""),
  );
};

const tryIO = <A>(f: () => Promise<A>): Effect.Effect<A, unknown> =>
  Effect.tryPromise({ try: f, catch: (error) => error });

export const getDeviceRecordPath = (statePath: string) =>
  path.join(statePath, DEVICE_FILE);

export const deviceSignerForIdentity = (
  identity: DeviceIdentity,
): DeviceSigner => {
  const cached = deviceSignerCache.get(identity.deviceId);
  if (cached) return cached;

  const publicKey = createPublicKey({
    key: Buffer.from(identity.publicKey, "base64"),
    format: "der",
    type: "spki",
  });
  const publicJwk = publicKey.export({ format: "jwk" });
  if (
    publicJwk.kty !== "OKP" ||
    publicJwk.crv !== "Ed25519" ||
    typeof publicJwk.x !== "string"
  ) {
    throw new Error("Stored Stella device key is not Ed25519.");
  }
  const rawPublicKey = new Uint8Array(
    Buffer.from(publicJwk.x, "base64url"),
  );
  if (rawPublicKey.byteLength !== 32) {
    throw new Error("Stored Stella device public key is malformed.");
  }
  const privateKey = createPrivateKey({
    key: Buffer.from(identity.privateKey, "base64"),
    format: "der",
    type: "pkcs8",
  });
  const signer: DeviceSigner = {
    alg: "ed25519",
    rawPublicKey,
    sign: async (input) =>
      signBytes(null, Buffer.from(input, "utf8"), privateKey).toString(
        "base64url",
      ),
  };
  deviceSignerCache.set(identity.deviceId, signer);
  return signer;
};

export const getOrCreateDeviceSigner = async (
  statePath: string,
): Promise<DeviceSigner> =>
  deviceSignerForIdentity(await getOrCreateDeviceIdentity(statePath));

const generateDeviceKeyPair = (): Pick<
  DeviceIdentity,
  "publicKey" | "privateKey"
> => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKey: publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64"),
    privateKey: privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64"),
  };
};

const toStoredDeviceRecord = (identity: DeviceIdentity): DeviceRecord => ({
  deviceId: identity.deviceId,
  publicKey: identity.publicKey,
  privateKeyProtected: protectValue(
    DEVICE_PRIVATE_KEY_SCOPE,
    identity.privateKey,
  ),
  ...(identity.supersededDeviceId
    ? { supersededDeviceId: identity.supersededDeviceId }
    : {}),
});

const createAndStoreDeviceIdentityEffect = (
  recordPath: string,
  previousPrivateKeyProtected?: string,
  supersededDeviceId?: string,
): Effect.Effect<DeviceIdentity, unknown> =>
  Effect.gen(function* () {
    const payload = yield* Effect.sync(
      (): DeviceIdentity => ({
        deviceId: crypto.randomUUID(),
        ...generateDeviceKeyPair(),
        ...(supersededDeviceId ? { supersededDeviceId } : {}),
      }),
    );
    const record = yield* Effect.sync(() => toStoredDeviceRecord(payload));
    yield* tryIO(() => ensurePrivateDir(path.dirname(recordPath)));
    yield* tryIO(() =>
      writePrivateFile(recordPath, JSON.stringify(record, null, 2)),
    );
    if (
      previousPrivateKeyProtected &&
      previousPrivateKeyProtected !== record.privateKeyProtected
    ) {
      yield* Effect.sync(() =>
        deleteProtectedValue(
          DEVICE_PRIVATE_KEY_SCOPE,
          previousPrivateKeyProtected,
        ),
      );
    }
    return payload;
  });

const readPersistedDeviceRecord = (
  recordPath: string,
): Effect.Effect<
  { parsed: DeviceRecord | undefined; reason: DeviceIdentityRegenerationReason },
  unknown
> =>
  tryIO(async () => {
    let raw: string;
    try {
      raw = await fs.readFile(recordPath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
        return { parsed: undefined, reason: "no-record" as const };
      }
      throw error;
    }
    try {
      return { parsed: JSON.parse(raw) as DeviceRecord, reason: "no-record" as const };
    } catch {
      return { parsed: undefined, reason: "malformed-record" as const };
    }
  });

export const getOrCreateDeviceIdentityEffect = (
  statePath: string,
): Effect.Effect<DeviceIdentity, unknown> =>
  Effect.gen(function* () {
    const recordPath = getDeviceRecordPath(statePath);
    const { parsed, reason: readReason } =
      yield* readPersistedDeviceRecord(recordPath);
    const previousPrivateKeyProtected = parsed?.privateKeyProtected;
    const supersededDeviceId = parsed?.deviceId ? parsed.deviceId : undefined;
    let reason = readReason;
    let existing: DeviceIdentity | null = null;
    if (parsed?.deviceId && parsed.publicKey && parsed.privateKeyProtected) {
      const privateKey = readProtectedValue(DEVICE_PRIVATE_KEY_SCOPE, parsed.privateKeyProtected);
      if (privateKey.ok) {
        existing = {
          deviceId: parsed.deviceId,
          publicKey: parsed.publicKey,
          privateKey: privateKey.value,
          ...(parsed.supersededDeviceId
            ? { supersededDeviceId: parsed.supersededDeviceId }
            : {}),
        };
      } else if (privateKey.reason === "unavailable") {
        return yield* Effect.fail(
          new Error("OS protected storage is unavailable; keeping this device's identity until it is."),
        );
      } else {
        reason = "undecryptable-private-key";
      }
    } else if (parsed) {
      reason = "incomplete-record";
    }
    if (existing) return existing;
    yield* Effect.sync(() =>
      logDeviceIdentityRegeneration(reason, supersededDeviceId),
    );
    return yield* createAndStoreDeviceIdentityEffect(
      recordPath,
      previousPrivateKeyProtected,
      supersededDeviceId,
    );
  });

export const getOrCreateDeviceIdentity = (
  statePath: string,
): Promise<DeviceIdentity> =>
  withHome((home) => home.getOrCreateDeviceIdentity(statePath));

export const resetDeviceIdentityEffect = (
  statePath: string,
  options: { preservePairings?: boolean } = {},
): Effect.Effect<DeviceIdentity, unknown> =>
  Effect.gen(function* () {
    const recordPath = getDeviceRecordPath(statePath);
    const { parsed } = yield* readPersistedDeviceRecord(recordPath).pipe(
      Effect.catch(() => Effect.succeed({ parsed: undefined })),
    );
    const supersededDeviceId =
      options.preservePairings && parsed?.deviceId ? parsed.deviceId : undefined;
    const identity = yield* createAndStoreDeviceIdentityEffect(
      recordPath,
      parsed?.privateKeyProtected,
      supersededDeviceId,
    );
    if (parsed?.deviceId) deviceSignerCache.delete(parsed.deviceId);
    return identity;
  });

/**
 * Drop the retained predecessor once the backend has accepted the succession,
 * so it is claimed exactly once.
 */
export const clearSupersededDeviceId = async (
  statePath: string,
): Promise<void> => {
  const recordPath = getDeviceRecordPath(statePath);
  try {
    const raw = await fs.readFile(recordPath, "utf-8");
    const parsed = JSON.parse(raw) as DeviceRecord;
    if (!parsed.supersededDeviceId) {
      return;
    }
    const { supersededDeviceId: _dropped, ...rest } = parsed;
    await writePrivateFile(recordPath, JSON.stringify(rest, null, 2));
  } catch {
    // Nothing to clear; the next successful claim will be a no-op anyway.
  }
};
