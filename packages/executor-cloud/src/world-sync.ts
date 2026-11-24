import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  CLOUD_TOOL_HOME,
  worldSyncMarkerPath,
} from "@stella/contracts/cloud-tool-home";
import { isolateToolProcessLaunch } from "@stella/runtime/kernel/tools/process-isolation.js";
import type { WorldSyncTiming } from "./attached-tool-protocol.js";
import { CLOUD_TOOL_PROCESS_IDENTITY } from "./cloud-process-isolation.js";
import {
  encodeWorldTreeFrame,
  isSyncedPath,
  validateRelativePath,
  WORLD_ENTRY_LIMIT,
  WORLD_FILE_LIMIT_BYTES,
  type WorldIndex,
  type WorldIndexEntry,
  type WorldListingEntry,
  type WorldTreeFrameType,
  WorldTreeFrames,
  type WorldTreeOperation,
  type WorldTreeRequest,
  WORLD_TREE_DATA_FRAME_BYTES,
} from "./world-tree.js";

export type {
  WorldIndex,
  WorldIndexEntry,
  WorldListingEntry,
} from "./world-tree.js";

export type WorldSyncAccess = Readonly<{
  origin: string;
  name: string;
  capability: string;
}>;

export type WorldMarker = Readonly<{
  manifestId: string;
  revision: number;
}>;

type StoredWorldIndex = { complete: boolean; entries: WorldIndex };

type WorldChanges = {
  revision: number;
  entries: WorldListingEntry[];
  deleted: string[];
  resync: boolean;
};

export const WORLD_BLOB_FRAME_HEADER_BYTES = 40;
export const WORLD_BLOB_BATCH_MAX_BYTES = 32 * 1024 * 1024;
export const WORLD_BLOB_BATCH_MAX_COUNT = 512;
export const WORLD_BLOB_UPLOAD_CONCURRENCY = 3;

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const statePaths = (root: string) => ({
  marker: worldSyncMarkerPath(root),
  index: path.join(path.dirname(root), ".stella-world-index.json"),
  lock: path.join(path.dirname(root), ".world-materialize.lock"),
});

const isErrno = (error: unknown, code: string): boolean =>
  error instanceof Error && "code" in error && error.code === code;

const WORLD_TREE_SCRIPT = fileURLToPath(
  new URL("./world-tree.ts", import.meta.url),
);

type WorldTreeHelper = {
  readonly root: string;
  readonly child: ChildProcessWithoutNullStreams;
  readonly frames: WorldTreeFrames;
  readonly exited: Promise<void>;
  stderr: string;
  dead: boolean;
};

const idleHelpers = new Map<string, WorldTreeHelper[]>();

/**
 * Every filesystem operation on the world tree runs in `world-tree.ts` as the
 * tool uid that owns the tree. Root keeps only the network, the credential,
 * the index and the marker, all outside the tree. A helper serves one request
 * at a time and stays for the rest of this process (a turn), so a sync costs
 * no process start; parallel uploads get one each.
 */
