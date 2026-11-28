// The account's Stella Views, for the Apps list (`@stella/contracts/backend/view-index`): one row
// per view (`<conversationId>/<slug>`) with its newest version. Every way a version lands records
// here: the orchestrator's `view` tool on a computer (`viewIndex.record`), the cloud orchestrator's
// (`cloud-view-tool.ts`, internal) and a task's view card (`conversations.publishView`). A version
// older than the row's newest is ignored, so versions arriving out of order settle on the newest.
// A shared view's link follows each new version (`refreshViewShare`).
import {
  VIEW_INDEX_ID_PATTERN,
  VIEW_INDEX_LIMITS,
  viewIndexId,
  viewSourceIcon,
  type IndexedView,
  type IndexedViewSource,
  type ViewIndexRecordArgs,
} from "@stella/contracts/backend/view-index";
import { VIEW_CLOCK_SKEW_MS } from "@stella/views/conversation";
import { viewIdentityFromPath } from "@stella/views/paths";
import { empty, json, number, object, optional, string } from "../args.js";
import { RpcError } from "../errors.js";
import { enforceOwnerRateLimit } from "../rate-limit.js";
import type { OwnerContext, OwnerDb, OwnerDbReader, OwnerDomain } from "../registry.js";
import { refreshViewShare } from "./shares.js";

export const VIEW_INDEX_MIGRATION = {
  id: "viewIndex.1-init",
  statements: [
    `CREATE TABLE view_index (
       id TEXT PRIMARY KEY,
       conversation_id TEXT NOT NULL,
       slug TEXT NOT NULL,
       file_path TEXT NOT NULL,
       title TEXT NOT NULL,
       icon TEXT,
       source TEXT NOT NULL,
       data_json TEXT,
       version INTEGER NOT NULL,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL,
       removed_at INTEGER
     )`,
    "CREATE INDEX view_index_recent ON view_index (updated_at DESC)",
    "CREATE INDEX view_index_by_conversation ON view_index (conversation_id)",
  ],
};

/** Versions a burst of edits can produce, with room. */
const RECORD_RATE = { count: 240, windowMs: 60_000 };
const SLUG_PATTERN = /^[\w.-]{1,128}$/u;
const CONVERSATION_PATTERN = /^[\w.:-]{1,160}$/u;

type Row = {
  id: string;
  conversation_id: string;
  slug: string;
  file_path: string;
  title: string;
  icon: string | null;
  source: string;
  data_json: string | null;
  version: number;
  created_at: number;
  updated_at: number;
  removed_at: number | null;
  conversation_title: string | null;
};

const encoder = new TextEncoder();

const toView = (row: Row): IndexedView => ({
  id: row.id,
  conversationId: row.conversation_id,
  slug: row.slug,
  filePath: row.file_path,
  title: row.title,
  icon: row.icon,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  conversationTitle: row.conversation_title?.trim() || null,
});

// A view whose chat was deleted leaves the list with it (the purge removes its row later).
const SELECT = `SELECT v.*, c.title AS conversation_title
  FROM view_index v LEFT JOIN conversations c ON c.conversation_id = v.conversation_id
  WHERE v.removed_at IS NULL AND (c.conversation_id IS NULL OR c.deleted_at IS NULL)`;

const listViews = (db: OwnerDbReader): IndexedView[] =>
  db.all<Row>(`${SELECT} ORDER BY v.updated_at DESC LIMIT ?`, VIEW_INDEX_LIMITS.maxListed).map(toView);

/** One view with its newest source and data, or null when the account has no such view. */
export const readIndexedView = (db: OwnerDbReader, id: string): IndexedViewSource | null => {
  const row = db.one<Row>(`${SELECT} AND v.id = ?`, id);
  if (!row) return null;
  let data: unknown;
  let hasData = false;
  if (row.data_json !== null) {
    try {
      data = JSON.parse(row.data_json);
      hasData = true;
    } catch {
      hasData = false;
    }
  }
  return { ...toView(row), source: row.source, ...(hasData ? { data } : {}) };
};

