import {
  UPDATE_PREPARER_STALE_MS,
  type AppSourceCalls,
  type AppSourceRemote,
  type AppSourceUpdate,
  type AppSourceViews,
} from "@stella/contracts/backend/app-source";
import { array, empty, nullable, object, optional, string } from "../args.js";
import { RpcError } from "../errors.js";
import { enforceOwnerRateLimit } from "../rate-limit.js";
import type { OwnerContext, OwnerDbReader, OwnerDomain } from "../registry.js";

const UPSTREAM_REPO = "upstream";
const TOKEN_TTL_SECONDS = 60 * 60;
const FORK_RETRY_MS = 2_000;

export const APP_SOURCE_MIGRATION = {
  id: "app-source.1-fork",
  statements: [
    `CREATE TABLE app_source_fork (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       name TEXT NOT NULL,
       remote TEXT NOT NULL,
       default_branch TEXT NOT NULL,
       created_at INTEGER NOT NULL
     )`,
  ],
};

export const APP_SOURCE_WEB_RENDERER_MIGRATION = {
  id: "app-source.2-web-renderer",
  statements: [
    `CREATE TABLE web_renderer (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       tree_sha TEXT NOT NULL,
       previous_tree_sha TEXT,
       uploaded_at INTEGER NOT NULL
     )`,
  ],
};

export const APP_SOURCE_FORK_PUSH_MIGRATION = {
  id: "app-source.3-fork-push",
  statements: [
    `CREATE TABLE app_source_fork_push (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       tip TEXT NOT NULL,
       pushed_at INTEGER NOT NULL
     )`,
  ],
};

export const APP_SOURCE_UPDATE_MIGRATION = {
  id: "app-source.4-update",
  statements: [
    `CREATE TABLE app_source_update (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       version TEXT NOT NULL,
       preparer_device_id TEXT,
       preparer_device TEXT,
       preparer_base TEXT,
       preparer_at INTEGER,
       result_sha TEXT,
       result_base TEXT,
       result_device_id TEXT,
       result_device TEXT,
       unresolved TEXT,
       apply_device_id TEXT,
       apply_device TEXT,
       apply_targets TEXT,
       apply_at INTEGER,
       updated_at INTEGER NOT NULL
     )`,
  ],
};

export const webRendererPrefix = (forkName: string) => `web-renderers/${forkName}/`;
export const TREE_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

type ForkRow = { name: string; remote: string; default_branch: string };

const artifactsCode = (error: unknown): string | null =>
  error instanceof Error && error.name === "ArtifactsError"
    ? String((error as { code?: unknown }).code ?? "")
    : null;

