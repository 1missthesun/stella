/**
 * Which devices may hold the user's saved values, decided by the devices
 * themselves, never by the cloud.
 *
 * The devices keep a list: an append-only chain of entries, each naming a
 * device and its two public keys (one to seal values to, one to sign with) and
 * each signed by a device already on the list. The cloud stores the chain and
 * passes it around but can't write a valid entry, so it can't add a device of
 * its own. Every device checks the whole chain itself, remembers the newest
 * entry it has seen (so the chain can't be rolled back or forked under it),
 * and seals values only to devices on it.
 *
 * - The first device founds the list, with itself on it. It also records the
 *   account's computers as they are at that moment, each with the device key
 *   it has had since it was set up, so each of them can join later by itself:
 *   its entry is signed by that same old key. That trusts the cloud once, at
 *   the founding, the way a first sign-in does.
 * - Any other device joins when the user allows it on a device already on the
 *   list. Both devices show the same 6-digit code, made from both devices'
 *   random numbers after each had committed to its own, so the cloud can't
 *   craft a request of its own whose code matches.
 * - A device on the list can take any device off it; values are then never
 *   sealed to that device again.
 *
 * Every record a device seals carries that device's signature, and every
 * deletion too, so the cloud can't plant, change or delete a saved value.
 *
 * The crypto is pure JS (@noble), so the desktop and the phone run the same
 * checks.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { SavedValueDevice } from "./saved-values.js";

export const SAVED_VALUES_TRUST_VERSION = 1 as const;
/** How long a device that asked to join waits for someone to allow it. */
export const SAVED_VALUES_JOIN_TTL_MS = 15 * 60_000;
/** A device on the list that hasn't been seen this long stops being sealed to until it's back. */
export const SAVED_VALUES_QUIET_MS = 14 * 24 * 60 * 60_000;
export const SAVED_VALUES_MAX_ROSTER_ENTRIES = 500;

const ROSTER_CONTEXT = "stella-saved-values-roster\n";
const CARRY_CONTEXT = "stella-saved-values-carry\n";
const RECORD_CONTEXT = "stella-saved-value-record\n";
const DELETE_CONTEXT = "stella-saved-value-delete\n";
const CODE_CONTEXT = "stella-saved-values-code\n";

const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export const toBase64Url = (bytes: Uint8Array): string => {
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]!;
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    out += B64[a >> 2]! + B64[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    if (b !== undefined) out += B64[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    if (c !== undefined) out += B64[c & 63]!;
  }
  return out;
};

export const fromBase64Url = (value: string): Uint8Array => {
  const clean = value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const digit = B64.indexOf(char);
    if (digit < 0) throw new Error("Not base64.");
    buffer = (buffer << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 255);
    }
  }
  return new Uint8Array(out);
};

/** JSON with object keys sorted at every level: the same bytes on every device. */
export const stableJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry === undefined ? null : entry)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
};

export const sha256Hex = (value: string | Uint8Array): string =>
  bytesToHex(sha256(typeof value === "string" ? utf8(value) : value));

// --- Signing keys -----------------------------------------------------------

export type SavedValuesSigningKey = Readonly<{ secretKey: Uint8Array; publicKey: string }>;

/** A device's signing key from its 32 secret bytes (made with the platform's own random source). */
export const signingKeyFromSecret = (secretKey: Uint8Array): SavedValuesSigningKey => ({
  secretKey,
  publicKey: toBase64Url(ed25519.getPublicKey(secretKey)),
});

const signText = (key: SavedValuesSigningKey, text: string): string =>
  toBase64Url(ed25519.sign(utf8(text), key.secretKey));

const verifyText = (publicKey: string, text: string, signature: string): boolean => {
  try {
    return ed25519.verify(fromBase64Url(signature), utf8(text), fromBase64Url(publicKey));
  } catch {
    return false;
  }
};

/**
 * A computer's long-standing device key as the cloud lists it (Ed25519 SPKI,
 * DER, base64), as the raw public key, base64url.
 */
export const identityKeyFromSpki = (spkiBase64: string): string | null => {
  try {
    const der = fromBase64Url(spkiBase64);
    if (der.length !== 44) return null;
    return toBase64Url(der.subarray(12));
  } catch {
    return null;
  }
};

// --- The list ----------------------------------------------------------------

export type SavedValuesDeviceKind = "computer" | "phone";

/** A device on the list: what it's called and its two public keys (raw, base64url). */
export type SavedValuesMember = Readonly<{
  deviceId: string;
  kind: SavedValuesDeviceKind;
  name: string;
  /** Ed25519: what this device signs list entries and records with. */
  signKey: string;
  /** X25519: what values are sealed to. */
  sealKey: string;
}>;