export type RecordedVersion = { recorded: boolean; version: number };


/** A version's time from a device, bounded by the server's clock, so no version can claim to be newer than everything after it. */
export const boundedViewTime = (createdAt: number, now: number): number => Math.max(0, Math.min(createdAt, now + VIEW_CLOCK_SKEW_MS));

const FLAT_VIEW_RE = /(?:^|[\\/])outputs[\\/]views[\\/]([\w.-]{1,128})\.view\.(?:tsx|ts|jsx|js)$/iu;

/**
 * A view's path names the view it is (devices take its storage and file from it), so it must be
 * this conversation's: `…/outputs/views/<this conversation>/<slug>.view.tsx`, or, for a view from
 * before chats had folders, `…/outputs/views/<slug>.view.tsx` that no other conversation's view has.
 */
export const assertOwnViewPath = (db: OwnerDbReader, conversationId: string, slug: string, filePath: string): void => {
  const refuse = () => {
    throw new RpcError("FORBIDDEN", "That path belongs to another view.");
  };
  if (/(?:^|[\\/])\.\.?(?:[\\/]|$)/u.test(filePath)) refuse();
  const named = viewIdentityFromPath(filePath);
  if (named) {
    if (named.conversationId !== conversationId || named.slug !== slug) refuse();
  } else if (FLAT_VIEW_RE.exec(filePath)?.[1] !== slug) {
    refuse();
  }
  const other = db.one<{ conversation_id: string }>("SELECT conversation_id FROM view_index WHERE file_path = ? AND conversation_id != ? LIMIT 1", filePath, conversationId);
  if (other) refuse();
};

/**
 * Records one version of a view. Newer than the row's newest (or the first): it becomes the view's
 * version and the view returns to the list if it was taken off. Older: nothing changes.
 */