const startWorldTree = (root: string): WorldTreeHelper => {
  const launch = isolateToolProcessLaunch({
    command: process.execPath,
    commandArgs: [WORLD_TREE_SCRIPT, "serve", root],
    ...(typeof process.getuid === "function" && process.getuid() === 0
      ? { identity: { ...CLOUD_TOOL_PROCESS_IDENTITY, home: CLOUD_TOOL_HOME } }
      : {}),
  });
  const child = spawn(launch.command, launch.args, {
    cwd: "/",
    env: {
      PATH: "/usr/bin:/bin",
      HOME: CLOUD_TOOL_HOME,
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  syncTiming.helperStarts = (syncTiming.helperStarts ?? 0) + 1;
  child.stdin.on("error", () => undefined);
  const helper: WorldTreeHelper = {
    root,
    child,
    frames: new WorldTreeFrames(
      (child.stdout as AsyncIterable<Buffer>)[Symbol.asyncIterator](),
    ),
    exited: new Promise<void>((resolve) => {
      child.once("error", () => resolve());
      child.once("close", () => resolve());
    }),
    stderr: "",
    dead: false,
  };
  child.stderr.on("data", (chunk: Buffer) => {
    helper.stderr = `${helper.stderr}${chunk.toString()}`.slice(-2_000);
  });
  void helper.exited.then(() => {
    helper.dead = true;
  });
  return helper;
};

type Referable = { ref?: () => unknown; unref?: () => unknown };

/** An idle helper never keeps this process alive; a busy one does. */
const holdProcessOpen = (helper: WorldTreeHelper, hold: boolean): void => {
  for (const handle of [
    helper.child,
    helper.child.stdin,
    helper.child.stdout,
    helper.child.stderr,
  ] as Referable[]) {
    if (hold) handle.ref?.();
    else handle.unref?.();
  }
};

const acquireWorldTree = (root: string): WorldTreeHelper => {
  const idle = idleHelpers.get(root) ?? [];
  let helper = idle.pop();
  while (helper?.dead) helper = idle.pop();
  helper ??= startWorldTree(root);
  holdProcessOpen(helper, true);
  return helper;
};

const releaseWorldTree = (helper: WorldTreeHelper, finished: boolean) => {
  if (finished && !helper.dead) {
    holdProcessOpen(helper, false);
    idleHelpers.set(helper.root, [...(idleHelpers.get(helper.root) ?? []), helper]);
  } else if (helper.child.exitCode === null) {
    // Abandoned midway: its stream state is unknown, so it never serves again.
    helper.dead = true;
    helper.child.kill("SIGKILL");
  }
};

const withWorldTree = async <T>(
  root: string,
  run: (helper: WorldTreeHelper) => Promise<T>,
): Promise<T> => {
  const helper = acquireWorldTree(root);
  let finished = false;
  try {
    const value = await run(helper);
    finished = true;
    return value;
  } finally {
    releaseWorldTree(helper, finished);
  }
};

const sendToWorldTree = async (
  helper: WorldTreeHelper,
  type: WorldTreeFrameType,
  payload?: Uint8Array,
): Promise<void> => {
  for (const part of encodeWorldTreeFrame(type, payload)) {
    if (helper.dead) {
      throw new Error(`The world tree helper stopped. ${helper.stderr.trim()}`);
    }
    if (helper.child.stdin.write(part)) continue;
    await Promise.race([
      new Promise<void>((resolve) => helper.child.stdin.once("drain", resolve)),
      helper.exited.then(() => {
        throw new Error(`The world tree helper stopped reading. ${helper.stderr.trim()}`);
      }),
    ]);
  }
};

/** Data to the helper in frames of at most WORLD_TREE_DATA_FRAME_BYTES. */
const sendDataToWorldTree = async (
  helper: WorldTreeHelper,
  data: string | Uint8Array,
): Promise<void> => {
  const bytes = typeof data === "string" ? Buffer.from(data) : data;
  for (let at = 0; at < bytes.byteLength; at += WORLD_TREE_DATA_FRAME_BYTES) {
    await sendToWorldTree(
      helper,
      "D",
      bytes.subarray(at, at + WORLD_TREE_DATA_FRAME_BYTES),
    );
  }
};

/** The helper's frames for the current request, ending after its result. */
async function* worldTreeReplies(
  helper: WorldTreeHelper,
): AsyncGenerator<Buffer, unknown> {
  for (;;) {
    const frame = await helper.frames.next();
    if (!frame) {
      await helper.exited;
      throw new Error(`The world tree helper stopped. ${helper.stderr.trim()}`);
    }
    if (frame.type === "D") {
      yield frame.payload;
    } else if (frame.type === "R") {
      return JSON.parse(frame.payload.toString("utf8")) as unknown;
    } else if (frame.type === "E") {
      throw new Error(frame.payload.toString("utf8"));
    } else {
      throw new Error("The world tree helper answered out of turn.");
    }
  }
}

const worldTreeResult = async (helper: WorldTreeHelper): Promise<unknown> => {
  const replies = worldTreeReplies(helper);
  for (;;) {
    const next = await replies.next();
    if (next.done) return next.value;
    throw new Error("The world tree helper sent data for a request without any.");
  }
};

const worldTreeJson = async (
  root: string,
  request: WorldTreeRequest,
): Promise<unknown> =>
  await withWorldTree(root, async (helper) => {
    await sendToWorldTree(helper, "Q", Buffer.from(JSON.stringify(request)));
    return await worldTreeResult(helper);
  });

const parseIndexEntry = (raw: unknown): WorldIndexEntry => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("World index is invalid.");
  }
  const row = raw as Record<string, unknown>;
  if (
    (row.kind !== "file" && row.kind !== "dir" && row.kind !== "symlink") ||
    !Number.isSafeInteger(row.mode) ||
    Number(row.mode) < 0 ||
    !Number.isSafeInteger(row.size) ||
    Number(row.size) < 0 ||
    !Number.isSafeInteger(row.mtime) ||
    (row.sha256 !== undefined &&
      (typeof row.sha256 !== "string" ||
        !/^[0-9a-f]{64}$/u.test(row.sha256))) ||
    (row.target !== undefined && typeof row.target !== "string")
  ) {
    throw new Error("World index is invalid.");
  }
  return {
    kind: row.kind,
    mode: Number(row.mode),
    size: Number(row.size),
    mtime: Number(row.mtime),
    ...(typeof row.sha256 === "string" ? { sha256: row.sha256 } : {}),
    ...(typeof row.target === "string" ? { target: row.target } : {}),
  };
};

const parseIndexEntries = (value: unknown): WorldIndex => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("World index is invalid.");
  }
  const entries: WorldIndex = {};
  for (const [entryPath, raw] of Object.entries(value)) {
    entries[validateRelativePath(entryPath)] = parseIndexEntry(raw);
  }
  return entries;
};

