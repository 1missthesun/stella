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
import {
  SAVED_VALUES_JOIN_TTL_MS,
  SAVED_VALUES_MAX_ROSTER_ENTRIES,
  checkRoster,
  deletionValid,
  joinCommit,
  type SavedValuesJoin,
  type SavedValuesMember,
  type SavedValuesRosterEntry,
} from "@stella/contracts/saved-values-trust";
import { Effect } from "effect";
import { array, json, literal, number, object, optional, string } from "../args.js";
import { RpcError } from "../errors.js";
import { enforceOwnerRateLimit } from "../rate-limit.js";
import type { OwnerContext, OwnerDbReader, OwnerDomain } from "../registry.js";

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
       sealed TEXT,
       delete_sig TEXT
     )`,
    `CREATE TABLE saved_value_roster (
       seq INTEGER PRIMARY KEY,
       entry TEXT NOT NULL
     )`,
    `CREATE TABLE saved_value_joins (
       join_id TEXT PRIMARY KEY,
       data TEXT NOT NULL,
       expires_at INTEGER NOT NULL
     )`,
  ],
};

const ID = string({ min: 1, max: 128 });
const BASE64URL = /^[A-Za-z0-9_-]+$/;
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
  delete_sig: string | null;
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
  ...(row.deleted && row.delete_sig ? { deleteSig: row.delete_sig } : {}),
  recipients: recipientsOf(row.recipients),
});

const readRoster = (db: OwnerDbReader): SavedValuesRosterEntry[] =>
  db
    .all<{ seq: number; entry: string }>("SELECT seq, entry FROM saved_value_roster ORDER BY seq")
    .flatMap((row) => {
      try {
        return [JSON.parse(row.entry) as SavedValuesRosterEntry];
      } catch {
        return [];
      }
    });

const DECIDED_JOIN_VISIBLE_MS = 5 * 60_000;
const MAX_OPEN_JOINS = 8;

const readJoins = (db: OwnerDbReader, now: number): SavedValuesJoin[] =>
  db
    .all<{ data: string; expires_at: number }>("SELECT data, expires_at FROM saved_value_joins ORDER BY join_id")
    .flatMap((row) => {
      try {
        const join = JSON.parse(row.data) as SavedValuesJoin;
        return row.expires_at > now ? [join] : [];
      } catch {
        return [];
      }
    });

const readState = (db: OwnerDbReader, now: number): SavedValuesState => ({
  roster: readRoster(db),
  joins: readJoins(db, now),
  devices: db
    .all<DeviceRow>("SELECT * FROM saved_value_devices ORDER BY device_id")
    .map(deviceOf),
  records: db
    .all<RecordRow>(
      "SELECT id, updated_at, updated_by, deleted, recipients, NULL AS sealed, delete_sig FROM saved_value_records ORDER BY id",
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

const dropSealsFor = (ctx: OwnerContext, deviceId: string) => {
  const rows = ctx.db.all<RecordRow>(
    "SELECT * FROM saved_value_records WHERE deleted = 0 AND recipients LIKE ?",
    `%${JSON.stringify(deviceId)}%`,
  );
  for (const row of rows) {
    const recipients = (JSON.parse(row.recipients) as string[]).filter((id) => id !== deviceId);
    let sealed: Record<string, SavedValueSeal> = {};
    try {
      sealed = row.sealed ? (JSON.parse(row.sealed) as Record<string, SavedValueSeal>) : {};
    } catch {
      sealed = {};
    }
    delete sealed[deviceId];
    ctx.db.run(
      "UPDATE saved_value_records SET recipients = ?, sealed = ? WHERE id = ?",
      JSON.stringify(recipients),
      JSON.stringify(sealed),
      row.id,
    );
  }
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
  const known = ctx.db.one<{ public_key: string }>(
    "SELECT public_key FROM saved_value_devices WHERE device_id = ?",
    args.deviceId,
  );
  if (known && known.public_key !== args.publicKey) dropSealsFor(ctx, args.deviceId);
  const existing = ctx.db.one<{ n: number }>("SELECT COUNT(*) AS n FROM saved_value_devices WHERE device_id != ?", args.deviceId);
  if ((existing?.n ?? 0) >= SAVED_VALUES_MAX_DEVICES) {
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
  if (args.deleted) {
    const listed = checkRoster(readRoster(ctx.db));
    if (
      !listed.ok ||
      !deletionValid({ id: args.id, updatedAt: args.updatedAt, by: args.updatedBy, sig: args.deleteSig, roster: listed.roster })
    ) {
      throw new RpcError("FORBIDDEN", "A deletion must be signed by a device on the list.");
    }
  }
  const sealed = args.deleted ? null : parseSealed(args.sealed);
  const recipients = sealed ? Object.keys(sealed).sort() : [];
  const current = ctx.db.one<RecordRow>("SELECT * FROM saved_value_records WHERE id = ?", args.id);
  if (current) {
    const held = headOf(current);
    const newer = args.updatedAt > current.updated_at;
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
    `INSERT INTO saved_value_records (id, updated_at, updated_by, deleted, recipients, sealed, delete_sig) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET updated_at = excluded.updated_at, updated_by = excluded.updated_by,
       deleted = excluded.deleted, recipients = excluded.recipients, sealed = excluded.sealed,
       delete_sig = excluded.delete_sig`,
    args.id,
    args.updatedAt,
    args.updatedBy,
    args.deleted ? 1 : 0,
    JSON.stringify(recipients),
    sealed ? JSON.stringify(sealed) : null,
    args.deleted ? args.deleteSig ?? null : null,
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

const parseEntry = (value: unknown): SavedValuesRosterEntry => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RpcError("BAD_REQUEST", "entry must be a list entry.");
  }
  return value as SavedValuesRosterEntry;
};

const writeEntry = (ctx: OwnerContext, entry: SavedValuesRosterEntry) => {
  ctx.db.run("INSERT INTO saved_value_roster (seq, entry) VALUES (?, ?)", entry.seq, JSON.stringify(entry));
};

const afterEntry = (ctx: OwnerContext, entry: SavedValuesRosterEntry) => {
  if (entry.op === "remove") {
    dropSealsFor(ctx, entry.target);
    ctx.db.run("DELETE FROM saved_value_devices WHERE device_id = ?", entry.target);
  } else if (entry.op === "add") {
    const card = ctx.db.one<{ public_key: string }>(
      "SELECT public_key FROM saved_value_devices WHERE device_id = ?",
      entry.device.deviceId,
    );
    if (card && card.public_key !== entry.device.sealKey) dropSealsFor(ctx, entry.device.deviceId);
  }
};

const rosterAppend = (ctx: OwnerContext, raw: unknown): { seq: number } => {
  enforceOwnerRateLimit(ctx.db, ctx.now, "savedValues.roster", { count: 60, windowMs: 60 * 60_000 },
    "Too many changes to your devices. Please wait a moment.");
  const entry = parseEntry(raw);
  const entries = readRoster(ctx.db);
  if (entries.length >= SAVED_VALUES_MAX_ROSTER_ENTRIES) {
    throw new RpcError("CONFLICT", "Your devices' list is full.", { retryable: false });
  }
  if (entry.seq !== entries.length) {
    throw new RpcError("CONFLICT", "The list changed; read it again.", { retryable: true });
  }
  const checked = checkRoster([...entries, entry]);
  if (!checked.ok) {
    throw new RpcError("BAD_REQUEST", `That entry doesn't fit the list (${checked.detail ?? checked.reason}).`);
  }
  writeEntry(ctx, entry);
  afterEntry(ctx, entry);
  return { seq: entry.seq };
};

