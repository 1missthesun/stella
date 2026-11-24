/**
 * Saved private values (logins, cards) synced across the user's devices,
 * end to end encrypted.
 *
 * Each device that can hold values (a computer, the phone app) has its own
 * X25519 key; its private half never leaves the device. The cloud keeps, per
 * owner, the devices' public keys and every saved record sealed separately to
 * each of them, plus ids and times. It never holds a key that opens a record:
 * the service names, accounts and values are all inside the seal.
 *
 * A cloud task that needs a saved login gets it from a device: Stella asks the
 * user's online computers to release it, and the one that has it seals just
 * the asked fields to a key that exists only in that task's sandbox (the
 * user-ask seal, `UserAskRecipientKey`). With no computer online, the task's
 * secure card goes to the user, and a phone holding the record answers it with
 * one tap, sealed the same way.
 *
 * Recipients are named by id: a device id today. Another kind of recipient (a
 * key a cloud task may use while every device is off, opted into per record)
 * would be one more entry in `sealed` and one more `policy` field, with no
 * change to this format.
 */
import {
  USER_ASK_SEAL_ALGORITHM,
  sealBindingBytes,
  type UserAskField,
  type UserAskFieldType,
} from "./user-ask.js";

export const SAVED_VALUES_FORMAT_VERSION = 1 as const;

/** The seal: X25519 key agreement with a fresh key per seal, HKDF-SHA256, AES-256-GCM (as user asks). */
export const SAVED_VALUE_SEAL_ALGORITHM = USER_ASK_SEAL_ALGORITHM;
export const SAVED_VALUE_SEAL_PURPOSE = "stella-saved-value" as const;
export const SAVED_VALUE_PUBLIC_KEY_BYTES = 32;
export const SAVED_VALUE_IV_BYTES = 12;
export const SAVED_VALUE_KEY_BYTES = 32;
/** The largest record a device seals (fields, values, names), before encryption. */
export const SAVED_VALUE_MAX_PAYLOAD_BYTES = 64 * 1024;
/** How many records one owner keeps synced. */
export const SAVED_VALUES_MAX_RECORDS = 2_000;
/** How many devices one owner seals to. */
export const SAVED_VALUES_MAX_DEVICES = 32;
/** How often a running device refreshes its card. */
export const SAVED_VALUES_DEVICE_REFRESH_MS = 24 * 60 * 60_000;

export const SAVED_VALUE_DEVICE_KINDS = ["computer", "phone"] as const;
export type SavedValueDeviceKind = (typeof SAVED_VALUE_DEVICE_KINDS)[number];

/** A device that can open saved values: its X25519 public key (raw, base64url). */
export type SavedValueDevice = Readonly<{
  deviceId: string;
  kind: SavedValueDeviceKind;
  publicKey: string;
  name?: string;
  updatedAt: number;
}>;

/** A record sealed to one recipient. */
export type SavedValueSeal = Readonly<{
  algorithm: typeof SAVED_VALUE_SEAL_ALGORITHM;
  /** The sealing device's fresh X25519 public key (raw, base64url). */
  clientPublicKey: string;
  iv: string;
  ciphertext: string;
}>;

/** What the cloud lists for a record: ids and times only. */
export type SavedValueHead = Readonly<{
  id: string;
  /** Raised by every change; a device takes a record whose updatedAt is newer than its own copy. */
  updatedAt: number;
  updatedBy: string;
  deleted?: true;
  /** A deletion's signature by `updatedBy`, which devices check before deleting. */
  deleteSig?: string;
  /** The recipients the record is sealed to. */
  recipients: readonly string[];
}>;

export type SavedValueRecord = SavedValueHead &
  Readonly<{
    /** One seal per recipient id; absent when deleted. */
    sealed?: Readonly<Record<string, SavedValueSeal>>;
  }>;

export type SavedValueField = Readonly<{
  id: string;
  label: string;
  type: UserAskFieldType;
  sensitive: boolean;
  /** The handle tasks use for a sensitive field: the same on every device. */
  handle?: string;
}>;

/** Reserved for later per-record choices; nothing reads it yet. */
export type SavedValuePolicy = Readonly<{
  /** Let cloud tasks use this value while every device is off (needs a cloud recipient). */
  cloudWhenDevicesOff?: boolean;
}>;

/** Inside the seal. */
export type SavedValuePayload = Readonly<{
  v: typeof SAVED_VALUES_FORMAT_VERSION;
  id: string;
  service: string;
  account: string;
  label: string;
  fields: readonly SavedValueField[];
  values: Readonly<Record<string, string>>;
  createdAt: number;
  updatedAt: number;
  policy?: SavedValuePolicy;
}>;