const readIndex = async (
  indexPath: string,
): Promise<StoredWorldIndex | null> => {
  let text: string;
  try {
    text = await readFile(indexPath, "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT")) return null;
    throw asError(error);
  }
  const value = JSON.parse(text) as unknown;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof (value as { complete?: unknown }).complete !== "boolean"
  ) {
    throw new Error("World index is invalid.");
  }
  const stored = value as { complete: boolean; entries?: unknown };
  return {
    complete: stored.complete,
    entries: parseIndexEntries(stored.entries),
  };
};

const writeJsonAtomic = async (
  filePath: string,
  value: unknown,
): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
};

const writeIndex = async (root: string, entries: WorldIndex): Promise<void> =>
  await writeJsonAtomic(statePaths(root).index, {
    complete: true,
    entries,
  } satisfies StoredWorldIndex);

const sameContent = (
  base: WorldIndexEntry | undefined,
  entry: WorldIndexEntry,
): boolean =>
  base !== undefined &&
  base.kind === entry.kind &&
  base.mode === entry.mode &&
  (entry.kind === "dir" ||
    (entry.kind === "file" &&
      base.sha256 === entry.sha256 &&
      base.size === entry.size) ||
    (entry.kind === "symlink" && base.target === entry.target));

export const readWorldMarker = async (root: string): Promise<WorldMarker> => {
  const value = JSON.parse(
    await readFile(statePaths(root).marker, "utf8"),
  ) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("World marker is invalid.");
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.manifestId !== "string" ||
    !row.manifestId ||
    !Number.isSafeInteger(row.revision) ||
    Number(row.revision) < 0
  ) {
    throw new Error("World marker is invalid.");
  }
  return { manifestId: row.manifestId, revision: Number(row.revision) };
};

const writeWorldMarker = async (
  root: string,
  marker: WorldMarker,
): Promise<void> => await writeJsonAtomic(statePaths(root).marker, marker);