const rosterReset = (ctx: OwnerContext, raw: unknown): { seq: number } => {
  enforceOwnerRateLimit(ctx.db, ctx.now, "savedValues.rosterReset", { count: 5, windowMs: 24 * 60 * 60_000 },
    "Your devices' list was started over too often today.");
  const entry = parseEntry(raw);
  if (entry.op !== "found" || !checkRoster([entry]).ok) {
    throw new RpcError("BAD_REQUEST", "A new list starts with one device, signed by itself.");
  }
  ctx.db.run("DELETE FROM saved_value_roster");
  ctx.db.run("DELETE FROM saved_value_joins");
  writeEntry(ctx, entry);
  return { seq: 0 };
};

const loadJoin = (ctx: OwnerContext, joinId: string): SavedValuesJoin => {
  const row = ctx.db.one<{ data: string; expires_at: number }>(
    "SELECT data, expires_at FROM saved_value_joins WHERE join_id = ?",
    joinId,
  );
  if (!row || row.expires_at <= ctx.now) throw new RpcError("NOT_FOUND", "That request to join has ended.");
  return JSON.parse(row.data) as SavedValuesJoin;
};

const saveJoin = (ctx: OwnerContext, join: SavedValuesJoin, expiresAt = join.expiresAt) => {
  ctx.db.run(
    `INSERT INTO saved_value_joins (join_id, data, expires_at) VALUES (?, ?, ?)
     ON CONFLICT (join_id) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`,
    join.joinId,
    JSON.stringify(join),
    expiresAt,
  );
  return join;
};

