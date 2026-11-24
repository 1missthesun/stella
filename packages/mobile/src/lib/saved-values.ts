import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { gcm } from "@noble/ciphers/aes.js";
import { bytesToUtf8, utf8ToBytes } from "@noble/ciphers/utils.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import type { SavedValuesState } from "@stella/contracts/backend/saved-values";
import {
  SAVED_VALUES_DEVICE_REFRESH_MS,
  SAVED_VALUES_FORMAT_VERSION,
  SAVED_VALUE_IV_BYTES,
  SAVED_VALUE_KEY_BYTES,
  SAVED_VALUE_MAX_PAYLOAD_BYTES,
  SAVED_VALUE_PUBLIC_KEY_BYTES,
  SAVED_VALUE_SEAL_ALGORITHM,
  matchSavedFields,
  parseSavedValuePayload,
  savedValueRecipients,
  savedValueSealAad,
  savedValueSealSalt,
  type SavedValueField,
  type SavedValuePayload,
  type SavedValueRecord,
  type SavedValueSeal,
  type SavedValueSealBinding,
} from "@stella/contracts/saved-values";
import {
  USER_ASK_CLOUD_ORIGIN_DEVICE_ID,
  USER_ASK_SECRET_HANDLE_PREFIX,
  normalizeSavedValuePart,
  savedServiceMatch,
  savedValueLabel,
  userAskFieldIsRememberable,
  type UserAsk,
  type UserAskField,
  type UserAskSecureInputDetail,
} from "@stella/contracts/user-ask";
import { authClient } from "./auth-client";
import { getBackendClient, readBackendView, useBackendView } from "./backend";
import { base64UrlToBytes, bytesToBase64Url } from "./base64url";
import { getOrCreateMobileDeviceId } from "./phone-access";
import * as SecureStore from "./secure-store";

/**
 * This phone's copy of the user's synced saved values. The phone has its own
 * X25519 key (the private half only in this device's keychain); every saved
 * record comes sealed to it, so a cloud task's secure card can be answered
 * from here with one tap. Opened records live only in memory, only while an
 * answer is being made.
 */

const DEVICE_KEY_ITEM = "stella.savedValues.deviceKey.v1";
const PUBLISH_RETRY_MS = 10 * 60_000;
const WITHDRAW_BUDGET_MS = 4_000;
const GET_BATCH = 100;

type DeviceKey = {
  deviceId: string;
  secretKey: Uint8Array;
  publicKey: string;
};

let deviceKey: Promise<DeviceKey> | null = null;

const readSecretKey = (stored: string | null): Uint8Array | null => {
  if (!stored) return null;
  try {
    const bytes = base64UrlToBytes(stored);
    return bytes.byteLength === SAVED_VALUE_PUBLIC_KEY_BYTES ? bytes : null;
  } catch {
    return null;
  }
};

const loadDeviceKey = (): Promise<DeviceKey> => {
  deviceKey ??= (async () => {
    const deviceId = await getOrCreateMobileDeviceId();
    let secretKey = readSecretKey(
      await SecureStore.getDeviceOnlyItemAsync(DEVICE_KEY_ITEM),
    );
    if (!secretKey) {
      secretKey = Crypto.getRandomBytes(SAVED_VALUE_PUBLIC_KEY_BYTES);
      await SecureStore.setDeviceOnlyItemAsync(
        DEVICE_KEY_ITEM,
        bytesToBase64Url(secretKey),
      );
    }
    return {
      deviceId,
      secretKey,
      publicKey: bytesToBase64Url(x25519.getPublicKey(secretKey)),
    };
  })().catch((error: unknown) => {
    deviceKey = null;
    throw error;
  });
  return deviceKey;
};

