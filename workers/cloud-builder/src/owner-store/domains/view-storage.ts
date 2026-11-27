// Stella Views' saved storage, per owner: one row per (view, key), so every device showing a view
// reads and writes the same values. A write applies whole, in server order: each gets the view's
// next `seq`, every key it touches is stamped with it, and the last write to a key wins. Removals
// stay as tombstones (value NULL), so a device seeding its pre-sync values can't bring a removed key
// back. Devices watch `viewStorage.get`; the store pushes a new value to every open device when a
// write lands (owner-store/store.ts), which is how a change on one reaches the others.
import {
  VIEW_STORAGE_LIMITS,
  type ViewStorageState,
  type ViewStorageWrite,
} from "@stella/contracts/backend/view-storage";
import { array, boolean, json, object, optional, string } from "../args.js";
import { RpcError } from "../errors.js";
import { enforceOwnerRateLimit } from "../rate-limit.js";
import type { OwnerContext, OwnerDb, OwnerDbReader, OwnerDomain } from "../registry.js";

export const VIEW_STORAGE_MIGRATION = {
  id: "viewStorage.1-init",
  statements: [
    `CREATE TABLE view_storage (
       view_id TEXT NOT NULL,
       key TEXT NOT NULL,
       value TEXT,
       bytes INTEGER NOT NULL,
       seq INTEGER NOT NULL,
       updated_at INTEGER NOT NULL,
       PRIMARY KEY (view_id, key)
     )`,
    `CREATE TABLE view_storage_views (
       view_id TEXT PRIMARY KEY,
       seq INTEGER NOT NULL,
       bytes INTEGER NOT NULL,
       keys INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
  ],
};

/** `<conversationId>/<slug>`: the conversation that made the view, and the view's slug. */
const VIEW_ID_PATTERN = /^[\w.:-]{1,160}\/[\w.-]{1,128}$/u;
/** Keys a slider drag can produce, with room; devices send at most every RTT. */
const WRITE_RATE = { count: 1800, windowMs: 60_000 };
/** Removals kept per view beyond its live keys, oldest dropped first. */
const MAX_TOMBSTONES = 500;

const encoder = new TextEncoder();
const byteLength = (text: string) => encoder.encode(text).length;

const change = object({
  key: string({ min: 1, max: VIEW_STORAGE_LIMITS.maxKeyLength }),
  value: json({ maxBytes: VIEW_STORAGE_LIMITS.maxViewBytes }),
});
const changes = array(change, { max: VIEW_STORAGE_LIMITS.maxChanges });
const viewId = string({ min: 3, max: VIEW_STORAGE_LIMITS.maxViewIdLength, pattern: VIEW_ID_PATTERN });

const parseWrite = object({
  viewId,
  clear: optional(boolean()),
  changes,
  seed: optional(changes),
});

type Row = { key: string; value: string | null; bytes: number };

const readState = (db: OwnerDbReader, id: string): ViewStorageState => {
  const head = db.one<{ seq: number }>("SELECT seq FROM view_storage_views WHERE view_id = ?", id);
  const values: Record<string, unknown> = {};
  for (const row of db.all<{ key: string; value: string }>(
    "SELECT key, value FROM view_storage WHERE view_id = ? AND value IS NOT NULL",
    id,
  )) {
    try {
      values[row.key] = JSON.parse(row.value);
    } catch {
      // A row is written only from parsed JSON; nothing to show for one that isn't.
    }
  }
  return { viewId: id, seq: head?.seq ?? 0, values };
};

const encode = (value: unknown): string | null =>
  value === null || value === undefined ? null : JSON.stringify(value);

const writeViewStorage = (ctx: OwnerContext, args: ViewStorageWrite): { seq: number } => {
  enforceOwnerRateLimit(ctx.db, ctx.now, "viewStorage.write", WRITE_RATE, "Too many view storage writes. Please wait a moment.");
  const apply = () => {
    const { db } = ctx;
    const rows = new Map(
      db
        .all<Row>("SELECT key, value, bytes FROM view_storage WHERE view_id = ?", args.viewId)
        .map((row) => [row.key, row]),
    );
    const next = new Map<string, string | null>();
    if (args.clear) {
      for (const [key, row] of rows) if (row.value !== null) next.set(key, null);
    }
    for (const entry of args.seed ?? []) {
      if (!rows.has(entry.key) && !next.has(entry.key)) next.set(entry.key, encode(entry.value));
    }
    for (const entry of args.changes) next.set(entry.key, encode(entry.value));
    if (next.size === 0) {
      const head = db.one<{ seq: number }>("SELECT seq FROM view_storage_views WHERE view_id = ?", args.viewId);
      return { seq: head?.seq ?? 0 };
    }

    let bytes = 0;
    let keys = 0;
    for (const [key, row] of rows) {
      if (next.has(key) || row.value === null) continue;
      bytes += row.bytes;
      keys += 1;
    }
    const sized = new Map<string, { text: string | null; bytes: number }>();
    for (const [key, text] of next) {
      const size = text === null ? 0 : byteLength(key) + byteLength(text);
      sized.set(key, { text, bytes: size });
      if (text !== null) {
        bytes += size;
        keys += 1;
      }
    }
    if (bytes > VIEW_STORAGE_LIMITS.maxViewBytes) {
      throw new RpcError(
        "BAD_REQUEST",
        `A view keeps at most ${VIEW_STORAGE_LIMITS.maxViewBytes / 1024} KB of storage; this write would make it ${Math.ceil(bytes / 1024)} KB.`,
        { reason: "view_storage_full" },
      );
    }
    if (keys > VIEW_STORAGE_LIMITS.maxKeys) {
      throw new RpcError("BAD_REQUEST", `A view keeps at most ${VIEW_STORAGE_LIMITS.maxKeys} storage keys.`, {
        reason: "view_storage_full",
      });
    }

    const head = db.one<{ seq: number }>("SELECT seq FROM view_storage_views WHERE view_id = ?", args.viewId);
    const seq = (head?.seq ?? 0) + 1;
    for (const [key, entry] of sized) {
      db.run(
        `INSERT INTO view_storage (view_id, key, value, bytes, seq, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (view_id, key) DO UPDATE SET
           value = excluded.value, bytes = excluded.bytes, seq = excluded.seq, updated_at = excluded.updated_at`,
        args.viewId,
        key,
        entry.text,
        entry.bytes,
        seq,
        ctx.now,
      );
    }
    db.run(
      `INSERT INTO view_storage_views (view_id, seq, bytes, keys, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (view_id) DO UPDATE SET
         seq = excluded.seq, bytes = excluded.bytes, keys = excluded.keys, updated_at = excluded.updated_at`,
      args.viewId,
      seq,
      bytes,
      keys,
      ctx.now,
    );
    const tombstones =
      db.one<{ n: number }>("SELECT COUNT(*) AS n FROM view_storage WHERE view_id = ? AND value IS NULL", args.viewId)?.n ?? 0;
    if (tombstones > MAX_TOMBSTONES) {
      db.run(
        `DELETE FROM view_storage WHERE view_id = ? AND key IN (
           SELECT key FROM view_storage WHERE view_id = ? AND value IS NULL ORDER BY seq LIMIT ?
         )`,
        args.viewId,
        args.viewId,
        tombstones - MAX_TOMBSTONES,
      );
    }
    return { seq };
  };
  return ctx.db.transaction ? ctx.db.transaction(apply) : apply();
};

/** Forgets the storage of every view a deleted conversation made. */
export const deleteConversationViewStorage = (db: OwnerDb, conversationId: string): void => {
  const prefix = `${conversationId}/`;
  db.run("DELETE FROM view_storage WHERE substr(view_id, 1, ?) = ?", prefix.length, prefix);
  db.run("DELETE FROM view_storage_views WHERE substr(view_id, 1, ?) = ?", prefix.length, prefix);
};

export const viewStorageDomain = {
  name: "viewStorage",
  migrations: [VIEW_STORAGE_MIGRATION],
  calls: {
    "viewStorage.write": {
      scope: "owner",
      maxBodyBytes: VIEW_STORAGE_LIMITS.maxViewBytes * 3,
      parse: parseWrite as (value: unknown) => ViewStorageWrite,
      handler: (ctx, args) => writeViewStorage(ctx, args),
    },
  },
  views: {
    "viewStorage.get": {
      parse: object({ viewId }),
      read: (ctx, args) => readState(ctx.db, args.viewId),
    },
  },
  purge: (ctx) => {
    ctx.db.run("DELETE FROM view_storage");
    ctx.db.run("DELETE FROM view_storage_views");
    return { pending: false };
  },
} satisfies OwnerDomain;