const forkName = async (ownerId: string): Promise<string> => {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`stella-app-fork-v1\0${ownerId}`)),
  );
  return `u-${[...digest.slice(0, 12)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
};

const unavailable = (message: string) =>
  new RpcError("UNAVAILABLE", message, { retryable: true, retryAfterMs: FORK_RETRY_MS });

const withRepo = async <T>(artifacts: Artifacts, name: string, work: (repo: ArtifactsRepo) => Promise<T>): Promise<T> => {
  let repo: ArtifactsRepo;
  try {
    repo = await artifacts.get(name);
  } catch (error) {
    const code = artifactsCode(error);
    if (code === "FORK_IN_PROGRESS" || code === "CREATE_IN_PROGRESS") {
      throw unavailable("Your copy of Stella's source is still being prepared.");
    }
    if (code === "NOT_FOUND" && name === UPSTREAM_REPO) {
      throw unavailable("Stella's source has not been published yet.");
    }
    throw error;
  }
  try {
    return await work(repo);
  } finally {
    (repo as unknown as { [Symbol.dispose]?: () => void })[Symbol.dispose]?.();
  }
};

const mintToken = async (repo: ArtifactsRepo, scope: "read" | "write") => {
  const minted = await repo.createToken(scope, TOKEN_TTL_SECONDS);
  return { token: minted.plaintext, expiresAt: Date.parse(minted.expiresAt) };
};

const readFork = (db: OwnerDbReader): ForkRow | null =>
  db.one<ForkRow>("SELECT name, remote, default_branch FROM app_source_fork WHERE id = 1");

const ensureFork = async (ctx: OwnerContext): Promise<ForkRow> => {
  const existing = readFork(ctx.db);
  if (existing) return existing;
  const artifacts = ctx.env.ARTIFACTS;
  const name = await forkName(ctx.ownerId);
  let fork: ForkRow;
  try {
    const created = await withRepo(artifacts, UPSTREAM_REPO, (upstream) =>
      upstream.fork(name, { defaultBranchOnly: true, readOnly: false }),
    );
    fork = { name: created.name, remote: created.remote, default_branch: created.defaultBranch };
    await withRepo(artifacts, name, (repo) => repo.revokeToken(created.token));
  } catch (error) {
    const code = artifactsCode(error);
    if (code === "FORK_IN_PROGRESS") throw unavailable("Your copy of Stella's source is still being prepared.");
    if (code !== "ALREADY_EXISTS") throw error;
    const info = await withRepo(artifacts, name, (repo) => repo.info());
    fork = { name: info.name, remote: info.remote, default_branch: info.defaultBranch };
  }
  ctx.db.run(
    "INSERT OR IGNORE INTO app_source_fork (id, name, remote, default_branch, created_at) VALUES (1, ?, ?, ?, ?)",
    fork.name,
    fork.remote,
    fork.default_branch,
    ctx.now,
  );
  return readFork(ctx.db) ?? fork;
};

const access = async (ctx: OwnerContext): Promise<AppSourceCalls["appSource.access"]["result"]> => {
  enforceOwnerRateLimit(ctx.db, ctx.now, "appSource.access", { count: 60, windowMs: 60_000 }, "Too many source requests. Please wait a moment.");
  const artifacts = ctx.env.ARTIFACTS;
  const fork = await ensureFork(ctx);
  const forkToken = await withRepo(artifacts, fork.name, (repo) => mintToken(repo, "write"));
  const upstream: AppSourceRemote = await withRepo(artifacts, UPSTREAM_REPO, async (repo) => ({
    remote: (await repo.info()).remote,
    ...(await mintToken(repo, "read")),
  }));
  return {
    fork: {
      name: fork.name,
      remote: fork.remote,
      defaultBranch: fork.default_branch,
      ...forkToken,
    },
    upstream,
  };
};

const forkNameOf = (db: OwnerDbReader) =>
  db.one<{ name: string }>("SELECT name FROM app_source_fork WHERE id = 1")?.name ?? null;

const webRenderer = (ctx: OwnerContext): AppSourceCalls["appSource.webRenderer"]["result"] => {
  const fork = forkNameOf(ctx.db);
  const row = ctx.db.one<{ tree_sha: string }>("SELECT tree_sha FROM web_renderer WHERE id = 1");
  return fork && row ? { path: `u/${fork}/${row.tree_sha}/` } : null;
};

const recordWebRenderer = (ctx: OwnerContext, args: unknown): { retired: string | null } => {
  const { treeSha } = object({ treeSha: string({ pattern: TREE_SHA_PATTERN }) })(args);
  const row = ctx.db.one<{ tree_sha: string; previous_tree_sha: string | null }>(
    "SELECT tree_sha, previous_tree_sha FROM web_renderer WHERE id = 1",
  );
  if (row?.tree_sha === treeSha) return { retired: null };
  ctx.db.run(
    `INSERT INTO web_renderer (id, tree_sha, previous_tree_sha, uploaded_at) VALUES (1, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET tree_sha = excluded.tree_sha,
       previous_tree_sha = excluded.previous_tree_sha, uploaded_at = excluded.uploaded_at`,
    treeSha,
    row?.tree_sha ?? null,
    ctx.now,
  );
  const retired = row?.previous_tree_sha ?? null;
  return { retired: retired && retired !== treeSha ? retired : null };
};

const forkPushed = (
  ctx: OwnerContext,
  args: AppSourceCalls["appSource.forkPushed"]["args"],
): AppSourceCalls["appSource.forkPushed"]["result"] => {
  enforceOwnerRateLimit(ctx.db, ctx.now, "appSource.forkPushed", { count: 30, windowMs: 60_000 }, "Too many source pushes. Please wait a moment.");
  const last = ctx.db.one<{ pushed_at: number }>("SELECT pushed_at FROM app_source_fork_push WHERE id = 1");
  const pushedAt = Math.max(ctx.now, (last?.pushed_at ?? 0) + 1);
  ctx.db.run(
    `INSERT INTO app_source_fork_push (id, tip, pushed_at) VALUES (1, ?, ?)
     ON CONFLICT (id) DO UPDATE SET tip = excluded.tip, pushed_at = excluded.pushed_at`,
    args.tip,
    pushedAt,
  );
  return { pushedAt };
};

const forkPush = (db: OwnerDbReader): AppSourceViews["appSource.fork"]["result"] => {
  const row = db.one<{ tip: string; pushed_at: number }>("SELECT tip, pushed_at FROM app_source_fork_push WHERE id = 1");
  return { tip: row?.tip ?? null, pushedAt: row?.pushed_at ?? null };
};

type UpdateRow = {
  version: string;
  preparer_device_id: string | null;
  preparer_device: string | null;
  preparer_base: string | null;
  preparer_at: number | null;
  result_sha: string | null;
  result_base: string | null;
  result_device_id: string | null;
  result_device: string | null;
  unresolved: string | null;
  apply_device_id: string | null;
  apply_device: string | null;
  apply_targets: string | null;
  apply_at: number | null;
  updated_at: number;
};

const parseList = (text: string | null): string[] | null => {
  if (text === null) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : null;
  } catch {
    return null;
  }
};

const updateOf = (row: UpdateRow | null): AppSourceUpdate | null =>
  row
    ? {
        version: row.version,
        preparer:
          row.preparer_device_id && row.preparer_base
            ? {
                deviceId: row.preparer_device_id,
                device: row.preparer_device ?? "",
                base: row.preparer_base,
                at: row.preparer_at ?? row.updated_at,
              }
            : null,
        result:
          row.result_sha && row.result_base && row.result_device_id
            ? {
                sha: row.result_sha,
                base: row.result_base,
                deviceId: row.result_device_id,
                device: row.result_device ?? "",
              }
            : null,
        unresolved: parseList(row.unresolved),
        apply:
          row.apply_at !== null && row.apply_device_id
            ? {
                deviceId: row.apply_device_id,
                device: row.apply_device ?? "",
                targets: parseList(row.apply_targets),
                at: row.apply_at,
              }
            : null,
        updatedAt: row.updated_at,
      }
    : null;

const readUpdateRow = (db: OwnerDbReader) =>
  db.one<UpdateRow>("SELECT * FROM app_source_update WHERE id = 1");

/** The row for `version`: a different published version starts over. */
const updateRowFor = (ctx: OwnerContext, version: string): UpdateRow => {
  const row = readUpdateRow(ctx.db);
  if (row?.version === version) return row;
  ctx.db.run(
    `INSERT INTO app_source_update (id, version, updated_at) VALUES (1, ?, ?)
     ON CONFLICT (id) DO UPDATE SET version = excluded.version,
       preparer_device_id = NULL, preparer_device = NULL, preparer_base = NULL, preparer_at = NULL,
       result_sha = NULL, result_base = NULL, result_device_id = NULL, result_device = NULL,
       unresolved = NULL, apply_device_id = NULL, apply_device = NULL, apply_targets = NULL,
       apply_at = NULL, updated_at = excluded.updated_at`,
    version,
    ctx.now,
  );
  return readUpdateRow(ctx.db)!;
};

const updateResult = (ctx: OwnerContext) => ({ update: updateOf(readUpdateRow(ctx.db))! });

const limitUpdates = (ctx: OwnerContext, name: string) =>
  enforceOwnerRateLimit(ctx.db, ctx.now, name, { count: 60, windowMs: 60_000 }, "Too many update requests. Please wait a moment.");

/**
 * One computer per account merges a version that needs a model. A claim is
 * granted when nobody holds it, the holder went quiet, or it is the holder
 * asking again (which keeps the claim fresh). A version already merged, or
 * one its preparer gave up on, is never claimed again: that would spend the
 * user's model use a second time.
 */
const claimUpdate = (ctx: OwnerContext, args: AppSourceCalls["appSource.claimUpdate"]["args"]) => {
  limitUpdates(ctx, "appSource.claimUpdate");
  const row = updateRowFor(ctx, args.version);
  const held =
    row.preparer_device_id !== null &&
    row.preparer_device_id !== args.deviceId &&
    ctx.now - (row.preparer_at ?? 0) < UPDATE_PREPARER_STALE_MS;
  if (row.result_sha === null && row.unresolved === null && !held) {
    ctx.db.run(
      `UPDATE app_source_update SET preparer_device_id = ?, preparer_device = ?, preparer_base = ?,
         preparer_at = ?, updated_at = ? WHERE id = 1`,
      args.deviceId,
      args.device,
      args.base,
      ctx.now,
      ctx.now,
    );
  }
  return updateResult(ctx);
};

/** The first merged result stays: every computer that takes it gets the same version. */
const updatePrepared = (ctx: OwnerContext, args: AppSourceCalls["appSource.updatePrepared"]["args"]) => {
  limitUpdates(ctx, "appSource.updatePrepared");
  const row = updateRowFor(ctx, args.version);
  if (args.result) {
    if (row.result_sha === null || row.result_device_id === args.deviceId) {
      ctx.db.run(
        `UPDATE app_source_update SET result_sha = ?, result_base = ?, result_device_id = ?,
           result_device = ?, unresolved = NULL, updated_at = ? WHERE id = 1`,
        args.result,
        args.base,
        args.deviceId,
        args.device,
        ctx.now,
      );
    }
  } else if (row.result_sha === null && row.preparer_device_id === args.deviceId) {
    ctx.db.run(
      "UPDATE app_source_update SET unresolved = ?, updated_at = ? WHERE id = 1",
      JSON.stringify(args.unresolved ?? []),
      ctx.now,
    );
  }
  return updateResult(ctx);
};

const applyUpdate = (ctx: OwnerContext, args: AppSourceCalls["appSource.applyUpdate"]["args"]) => {
  limitUpdates(ctx, "appSource.applyUpdate");
  updateRowFor(ctx, args.version);
  ctx.db.run(
    `UPDATE app_source_update SET apply_device_id = ?, apply_device = ?, apply_targets = ?,
       apply_at = ?, updated_at = ? WHERE id = 1`,
    args.deviceId,
    args.device,
    args.targets === null ? null : JSON.stringify(args.targets),
    ctx.now,
    ctx.now,
  );
  return updateResult(ctx);
};

const COMMIT_SHA = { pattern: /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/ };
const deviceArgs = {
  deviceId: string({ min: 1, max: 256 }),
  device: string({ max: 256 }),
};

export const appSourceDomain = {
  name: "app-source",
  migrations: [
    APP_SOURCE_MIGRATION,
    APP_SOURCE_WEB_RENDERER_MIGRATION,
    APP_SOURCE_FORK_PUSH_MIGRATION,
    APP_SOURCE_UPDATE_MIGRATION,
  ],
  internal: {
    "appSource.webRendererFork": (ctx: OwnerContext) => ({ forkName: forkNameOf(ctx.db) }),
    "appSource.recordWebRenderer": recordWebRenderer,
  },
  purge: async (ctx: OwnerContext) => {
    const fork = forkNameOf(ctx.db);
    ctx.db.run("DELETE FROM web_renderer");
    ctx.db.run("DELETE FROM app_source_fork_push");
    ctx.db.run("DELETE FROM app_source_update");
    if (!fork) return { pending: false };
    const bucket = ctx.env.APP_BUILDS;
    const listing = await bucket.list({ prefix: webRendererPrefix(fork), limit: 1000 });
    if (listing.objects.length > 0) await bucket.delete(listing.objects.map((entry) => entry.key));
    return { pending: listing.truncated };
  },
  calls: {
    "appSource.webRenderer": {
      scope: "owner",
      parse: empty(),
      handler: (ctx: OwnerContext) => webRenderer(ctx),
    },
    "appSource.access": {
      scope: "owner",
      parse: empty(),
      handler: (ctx: OwnerContext) => access(ctx),
    },
    "appSource.forkPushed": {
      scope: "owner",
      parse: object({ tip: string({ pattern: TREE_SHA_PATTERN }) }),
      handler: (ctx: OwnerContext, args: AppSourceCalls["appSource.forkPushed"]["args"]) => forkPushed(ctx, args),
    },
    "appSource.claimUpdate": {
      scope: "owner",
      parse: object({ version: string(COMMIT_SHA), ...deviceArgs, base: string(COMMIT_SHA) }),
      handler: (ctx: OwnerContext, args: AppSourceCalls["appSource.claimUpdate"]["args"]) => claimUpdate(ctx, args),
    },
    "appSource.updatePrepared": {
      scope: "owner",
      parse: object({
        version: string(COMMIT_SHA),
        ...deviceArgs,
        base: string(COMMIT_SHA),
        result: nullable(string(COMMIT_SHA)),
        unresolved: optional(array(string({ max: 1_024 }), { max: 200 })),
      }),
      handler: (ctx: OwnerContext, args: AppSourceCalls["appSource.updatePrepared"]["args"]) => updatePrepared(ctx, args),
    },
    "appSource.applyUpdate": {
      scope: "owner",
      parse: object({
        version: string(COMMIT_SHA),
        ...deviceArgs,
        targets: nullable(array(string({ min: 1, max: 256 }), { max: 64 })),
      }),
      handler: (ctx: OwnerContext, args: AppSourceCalls["appSource.applyUpdate"]["args"]) => applyUpdate(ctx, args),
    },
  },
  views: {
    "appSource.fork": {
      parse: empty(),
      read: (ctx) => forkPush(ctx.db),
    },
    "appSource.update": {
      parse: empty(),
      read: (ctx) => ({ update: updateOf(readUpdateRow(ctx.db)) }),
    },
  },
} satisfies OwnerDomain;