export type SavedValueSealBinding = Readonly<{
  recordId: string;
  recipientId: string;
  updatedAt: number;
}>;

/**
 * What a seal is bound to (its AAD and HKDF info): the record, the recipient
 * and the version, so a seal can't be moved to another record, recipient or
 * an older version. HKDF salt is the UTF-8 of the AAD's SHA-256 hex.
 */
export const savedValueSealAad = (binding: SavedValueSealBinding): Uint8Array =>
  sealBindingBytes({
    v: SAVED_VALUES_FORMAT_VERSION,
    purpose: SAVED_VALUE_SEAL_PURPOSE,
    algorithm: SAVED_VALUE_SEAL_ALGORITHM,
    recordId: binding.recordId,
    recipientId: binding.recipientId,
    updatedAt: binding.updatedAt,
  });

export const savedValueSealSalt = (aadSha256Hex: string): Uint8Array =>
  new TextEncoder().encode(aadSha256Hex.trim().toLowerCase());

export const isSavedValueDeviceKind = (value: unknown): value is SavedValueDeviceKind =>
  typeof value === "string" && (SAVED_VALUE_DEVICE_KINDS as readonly string[]).includes(value);

export const parseSavedValuePayload = (text: string): SavedValuePayload | null => {
  try {
    const value = JSON.parse(text) as Partial<SavedValuePayload> | null;
    if (
      !value ||
      value.v !== SAVED_VALUES_FORMAT_VERSION ||
      typeof value.id !== "string" ||
      typeof value.service !== "string" ||
      typeof value.account !== "string" ||
      typeof value.label !== "string" ||
      !Array.isArray(value.fields) ||
      !value.values ||
      typeof value.values !== "object" ||
      typeof value.createdAt !== "number" ||
      typeof value.updatedAt !== "number"
    ) {
      return null;
    }
    const fields = value.fields.filter(
      (field): field is SavedValueField =>
        !!field &&
        typeof field.id === "string" &&
        typeof field.label === "string" &&
        typeof field.type === "string" &&
        typeof field.sensitive === "boolean" &&
        (field.handle === undefined || typeof field.handle === "string"),
    );
    const values = Object.fromEntries(
      Object.entries(value.values).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
    return { ...(value as SavedValuePayload), fields, values };
  } catch {
    return null;
  }
};

/** A device on the list, for Settings. */
export type SavedValuesListedDevice = Readonly<{
  deviceId: string;
  name: string;
  kind: SavedValueDeviceKind;
  thisDevice: boolean;
  lastSeenAt?: number;
  /** Not seen for a while: nothing new is sealed to it until it's back. */
  quiet: boolean;
}>;

/** A device asking to be allowed, as a device on the list shows it. */
export type SavedValuesJoinRequest = Readonly<{
  joinId: string;
  name: string;
  kind: SavedValueDeviceKind;
  /** The 6 digits both screens show; null until both devices have added their numbers. */
  code: string | null;
  createdAt: number;
}>;

/** A cloud task's use of a saved value on this computer. */
export type SavedValueReleaseLogEntry = Readonly<{
  at: number;
  label: string;
  service: string;
  taskName?: string;
  /** Not released: too many uses in the last hour, so the task asked the user. */
  refused?: true;
}>;

/** This device's sync of saved values, for Settings. */
export type SavedValuesSyncStatus = Readonly<{
  /** Off only when the user turned it off. */
  enabled: boolean;
  /** Signed in and connected: values are syncing. */
  active: boolean;
  /**
   * member: on the devices' list. waiting: asking to be allowed by a device
   * on it. problem: the list couldn't be checked, so nothing syncs. off.
   */
  standing: "member" | "waiting" | "problem" | "off";
  /**
   * While waiting: the code to compare once it can be made, the device that
   * will show it, whether the user confirmed it here, and whether the last ask
   * was declined (or this device was taken off).
   */
  waiting?: Readonly<{
    code: string | null;
    approver?: string;
    confirmed?: boolean;
    declined?: boolean;
    removed?: boolean;
  }>;
  problem?: "reset" | "rollback" | "fork" | "invalid";
  devices: readonly SavedValuesListedDevice[];
  requests: readonly SavedValuesJoinRequest[];
  records: number;
  releases: readonly SavedValueReleaseLogEntry[];
  lastSyncedAt?: number;
  error?: string;
}>;

/** A cloud task asking the user's computers for a saved value (the release). */
export type SavedValueReleaseRequest = Readonly<{
  /** Binds the sealed fields; the task opens them with its own key. */
  releaseId: string;
  service: string;
  account?: string;
  purpose: string;
  fields: readonly Readonly<{
    id: string;
    label: string;
    type: UserAskFieldType;
    sensitive: boolean;
    optional?: boolean;
  }>[];
  recipientKey: import("./user-ask.js").UserAskRecipientKey;
  conversationId?: string;
  threadId?: string;
  /** The task's name, for this computer's log of uses. */
  taskName?: string;
}>;

export type SavedValueReleaseResult =
  | Readonly<{
      found: true;
      /** Every answered field, sealed to the task's key with the user-ask seal (askId = releaseId). */
      sealed: Readonly<Record<string, import("./user-ask.js").UserAskSealedValue>>;
      saved: Readonly<{
        label: string;
        account?: string;
        savedAt: number;
        service?: string;
        askedService?: string;
      }>;
      /** The device that released it. */
      deviceId: string;
    }>
  | Readonly<{
      found: false;
      /** What is saved, by name only, when the computer that answered has nothing for the service. */
      savedHere: readonly import("./user-ask.js").SavedSecureValueSummary[];
      /** Why nothing came back: nothing saved, or no computer that could answer. */
      reason: "not_saved" | "no_computer" | "sync_off" | "limit";
      /** When several saved values fit and the task must name the account. */
      message?: string;
    }>;

const fieldKey = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Names a sign-in's account field goes by: a login saved with "Email" answers a request for "Username". */
const ACCOUNT_FIELD_KEYS = new Set([
  "username", "user", "userid", "login", "loginid", "email", "emailaddress",
  "usernameoremail", "emailorusername", "account", "accountname",
]);

/** The name a field is paired by: its own, or "account" for any of the account names. */
const pairingKey = (value: string) => {
  const key = fieldKey(value);
  return ACCOUNT_FIELD_KEYS.has(key) ? "account" : key;
};

type MatchableField = Pick<UserAskField, "id" | "label" | "type" | "sensitive">;
type PairableSavedField = Pick<SavedValueField, "id" | "label" | "type" | "sensitive">;

/** A one-time code is never saved, so no saved field answers one. */
const sameKind = (saved: PairableSavedField, field: MatchableField) =>
  field.type !== "code" &&
  saved.sensitive === field.sensitive &&
  (saved.type === "secret") === (field.type === "secret");

/**
 * Pairs requested fields with saved ones, one to one: by id, then by label,
 * then by what the field is (any account name pairs with any other), then
 * (so a renamed field still finds its value) the only unclaimed saved field
 * of the same kind when exactly one requested field of that kind is left over.
 * No saved field is ever paired with two requested fields, so every field keeps
 * its own value and its own handle.
 */
export const matchSavedFields = <S extends PairableSavedField>(
  saved: readonly S[],
  fields: readonly MatchableField[],
): Map<string, S> => {
  const matched = new Map<string, S>();
  const claimed = new Set<S>();
  const pair = (field: MatchableField, candidate: S | undefined) => {
    if (!candidate || claimed.has(candidate) || matched.has(field.id)) return;
    matched.set(field.id, candidate);
    claimed.add(candidate);
  };
  for (const field of fields) {
    if (field.type === "code") continue;
    pair(field, saved.find((candidate) => candidate.id === field.id));
  }
  for (const field of fields) {
    if (matched.has(field.id) || field.type === "code") continue;
    const label = fieldKey(field.label);
    pair(
      field,
      saved.find((candidate) => !claimed.has(candidate) && fieldKey(candidate.label) === label),
    );
  }
  for (const field of fields) {
    if (matched.has(field.id)) continue;
    const keys = new Set([pairingKey(field.id), pairingKey(field.label)]);
    pair(
      field,
      saved.find(
        (candidate) =>
          !claimed.has(candidate) &&
          sameKind(candidate, field) &&
          (keys.has(pairingKey(candidate.id)) || keys.has(pairingKey(candidate.label))),
      ),
    );
  }
  for (const field of fields) {
    if (matched.has(field.id)) continue;
    const open = saved.filter((candidate) => !claimed.has(candidate) && sameKind(candidate, field));
    const rivals = fields.filter(
      (other) => !matched.has(other.id) && open.some((candidate) => sameKind(candidate, other)),
    );
    if (open.length === 1 && rivals.length === 1) pair(field, open[0]);
  }
  return matched;
};