const sealKey = (
  sharedSecret: Uint8Array,
  binding: SavedValueSealBinding,
): { key: Uint8Array; aad: Uint8Array } => {
  const aad = savedValueSealAad(binding);
  const salt = savedValueSealSalt(bytesToHex(sha256(aad)));
  return {
    aad,
    key: hkdf(sha256, sharedSecret, salt, aad, SAVED_VALUE_KEY_BYTES),
  };
};

const openSeal = (
  seal: SavedValueSeal,
  key: DeviceKey,
  binding: SavedValueSealBinding,
): SavedValuePayload | null => {
  if (seal.algorithm !== SAVED_VALUE_SEAL_ALGORITHM) return null;
  try {
    const shared = x25519.getSharedSecret(
      key.secretKey,
      base64UrlToBytes(seal.clientPublicKey),
    );
    const { key: aesKey, aad } = sealKey(shared, binding);
    const plaintext = gcm(aesKey, base64UrlToBytes(seal.iv), aad).decrypt(
      base64UrlToBytes(seal.ciphertext),
    );
    const payload = parseSavedValuePayload(bytesToUtf8(plaintext));
    return payload &&
      payload.id === binding.recordId &&
      payload.updatedAt === binding.updatedAt
      ? payload
      : null;
  } catch {
    return null;
  }
};

const sealTo = (
  plaintext: Uint8Array,
  recipientPublicKey: string,
  binding: SavedValueSealBinding,
): SavedValueSeal => {
  const ephemeral = Crypto.getRandomBytes(SAVED_VALUE_PUBLIC_KEY_BYTES);
  const shared = x25519.getSharedSecret(
    ephemeral,
    base64UrlToBytes(recipientPublicKey),
  );
  const { key, aad } = sealKey(shared, binding);
  const iv = Crypto.getRandomBytes(SAVED_VALUE_IV_BYTES);
  return {
    algorithm: SAVED_VALUE_SEAL_ALGORITHM,
    clientPublicKey: bytesToBase64Url(x25519.getPublicKey(ephemeral)),
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(gcm(key, iv, aad).encrypt(plaintext)),
  };
};

let latestState: SavedValuesState | null = null;
const stateListeners = new Set<() => void>();
const sealedRecords = new Map<string, SavedValueRecord>();

const setLatestState = (next: SavedValuesState | null) => {
  latestState = next;
  for (const listener of stateListeners) listener();
};

const subscribeState = (listener: () => void) => {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
};

/** Changes whenever the synced records change, so open cards look again. */
export const useSavedValuesVersion = (): string =>
  useSyncExternalStore(subscribeState, () =>
    latestState
      ? latestState.records.map((head) => `${head.id}:${head.updatedAt}`).join(",")
      : "",
  );

const phoneName = (): string =>
  Device.deviceName?.trim() || Device.modelName?.trim() || "Phone";

let publishing = false;
let lastPublishAttemptAt = 0;

const publishDevice = async (state: SavedValuesState): Promise<void> => {
  const key = await loadDeviceKey();
  const mine = state.devices.find((device) => device.deviceId === key.deviceId);
  const current =
    mine !== undefined &&
    mine.kind === "phone" &&
    mine.publicKey === key.publicKey &&
    Date.now() - mine.updatedAt < SAVED_VALUES_DEVICE_REFRESH_MS;
  if (current || publishing) return;
  if (Date.now() - lastPublishAttemptAt < PUBLISH_RETRY_MS) return;
  publishing = true;
  lastPublishAttemptAt = Date.now();
  try {
    await getBackendClient().call("savedValues.putDevice", {
      deviceId: key.deviceId,
      kind: "phone",
      publicKey: key.publicKey,
      name: phoneName(),
    });
  } finally {
    publishing = false;
  }
};

const NO_ARGS = {} as const;

/** While signed in: watch the synced records and keep this phone's key published. */
export const useSavedValuesSync = (): void => {
  const session = authClient.useSession();
  const signedIn = Boolean(session.data);
  const view = useBackendView("savedValues.state", signedIn ? NO_ARGS : "skip");
  const value = view.value;
  useEffect(() => {
    if (!signedIn || !value) return;
    setLatestState(value);
    void publishDevice(value).catch(() => undefined);
  }, [signedIn, value]);
};