export const withWorldSyncLock = async <T>(
  root: string,
  operation: () => Promise<T>,
): Promise<T> => {
  const lockPath = statePaths(root).lock;
  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  const lock = spawn(
    "/bin/bash",
    [
      "-c",
      '( set -eu; exec 9>"$1"; /usr/bin/flock --exclusive 9; printf R; cat >/dev/null )',
      "world-sync-lock",
      lockPath,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  await new Promise<void>((resolve, reject) => {
    lock.once("error", (error) => reject(error));
    lock.once("exit", (code) => {
      if (code !== null)
        reject(new Error(`World lock exited with code ${code}.`));
    });
    lock.stdout.once("data", (chunk: Buffer) => {
      if (chunk.includes(0x52)) resolve();
      else reject(new Error("World lock did not report readiness."));
    });
  });
  try {
    return await operation();
  } finally {
    lock.stdin.end();
    if (lock.exitCode === null) {
      await new Promise<void>((resolve) => lock.once("exit", () => resolve()));
    }
  }
};

const routeUrl = (access: WorldSyncAccess, route: string): string => {
  const url = new URL(
    `${access.origin.replace(/\/+$/u, "")}/internal/worlds/${access.name}/${route}`,
  );
  return url.toString();
};

const headers = (access: WorldSyncAccess): Headers =>
  new Headers({ authorization: `Bearer ${access.capability}` });

const parseRevision = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error("World response revision is invalid.");
  }
  return Number(value);
};

const parseEntry = (value: unknown): WorldListingEntry => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("World change entry is invalid.");
  }
  const row = value as Record<string, unknown>;
  const entryPath =
    typeof row.path === "string" ? validateRelativePath(row.path) : "";
  if (
    !entryPath ||
    (row.kind !== "file" && row.kind !== "dir" && row.kind !== "symlink") ||
    !Number.isSafeInteger(row.mode) ||
    !Number.isSafeInteger(row.mtime) ||
    !Number.isSafeInteger(row.size) ||
    Number(row.size) < 0 ||
    Number(row.size) > WORLD_FILE_LIMIT_BYTES ||
    (row.kind === "file" &&
      (typeof row.sha256 !== "string" ||
        !/^[0-9a-f]{64}$/u.test(row.sha256))) ||
    (row.kind === "symlink" && typeof row.target !== "string")
  ) {
    throw new Error("World change entry is invalid.");
  }
  return {
    path: entryPath,
    kind: row.kind,
    mode: Number(row.mode),
    mtime: Number(row.mtime),
    size: Number(row.size),
    ...(typeof row.sha256 === "string" ? { sha256: row.sha256 } : {}),
    ...(typeof row.target === "string" ? { target: row.target } : {}),
  };
};

const getChanges = async (
  access: WorldSyncAccess,
  since: number,
): Promise<WorldChanges> => {
  const response = await fetch(routeUrl(access, `changes?since=${since}`), {
    headers: headers(access),
  });
  const value = (await response.json().catch(() => null)) as unknown;
  if (
    !response.ok ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(`World pull failed with HTTP ${response.status}.`);
  }
  const row = value as Record<string, unknown>;
  if (
    !Array.isArray(row.entries) ||
    !Array.isArray(row.deleted) ||
    typeof row.resync !== "boolean"
  ) {
    throw new Error("World changes response is invalid.");
  }
  const entries = row.entries.map(parseEntry);
  const deleted = row.deleted.map((entry) => {
    if (typeof entry !== "string")
      throw new Error("World deletion is invalid.");
    return validateRelativePath(entry);
  });
  return {
    revision: parseRevision(row.revision),
    entries,
    deleted,
    resync: row.resync,
  };
};

export const listWorldProjection = async (
  root: string,
  previous: WorldIndex = {},
): Promise<{ entries: WorldListingEntry[]; index: WorldIndex }> => {
  const value = await worldTreeJson(root, { op: "list", previous });
  const rows = (value as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(rows) || rows.length > WORLD_ENTRY_LIMIT) {
    throw new Error("World listing is invalid.");
  }
  const entries: WorldListingEntry[] = [];
  const index: WorldIndex = {};
  for (const row of rows) {
    const entry = parseEntry(row);
    if (!isSyncedPath(entry.path) || index[entry.path]) {
      throw new Error("World listing is invalid.");
    }
    const { path: entryPath, ...indexed } = entry;
    entries.push(entry);
    index[entryPath] = indexed;
  }
  return { entries, index };
};

const fetchBlobInto = async (
  tree: WorldTreeHelper,
  access: WorldSyncAccess,
  entry: Extract<WorldTreeOperation, { op: "file" }>,
): Promise<void> => {
  const response = await fetch(routeUrl(access, `blob/${entry.sha256}`), {
    headers: headers(access),
  });
  if (!response.ok || !response.body) {
    throw new Error(`World blob fetch failed with HTTP ${response.status}.`);
  }
  let size = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > entry.size) {
      throw new Error(`World blob size mismatch for ${entry.path}.`);
    }
    await sendDataToWorldTree(tree, chunk);
  }
  if (size !== entry.size) {
    throw new Error(`World blob size mismatch for ${entry.path}.`);
  }
};