const NONCE = /^[A-Za-z0-9_-]{43}$/;

const joinStart = (
  ctx: OwnerContext,
  args: { joinId: string; device: unknown; commit: string },
): SavedValuesJoin => {
  enforceOwnerRateLimit(ctx.db, ctx.now, "savedValues.join", { count: 30, windowMs: 60 * 60_000 },
    "Too many requests to add a device. Please wait a moment.");
  ctx.db.run("DELETE FROM saved_value_joins WHERE expires_at <= ?", ctx.now);
  const device = args.device as SavedValuesMember;
  if (
    !device ||
    typeof device.deviceId !== "string" ||
    (device.kind !== "computer" && device.kind !== "phone") ||
    typeof device.name !== "string" ||
    !BASE64URL.test(device.signKey ?? "") ||
    !BASE64URL.test(device.sealKey ?? "") ||
    !/^[0-9a-f]{64}$/.test(args.commit)
  ) {
    throw new RpcError("BAD_REQUEST", "A request to join needs the device's keys and a commitment.");
  }
  for (const join of readJoins(ctx.db, ctx.now)) {
    if (join.device.deviceId === device.deviceId) {
      ctx.db.run("DELETE FROM saved_value_joins WHERE join_id = ?", join.joinId);
    }
  }
  const open = readJoins(ctx.db, ctx.now).filter((join) => join.state === "open");
  if (open.length >= MAX_OPEN_JOINS) {
    throw new RpcError("RATE_LIMITED", "Too many devices are waiting to be added.");
  }
  return saveJoin(ctx, {
    joinId: args.joinId,
    device: {
      deviceId: device.deviceId,
      kind: device.kind,
      name: device.name.slice(0, 120),
      signKey: device.signKey,
      sealKey: device.sealKey,
    },
    commit: args.commit,
    createdAt: ctx.now,
    expiresAt: ctx.now + SAVED_VALUES_JOIN_TTL_MS,
    state: "open",
  });
};

const listedDevice = (ctx: OwnerContext, deviceId: string) => {
  const checked = checkRoster(readRoster(ctx.db));
  const member = checked.ok ? checked.roster.members.get(deviceId) : undefined;
  if (!member) throw new RpcError("FORBIDDEN", "Only a device on the list can do that.");
  return member;
};

const joinAnswer = (
  ctx: OwnerContext,
  args: { joinId: string; by: string; listedNonce: string; pin: { genesis: string; seq: number; hash: string } },
): SavedValuesJoin => {
  const join = loadJoin(ctx, args.joinId);
  const member = listedDevice(ctx, args.by);
  if (!NONCE.test(args.listedNonce)) throw new RpcError("BAD_REQUEST", "listedNonce must be 32 random bytes.");
  if (join.state !== "open" || join.listedNonce) return join;
  return saveJoin(ctx, {
    ...join,
    expiresAt: ctx.now + SAVED_VALUES_JOIN_TTL_MS,
    answeredBy: args.by,
    answeredByName: member.name,
    listedNonce: args.listedNonce,
    pin: { genesis: args.pin.genesis, seq: args.pin.seq, hash: args.pin.hash },
  });
};

const joinReveal = (ctx: OwnerContext, args: { joinId: string; joinerNonce: string }): SavedValuesJoin => {
  const join = loadJoin(ctx, args.joinId);
  if (!join.listedNonce) throw new RpcError("CONFLICT", "No device on the list has answered yet.", { retryable: true });
  if (join.joinerNonce) return join;
  if (!NONCE.test(args.joinerNonce) || joinCommit(args.joinerNonce) !== join.commit) {
    throw new RpcError("BAD_REQUEST", "That number doesn't match the request.");
  }
  return saveJoin(ctx, { ...join, joinerNonce: args.joinerNonce });
};