/** On sign-out: this phone stops receiving saved values, and its key is gone. */
export const withdrawSavedValuesDevice = async (): Promise<void> => {
  try {
    const deviceId = await getOrCreateMobileDeviceId();
    await Promise.race([
      getBackendClient().call("savedValues.removeDevice", { deviceId }),
      new Promise((resolve) => setTimeout(resolve, WITHDRAW_BUDGET_MS)),
    ]);
  } catch {
    // Best-effort: a device not seen for a while stops being sealed to anyway.
  }
  await SecureStore.deleteDeviceOnlyItemAsync(DEVICE_KEY_ITEM).catch(
    () => undefined,
  );
  deviceKey = null;
  lastPublishAttemptAt = 0;
  sealedRecords.clear();
  setLatestState(null);
};

type OpenedRecord = { payload: SavedValuePayload; updatedAt: number };

const readState = async (): Promise<SavedValuesState> =>
  latestState ?? (await readBackendView("savedValues.state", NO_ARGS));

/** Every record sealed to this phone, opened. Callers keep only what they need. */
const openAll = async (): Promise<{
  key: DeviceKey;
  state: SavedValuesState;
  records: OpenedRecord[];
}> => {
  const [key, state] = await Promise.all([loadDeviceKey(), readState()]);
  const heads = state.records.filter(
    (head) => !head.deleted && head.recipients.includes(key.deviceId),
  );
  const stale = heads
    .filter((head) => sealedRecords.get(head.id)?.updatedAt !== head.updatedAt)
    .map((head) => head.id);
  for (let start = 0; start < stale.length; start += GET_BATCH) {
    const { records } = await getBackendClient().call("savedValues.get", {
      ids: stale.slice(start, start + GET_BATCH),
    });
    for (const record of records) sealedRecords.set(record.id, record);
  }
  const live = new Set(heads.map((head) => head.id));
  for (const id of sealedRecords.keys()) {
    if (!live.has(id)) sealedRecords.delete(id);
  }
  const records: OpenedRecord[] = [];
  for (const head of heads) {
    const record = sealedRecords.get(head.id);
    const seal = record?.sealed?.[key.deviceId];
    if (!record || record.deleted || !seal) continue;
    const payload = openSeal(seal, key, {
      recordId: record.id,
      recipientId: key.deviceId,
      updatedAt: record.updatedAt,
    });
    if (payload) records.push({ payload, updatedAt: record.updatedAt });
  }
  return { key, state, records };
};

const ACCOUNT_FIELD_PATTERN =
  /^(user(name)?|e-?mail|login|account|handle|user ?id)$/i;

const sameAccount = (left: string, right: string) =>
  left.trim().toLowerCase() === right.trim().toLowerCase();

/** An account that names nothing (the service's own name, redacted text) counts as none. */
const usableAccount = (service: string, account: string | undefined): string => {
  const value = normalizeSavedValuePart(account ?? "");
  if (
    !value ||
    /\[redacted[^\]]*\]/i.test(value) ||
    (service && sameAccount(value, service))
  ) {
    return "";
  }
  return value;
};

const accountFromAnswer = (
  typed: readonly { field: UserAskField; value: string }[],
): string => {
  for (const { field, value } of typed) {
    if (field.sensitive || !value.trim()) continue;
    if (
      ACCOUNT_FIELD_PATTERN.test(field.id.replace(/_/g, " ")) ||
      ACCOUNT_FIELD_PATTERN.test(field.label.trim())
    ) {
      return normalizeSavedValuePart(value);
    }
  }
  return "";
};