/** A computer recorded at the founding, which may join by itself with its old device key. */
export type SavedValuesCarried = Readonly<{
  deviceId: string;
  /** Its long-standing Ed25519 device key, raw, base64url. */
  identityKey: string;
  name?: string;
}>;

type EntryCommon = {
  v: typeof SAVED_VALUES_TRUST_VERSION;
  seq: number;
  /** The previous entry's hash; empty for the founding entry. */
  prev: string;
  at: number;
  /** The device whose signing key signed this entry. */
  by: string;
};

export type SavedValuesRosterEntryBody =
  | (EntryCommon & { op: "found"; device: SavedValuesMember; carried: readonly SavedValuesCarried[] })
  | (EntryCommon & {
      op: "add";
      device: SavedValuesMember;
      /** For a carried computer joining by itself: its old device key's signature over its new keys. */
      carriedSig?: string;
    })
  | (EntryCommon & { op: "remove"; target: string });

export type SavedValuesRosterEntry = SavedValuesRosterEntryBody & Readonly<{ sig: string }>;

const entryText = (body: SavedValuesRosterEntryBody): string => ROSTER_CONTEXT + stableJson(body);

export const rosterEntryHash = (entry: SavedValuesRosterEntry): string => sha256Hex(stableJson(entry));

/** What a carried computer's old device key signs to vouch for its new keys. */
export const carriedSigText = (args: { genesis: string; device: SavedValuesMember }): string =>
  CARRY_CONTEXT + stableJson({ genesis: args.genesis, device: args.device });

export const signRosterEntry = (
  body: SavedValuesRosterEntryBody,
  key: SavedValuesSigningKey,
): SavedValuesRosterEntry => ({ ...body, sig: signText(key, entryText(body)) });

export type SavedValuesRosterPin = Readonly<{ genesis: string; seq: number; hash: string }>;

export type SavedValuesRosterMember = SavedValuesMember &
  Readonly<{ addedAt: number; addedBy: string }>;

export type SavedValuesRoster = Readonly<{
  members: ReadonlyMap<string, SavedValuesRosterMember>;
  /** Computers from the founding that haven't joined (or been taken off) yet. */
  carried: ReadonlyMap<string, SavedValuesCarried>;
  /** Every device that was ever on the list and was taken off. */
  removed: ReadonlySet<string>;
  head: SavedValuesRosterPin;
}>;

export type SavedValuesRosterCheck =
  | Readonly<{ ok: true; roster: SavedValuesRoster }>
  | Readonly<{
      ok: false;
      /**
       * empty: no list yet. reset: a different list than the one this device
       * knew (started over on another device). rollback/fork: the cloud showed
       * an older or different history than this device has seen. invalid: an
       * entry that doesn't check out.
       */
      reason: "empty" | "reset" | "rollback" | "fork" | "invalid";
      detail?: string;
    }>;

const isMember = (value: unknown): value is SavedValuesMember => {
  const device = value as Partial<SavedValuesMember> | null;
  return (
    !!device &&
    typeof device.deviceId === "string" &&
    device.deviceId.length > 0 &&
    device.deviceId.length <= 256 &&
    (device.kind === "computer" || device.kind === "phone") &&
    typeof device.name === "string" &&
    device.name.length <= 120 &&
    typeof device.signKey === "string" &&
    device.signKey.length === 43 &&
    typeof device.sealKey === "string" &&
    device.sealKey.length === 43
  );
};

/**
 * Checks a list from its founding entry, and against what this device saw
 * last (`pin`). Only a list that passes may be sealed to.
 */
