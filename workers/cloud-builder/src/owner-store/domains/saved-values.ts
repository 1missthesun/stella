import type { SavedValueCalls, SavedValuesState } from "@stella/contracts/backend/saved-values";
import {
  SAVED_VALUES_MAX_DEVICES,
  SAVED_VALUES_MAX_RECORDS,
  SAVED_VALUE_DEVICE_KINDS,
  SAVED_VALUE_MAX_PAYLOAD_BYTES,
  SAVED_VALUE_SEAL_ALGORITHM,
  type SavedValueDevice,
  type SavedValueHead,
  type SavedValueRecord,
  type SavedValueReleaseRequest,
  type SavedValueReleaseResult,
  type SavedValueSeal,
} from "@stella/contracts/saved-values";
import { array, json, literal, number, object, optional, string } from "../args.js";
import { RpcError } from "../errors.js";
import { enforceOwnerRateLimit } from "../rate-limit.js";
import type { OwnerContext, OwnerDbReader, OwnerDomain } from "../registry.js";

/**
 * Saved private values synced across the owner's devices. The cloud keeps
 * each device's public key and every record sealed to each device; it holds
 * no key that opens one. A cloud task gets a value only from a computer that
 * releases it (`savedValues.release`), sealed to that task's own key.
 */

export const SAVED_VALUES_MIGRATION = {
  id: "saved-values.1-init",
  statements: [
    `CREATE TABLE saved_value_devices (
       device_id TEXT PRIMARY KEY,
       kind TEXT NOT NULL,
       public_key TEXT NOT NULL,
       name TEXT,
       updated_at INTEGER NOT NULL
     )`,
    `CREATE TABLE saved_value_records (
       id TEXT PRIMARY KEY,
       updated_at INTEGER NOT NULL,
       updated_by TEXT NOT NULL,
       deleted INTEGER NOT NULL DEFAULT 0,
       recipients TEXT NOT NULL,
       sealed TEXT
     )`,
  ],
};

const ID = string({ min: 1, max: 128 });
const BASE64URL = /^[A-Za-z0-9_-]+$/;
/** A seal is the payload's size, base64url-encoded, plus the GCM tag and its fields. */
const MAX_SEAL_CHARS = Math.ceil((SAVED_VALUE_MAX_PAYLOAD_BYTES + 64) * 4 / 3) + 256;
const RELEASE_TIMEOUT_NOTE = "No computer answered in time.";

type DeviceRow = {
  device_id: string;
  kind: string;
  public_key: string;
  name: string | null;
  updated_at: number;
};

type RecordRow = {
  id: string;
  updated_at: number;
  updated_by: string;
  deleted: number;
  recipients: string;
  sealed: string | null;
};

const deviceOf = (row: DeviceRow): SavedValueDevice => ({
  deviceId: row.device_id,
  kind: row.kind as SavedValueDevice["kind"],
  publicKey: row.public_key,
  ...(row.name ? { name: row.name } : {}),
  updatedAt: row.updated_at,
});

const recipientsOf = (text: string): string[] => {
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
};

const headOf = (row: RecordRow): SavedValueHead => ({
  id: row.id,
  updatedAt: row.updated_at,
  updatedBy: row.updated_by,
  ...(row.deleted ? { deleted: true as const } : {}),
  recipients: recipientsOf(row.recipients),
});

const readState = (db: OwnerDbReader): SavedValuesState => ({
  devices: db
    .all<DeviceRow>("SELECT * FROM saved_value_devices ORDER BY device_id")
    .map(deviceOf),
  records: db
    .all<RecordRow>(
      "SELECT id, updated_at, updated_by, deleted, recipients, NULL AS sealed FROM saved_value_records ORDER BY id",
    )
    .map(headOf),
});

const isSeal = (value: unknown): value is SavedValueSeal => {
  if (!value || typeof value !== "object") return false;
  const seal = value as Record<string, unknown>;
  return (
    seal.algorithm === SAVED_VALUE_SEAL_ALGORITHM &&
    typeof seal.clientPublicKey === "string" &&
    BASE64URL.test(seal.clientPublicKey) &&
    seal.clientPublicKey.length <= 64 &&
    typeof seal.iv === "string" &&
    BASE64URL.test(seal.iv) &&
    seal.iv.length <= 32 &&
    typeof seal.ciphertext === "string" &&
    BASE64URL.test(seal.ciphertext) &&
    seal.ciphertext.length <= MAX_SEAL_CHARS &&
    Object.keys(seal).length === 4
  );
};