const applyChanges = async (
  root: string,
  access: WorldSyncAccess,
  received: WorldChanges,
  base: WorldIndex,
): Promise<void> => {
  const operations: WorldTreeOperation[] = [];
  const next: WorldIndex = { ...base };
  for (const deleted of received.deleted
    .filter((entry) => isSyncedPath(entry))
    .sort((left, right) => right.length - left.length)) {
    if (!next[deleted]) continue;
    delete next[deleted];
    operations.push({ op: "delete", path: deleted });
  }
  const entries = received.entries.filter(
    ({ path: entryPath, ...entry }) =>
      isSyncedPath(entryPath) && !sameContent(base[entryPath], entry),
  );
  const directories = entries
    .filter((entry) => entry.kind === "dir")
    .sort((left, right) => left.path.length - right.path.length);
  for (const entry of directories) {
    operations.push({ op: "dir", path: entry.path, mode: entry.mode & 0o7777 });
  }
  for (const entry of entries) {
    if (entry.kind === "dir") continue;
    if (entry.kind === "file" && entry.sha256) {
      operations.push({
        op: "file",
        path: entry.path,
        mode: entry.mode & 0o7777,
        mtime: entry.mtime,
        size: entry.size,
        sha256: entry.sha256,
      });
    } else if (entry.kind === "symlink" && entry.target !== undefined) {
      operations.push({
        op: "symlink",
        path: entry.path,
        target: entry.target,
        mtime: entry.mtime,
      });
    } else {
      throw new Error(`World change is incomplete: ${entry.path}`);
    }
  }
  for (const entry of [...directories].reverse()) {
    operations.push({ op: "times", path: entry.path, mtime: entry.mtime });
  }
  if (operations.length > 0) {
    await withWorldTree(root, async (tree) => {
      await sendToWorldTree(tree, "Q", Buffer.from(JSON.stringify({ op: "apply" })));
      for (const operation of operations) {
        await sendDataToWorldTree(tree, `${JSON.stringify(operation)}\n`);
        if (operation.op === "file") {
          await fetchBlobInto(tree, access, operation);
        }
      }
      await sendToWorldTree(tree, "Z");
      await worldTreeResult(tree);
    });
  }
  for (const { path: entryPath, ...entry } of entries) {
    next[entryPath] = entry;
  }
  for (const key of Object.keys(base)) delete base[key];
  Object.assign(base, next);
};

const extractWorldExport = async (
  root: string,
  access: WorldSyncAccess,
): Promise<WorldMarker> => {
  const response = await fetch(routeUrl(access, "export"), {
    headers: headers(access),
  });
  if (!response.ok || !response.body) {
    throw new Error(`World export failed with HTTP ${response.status}.`);
  }
  const manifestId = response.headers.get("x-stella-world-manifest") ?? "";
  const revision = parseRevision(
    Number(response.headers.get("x-stella-world-revision")),
  );
  if (!manifestId) throw new Error("World export manifest is invalid.");
  await withWorldTree(root, async (tree) => {
    await sendToWorldTree(tree, "Q", Buffer.from(JSON.stringify({ op: "extract" })));
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      await sendDataToWorldTree(tree, chunk);
    }
    await sendToWorldTree(tree, "Z");
    await worldTreeResult(tree);
  });
  return { manifestId, revision };
};

const restoredNodeModules = async (root: string): Promise<WorldIndex> =>
  parseIndexEntries(await worldTreeJson(root, { op: "node-modules" }));

const baseFromExport = async (
  root: string,
  seed: WorldIndex,
): Promise<WorldIndex> => {
  const base = (await listWorldProjection(root, seed)).index;
  await writeIndex(root, base);
  return base;
};

/**
 * The base this disk syncs against. A cold materialization leaves only a seed
 * (or nothing): the disk then holds exactly the export, and nothing has run
 * on it yet, so the disk itself becomes the base before the first revision
 * is applied.
 */