export const checkRoster = (
  entries: readonly SavedValuesRosterEntry[],
  pin?: SavedValuesRosterPin | null,
): SavedValuesRosterCheck => {
  if (entries.length === 0) return pin ? { ok: false, reason: "reset" } : { ok: false, reason: "empty" };
  const sorted = [...entries].sort((left, right) => left.seq - right.seq);
  const invalid = (detail: string): SavedValuesRosterCheck => ({ ok: false, reason: "invalid", detail });
  const members = new Map<string, SavedValuesRosterMember>();
  const carried = new Map<string, SavedValuesCarried>();
  const removed = new Set<string>();
  const seen = new Set<string>();
  let previous = "";
  let genesis = "";
  for (let index = 0; index < sorted.length; index += 1) {
    const entry = sorted[index]!;
    const { sig, ...body } = entry;
    if (entry.v !== SAVED_VALUES_TRUST_VERSION || entry.seq !== index || entry.prev !== previous) {
      return invalid(`entry ${index} is out of order`);
    }
    if (typeof sig !== "string" || typeof entry.by !== "string" || typeof entry.at !== "number") {
      return invalid(`entry ${index} is malformed`);
    }
    const text = entryText(body as SavedValuesRosterEntryBody);
    if (entry.op === "found") {
      if (index !== 0 || !isMember(entry.device) || entry.by !== entry.device.deviceId) {
        return invalid("the founding entry is malformed");
      }
      if (!verifyText(entry.device.signKey, text, sig)) return invalid("the founding entry's signature is wrong");
      members.set(entry.device.deviceId, { ...entry.device, addedAt: entry.at, addedBy: entry.by });
      seen.add(entry.device.deviceId);
      for (const computer of Array.isArray(entry.carried) ? entry.carried : []) {
        if (
          computer &&
          typeof computer.deviceId === "string" &&
          typeof computer.identityKey === "string" &&
          computer.identityKey.length === 43 &&
          computer.deviceId !== entry.device.deviceId
        ) {
          carried.set(computer.deviceId, computer);
        }
      }
    } else if (index === 0) {
      return invalid("the list doesn't start with a founding entry");
    } else if (entry.op === "add") {
      if (!isMember(entry.device)) return invalid(`entry ${index} names no device`);
      const device = entry.device;
      if (typeof entry.carriedSig === "string") {
        // A computer from the founding joining by itself, once.
        const old = carried.get(device.deviceId);
        if (
          !old ||
          seen.has(device.deviceId) ||
          device.kind !== "computer" ||
          entry.by !== device.deviceId ||
          !verifyText(device.signKey, text, sig) ||
          !verifyText(old.identityKey, carriedSigText({ genesis, device }), entry.carriedSig)
        ) {
          return invalid(`entry ${index}: a carried computer's entry doesn't check out`);
        }
        carried.delete(device.deviceId);
      } else {
        const signer = members.get(entry.by);
        if (!signer || !verifyText(signer.signKey, text, sig)) {
          return invalid(`entry ${index} isn't signed by a device on the list`);
        }
      }
      members.set(device.deviceId, { ...device, addedAt: entry.at, addedBy: entry.by });
      removed.delete(device.deviceId);
      seen.add(device.deviceId);
    } else if (entry.op === "remove") {
      const signer = members.get(entry.by);
      if (!signer || !verifyText(signer.signKey, text, sig) || typeof entry.target !== "string") {
        return invalid(`entry ${index} isn't signed by a device on the list`);
      }
      if (members.delete(entry.target)) removed.add(entry.target);
      carried.delete(entry.target);
      seen.add(entry.target);
    } else {
      return invalid(`entry ${index} has an unknown kind`);
    }
    previous = rosterEntryHash(entry);
    if (index === 0) genesis = previous;
  }
  const last = sorted[sorted.length - 1]!;
  const head: SavedValuesRosterPin = { genesis, seq: last.seq, hash: previous };
  if (pin) {
    if (pin.genesis !== genesis) return { ok: false, reason: "reset" };
    if (pin.seq > head.seq) return { ok: false, reason: "rollback" };
    const atPin = sorted[pin.seq];
    if (!atPin || rosterEntryHash(atPin) !== pin.hash) return { ok: false, reason: "fork" };
  }
  return { ok: true, roster: { members, carried, removed, head } };
};

const nextBody = (roster: SavedValuesRoster | null, by: string, at: number) => ({
  v: SAVED_VALUES_TRUST_VERSION,
  seq: roster ? roster.head.seq + 1 : 0,
  prev: roster ? roster.head.hash : "",
  at,
  by,
});

export const foundRoster = (args: {
  self: SavedValuesMember;
  carried: readonly SavedValuesCarried[];
  key: SavedValuesSigningKey;
  at: number;
}): SavedValuesRosterEntry =>
  signRosterEntry(
    {
      ...nextBody(null, args.self.deviceId, args.at),
      op: "found",
      device: args.self,
      carried: args.carried.filter((computer) => computer.deviceId !== args.self.deviceId),
    },
    args.key,
  );

export const addToRoster = (args: {
  roster: SavedValuesRoster;
  device: SavedValuesMember;
  by: string;
  key: SavedValuesSigningKey;
  at: number;
  carriedSig?: string;
}): SavedValuesRosterEntry =>
  signRosterEntry(
    {
      ...nextBody(args.roster, args.by, args.at),
      op: "add",
      device: args.device,
      ...(args.carriedSig ? { carriedSig: args.carriedSig } : {}),
    },
    args.key,
  );

export const removeFromRoster = (args: {
  roster: SavedValuesRoster;
  target: string;
  by: string;
  key: SavedValuesSigningKey;
  at: number;
}): SavedValuesRosterEntry =>
  signRosterEntry({ ...nextBody(args.roster, args.by, args.at), op: "remove", target: args.target }, args.key);

/** Whether `device` is on the list with exactly these keys. */
export const onRoster = (roster: SavedValuesRoster, device: SavedValuesMember): boolean => {
  const member = roster.members.get(device.deviceId);
  return !!member && member.signKey === device.signKey && member.sealKey === device.sealKey;
};