const joinDecide = (
  ctx: OwnerContext,
  args: { joinId: string; by: string; state: "allowed" | "declined" },
): SavedValuesJoin => {
  const join = loadJoin(ctx, args.joinId);
  listedDevice(ctx, args.by);
  if (join.state !== "open" || (join.answeredBy && join.answeredBy !== args.by)) return join;
  return saveJoin(ctx, { ...join, state: args.state, decidedBy: args.by }, ctx.now + DECIDED_JOIN_VISIBLE_MS);
};

const releaseParser = object({
  releaseId: string({ min: 1, max: 128 }),
  service: string({ min: 1, max: 240 }),
  account: optional(string({ max: 240 })),
  purpose: string({ min: 1, max: 2_000 }),
  fields: json({ maxBytes: 16 * 1024 }),
  recipientKey: json({ maxBytes: 1024 }),
  conversationId: optional(string({ max: 512 })),
  threadId: optional(string({ max: 512 })),
  taskName: optional(string({ max: 240 })),
});

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
      read: (ctx) => readState(ctx.db, ctx.now),
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
        deleteSig: optional(string({ max: 128 })),
        sealed: optional(json({ maxBytes: (MAX_SEAL_CHARS + 512) * SAVED_VALUES_MAX_DEVICES })),
      }) as never,
      handler: putRecord,
    },
    "savedValues.rosterAppend": {
      scope: "owner",
      maxBodyBytes: 16 * 1024,
      parse: object({ entry: json({ maxBytes: 12 * 1024 }) }) as never,
      handler: (ctx, args: { entry: unknown }) => rosterAppend(ctx, args.entry),
    },
    "savedValues.rosterReset": {
      scope: "owner",
      maxBodyBytes: 16 * 1024,
      parse: object({ entry: json({ maxBytes: 12 * 1024 }) }) as never,
      handler: (ctx, args: { entry: unknown }) => rosterReset(ctx, args.entry),
    },
    "savedValues.joinStart": {
      scope: "owner",
      parse: object({ joinId: ID, device: json({ maxBytes: 2048 }), commit: string({ min: 64, max: 64 }) }) as never,
      handler: joinStart as never,
    },
    "savedValues.joinAnswer": {
      scope: "owner",
      parse: object({
        joinId: ID,
        by: ID,
        listedNonce: string({ min: 1, max: 64 }),
        pin: object({
          genesis: string({ min: 64, max: 64 }),
          seq: number({ int: true, min: 0 }),
          hash: string({ min: 64, max: 64 }),
        }),
      }),
      handler: joinAnswer,
    },
    "savedValues.joinReveal": {
      scope: "owner",
      parse: object({ joinId: ID, joinerNonce: string({ min: 1, max: 64 }) }),
      handler: joinReveal,
    },
    "savedValues.joinDecide": {
      scope: "owner",
      parse: object({ joinId: ID, by: ID, state: literal("allowed", "declined") }),
      handler: joinDecide,
    },
    "savedValues.joinCancel": {
      scope: "owner",
      parse: object({ joinId: ID }),
      handler: (ctx, args) => {
        const held = ctx.db.one("SELECT join_id FROM saved_value_joins WHERE join_id = ?", args.joinId);
        ctx.db.run("DELETE FROM saved_value_joins WHERE join_id = ?", args.joinId);
        return { canceled: held !== null };
      },
    },
  },
  internal: {
    "savedValues.release": (ctx, args) =>
      Effect.runPromise(
        Effect.tryPromise({ try: () => release(ctx, args), catch: (error) => error }).pipe(
          Effect.timeoutOrElse({
            duration: 45_000,
            orElse: () => Effect.succeed<SavedValueReleaseResult>({ found: false, savedHere: [], reason: "no_computer" }),
          }),
        ),
      ).catch((error) => {
        throw new RpcError("UNAVAILABLE", error instanceof Error ? error.message : RELEASE_TIMEOUT_NOTE, { retryable: true });
      }),
  },
  purge: (ctx) => {
    ctx.db.run("DELETE FROM saved_value_records");
    ctx.db.run("DELETE FROM saved_value_devices");
    ctx.db.run("DELETE FROM saved_value_roster");
    ctx.db.run("DELETE FROM saved_value_joins");
    return { pending: false };
  },
} satisfies OwnerDomain;
