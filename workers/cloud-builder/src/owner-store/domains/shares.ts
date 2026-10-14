import {
  SHARE_CANVAS_PATTERN,
  SHARE_MAX_HTML_BYTES,
  SHARE_MAX_TITLE_CHARS,
  type PublishedShare,
  type SavedCanvasShare,
  type SharedFileLink,
  type ShareLink,
  type ShareVisibility,
} from "@stella/contracts/backend/shares";
import {
  buildCanvasShareUrl,
  buildFileShareUrl,
  readCanvasShareBaseUrl,
} from "@stella/contracts/canvas-share";
import {
  CANVAS_VIEW_GRANT_PARAM,
  CANVAS_VIEW_GRANT_TTL_MS,
  canvasOwnerTag,
  signCanvasViewToken,
} from "../../../../shared/canvas-view-grant.js";
import { empty, literal, object, optional, string } from "../args.js";
import { RpcError } from "../errors.js";
import { enforceOwnerRateLimit } from "../rate-limit.js";
import { getFile, normalizeDrivePath } from "./drive.js";
import type { OwnerContext, OwnerDbReader, OwnerDomain } from "../registry.js";

const SHARE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const LIST_LIMIT = 100;
const PURGE_BATCH = 1_000;
const EXPIRE_JOB = "shares.expire";
const RATE_LIMIT = { count: 20, windowMs: 60_000 };
const SAVE_RATE_LIMIT = { count: 60, windowMs: 60_000 };

export const SHARES_MIGRATION = {
  id: "shares.1-init",
  statements: [
    `CREATE TABLE shares (
       slug TEXT PRIMARY KEY,
       title TEXT,
       r2_key TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       expires_at INTEGER NOT NULL
     )`,
  ],
};

export const SHARES_CANVAS_MIGRATION = {
  id: "shares.2-canvas-visibility",
  statements: [
    "ALTER TABLE shares ADD COLUMN canvas TEXT",
    "ALTER TABLE shares ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'",
    "CREATE UNIQUE INDEX shares_by_canvas ON shares (canvas) WHERE canvas IS NOT NULL",
  ],
};

export const SHARES_FILE_MIGRATION = {
  id: "shares.3-files",
  statements: [
    "ALTER TABLE shares ADD COLUMN file_path TEXT",
    "ALTER TABLE shares ADD COLUMN file_source_key TEXT",
    "CREATE UNIQUE INDEX shares_by_file ON shares (file_path) WHERE file_path IS NOT NULL",
  ],
};

const SHARE_FILE_MAX_BYTES = 500 * 1024 * 1024;

type ShareRow = {
  slug: string;
  title: string | null;
  r2_key: string;
  created_at: number;
  expires_at: number;
  canvas: string | null;
  visibility: string;
  file_path: string | null;
  file_source_key: string | null;
};

const unavailable = () =>
  new RpcError("UNAVAILABLE", "Sharing is unavailable right now. Try again shortly.", {
    retryAfterMs: 5_000,
  });

const bucketOf = (env: Cloudflare.Env): R2Bucket => {
  if (!env.CANVAS_SHARES) throw unavailable();
  return env.CANVAS_SHARES;
};

const baseUrlOf = (env: Cloudflare.Env): string => {
  const base = readCanvasShareBaseUrl(env.CANVAS_SHARE_BASE_URL);
  if (!base) throw unavailable();
  return base;
};