const parseSealed = (value: unknown): Record<string, SavedValueSeal> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RpcError("BAD_REQUEST", "sealed must map recipient ids to seals.");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0 || entries.length > SAVED_VALUES_MAX_DEVICES) {
    throw new RpcError("BAD_REQUEST", `sealed needs between 1 and ${SAVED_VALUES_MAX_DEVICES} recipients.`);
  }
  for (const [recipient, seal] of entries) {
    if (!recipient || recipient.length > 128 || !isSeal(seal)) {
      throw new RpcError("BAD_REQUEST", "sealed holds a malformed seal.");
    }
  }
  return value as Record<string, SavedValueSeal>;
};

const putDevice = (
  ctx: OwnerContext,
  args: SavedValueCalls["savedValues.putDevice"]["args"],
): SavedValueDevice => {
  enforceOwnerRateLimit(ctx.db, ctx.now, "savedValues.putDevice", { count: 30, windowMs: 60 * 60_000 },
    "Too many device key changes. Please wait a moment.");
  if (!BASE64URL.test(args.publicKey) || args.publicKey.length !== 43) {
    throw new RpcError("BAD_REQUEST", "publicKey must be a raw X25519 key, base64url.");
  }
  const existing = ctx.db.one<{ n: number }>("SELECT COUNT(*) AS n FROM saved_value_devices WHERE device_id != ?", args.deviceId);
  if ((existing?.n ?? 0) >= SAVED_VALUES_MAX_DEVICES) {
    // The device seen longest ago makes room; it gets values again when it comes back.
    ctx.db.run(
      "DELETE FROM saved_value_devices WHERE device_id = (SELECT device_id FROM saved_value_devices ORDER BY updated_at LIMIT 1)",
    );
  }
  ctx.db.run(
    `INSERT INTO saved_value_devices (device_id, kind, public_key, name, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (device_id) DO UPDATE SET kind = excluded.kind, public_key = excluded.public_key,
       name = excluded.name, updated_at = excluded.updated_at`,
    args.deviceId,
    args.kind,
    args.publicKey,
    args.name?.slice(0, 120) ?? null,
    ctx.now,
  );
  return deviceOf(ctx.db.one<DeviceRow>("SELECT * FROM saved_value_devices WHERE device_id = ?", args.deviceId)!);
};

const putRecord = (
  ctx: OwnerContext,
  args: SavedValueCalls["savedValues.put"]["args"],
): SavedValueCalls["savedValues.put"]["result"] => {
  enforceOwnerRateLimit(ctx.db, ctx.now, "savedValues.put", { count: 600, windowMs: 60 * 60_000 },
    "Too many saved value changes. Please wait a moment.");
  const sealed = args.deleted ? null : parseSealed(args.sealed);
  const recipients = sealed ? Object.keys(sealed).sort() : [];
  const current = ctx.db.one<RecordRow>("SELECT * FROM saved_value_records WHERE id = ?", args.id);
  if (current) {
    const held = headOf(current);
    const newer = args.updatedAt > current.updated_at;
    // The same version sealed to more devices (one that joined) replaces it too.
    const widened =
      args.updatedAt === current.updated_at &&
      !current.deleted &&
      !args.deleted &&
      held.recipients.every((id) => recipients.includes(id)) &&
      recipients.length > held.recipients.length;
    if (!newer && !widened) return { accepted: false, head: held };
  } else {
    const count = ctx.db.one<{ n: number }>("SELECT COUNT(*) AS n FROM saved_value_records");
    if ((count?.n ?? 0) >= SAVED_VALUES_MAX_RECORDS) {
      throw new RpcError("CONFLICT", `At most ${SAVED_VALUES_MAX_RECORDS} saved values sync.`, { retryable: false });
    }
  }
  ctx.db.run(
    `INSERT INTO saved_value_records (id, updated_at, updated_by, deleted, recipients, sealed) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET updated_at = excluded.updated_at, updated_by = excluded.updated_by,
       deleted = excluded.deleted, recipients = excluded.recipients, sealed = excluded.sealed`,
    args.id,
    args.updatedAt,
    args.updatedBy,
    args.deleted ? 1 : 0,
    JSON.stringify(recipients),
    sealed ? JSON.stringify(sealed) : null,
  );
  return { accepted: true, head: headOf(ctx.db.one<RecordRow>("SELECT * FROM saved_value_records WHERE id = ?", args.id)!) };
};

const getRecords = (ctx: OwnerContext, ids: readonly string[]): SavedValueRecord[] =>
  ids.flatMap((id) => {
    const row = ctx.db.one<RecordRow>("SELECT * FROM saved_value_records WHERE id = ?", id);
    if (!row) return [];
    let sealed: Record<string, SavedValueSeal> | undefined;
    try {
      sealed = row.sealed ? (JSON.parse(row.sealed) as Record<string, SavedValueSeal>) : undefined;
    } catch {
      sealed = undefined;
    }
    return [{ ...headOf(row), ...(sealed ? { sealed } : {}) }];
  });