export const recordViewVersion = async (ctx: OwnerContext, args: ViewIndexRecordArgs): Promise<RecordedVersion> => {
  const id = viewIndexId(args.conversationId, args.slug);
  if (!VIEW_INDEX_ID_PATTERN.test(id)) throw new RpcError("BAD_REQUEST", "That isn't a view's name.");
  if (encoder.encode(args.source).byteLength > VIEW_INDEX_LIMITS.maxSourceBytes) {
    throw new RpcError("BAD_REQUEST", `A view's source is limited to ${VIEW_INDEX_LIMITS.maxSourceBytes / 1024} KB.`);
  }
  const title = args.title.trim().slice(0, VIEW_INDEX_LIMITS.maxTitleChars) || args.slug;
  // Data that doesn't fit stays with the version in the chat; opened from Apps, the view runs without it.
  let dataJson: string | null = null;
  if (args.data !== undefined) {
    const text = JSON.stringify(args.data);
    if (text !== undefined && encoder.encode(text).byteLength <= VIEW_INDEX_LIMITS.maxDataBytes) dataJson = text;
  }
  assertOwnViewPath(ctx.db, args.conversationId, args.slug, args.filePath);
  const createdAt = boundedViewTime(args.createdAt, ctx.now);
  const existing = ctx.db.one<{ version: number; updated_at: number; source: string; data_json: string | null; title: string; removed_at: number | null }>(
    "SELECT version, updated_at, source, data_json, title, removed_at FROM view_index WHERE id = ?",
    id,
  );
  // A row stamped ahead of the server's clock (before times were bounded) holds no version back.
  if (existing && boundedViewTime(existing.updated_at, ctx.now) > createdAt) return { recorded: false, version: existing.version };
  if (
    existing &&
    existing.source === args.source &&
    existing.title === title &&
    (args.data === undefined || existing.data_json === dataJson) &&
    existing.removed_at === null
  ) {
    return { recorded: false, version: existing.version };
  }
  const icon = viewSourceIcon(args.source);
  if (existing) {
    ctx.db.run(
      `UPDATE view_index SET file_path = ?, title = ?, icon = ?, source = ?,
         data_json = CASE WHEN ? THEN ? ELSE data_json END,
         version = version + 1, updated_at = ?, removed_at = NULL
       WHERE id = ?`,
      args.filePath,
      title,
      icon,
      args.source,
      args.data !== undefined ? 1 : 0,
      dataJson,
      createdAt,
      id,
    );
  } else {
    ctx.db.run(
      `INSERT INTO view_index
         (id, conversation_id, slug, file_path, title, icon, source, data_json, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      id,
      args.conversationId,
      args.slug,
      args.filePath,
      title,
      icon,
      args.source,
      dataJson,
      createdAt,
      createdAt,
    );
  }
  const version = (existing?.version ?? 0) + 1;
  const view = readIndexedView(ctx.db, id);
  if (view) {
    try {
      await refreshViewShare(ctx, view);
    } catch (error) {
      // The version is recorded; its link catches up on the next version or Share.
      console.error(JSON.stringify({
        event: "view_share_refresh_failed",
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  }
  return { recorded: true, version };
};

const recordArgs = object({
  conversationId: string({ min: 1, max: 160, pattern: CONVERSATION_PATTERN }),
  filePath: string({ min: 1, max: VIEW_INDEX_LIMITS.maxFilePathChars }),
  slug: string({ min: 1, max: 128, pattern: SLUG_PATTERN }),
  title: string({ min: 1, max: VIEW_INDEX_LIMITS.maxTitleChars * 4 }),
  source: string({ min: 1, max: VIEW_INDEX_LIMITS.maxSourceBytes }),
  // Sized loosely: data too big for the index is dropped, not refused (see recordViewVersion).
  data: optional(json({ maxBytes: 4 * 1024 * 1024 })),
  createdAt: number({ min: 0 }),
});

const record = async (ctx: OwnerContext, args: ViewIndexRecordArgs): Promise<RecordedVersion> => {
  enforceOwnerRateLimit(ctx.db, ctx.now, "viewIndex.record", RECORD_RATE, "Too many view versions. Please wait a moment.");
  return await recordViewVersion(ctx, args);
};

const remove = (ctx: OwnerContext, args: { id: string }): { removed: true } => {
  ctx.db.run("UPDATE view_index SET removed_at = ? WHERE id = ? AND removed_at IS NULL", ctx.now, args.id);
  return { removed: true };
};

/** Forgets every view a deleted conversation made. */
export const deleteConversationViewIndex = (db: OwnerDb, conversationId: string): void => {
  db.run("DELETE FROM view_index WHERE conversation_id = ?", conversationId);
};

const idArg = string({ min: 3, max: 300, pattern: VIEW_INDEX_ID_PATTERN });

export const viewIndexDomain = {
  name: "viewIndex",
  migrations: [VIEW_INDEX_MIGRATION],
  calls: {
    "viewIndex.record": {
      scope: "owner",
      maxBodyBytes: VIEW_INDEX_LIMITS.maxSourceBytes * 2 + 4 * 1024 * 1024 + 16 * 1024,
      parse: recordArgs as (value: unknown) => ViewIndexRecordArgs,
      handler: record,
    },
    "viewIndex.remove": {
      scope: "owner",
      parse: object({ id: idArg }),
      handler: remove,
    },
  },
  views: {
    "viewIndex.list": {
      parse: empty(),
      read: (ctx) => listViews(ctx.db),
    },
    "viewIndex.get": {
      parse: object({ id: idArg }),
      read: (ctx, args) => readIndexedView(ctx.db, args.id),
    },
  },
  internal: {
    // The cloud orchestrator's `view` tool (cloud-view-tool.ts).
    "viewIndex.record": (ctx: OwnerContext, args: unknown) => recordViewVersion(ctx, recordArgs(args) as ViewIndexRecordArgs),
  },
  purge: (ctx) => {
    ctx.db.run("DELETE FROM view_index");
    return { pending: false };
  },
} satisfies OwnerDomain;