const ownerSiteOf = (env: Cloudflare.Env): string | null => {
  const value = env.CANVAS_OWNER_SITE_URL?.trim();
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const viewSecretOf = (env: Cloudflare.Env): string | null => {
  const value = (env as unknown as Record<string, unknown>).CANVAS_SHARE_VIEW_SECRET;
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || null;
};

const keyForSlug = (slug: string): string => `shares/${slug}.html`;

const visibilityOf = (row: Pick<ShareRow, "visibility">): ShareVisibility =>
  row.visibility === "private" ? "private" : "public";

const validateDocument = (html: string, rawTitle: string | undefined) => {
  const bytes = new TextEncoder().encode(html);
  if (bytes.byteLength === 0) throw new RpcError("BAD_REQUEST", "Canvas HTML is required.");
  if (bytes.byteLength > SHARE_MAX_HTML_BYTES) {
    throw new RpcError(
      "BAD_REQUEST",
      `Canvas HTML exceeds the ${SHARE_MAX_HTML_BYTES / (1024 * 1024)}MB limit.`,
    );
  }
  const title = rawTitle?.trim() || null;
  if (title && title.length > SHARE_MAX_TITLE_CHARS) {
    throw new RpcError("BAD_REQUEST", `Titles are limited to ${SHARE_MAX_TITLE_CHARS} characters.`);
  }
  return { bytes, title };
};

const putObject = async (
  ctx: OwnerContext,
  key: string,
  body: Uint8Array | ArrayBuffer,
  options: { expiresAt: number; visibility: ShareVisibility },
): Promise<void> => {
  const ownerSite = ownerSiteOf(ctx.env);
  await bucketOf(ctx.env).put(key, body, {
    httpMetadata: {
      contentType: "text/html; charset=utf-8",
      cacheControl: options.visibility === "public" ? "public, max-age=300" : "private, no-store",
    },
    customMetadata: {
      "expires-at": String(options.expiresAt),
      visibility: options.visibility,
      owner: await canvasOwnerTag(ctx.ownerId),
      ...(ownerSite ? { "owner-site": ownerSite } : {}),
    },
  });
};

const shareUrlOf = (base: string, row: ShareRow): string =>
  row.file_path
    ? buildFileShareUrl(base, row.slug, row.title ?? "file")
    : buildCanvasShareUrl(base, row.slug);

const toLink = (base: string, row: ShareRow): ShareLink => ({
  slug: row.slug,
  url: shareUrlOf(base, row),
  title: row.title,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  visibility: visibilityOf(row),
  canvas: row.canvas,
  file: row.file_path,
});

const generateSlug = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

const expireJobId = (slug: string): string => `${EXPIRE_JOB}:${slug}`;

const dropRow = (ctx: OwnerContext, slug: string): void => {
  ctx.db.run("DELETE FROM shares WHERE slug = ?", slug);
  ctx.jobs.cancel(expireJobId(slug));
};

const listShares = (db: OwnerDbReader, env: Cloudflare.Env, now: number): ShareLink[] => {
  const base = baseUrlOf(env);
  return db
    .all<ShareRow>(
      "SELECT * FROM shares WHERE expires_at > ? AND visibility = 'public' ORDER BY created_at DESC LIMIT ?",
      now,
      LIST_LIMIT,
    )
    .map((row) => toLink(base, row));
};

const readCanvasShare = (
  db: OwnerDbReader,
  env: Cloudflare.Env,
  now: number,
  canvas: string,
): ShareLink | null => {
  const row = db.one<ShareRow>(
    "SELECT * FROM shares WHERE canvas = ? AND expires_at > ?",
    canvas,
    now,
  );
  return row ? toLink(baseUrlOf(env), row) : null;
};

const publish = async (
  ctx: OwnerContext,
  args: { html: string; title?: string },
): Promise<PublishedShare> => {
  bucketOf(ctx.env);
  const base = baseUrlOf(ctx.env);
  const { bytes, title } = validateDocument(args.html, args.title);
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    "shares.publish",
    RATE_LIMIT,
    "Too many shares. Please wait a moment.",
  );

  const slug = generateSlug();
  const key = keyForSlug(slug);
  const expiresAt = ctx.now + SHARE_TTL_MS;
  ctx.db.run(
    "INSERT INTO shares (slug, title, r2_key, created_at, expires_at, visibility) VALUES (?, ?, ?, ?, ?, 'public')",
    slug,
    title,
    key,
    ctx.now,
    expiresAt,
  );
  ctx.jobs.schedule(EXPIRE_JOB, expiresAt, { slug }, { id: expireJobId(slug) });
  try {
    await putObject(ctx, key, bytes, { expiresAt, visibility: "public" });
  } catch (error) {
    await forgetFailedPut(ctx, slug, key, error);
    throw unavailable();
  }
  return { url: buildCanvasShareUrl(base, slug), slug, expiresAt };
};

const forgetFailedPut = async (
  ctx: OwnerContext,
  slug: string,
  key: string,
  error: unknown,
): Promise<void> => {
  console.error(JSON.stringify({
    event: "share_publish_failed",
    message: error instanceof Error ? error.message : String(error),
  }));
  try {
    await bucketOf(ctx.env).delete(key);
    dropRow(ctx, slug);
  } catch {
    // Kept for the expiry job.
  }
};