/** Records for a service, best first: saved under the same name, then close ones; newest first within each. */
const candidatesFor = (
  records: readonly OpenedRecord[],
  service: string,
  account: string,
  allowClose: boolean,
): OpenedRecord[] => {
  const rank = (record: OpenedRecord) => {
    const match = savedServiceMatch(record.payload.service, service);
    return match === "exact" ? 0 : match === "close" && allowClose ? 1 : -1;
  };
  return records
    .filter(
      (record) =>
        rank(record) >= 0 &&
        (!account ||
          sameAccount(
            usableAccount(record.payload.service, record.payload.account),
            account,
          )),
    )
    .sort(
      (left, right) => rank(left) - rank(right) || right.updatedAt - left.updatedAt,
    );
};

export type SavedLogin = Readonly<{
  label: string;
  /** Values for the asked fields, by the ask's field id. Kept only while the card is open. */
  fills: Readonly<Record<string, string>>;
}>;

const answerableFrom = (
  payload: SavedValuePayload,
  fields: readonly UserAskField[],
): Record<string, string> | null => {
  const paired = matchSavedFields(payload.fields, fields);
  const fills: Record<string, string> = {};
  for (const field of fields) {
    const saved = paired.get(field.id);
    const value = saved ? payload.values[saved.id] : undefined;
    if (value) {
      fills[field.id] = value;
      continue;
    }
    if (!field.optional && userAskFieldIsRememberable(field)) return null;
  }
  return Object.keys(fills).length > 0 ? fills : null;
};

/**
 * The saved login this phone holds for a secure card, when it answers every
 * field a saved value can (a one-time code is still typed). None when the
 * task said the saved one didn't work.
 */
export const findSavedLogin = async (ask: UserAsk): Promise<SavedLogin | null> => {
  const detail = ask.detail;
  if (detail.kind !== "secure_input" || !detail.save || detail.save.replacing) {
    return null;
  }
  const service = normalizeSavedValuePart(detail.save.service);
  if (!service) return null;
  const { records } = await openAll();
  const account = usableAccount(service, detail.save.account);
  for (const record of candidatesFor(records, service, account, true)) {
    const fills = answerableFrom(record.payload, detail.fields);
    if (fills) return { label: record.payload.label, fills };
  }
  return null;
};

/** Whether what the user types on this card is stored by no computer, so the phone stores it. */
export const rememberedByPhone = (ask: UserAsk): boolean =>
  ask.originDeviceId === USER_ASK_CLOUD_ORIGIN_DEVICE_ID;

const newHandle = () => `${USER_ASK_SECRET_HANDLE_PREFIX}${Crypto.randomUUID()}`;

/** The record an answer updates: the one for the same account, or the only one when no account tells them apart. */
const existingRecordFor = (
  matches: readonly OpenedRecord[],
  account: string,
): OpenedRecord | null => {
  const same = matches.find((record) =>
    sameAccount(usableAccount(record.payload.service, record.payload.account), account),
  );
  if (same) return same;
  const only = matches.length === 1 ? matches[0] : undefined;
  if (only && (!account || !usableAccount(only.payload.service, only.payload.account))) {
    return only;
  }
  return null;
};

/**
 * Store what the user typed on a cloud task's card in the synced saved
 * values, sealed to every current device: a new record, or the one already
 * saved for that service and account.
 */