const establishedBase = async (root: string): Promise<WorldIndex> => {
  const stored = await readIndex(statePaths(root).index);
  if (stored?.complete) return stored.entries;
  return await baseFromExport(
    root,
    stored?.entries ?? (await restoredNodeModules(root)),
  );
};

export type { WorldSyncTiming } from "./attached-tool-protocol.js";

const syncTiming: WorldSyncTiming = {
  pulls: 0,
  pullMs: 0,
  pullMaxMs: 0,
  pushes: 0,
  pushMs: 0,
  pushMaxMs: 0,
  helperStarts: 0,
};

/** The pulls and pushes since the last call, then starts counting afresh. */
export const takeWorldSyncTiming = (): WorldSyncTiming => {
  const taken = { ...syncTiming };
  for (const key of Object.keys(syncTiming) as (keyof WorldSyncTiming)[]) {
    syncTiming[key] = 0;
  }
  return taken;
};

const timed = async <T>(
  kind: "pull" | "push",
  run: () => Promise<T>,
): Promise<T> => {
  const started = performance.now();
  try {
    return await run();
  } finally {
    const ms = Math.round(performance.now() - started);
    if (kind === "pull") {
      syncTiming.pulls += 1;
      syncTiming.pullMs += ms;
      syncTiming.pullMaxMs = Math.max(syncTiming.pullMaxMs, ms);
    } else {
      syncTiming.pushes += 1;
      syncTiming.pushMs += ms;
      syncTiming.pushMaxMs = Math.max(syncTiming.pushMaxMs, ms);
    }
  }
};

export const worldBaseEstablished = async (root: string): Promise<boolean> =>
  (await readIndex(statePaths(root).index))?.complete === true;

export const pullWorldProjection = async (args: {
  root: string;
  access: WorldSyncAccess;
}): Promise<WorldMarker> =>
  await timed("pull", () => withWorldSyncLock(args.root, async () => {
    let marker = await readWorldMarker(args.root);
    const base = await establishedBase(args.root);
    for (;;) {
      const changes = await getChanges(args.access, marker.revision);
      if (changes.resync) {
        marker = await extractWorldExport(args.root, args.access);
        await baseFromExport(args.root, await restoredNodeModules(args.root));
        await writeWorldMarker(args.root, marker);
        return marker;
      }
      if (changes.revision <= marker.revision) return marker;
      await applyChanges(args.root, args.access, changes, base);
      marker = { ...marker, revision: changes.revision };
      await writeIndex(args.root, base);
      await writeWorldMarker(args.root, marker);
    }
  }));

const postChanges = async (
  access: WorldSyncAccess,
  changes: Readonly<{ entries: WorldListingEntry[]; deleted: string[] }>,
): Promise<{
  missingBlobs: string[];
  revision: number;
  previousRevision: number;
}> => {
  const requestHeaders = headers(access);
  requestHeaders.set("content-type", "application/json");
  const response = await fetch(routeUrl(access, "push"), {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(changes),
  });
  const value = (await response.json().catch(() => null)) as {
    missingBlobs?: unknown;
    revision?: unknown;
    previousRevision?: unknown;
  } | null;
  if (
    !response.ok ||
    !value ||
    !Array.isArray(value.missingBlobs) ||
    value.missingBlobs.some(
      (sha) => typeof sha !== "string" || !/^[0-9a-f]{64}$/u.test(sha),
    )
  ) {
    throw new Error(`World push failed with HTTP ${response.status}.`);
  }
  return {
    missingBlobs: value.missingBlobs,
    revision: parseRevision(value.revision),
    previousRevision: parseRevision(value.previousRevision),
  };
};

export type WorldBlobUpload = Readonly<{
  sha256: string;
  path: string;
  size: number;
}>;

export type WorldBlobUploadBatch =
  | Readonly<{
      kind: "batch";
      blobs: readonly WorldBlobUpload[];
      bytes: number;
    }>
  | Readonly<{ kind: "oversize"; blob: WorldBlobUpload }>;

