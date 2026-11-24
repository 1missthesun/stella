import { x25519 } from "@noble/curves/ed25519.js";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import { SAVED_VALUE_PUBLIC_KEY_BYTES } from "@stella/contracts/saved-values";
import {
  signingKeyFromSecret,
  type SavedValuesMember,
  type SavedValuesRosterPin,
  type SavedValuesSigningKey,
} from "@stella/contracts/saved-values-trust";
import { base64UrlToBytes, bytesToBase64Url } from "./base64url";
import { getOrCreateMobileDeviceId } from "./phone-access";
import * as SecureStore from "./secure-store";

/**
 * What this phone alone keeps for the user's saved values, never in a backup
 * and never sent anywhere: its key to open values, its key to sign with, and
 * which devices' list it knows.
 */

const SEAL_KEY_ITEM = "stella.savedValues.deviceKey.v1";
const SIGN_KEY_ITEM = "stella.savedValues.signKey.v1";
const TRUST_ITEM = "stella.savedValues.trust.v1";
const SECRET_BYTES = SAVED_VALUE_PUBLIC_KEY_BYTES;
const MAX_NAME_CHARS = 120;

export type SavedValuesDeviceKeys = Readonly<{
  deviceId: string;
  secretKey: Uint8Array;
  publicKey: string;
  signing: SavedValuesSigningKey;
}>;

let deviceKeys: Promise<SavedValuesDeviceKeys> | null = null;

const readSecret = async (item: string): Promise<Uint8Array | null> => {
  const stored = await SecureStore.getDeviceOnlyItemAsync(item);
  if (!stored) return null;
  try {
    const bytes = base64UrlToBytes(stored);
    return bytes.byteLength === SECRET_BYTES ? bytes : null;
  } catch {
    return null;
  }
};

const readOrMakeSecret = async (item: string): Promise<Uint8Array> => {
  const held = await readSecret(item);
  if (held) return held;
  const made = Crypto.getRandomBytes(SECRET_BYTES);
  await SecureStore.setDeviceOnlyItemAsync(item, bytesToBase64Url(made));
  return made;
};

export const loadDeviceKeys = (): Promise<SavedValuesDeviceKeys> => {
  deviceKeys ??= (async () => {
    const deviceId = await getOrCreateMobileDeviceId();
    const secretKey = await readOrMakeSecret(SEAL_KEY_ITEM);
    const signing = signingKeyFromSecret(await readOrMakeSecret(SIGN_KEY_ITEM));
    return {
      deviceId,
      secretKey,
      publicKey: bytesToBase64Url(x25519.getPublicKey(secretKey)),
      signing,
    };
  })().catch((error: unknown) => {
    deviceKeys = null;
    throw error;
  });
  return deviceKeys;
};

export const phoneName = (): string =>
  (Device.deviceName?.trim() || Device.modelName?.trim() || "Phone").slice(
    0,
    MAX_NAME_CHARS,
  );

export const selfMember = (keys: SavedValuesDeviceKeys): SavedValuesMember => ({
  deviceId: keys.deviceId,
  kind: "phone",
  name: phoneName(),
  signKey: keys.signing.publicKey,
  sealKey: keys.publicKey,
});

/** Why this phone doesn't ask to join again by itself. */
export type SavedValuesStopped = "declined" | "removed";

export type SavedValuesTrust = Readonly<{
  ownerId: string;
  pin: SavedValuesRosterPin | null;
  stopped: SavedValuesStopped | null;
}>;

const isPin = (value: unknown): value is SavedValuesRosterPin => {
  const pin = value as Partial<SavedValuesRosterPin> | null;
  return (
    !!pin &&
    typeof pin.genesis === "string" &&
    typeof pin.seq === "number" &&
    typeof pin.hash === "string"
  );
};

/** What this phone knows for this account; another account starts knowing nothing. */
export const loadTrust = async (ownerId: string): Promise<SavedValuesTrust> => {
  const nothing: SavedValuesTrust = { ownerId, pin: null, stopped: null };
  const stored = await SecureStore.getDeviceOnlyItemAsync(TRUST_ITEM);
  if (!stored) return nothing;
  try {
    const value = JSON.parse(stored) as Partial<SavedValuesTrust> | null;
    if (value?.ownerId !== ownerId) return nothing;
    return {
      ownerId,
      pin: isPin(value.pin) ? value.pin : null,
      stopped:
        value.stopped === "declined" ||
        value.stopped === "removed"
          ? value.stopped
          : null,
    };
  } catch {
    return nothing;
  }
};

export const saveTrust = (trust: SavedValuesTrust): Promise<void> =>
  SecureStore.setDeviceOnlyItemAsync(TRUST_ITEM, JSON.stringify(trust));

export const forgetDevice = async (): Promise<void> => {
  deviceKeys = null;
  await Promise.all(
    [SEAL_KEY_ITEM, SIGN_KEY_ITEM, TRUST_ITEM].map((item) =>
      SecureStore.deleteDeviceOnlyItemAsync(item).catch(() => undefined),
    ),
  );
};