export const rememberOnDevices = async (args: {
  detail: UserAskSecureInputDetail;
  typed: readonly { field: UserAskField; value: string }[];
}): Promise<{ label: string } | null> => {
  const { detail } = args;
  const keep = args.typed.filter(({ field }) => userAskFieldIsRememberable(field));
  if (!detail.save || !keep.some(({ field }) => field.sensitive)) return null;
  const service =
    normalizeSavedValuePart(detail.save.service) ||
    normalizeSavedValuePart(detail.purpose);
  const account =
    usableAccount(service, detail.save.account) ||
    usableAccount(service, accountFromAnswer(args.typed));
  const { key, state, records } = await openAll();
  const existing = existingRecordFor(
    candidatesFor(records, service, "", false),
    account,
  );
  const previous = existing?.payload ?? null;
  const fields: SavedValueField[] = previous
    ? previous.fields.map((field) => ({ ...field }))
    : [];
  const values: Record<string, string> = {};
  for (const field of fields) {
    const value = previous?.values[field.id];
    if (value !== undefined) values[field.id] = value;
  }
  const paired = matchSavedFields(
    fields,
    keep.map(({ field }) => field),
  );
  for (const { field, value } of keep) {
    const current = paired.get(field.id) ?? null;
    let id = current?.id ?? field.id;
    if (!current) {
      while (fields.some((other) => other.id === id)) {
        id = `${id}_${fields.length + 1}`;
      }
    }
    const stored: SavedValueField = {
      id,
      label: field.label,
      type: field.type,
      sensitive: field.sensitive,
      ...(field.sensitive ? { handle: current?.handle ?? newHandle() } : {}),
    };
    if (current) fields[fields.indexOf(current)] = stored;
    else fields.push(stored);
    values[stored.id] = value;
  }
  const now = Date.now();
  const updatedAt = Math.max(now, (existing?.updatedAt ?? 0) + 1);
  const label =
    savedValueLabel(service, account) || fields[0]?.label || "Saved value";
  const payload: SavedValuePayload = {
    v: SAVED_VALUES_FORMAT_VERSION,
    id: previous?.id ?? Crypto.randomUUID(),
    service,
    account,
    label,
    fields,
    values,
    createdAt: previous?.createdAt ?? now,
    updatedAt,
    ...(previous?.policy ? { policy: previous.policy } : {}),
  };
  const plaintext = utf8ToBytes(JSON.stringify(payload));
  if (plaintext.byteLength > SAVED_VALUE_MAX_PAYLOAD_BYTES) return null;
  const recipients = new Map(
    savedValueRecipients(state.devices, now).map((device) => [
      device.deviceId,
      device.publicKey,
    ]),
  );
  recipients.set(key.deviceId, key.publicKey);
  const sealed: Record<string, SavedValueSeal> = {};
  for (const [recipientId, publicKey] of recipients) {
    try {
      sealed[recipientId] = sealTo(plaintext, publicKey, {
        recordId: payload.id,
        recipientId,
        updatedAt,
      });
    } catch {
      continue;
    }
  }
  const result = await getBackendClient().call("savedValues.put", {
    id: payload.id,
    updatedAt,
    updatedBy: key.deviceId,
    sealed,
  });
  return result.accepted ? { label } : null;
};

export type SavedLoginLookup = Readonly<{
  status: "checking" | "found" | "none";
  login: SavedLogin | null;
}>;

const NO_SAVED_LOGIN: SavedLoginLookup = { status: "none", login: null };
const CHECKING_SAVED_LOGIN: SavedLoginLookup = { status: "checking", login: null };

/** The saved login this phone holds for an open secure card, looked up again when the synced records change. */
export const useSavedLogin = (ask: UserAsk, enabled: boolean): SavedLoginLookup => {
  const version = useSavedValuesVersion();
  const [lookup, setLookup] = useState<SavedLoginLookup>(
    enabled ? CHECKING_SAVED_LOGIN : NO_SAVED_LOGIN,
  );
  const askRef = useRef(ask);
  askRef.current = ask;
  useEffect(() => {
    if (!enabled) {
      setLookup(NO_SAVED_LOGIN);
      return;
    }
    let cancelled = false;
    findSavedLogin(askRef.current)
      .then((login) => {
        if (!cancelled) setLookup(login ? { status: "found", login } : NO_SAVED_LOGIN);
      })
      .catch(() => {
        if (!cancelled) setLookup(NO_SAVED_LOGIN);
      });
    return () => {
      cancelled = true;
    };
  }, [ask.askId, ask.revision, enabled, version]);
  return lookup;
};