/**
 * Who a record is sealed to now: this device, and every other device on the
 * list that checked in recently with the same seal key the list has for it.
 * A device that went quiet gets its values again when it's back.
 */
export const savedValueRecipients = (args: {
  roster: SavedValuesRoster;
  devices: readonly SavedValueDevice[];
  selfId: string;
  now: number;
}): SavedValuesRosterMember[] => {
  const seen = new Map(args.devices.map((device) => [device.deviceId, device]));
  return [...args.roster.members.values()]
    .filter((member) => {
      if (member.deviceId === args.selfId) return true;
      const card = seen.get(member.deviceId);
      return !!card && card.publicKey === member.sealKey && args.now - card.updatedAt < SAVED_VALUES_QUIET_MS;
    })
    .sort((left, right) => left.deviceId.localeCompare(right.deviceId));
};

// --- Joining ----------------------------------------------------------------

/**
 * A device asking to join. The cloud relays it; the devices check it.
 *
 * 1. The new device posts its keys and a commitment to a random number.
 * 2. A device on the list (any, automatically) adds its own random number.
 * 3. The new device reveals its number.
 * 4. Both screens show the code made from the request and both numbers. The
 *    user allows it on a device on the list, which adds it, signed.
 *
 * The cloud would have to fix its own request before seeing the listed
 * device's number and pick the number it shows the new device before seeing
 * the new device's, so a request of its own matches the code on the new
 * device's screen only by chance (1 in a million).
 */
export type SavedValuesJoin = Readonly<{
  joinId: string;
  device: SavedValuesMember;
  /** sha256 hex of the new device's random number. */
  commit: string;
  createdAt: number;
  expiresAt: number;
  /** The listed device that added its number, and the number (base64url). */
  answeredBy?: string;
  listedNonce?: string;
  /** The new device's number, revealed after the listed device's. */
  joinerNonce?: string;
  state: "open" | "allowed" | "declined";
  decidedBy?: string;
}>;

export const joinCommit = (joinerNonce: string): string => sha256Hex(CODE_CONTEXT + joinerNonce);

/** The 6-digit code both screens show, or null while it can't be made (or doesn't check out). */
export const joinCode = (join: Pick<SavedValuesJoin, "joinId" | "device" | "commit" | "listedNonce" | "joinerNonce">): string | null => {
  if (!join.listedNonce || !join.joinerNonce || joinCommit(join.joinerNonce) !== join.commit) return null;
  const digest = sha256(
    utf8(
      CODE_CONTEXT +
        stableJson({
          joinId: join.joinId,
          device: join.device,
          listedNonce: join.listedNonce,
          joinerNonce: join.joinerNonce,
        }),
    ),
  );
  const number = ((digest[0]! << 24) >>> 0) + (digest[1]! << 16) + (digest[2]! << 8) + digest[3]!;
  return String(number % 1_000_000).padStart(6, "0");
};

/** "482913" as "482 913". */
export const formatJoinCode = (code: string): string => `${code.slice(0, 3)} ${code.slice(3)}`;

// --- Records ----------------------------------------------------------------

/** What is sealed: the record, and the signature of the device that sealed it. */
export type SavedValueEnvelope = Readonly<{
  v: 2;
  by: string;
  sig: string;
  /** The record (SavedValuePayload) as JSON text: what was signed. */
  payload: string;
}>;

export const signedEnvelope = (args: { payload: string; by: string; key: SavedValuesSigningKey }): string =>
  JSON.stringify({ v: 2, by: args.by, sig: signText(args.key, RECORD_CONTEXT + args.payload), payload: args.payload });

/** The record inside an envelope, if a device on the list sealed it. */
export const openEnvelope = (text: string, roster: SavedValuesRoster): string | null => {
  try {
    const envelope = JSON.parse(text) as Partial<SavedValueEnvelope>;
    if (envelope?.v !== 2 || typeof envelope.by !== "string" || typeof envelope.sig !== "string" || typeof envelope.payload !== "string") {
      return null;
    }
    const signer = roster.members.get(envelope.by);
    if (!signer || !verifyText(signer.signKey, RECORD_CONTEXT + envelope.payload, envelope.sig)) return null;
    return envelope.payload;
  } catch {
    return null;
  }
};

const deleteText = (args: { id: string; updatedAt: number }) =>
  DELETE_CONTEXT + stableJson({ id: args.id, updatedAt: args.updatedAt });

export const signDeletion = (args: { id: string; updatedAt: number; key: SavedValuesSigningKey }): string =>
  signText(args.key, deleteText(args));

export const deletionValid = (args: {
  id: string;
  updatedAt: number;
  by: string;
  sig: string | undefined;
  roster: SavedValuesRoster;
}): boolean => {
  const signer = args.roster.members.get(args.by);
  return !!signer && !!args.sig && verifyText(signer.signKey, deleteText(args), args.sig);
};