const save = async (
  ctx: OwnerContext,
  args: { canvas: string; html: string; title?: string; visibility?: ShareVisibility },
): Promise<SavedCanvasShare> => {
  bucketOf(ctx.env);
  const base = baseUrlOf(ctx.env);
  const { bytes, title } = validateDocument(args.html, args.title);
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    "shares.save",
    SAVE_RATE_LIMIT,
    "Too many canvases saved. Please wait a moment.",
  );
  const expiresAt = ctx.now + SHARE_TTL_MS;
  const existing = ctx.db.one<ShareRow>("SELECT * FROM shares WHERE canvas = ?", args.canvas);

  if (existing) {
    const visibility = args.visibility ?? visibilityOf(existing);
    ctx.db.run(
      "UPDATE shares SET title = ?, expires_at = ? WHERE slug = ?",
      title ?? existing.title,
      expiresAt,
      existing.slug,
    );
    ctx.jobs.schedule(EXPIRE_JOB, expiresAt, { slug: existing.slug }, { id: expireJobId(existing.slug) });
    try {
      await putObject(ctx, existing.r2_key, bytes, { expiresAt, visibility });
    } catch (error) {
      console.error(JSON.stringify({
        event: "share_save_failed",
        message: error instanceof Error ? error.message : String(error),
      }));
      throw unavailable();
    }
    if (visibility !== visibilityOf(existing)) {
      ctx.db.run("UPDATE shares SET visibility = ? WHERE slug = ?", visibility, existing.slug);
    }
    return { url: buildCanvasShareUrl(base, existing.slug), slug: existing.slug, visibility, expiresAt };
  }

  const visibility = args.visibility ?? "private";
  const slug = generateSlug();
  const key = keyForSlug(slug);
  ctx.db.run(
    `INSERT INTO shares (slug, title, r2_key, created_at, expires_at, canvas, visibility)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    slug,
    title,
    key,
    ctx.now,
    expiresAt,
    args.canvas,
    visibility,
  );
  ctx.jobs.schedule(EXPIRE_JOB, expiresAt, { slug }, { id: expireJobId(slug) });
  try {
    await putObject(ctx, key, bytes, { expiresAt, visibility });
  } catch (error) {
    await forgetFailedPut(ctx, slug, key, error);
    throw unavailable();
  }
  return { url: buildCanvasShareUrl(base, slug), slug, visibility, expiresAt };
};

const setVisibility = async (
  ctx: OwnerContext,
  args: { slug: string; visibility: ShareVisibility },
): Promise<SavedCanvasShare> => {
  const base = baseUrlOf(ctx.env);
  const bucket = bucketOf(ctx.env);
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    "shares.visibility",
    RATE_LIMIT,
    "Too many changes to shares. Please wait a moment.",
  );
  const row = ctx.db.one<ShareRow>(
    "SELECT * FROM shares WHERE slug = ? AND expires_at > ?",
    args.slug,
    ctx.now,
  );
  if (!row) throw new RpcError("NOT_FOUND", "Share not found.");
  if (row.file_path) {
    throw new RpcError("BAD_REQUEST", "A shared file's link is always public. Revoke it to stop sharing.");
  }
  const result = (visibility: ShareVisibility): SavedCanvasShare => ({
    url: buildCanvasShareUrl(base, row.slug),
    slug: row.slug,
    visibility,
    expiresAt: row.expires_at,
  });
  if (visibilityOf(row) === args.visibility) return result(args.visibility);

  const object = await bucket.get(row.r2_key);
  if (!object) {
    dropRow(ctx, row.slug);
    throw new RpcError("NOT_FOUND", "Share not found.");
  }
  const body = await object.arrayBuffer();
  try {
    await putObject(ctx, row.r2_key, body, { expiresAt: row.expires_at, visibility: args.visibility });
  } catch (error) {
    console.error(JSON.stringify({
      event: "share_visibility_failed",
      message: error instanceof Error ? error.message : String(error),
    }));
    throw unavailable();
  }
  ctx.db.run("UPDATE shares SET visibility = ? WHERE slug = ?", args.visibility, row.slug);
  return result(args.visibility);
};

const viewLink = async (ctx: OwnerContext, args: { slug: string }): Promise<{ url: string }> => {
  const base = baseUrlOf(ctx.env);
  const row = ctx.db.one<ShareRow>(
    "SELECT * FROM shares WHERE slug = ? AND expires_at > ?",
    args.slug,
    ctx.now,
  );
  if (!row) throw new RpcError("NOT_FOUND", "Share not found.");
  const url = shareUrlOf(base, row);
  if (visibilityOf(row) === "public") return { url };
  const secret = viewSecretOf(ctx.env);
  if (!secret) throw unavailable();
  const grant = await signCanvasViewToken(secret, {
    k: "grant",
    o: await canvasOwnerTag(ctx.ownerId),
    s: row.slug,
    e: ctx.now + CANVAS_VIEW_GRANT_TTL_MS,
  });
  return { url: `${url}?${CANVAS_VIEW_GRANT_PARAM}=${encodeURIComponent(grant)}` };
};

const fileKeyForSlug = (slug: string): string => `files/${slug}`;

const inlineContentType = (contentType: string): boolean =>
  /^(?:image\/(?!svg)|video\/|audio\/|application\/pdf$)/i.test(contentType);

const shareFile = async (
  ctx: OwnerContext,
  args: { path: string },
): Promise<SharedFileLink> => {
  const shares = bucketOf(ctx.env);
  const base = baseUrlOf(ctx.env);
  const path = normalizeDrivePath(args.path);
  const file = getFile(ctx.db, path);
  if (!file) throw new RpcError("NOT_FOUND", "That file is not in your drive.");
  const existing = ctx.db.one<ShareRow>(
    "SELECT * FROM shares WHERE file_path = ? AND expires_at > ?",
    path,
    ctx.now,
  );
  if (existing && existing.file_source_key === file.r2_key && existing.title === file.name) {
    return {
      url: shareUrlOf(base, existing),
      slug: existing.slug,
      expiresAt: existing.expires_at,
    };
  }
  if (file.size_bytes > SHARE_FILE_MAX_BYTES) {
    throw new RpcError(
      "BAD_REQUEST",
      `Files over ${SHARE_FILE_MAX_BYTES / (1024 * 1024)} MB can't be shared by link.`,
    );
  }
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    "shares.shareFile",
    RATE_LIMIT,
    "Too many shares. Please wait a moment.",
  );
  const drive = ctx.env.DRIVE;
  if (!drive) throw unavailable();
  const source = await drive.get(file.r2_key);
  if (!source) throw new RpcError("NOT_FOUND", "That file is not in your drive.");

  const stale = ctx.db.one<ShareRow>("SELECT * FROM shares WHERE file_path = ?", path);
  const slug = stale?.slug ?? generateSlug();
  const key = fileKeyForSlug(slug);
  const expiresAt = ctx.now + SHARE_TTL_MS;
  if (stale) {
    ctx.db.run(
      "UPDATE shares SET title = ?, expires_at = ?, visibility = 'public' WHERE slug = ?",
      file.name,
      expiresAt,
      slug,
    );
  } else {
    ctx.db.run(
      `INSERT INTO shares (slug, title, r2_key, created_at, expires_at, visibility, file_path)
         VALUES (?, ?, ?, ?, ?, 'public', ?)`,
      slug,
      file.name,
      key,
      ctx.now,
      expiresAt,
      path,
    );
  }
  ctx.jobs.schedule(EXPIRE_JOB, expiresAt, { slug }, { id: expireJobId(slug) });
  const contentType = file.content_type || "application/octet-stream";
  try {
    await shares.put(key, source.body, {
      httpMetadata: {
        contentType,
        contentDisposition: `${inlineContentType(contentType) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        cacheControl: "public, max-age=300",
      },
      customMetadata: {
        "expires-at": String(expiresAt),
        visibility: "public",
        owner: await canvasOwnerTag(ctx.ownerId),
      },
    });
  } catch (error) {
    if (stale) {
      console.error(JSON.stringify({
        event: "share_file_failed",
        message: error instanceof Error ? error.message : String(error),
      }));
    } else {
      await forgetFailedPut(ctx, slug, key, error);
    }
    throw unavailable();
  }
  ctx.db.run("UPDATE shares SET file_source_key = ? WHERE slug = ?", file.r2_key, slug);
  return { url: buildFileShareUrl(base, slug, file.name), slug, expiresAt };
};

const saveArgs = object({
  canvas: string({ min: 1, max: 64, pattern: SHARE_CANVAS_PATTERN }),
  html: string({ max: SHARE_MAX_HTML_BYTES }),
  title: optional(string({ max: SHARE_MAX_TITLE_CHARS * 4 })),
  visibility: optional(literal("private", "public")),
});

const saveFromCloud = (ctx: OwnerContext, raw: unknown): Promise<SavedCanvasShare> =>
  save(ctx, saveArgs(raw));

const revoke = async (ctx: OwnerContext, args: { slug: string }): Promise<{ revoked: true }> => {
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    "shares.revoke",
    RATE_LIMIT,
    "Too many changes to shares. Please wait a moment.",
  );
  const row = ctx.db.one<{ r2_key: string }>("SELECT r2_key FROM shares WHERE slug = ?", args.slug);
  if (!row) throw new RpcError("NOT_FOUND", "Share not found.");
  await bucketOf(ctx.env).delete(row.r2_key);
  dropRow(ctx, args.slug);
  return { revoked: true };
};

const expire = async (ctx: OwnerContext, payload: unknown): Promise<void> => {
  const slug = (payload as { slug?: unknown } | null)?.slug;
  if (typeof slug !== "string") return;
  const row = ctx.db.one<{ r2_key: string }>("SELECT r2_key FROM shares WHERE slug = ?", slug);
  if (!row) return;
  await bucketOf(ctx.env).delete(row.r2_key);
  ctx.db.run("DELETE FROM shares WHERE slug = ?", slug);
};

const purgeShares = async (ctx: OwnerContext): Promise<{ pending: boolean }> => {
  const rows = ctx.db.all<{ slug: string; r2_key: string }>(
    "SELECT slug, r2_key FROM shares LIMIT ?",
    PURGE_BATCH,
  );
  if (rows.length === 0) return { pending: false };
  await bucketOf(ctx.env).delete(rows.map((row) => row.r2_key));
  for (const row of rows) dropRow(ctx, row.slug);
  return { pending: rows.length === PURGE_BATCH };
};

export const sharesDomain = {
  name: "shares",
  migrations: [SHARES_MIGRATION, SHARES_CANVAS_MIGRATION, SHARES_FILE_MIGRATION],
  calls: {
    "shares.publish": {
      scope: "owner",
      maxBodyBytes: SHARE_MAX_HTML_BYTES * 2,
      parse: object({
        html: string({ max: SHARE_MAX_HTML_BYTES }),
        title: optional(string({ max: SHARE_MAX_TITLE_CHARS * 4 })),
      }),
      handler: publish,
    },
    "shares.save": {
      scope: "owner",
      maxBodyBytes: SHARE_MAX_HTML_BYTES * 2,
      parse: saveArgs,
      handler: save,
    },
    "shares.setVisibility": {
      scope: "owner",
      parse: object({
        slug: string({ min: 1, max: 128 }),
        visibility: literal("private", "public"),
      }),
      handler: setVisibility,
    },
    "shares.viewLink": {
      scope: "owner",
      parse: object({ slug: string({ min: 1, max: 128 }) }),
      handler: viewLink,
    },
    "shares.shareFile": {
      scope: "owner",
      parse: object({ path: string({ min: 1, max: 4_000 }) }),
      handler: shareFile,
    },
    "shares.revoke": {
      scope: "owner",
      parse: object({ slug: string({ min: 1, max: 128 }) }),
      handler: revoke,
    },
  },
  views: {
    "shares.list": {
      parse: empty(),
      read: (ctx) => listShares(ctx.db, ctx.env, ctx.now),
    },
    "shares.canvas": {
      parse: object({ canvas: string({ min: 1, max: 64, pattern: SHARE_CANVAS_PATTERN }) }),
      read: (ctx, args) => readCanvasShare(ctx.db, ctx.env, ctx.now, args.canvas),
    },
  },
  internal: {
    "shares.saveCanvas": saveFromCloud,
  },
  jobs: {
    [EXPIRE_JOB]: { run: expire },
  },
  purge: (ctx: OwnerContext) => purgeShares(ctx),
} satisfies OwnerDomain;
