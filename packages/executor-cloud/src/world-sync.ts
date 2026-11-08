import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  CLOUD_TOOL_HOME,
  worldSyncMarkerPath,
} from "@stella/contracts/cloud-tool-home";
import { isolateToolProcessLaunch } from "@stella/runtime/kernel/tools/process-isolation.js";
import { CLOUD_TOOL_PROCESS_IDENTITY } from "./cloud-process-isolation.js";
import {
  ExactReader,
  isSyncedPath,
  validateRelativePath,
  WORLD_ENTRY_LIMIT,
  WORLD_FILE_LIMIT_BYTES,
  type WorldIndex,
  type WorldIndexEntry,
  type WorldListingEntry,
  type WorldTreeOperation,
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

type WorldTreeProcess = {
  stdin: NodeJS.WritableStream;
  stdout: AsyncIterable<Buffer>;
  exited: Promise<void>;
  kill: () => void;
};

/**
 * Every filesystem operation on the world tree runs in `world-tree.ts` as the
 * tool uid that owns the tree. Root keeps only the network, the credential,
 * the index and the marker, all outside the tree.
 */
const startWorldTree = (operation: string, root: string): WorldTreeProcess => {
  const launch = isolateToolProcessLaunch({
    command: process.execPath,
    commandArgs: [WORLD_TREE_SCRIPT, operation, root],
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
  child.stdin.on("error", () => undefined);
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-2_000);
  });
  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `World ${operation} failed (${code ?? signal}): ${stderr.trim()}`,
          ),
        );
      }
    });
  });
  exited.catch(() => undefined);
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    exited,
    kill: () => {
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
};

const writeToWorldTree = async (
  tree: WorldTreeProcess,
  chunk: string | Uint8Array,
): Promise<void> => {
  if (tree.stdin.write(chunk)) return;
  await Promise.race([
    new Promise<void>((resolve) => tree.stdin.once("drain", resolve)),
    tree.exited.then(() => {
      throw new Error("The world tree process stopped reading.");
    }),
  ]);
};

const worldTreeJson = async (
  operation: string,
  root: string,
  input = "",
): Promise<unknown> => {
  const tree = startWorldTree(operation, root);
  try {
    tree.stdin.end(input);
    const chunks: Buffer[] = [];
    for await (const chunk of tree.stdout) chunks.push(chunk);
    await tree.exited;
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    tree.kill();
  }
};

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
  const value = await worldTreeJson("list", root, JSON.stringify(previous));
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
  tree: WorldTreeProcess,
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
    await writeToWorldTree(tree, chunk);
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
    const tree = startWorldTree("apply", root);
    try {
      for (const operation of operations) {
        await writeToWorldTree(tree, `${JSON.stringify(operation)}\n`);
        if (operation.op === "file") {
          await fetchBlobInto(tree, access, operation);
        }
      }
      tree.stdin.end();
      for await (const _ of tree.stdout);
      await tree.exited;
    } finally {
      tree.kill();
    }
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
  const tree = startWorldTree("extract", root);
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      await writeToWorldTree(tree, chunk);
    }
    tree.stdin.end();
    for await (const _ of tree.stdout);
    await tree.exited;
  } finally {
    tree.kill();
  }
  return { manifestId, revision };
};

const restoredNodeModules = async (root: string): Promise<WorldIndex> =>
  parseIndexEntries(await worldTreeJson("node-modules", root));

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

export const worldBaseEstablished = async (root: string): Promise<boolean> =>
  (await readIndex(statePaths(root).index))?.complete === true;

export const pullWorldProjection = async (args: {
  root: string;
  access: WorldSyncAccess;
}): Promise<WorldMarker> =>
  await withWorldSyncLock(args.root, async () => {
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
  });

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
      const tree = startWorldTree("read", root);
      try {
        tree.stdin.end(
          JSON.stringify(blobs.map(({ path: entryPath, size }) => ({ path: entryPath, size }))),
        );
        const reader = new ExactReader(tree.stdout[Symbol.asyncIterator]());
        try {
          for (const blob of blobs) {
            if (framed) yield blobFrameHeader(blob);
            yield* reader.exactly(blob.size);
          }
        } catch (error) {
          await tree.exited;
          throw error;
        }
        await tree.exited;
      } finally {
        tree.kill();
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
  await withWorldSyncLock(args.root, async () => {
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
  });