export const batchWorldBlobUploads = (
  blobs: readonly WorldBlobUpload[],
): WorldBlobUploadBatch[] => {
  const batches: WorldBlobUploadBatch[] = [];
  let current: WorldBlobUpload[] = [];
  let currentBytes = 0;
  const flush = (): void => {
    if (current.length === 0) return;
    batches.push({ kind: "batch", blobs: current, bytes: currentBytes });
    current = [];
    currentBytes = 0;
  };
  for (const blob of blobs) {
    if (blob.size > WORLD_BLOB_BATCH_MAX_BYTES) {
      flush();
      batches.push({ kind: "oversize", blob });
      continue;
    }
    if (
      current.length >= WORLD_BLOB_BATCH_MAX_COUNT ||
      currentBytes + blob.size > WORLD_BLOB_BATCH_MAX_BYTES
    ) {
      flush();
    }
    current.push(blob);
    currentBytes += blob.size;
  }
  flush();
  return batches;
};

const hexBytes = (sha256: string): Uint8Array => {
  if (!/^[0-9a-f]{64}$/u.test(sha256)) {
    throw new Error("World blob sha256 is invalid.");
  }
  return Uint8Array.from({ length: 32 }, (_, index) =>
    Number.parseInt(sha256.slice(index * 2, index * 2 + 2), 16),
  );
};

const blobFrameHeader = (blob: WorldBlobUpload): Uint8Array => {
  const header = new Uint8Array(WORLD_BLOB_FRAME_HEADER_BYTES);
  header.set(hexBytes(blob.sha256));
  new DataView(header.buffer).setBigUint64(32, BigInt(blob.size), false);
  return header;
};

const parseBlobOutcomes = async (
  response: Response,
  expected: readonly WorldBlobUpload[],
): Promise<void> => {
  const value = (await response.json().catch(() => null)) as {
    outcomes?: unknown;
  } | null;
  const outcomes = value?.outcomes;
  if (!response.ok || !Array.isArray(outcomes)) {
    throw new Error(`World blob upload failed with HTTP ${response.status}.`);
  }
  const accepted = new Set<string>();
  for (const raw of outcomes) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("World blob upload returned malformed outcomes.");
    }
    const sha256 = "sha256" in raw ? raw.sha256 : undefined;
    const acceptedValue = "accepted" in raw ? raw.accepted : undefined;
    if (
      typeof sha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(sha256) ||
      acceptedValue !== true
    ) {
      throw new Error("World blob upload rejected a blob.");
    }
    accepted.add(sha256);
  }
  if (
    accepted.size !== expected.length ||
    expected.some((blob) => !accepted.has(blob.sha256))
  ) {
    throw new Error("World blob upload did not accept every requested blob.");
  }
};

/**
 * The upload body for `blobs`, read from the tree by the tool uid: a refusal
 * or a short read there fails the stream, and so the upload.
 */
const blobBody = (
  root: string,
  blobs: readonly WorldBlobUpload[],
  framed: boolean,
): Readable =>
  Readable.from(
    (async function* () {
      const tree = acquireWorldTree(root);
      let finished = false;
      try {
        await sendToWorldTree(
          tree,
          "Q",
          Buffer.from(
            JSON.stringify({
              op: "read",
              files: blobs.map(({ path: entryPath, size }) => ({ path: entryPath, size })),
            } satisfies WorldTreeRequest),
          ),
        );
        const replies = worldTreeReplies(tree);
        let pending: Buffer = Buffer.alloc(0);
        const take = async (bytes: number): Promise<Buffer> => {
          while (pending.byteLength < bytes) {
            const next = await replies.next();
            if (next.done) throw new Error("World file changed while it was sent.");
            pending = pending.byteLength ? Buffer.concat([pending, next.value]) : next.value;
          }
          const taken = pending.subarray(0, bytes);
          pending = pending.subarray(bytes);
          return taken;
        };
        for (const blob of blobs) {
          if (framed) yield blobFrameHeader(blob);
          let remaining = blob.size;
          while (remaining > 0) {
            const chunk = await take(Math.min(remaining, WORLD_TREE_DATA_FRAME_BYTES));
            remaining -= chunk.byteLength;
            yield chunk;
          }
        }
        if (pending.byteLength > 0 || !(await replies.next()).done) {
          throw new Error("The world tree helper sent more than was asked for.");
        }
        finished = true;
      } finally {
        releaseWorldTree(tree, finished);
      }
    })(),
  );