const releaseParser = object({
  releaseId: string({ min: 1, max: 128 }),
  service: string({ min: 1, max: 240 }),
  account: optional(string({ max: 240 })),
  purpose: string({ min: 1, max: 2_000 }),
  fields: json({ maxBytes: 16 * 1024 }),
  recipientKey: json({ maxBytes: 1024 }),
  conversationId: optional(string({ max: 512 })),
  threadId: optional(string({ max: 512 })),
});

/**
 * A cloud task's request for a saved value: ask the owner's online computers
 * that hold saved values, the main one first, until one answers. The answer
 * is sealed to the task's key; nothing here can open it.
 */
const release = async (ctx: OwnerContext, raw: unknown): Promise<SavedValueReleaseResult> => {
  const request = releaseParser(raw, "args") as unknown as SavedValueReleaseRequest;
  const holders = new Set(
    ctx.db
      .all<{ device_id: string }>("SELECT device_id FROM saved_value_devices WHERE kind = 'computer'")
      .map((row) => row.device_id),
  );
  const computers = (await ctx.host.deviceDestinations())
    .filter((device) => device.online && holders.has(device.deviceId))
    .sort((left, right) => Number(right.brainHome === true) - Number(left.brainHome === true) ||
      (right.lastSeenAt ?? 0) - (left.lastSeenAt ?? 0));
  if (computers.length === 0) {
    return { found: false, savedHere: [], reason: holders.size === 0 ? "sync_off" : "no_computer" };
  }
  let missed: SavedValueReleaseResult | null = null;
  for (const computer of computers) {
    const answer = await ctx.host.relayDeviceRequest({
      deviceId: computer.deviceId,
      method: "savedValues.release",
      params: request as unknown as Record<string, unknown>,
    });
    if (!answer.ok) continue;
    const value = answer.value as SavedValueReleaseResult | null;
    if (value && value.found === true) return { ...value, deviceId: computer.deviceId };
    if (value && value.found === false) missed ??= value;
  }
  return missed ?? { found: false, savedHere: [], reason: "no_computer" };
};

export const savedValuesDomain = {
  name: "savedValues",
  migrations: [SAVED_VALUES_MIGRATION],
  views: {
    "savedValues.state": {
      parse: object({}),
      read: (ctx) => readState(ctx.db),
    },
  },
  calls: {
    "savedValues.putDevice": {
      scope: "owner",
      parse: object({
        deviceId: ID,
        kind: literal(...SAVED_VALUE_DEVICE_KINDS),
        publicKey: string({ min: 1, max: 64 }),
        name: optional(string({ max: 240 })),
      }),
      handler: putDevice,
    },
    "savedValues.removeDevice": {
      scope: "owner",
      parse: object({ deviceId: ID }),
      handler: (ctx, args) => {
        const held = ctx.db.one("SELECT device_id FROM saved_value_devices WHERE device_id = ?", args.deviceId);
        ctx.db.run("DELETE FROM saved_value_devices WHERE device_id = ?", args.deviceId);
        return { removed: held !== null };
      },
    },
    "savedValues.get": {
      scope: "owner",
      parse: object({ ids: array(ID, { max: 100 }) }),
      handler: (ctx, args) => ({ records: getRecords(ctx, args.ids) }),
    },
    "savedValues.put": {
      scope: "owner",
      maxBodyBytes: (MAX_SEAL_CHARS + 512) * SAVED_VALUES_MAX_DEVICES + 4096,
      parse: object({
        id: ID,
        updatedAt: number({ int: true, min: 1 }),
        updatedBy: ID,
        deleted: optional(literal(true)),
        sealed: optional(json({ maxBytes: (MAX_SEAL_CHARS + 512) * SAVED_VALUES_MAX_DEVICES })),
      }) as never,
      handler: putRecord,
    },
  },
  internal: {
    "savedValues.release": (ctx, args) =>
      Promise.race([
        release(ctx, args),
        new Promise<SavedValueReleaseResult>((resolve) =>
          setTimeout(() => resolve({ found: false, savedHere: [], reason: "no_computer" }), 45_000),
        ),
      ]).catch((error) => {
        throw new RpcError("UNAVAILABLE", error instanceof Error ? error.message : RELEASE_TIMEOUT_NOTE, { retryable: true });
      }),
  },
  purge: (ctx) => {
    ctx.db.run("DELETE FROM saved_value_records");
    ctx.db.run("DELETE FROM saved_value_devices");
    return { pending: false };
  },
} satisfies OwnerDomain;
