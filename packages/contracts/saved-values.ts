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
export const SAVED_VALUE_MAX_PAYLOAD_BYTES = 64 * 1024;
export const SAVED_VALUES_MAX_RECORDS = 2_000;
export const SAVED_VALUES_MAX_DEVICES = 32;
export const SAVED_VALUES_DEVICE_REFRESH_MS = 24 * 60 * 60_000;

export const SAVED_VALUE_DEVICE_KINDS = ["computer", "phone"] as const;
export type SavedValueDeviceKind = (typeof SAVED_VALUE_DEVICE_KINDS)[number];

export type SavedValueDevice = Readonly<{
  deviceId: string;
  kind: SavedValueDeviceKind;
  publicKey: string;
  name?: string;
  updatedAt: number;
}>;

export type SavedValueSeal = Readonly<{
  algorithm: typeof SAVED_VALUE_SEAL_ALGORITHM;
  clientPublicKey: string;
  iv: string;
  ciphertext: string;
}>;

export type SavedValueHead = Readonly<{
  id: string;
  updatedAt: number;
  updatedBy: string;
  deleted?: true;
  deleteSig?: string;
  recipients: readonly string[];
}>;

export type SavedValueRecord = SavedValueHead &
  Readonly<{
    sealed?: Readonly<Record<string, SavedValueSeal>>;
  }>;

export type SavedValueField = Readonly<{
  id: string;
  label: string;
  type: UserAskFieldType;
  sensitive: boolean;
  handle?: string;
}>;

export type SavedValuePolicy = Readonly<{
  cloudWhenDevicesOff?: boolean;
}>;

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

export type SavedValuesListedDevice = Readonly<{
  deviceId: string;
  name: string;
  kind: SavedValueDeviceKind;
  thisDevice: boolean;
  addedAt: number;
  lastSeenAt?: number;
  quiet: boolean;
}>;

export type SavedValuesJoinRequest = Readonly<{
  joinId: string;
  name: string;
  kind: SavedValueDeviceKind;
  answered: boolean;
  code: string | null;
  createdAt: number;
}>;

export type SavedValueReleaseLogEntry = Readonly<{
  at: number;
  label: string;
  service: string;
  taskName?: string;
  refused?: true;
}>;

export type SavedValuesSyncStatus = Readonly<{
  enabled: boolean;
  active: boolean;
  standing: "member" | "waiting" | "problem" | "off";
  waiting?: Readonly<{
    code: string | null;
    approvers?: readonly string[];
    askedAt?: number;
    askFailed?: boolean;
    approver?: string;
    confirmed?: boolean;
    declined?: boolean;
    removed?: boolean;
    skipped?: boolean;
    // Not on the list and not asking: this device asks only when something on
    // it first needs a saved value (or the user asks from Saved logins).
    idle?: boolean;
    // The saved value that made this device ask, when one did.
    forService?: string;
  }>;
  problem?: "reset" | "rollback" | "fork" | "invalid";
  devices: readonly SavedValuesListedDevice[];
  requests: readonly SavedValuesJoinRequest[];
  records: number;
  releases: readonly SavedValueReleaseLogEntry[];
  lastSyncedAt?: number;
  error?: string;
}>;

export type SavedValuesSyncAction =
  | Readonly<{ action: "answer" | "allow" | "decline"; joinId: string }>
  | Readonly<{ action: "confirm" | "askAgain" | "skip" | "startOver" }>
  | Readonly<{ action: "remove"; deviceId: string }>;

export type SavedValueReleaseRequest = Readonly<{
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
  taskName?: string;
}>;

export type SavedValueReleaseResult =
  | Readonly<{
      found: true;
      sealed: Readonly<Record<string, import("./user-ask.js").UserAskSealedValue>>;
      saved: Readonly<{
        label: string;
        account?: string;
        savedAt: number;
        service?: string;
        askedService?: string;
      }>;
      deviceId: string;
    }>
  | Readonly<{
      found: false;
      savedHere: readonly import("./user-ask.js").SavedSecureValueSummary[];
      reason: "not_saved" | "no_computer" | "sync_off" | "limit";
      message?: string;
    }>;

const fieldKey = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "");

const ACCOUNT_FIELD_KEYS = new Set([
  "username", "user", "userid", "login", "loginid", "email", "emailaddress",
  "usernameoremail", "emailorusername", "account", "accountname",
]);

const pairingKey = (value: string) => {
  const key = fieldKey(value);
  return ACCOUNT_FIELD_KEYS.has(key) ? "account" : key;
};

type MatchableField = Pick<UserAskField, "id" | "label" | "type" | "sensitive">;
type PairableSavedField = Pick<SavedValueField, "id" | "label" | "type" | "sensitive">;

const sameKind = (saved: PairableSavedField, field: MatchableField) =>
  field.type !== "code" &&
  saved.sensitive === field.sensitive &&
  (saved.type === "secret") === (field.type === "secret");

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