const uploadBlobBatch = async (
  root: string,
  access: WorldSyncAccess,
  batch: WorldBlobUploadBatch,
): Promise<void> => {
  const requestHeaders = headers(access);
  const blobs = batch.kind === "batch" ? batch.blobs : [batch.blob];
  if (batch.kind === "batch") {
    requestHeaders.set("content-type", "application/vnd.stella.world-blobs");
    requestHeaders.set(
      "content-length",
      String(batch.bytes + batch.blobs.length * WORLD_BLOB_FRAME_HEADER_BYTES),
    );
  } else {
    requestHeaders.set("content-type", "application/octet-stream");
    requestHeaders.set("x-stella-world-blob-sha256", batch.blob.sha256);
    requestHeaders.set("content-length", String(batch.blob.size));
  }
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers: requestHeaders,
    body: blobBody(root, blobs, batch.kind === "batch") as never,
    duplex: "half",
  };
  const response = await fetch(routeUrl(access, "push"), init);
  await parseBlobOutcomes(response, blobs);
};

const uploadWithRetry = async (
  root: string,
  access: WorldSyncAccess,
  batch: WorldBlobUploadBatch,
): Promise<void> => {
  try {
    await uploadBlobBatch(root, access, batch);
  } catch {
    await uploadBlobBatch(root, access, batch);
  }
};

const uploadBatches = async (
  root: string,
  access: WorldSyncAccess,
  batches: readonly WorldBlobUploadBatch[],
): Promise<void> => {
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      const batch = batches[index];
      if (!batch) return;
      await uploadWithRetry(root, access, batch);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(WORLD_BLOB_UPLOAD_CONCURRENCY, batches.length) },
      () => worker(),
    ),
  );
};

/**
 * Send the world what this disk changed since its base, and nothing else:
 * every file created or changed here, every path the base had that is gone.
 * A file this disk merely has an older copy of is never sent, and a file it
 * never saw is never deleted. Per path, the later push wins. Refuses on a
 * disk whose base a pull has not established yet.
 */
export const pushWorldProjection = async (args: {
  root: string;
  access: WorldSyncAccess;
}): Promise<WorldMarker> =>
  await timed("push", () => withWorldSyncLock(args.root, async () => {
    const marker = await readWorldMarker(args.root);
    const stored = await readIndex(statePaths(args.root).index);
    if (!stored?.complete) {
      throw new Error(
        "This workspace has not synced with the world yet, so nothing was sent to it.",
      );
    }
    const base = stored.entries;
    const projection = await listWorldProjection(args.root, base);
    const entries = projection.entries.filter(
      ({ path: entryPath, ...entry }) => !sameContent(base[entryPath], entry),
    );
    const deleted = Object.keys(base).filter(
      (entryPath) => !projection.index[entryPath] && isSyncedPath(entryPath),
    );
    if (entries.length === 0 && deleted.length === 0) {
      await writeIndex(args.root, projection.index);
      return marker;
    }
    const files = new Map(
      entries
        .filter(
          (
            entry,
          ): entry is WorldListingEntry & { kind: "file"; sha256: string } =>
            entry.kind === "file" && Boolean(entry.sha256),
        )
        .map((entry) => [
          entry.sha256,
          { sha256: entry.sha256, path: entry.path, size: entry.size },
        ]),
    );
    let pushed = await postChanges(args.access, { entries, deleted });
    while (pushed.missingBlobs.length > 0) {
      const uploads = pushed.missingBlobs.map((sha256) => {
        const upload = files.get(sha256);
        if (!upload)
          throw new Error(`World requested an unknown blob ${sha256}.`);
        return upload;
      });
      await uploadBatches(args.root, args.access, batchWorldBlobUploads(uploads));
      pushed = await postChanges(args.access, { entries, deleted });
    }
    const nextMarker =
      pushed.previousRevision === marker.revision
        ? { ...marker, revision: pushed.revision }
        : marker;
    await writeIndex(args.root, projection.index);
    await writeWorldMarker(args.root, nextMarker);
    return nextMarker;
  }));
