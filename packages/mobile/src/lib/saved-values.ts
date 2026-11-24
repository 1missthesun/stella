import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { gcm } from "@noble/ciphers/aes.js";
import { bytesToUtf8, utf8ToBytes } from "@noble/ciphers/utils.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import * as Crypto from "expo-crypto";
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
import {
  deletionValid,
  openEnvelope,
  removeFromRoster,
  savedValueRecipients,
  signedEnvelope,
  type SavedValuesRoster,
} from "@stella/contracts/saved-values-trust";
import { authClient } from "./auth-client";
import { getBackendClient, useBackendView } from "./backend";
import { base64UrlToBytes, bytesToBase64Url } from "./base64url";
import { getOrCreateMobileDeviceId } from "./phone-access";
import {
  forgetDevice,
  phoneName,
  type SavedValuesDeviceKeys,
} from "./saved-values-device";
import {
  noteSavedValuesState,
  removeFromSavedValues,
  resetSavedValuesTrust,
  savedValuesMembership,
  savedValuesVersion,
  subscribeSavedValues,
} from "./saved-values-trust";
import { useAppVisible } from "./use-app-visible";

const PUBLISH_RETRY_MS = 10 * 60_000;
const WITHDRAW_BUDGET_MS = 4_000;
const GET_BATCH = 100;
const HEAL_DELAY_MS = 6_000;

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
  keys: SavedValuesDeviceKeys,
  binding: SavedValueSealBinding,
): string | null => {
  if (seal.algorithm !== SAVED_VALUE_SEAL_ALGORITHM) return null;
  try {
    const shared = x25519.getSharedSecret(
      keys.secretKey,
      base64UrlToBytes(seal.clientPublicKey),
    );
    const { key, aad } = sealKey(shared, binding);
    return bytesToUtf8(
      gcm(key, base64UrlToBytes(seal.iv), aad).decrypt(
        base64UrlToBytes(seal.ciphertext),
      ),
    );
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

const sealedRecords = new Map<string, SavedValueRecord>();

export const useSavedValuesVersion = (): string =>
  useSyncExternalStore(subscribeSavedValues, savedValuesVersion);

let publishing = false;
let lastPublishAttemptAt = 0;

const publishDevice = async (): Promise<void> => {
  const membership = await savedValuesMembership();
  if (!membership) return;
  const { keys, state } = membership;
  const mine = state.devices.find((device) => device.deviceId === keys.deviceId);
  const current =
    mine !== undefined &&
    mine.kind === "phone" &&
    mine.publicKey === keys.publicKey &&
    Date.now() - mine.updatedAt < SAVED_VALUES_DEVICE_REFRESH_MS;
  if (current || publishing) return;
  if (mine && Date.now() - lastPublishAttemptAt < PUBLISH_RETRY_MS) return;
  publishing = true;
  lastPublishAttemptAt = Date.now();
  try {
    await getBackendClient().call("savedValues.putDevice", {
      deviceId: keys.deviceId,
      kind: "phone",
      publicKey: keys.publicKey,
      name: phoneName(),
    });
  } finally {
    publishing = false;
  }
};

const NO_ARGS = {} as const;

export const useSavedValuesSync = (): void => {
  const session = authClient.useSession();
  const owner = session.data?.user?.id ?? null;
  const view = useBackendView("savedValues.state", owner ? NO_ARGS : "skip");
  const value = view.value;
  const version = useSavedValuesVersion();
  const visible = useAppVisible();
  useEffect(() => {
    if (!owner || !value) return;
    void noteSavedValuesState(owner, value)
      .then(publishDevice)
      .catch(() => undefined);
  }, [owner, value]);
  useEffect(() => {
    if (!owner || !visible) return;
    void publishDevice().catch(() => undefined);
    const timer = setTimeout(
      () => void sealForNewDevices().catch(() => undefined),
      HEAL_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [owner, value, version, visible]);
  useEffect(() => () => sealedRecords.clear(), [owner]);
};

const withdraw = async (): Promise<void> => {
  const membership = await savedValuesMembership();
  if (membership) {
    const { keys, roster } = membership;
    await getBackendClient()
      .call("savedValues.rosterAppend", {
        entry: removeFromRoster({
          roster,
          target: keys.deviceId,
          by: keys.deviceId,
          key: keys.signing,
          at: Date.now(),
        }),
      })
      .catch(() => undefined);
  }
  await getBackendClient().call("savedValues.removeDevice", {
    deviceId: await getOrCreateMobileDeviceId(),
  });
};

export const withdrawSavedValuesDevice = async (): Promise<void> => {
  try {
    await Promise.race([
      withdraw(),
      new Promise((resolve) => setTimeout(resolve, WITHDRAW_BUDGET_MS)),
    ]);
  } catch {}
  resetSavedValuesTrust();
  await forgetDevice();
  lastPublishAttemptAt = 0;
  sealedRecords.clear();
};

type OpenedRecord = {
  payload: SavedValuePayload;
  updatedAt: number;
  envelope: string;
  signedBy: string;
};

const signerOf = (envelope: string): string => {
  const by = (JSON.parse(envelope) as { by?: unknown }).by;
  return typeof by === "string" ? by : "";
};

const envelopePayload = (envelope: string): string =>
  (JSON.parse(envelope) as { payload: string }).payload;

const verified = new WeakMap<SavedValueRecord, string>();

const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const openRecord = (
  record: SavedValueRecord,
  keys: SavedValuesDeviceKeys,
  roster: SavedValuesRoster,
): OpenedRecord | null => {
  const seal = record.sealed?.[keys.deviceId];
  const envelope = seal
    ? openSeal(seal, keys, {
        recordId: record.id,
        recipientId: keys.deviceId,
        updatedAt: record.updatedAt,
      })
    : null;
  const signed =
    envelope === null
      ? null
      : verified.get(record) === roster.head.hash
        ? envelopePayload(envelope)
        : openEnvelope(envelope, roster);
  const payload = signed === null ? null : parseSavedValuePayload(signed);
  if (
    envelope === null ||
    !payload ||
    payload.id !== record.id ||
    payload.updatedAt !== record.updatedAt
  ) {
    return null;
  }
  verified.set(record, roster.head.hash);
  return {
    payload,
    updatedAt: record.updatedAt,
    envelope,
    signedBy: signerOf(envelope),
  };
};

type OpenedRecords = {
  keys: SavedValuesDeviceKeys;
  roster: SavedValuesRoster;
  state: SavedValuesState;
  records: OpenedRecord[];
};

const openAll = async (): Promise<OpenedRecords | null> => {
  const membership = await savedValuesMembership();
  if (!membership) {
    sealedRecords.clear();
    return null;
  }
  const { keys, roster, state } = membership;
  const deleted = new Set(
    state.records
      .filter(
        (head) =>
          head.deleted &&
          deletionValid({
            id: head.id,
            updatedAt: head.updatedAt,
            by: head.updatedBy,
            sig: head.deleteSig,
            roster,
          }),
      )
      .map((head) => head.id),
  );
  const heads = state.records.filter(
    (head) => !head.deleted && head.recipients.includes(keys.deviceId),
  );
  const stale = heads
    .filter((head) => sealedRecords.get(head.id)?.updatedAt !== head.updatedAt)
    .map((head) => head.id);
  for (let start = 0; start < stale.length; start += GET_BATCH) {
    const { records } = await getBackendClient().call("savedValues.get", {
      ids: stale.slice(start, start + GET_BATCH),
    });
    for (const record of records) {
      await breathe();
      if (!record.deleted && openRecord(record, keys, roster)) {
        sealedRecords.set(record.id, record);
      }
    }
  }
  const records: OpenedRecord[] = [];
  for (const [id, record] of [...sealedRecords]) {
    await breathe();
    const opened = deleted.has(id) ? null : openRecord(record, keys, roster);
    if (opened) records.push(opened);
    else sealedRecords.delete(id);
  }
  return { keys, roster, state, records };
};

const sealEnvelope = (
  envelope: string,
  record: { id: string; updatedAt: number },
  recipients: readonly { deviceId: string; sealKey: string }[],
): Record<string, SavedValueSeal> => {
  const plaintext = utf8ToBytes(envelope);
  const sealed: Record<string, SavedValueSeal> = {};
  for (const recipient of recipients) {
    try {
      sealed[recipient.deviceId] = sealTo(plaintext, recipient.sealKey, {
        recordId: record.id,
        recipientId: recipient.deviceId,
        updatedAt: record.updatedAt,
      });
    } catch {
      continue;
    }
  }
  return sealed;
};

const putRecord = async (args: {
  payload: SavedValuePayload;
  keys: SavedValuesDeviceKeys;
  roster: SavedValuesRoster;
  state: SavedValuesState;
  except?: string;
}): Promise<boolean> => {
  const { payload, keys, roster, state } = args;
  const envelope = signedEnvelope({
    payload: JSON.stringify(payload),
    by: keys.deviceId,
    key: keys.signing,
  });
  if (utf8ToBytes(envelope).byteLength > SAVED_VALUE_MAX_PAYLOAD_BYTES) {
    return false;
  }
  const recipients = savedValueRecipients({
    roster,
    devices: state.devices,
    selfId: keys.deviceId,
    now: Date.now(),
  }).filter((member) => member.deviceId !== args.except);
  const result = await getBackendClient().call("savedValues.put", {
    id: payload.id,
    updatedAt: payload.updatedAt,
    updatedBy: keys.deviceId,
    sealed: sealEnvelope(envelope, payload, recipients),
  });
  return result.accepted;
};

let healing = false;

const sealForNewDevices = async (): Promise<void> => {
  if (healing) return;
  const membership = await savedValuesMembership();
  if (!membership) return;
  const { keys, roster, state } = membership;
  const wanted = savedValueRecipients({
    roster,
    devices: state.devices,
    selfId: keys.deviceId,
    now: Date.now(),
  });
  const lacking = new Map(
    state.records
      .filter(
        (head) => !head.deleted && head.recipients.includes(keys.deviceId),
      )
      .map(
        (head) =>
          [
            head.id,
            wanted.filter((member) => !head.recipients.includes(member.deviceId)),
          ] as const,
      )
      .filter(([, members]) => members.length > 0),
  );
  if (lacking.size === 0) return;
  healing = true;
  for (const id of lacking.keys()) sealedRecords.delete(id);
  try {
    const opened = await openAll();
    for (const record of opened?.records ?? []) {
      const members = lacking.get(record.payload.id);
      const held = sealedRecords.get(record.payload.id);
      if (!members || !held || held.updatedAt !== record.updatedAt) continue;
      await getBackendClient().call("savedValues.put", {
        id: record.payload.id,
        updatedAt: record.updatedAt,
        updatedBy: held.updatedBy,
        sealed: {
          ...held.sealed,
          ...sealEnvelope(record.envelope, record.payload, members),
        },
      });
      sealedRecords.delete(record.payload.id);
    }
  } finally {
    healing = false;
  }
};

export const removeSavedValuesDevice = async (
  deviceId: string,
): Promise<void> => {
  const opened = await openAll();
  if (!opened) return;
  for (const record of opened.records) {
    if (record.signedBy !== deviceId) continue;
    await putRecord({
      payload: { ...record.payload, updatedAt: record.updatedAt + 1 },
      keys: opened.keys,
      roster: opened.roster,
      state: opened.state,
      except: deviceId,
    });
  }
  await removeFromSavedValues(deviceId);
};

const ACCOUNT_FIELD_PATTERN =
  /^(user(name)?|e-?mail|login|account|handle|user ?id)$/i;

const sameAccount = (left: string, right: string) =>
  left.trim().toLowerCase() === right.trim().toLowerCase();

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

export const findSavedLogin = async (ask: UserAsk): Promise<SavedLogin | null> => {
  const detail = ask.detail;
  if (detail.kind !== "secure_input" || !detail.save || detail.save.replacing) {
    return null;
  }
  const service = normalizeSavedValuePart(detail.save.service);
  if (!service) return null;
  const opened = await openAll();
  if (!opened) return null;
  const account = usableAccount(service, detail.save.account);
  for (const record of candidatesFor(opened.records, service, account, true)) {
    const fills = answerableFrom(record.payload, detail.fields);
    if (fills) return { label: record.payload.label, fills };
  }
  return null;
};

export const rememberedByPhone = (ask: UserAsk): boolean =>
  ask.originDeviceId === USER_ASK_CLOUD_ORIGIN_DEVICE_ID;

const newHandle = () => `${USER_ASK_SECRET_HANDLE_PREFIX}${Crypto.randomUUID()}`;

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
  const opened = await openAll();
  if (!opened) return null;
  const { keys, roster, state, records } = opened;
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
  return (await putRecord({ payload, keys, roster, state })) ? { label } : null;
};

export type SavedLoginLookup = Readonly<{
  status: "checking" | "found" | "none";
  login: SavedLogin | null;
}>;

const NO_SAVED_LOGIN: SavedLoginLookup = { status: "none", login: null };
const CHECKING_SAVED_LOGIN: SavedLoginLookup = { status: "checking", login: null };

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
