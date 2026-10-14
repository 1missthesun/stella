import { createHash } from "node:crypto";
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import {
  readWorkspaceFileNoFollow,
  statWorkspaceFileNoFollow,
  unlinkWorkspaceFileNoFollow,
  writeWorkspaceBytesNoFollow,
  type WorkspaceFileIdentity,
} from "@stella/runtime/kernel/tools/workspace-file-boundary.js";
import { isEvidenceThumbnailDrivePath } from "@stella/contracts/chat-evidence-thumbnails";

type DriveSyncEntry = {
  path: string;
  relativePath: string;
  sizeBytes: number;
  contentType: string;
  source: string;
  origin?: string;
  updatedAt: number;
  url: string;
  sha256?: string;
};

type DriveSyncTombstone = {
  path: string;
  relativePath: string;
  deletedAt: number;
};

export type DriveSyncResult = {
  known: Map<string, number>;
  materialized: string[];
  skipped: Array<{ path: string; reason: string }>;
  deleted: string[];
  stale: string[];
  conflicts: Array<{ path: string; driveMoved: boolean }>;
  untracked: string[];
  ledger: DriveLedgerSnapshot;
};

export const emptyDriveSync = (): DriveSyncResult => ({
  known: new Map(),
  materialized: [],
  skipped: [],
  deleted: [],
  stale: [],
  conflicts: [],
  untracked: [],
  ledger: { files: new Map(), syncedAt: 0, checkedThrough: "" },
});

const PATH_LIKE = /[A-Za-z0-9_][A-Za-z0-9_.\-/]*\.[A-Za-z0-9]{1,8}/g;

export const drivePathsInPrompt = (prompt: string): string[] => {
  const found = new Set<string>();
  for (const match of prompt.slice(0, 20_000).matchAll(PATH_LIKE)) {
    const value = match[0].replace(/[.,;:)\]]+$/, "");
    if (value.length > 0 && value.length <= 400) found.add(value);
    if (found.size >= 25) break;
  }
  return [...found];
};

const DOWNLOAD_CONCURRENCY = 6;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const DRIVE_FILE_MAX_BYTES = 128 * 1024 * 1024;
const HYDRATE_BUDGET_MS = 90_000;
const LEDGER_MAX_ENTRIES = 2_000;
const LEDGER_FILE = "drive-sync.json";
const LEDGER_MAX_BYTES = 4 * 1024 * 1024;
const MANIFEST_FILE_MAX = 100;
const TOMBSTONE_MAX = 500;
const PRESENCE_MAX = 500;
const RESYNC_MAX_FILES = 20_000;
const RESYNC_MAX_ENTRIES = 100_000;
const RESYNC_CLOCK_MARGIN_MS = 5 * 60_000;

export type DriveLedgerEntry = {
  updatedAt: number;
  sizeBytes: number;
  sha256: string;
};
type LedgerEntry = DriveLedgerEntry;

export type DriveLedgerSnapshot = {
  files: ReadonlyMap<string, DriveLedgerEntry>;
  syncedAt: number;
  checkedThrough: string;
};
type Ledger = {
  files: Map<string, LedgerEntry>;
  syncedAt: number;
  checkedThrough: string;
};

type WorkspaceOwner = { uid: number; gid: number };

type LedgerRead = {
  ledger: Ledger;
  expectedStat?: WorkspaceFileIdentity;
};

const readLedger = async (
  file: string,
  workspaceRoot: string,
  owner: WorkspaceOwner,
): Promise<LedgerRead> => {
  const ledger: Ledger = { files: new Map(), syncedAt: 0, checkedThrough: "" };
  let read: Awaited<ReturnType<typeof readWorkspaceFileNoFollow>>;
  try {
    read = await readWorkspaceFileNoFollow(
      file,
      workspaceRoot,
      LEDGER_MAX_BYTES,
      { owner },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ledger };
    }
    throw error;
  }
  const expectedStat = read.stat;
  const raw = new TextDecoder().decode(read.bytes);
  read.bytes.fill(0);
  if (!raw) return { ledger, expectedStat };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ledger, expectedStat };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ledger, expectedStat };
  }
  const document = parsed as {
    files?: unknown;
    syncedAt?: unknown;
    checkedThrough?: unknown;
  };
  if (typeof document.syncedAt === "number" && document.syncedAt > 0) {
    ledger.syncedAt = Math.min(Math.floor(document.syncedAt), Date.now());
  }
  if (typeof document.checkedThrough === "string") {
    ledger.checkedThrough = document.checkedThrough.slice(0, 400);
  }
  const files =
    document.files && typeof document.files === "object"
      ? (document.files as Record<string, unknown>)
      : {};
  for (const [key, value] of Object.entries(files).slice(
    0,
    LEDGER_MAX_ENTRIES,
  )) {
    const entry = value as Partial<LedgerEntry> | null;
    if (
      key.length > 0 &&
      key.length <= 1_000 &&
      typeof entry?.updatedAt === "number" &&
      Number.isFinite(entry.updatedAt) &&
      typeof entry.sizeBytes === "number" &&
      Number.isSafeInteger(entry.sizeBytes) &&
      entry.sizeBytes >= 0 &&
      entry.sizeBytes <= DRIVE_FILE_MAX_BYTES &&
      typeof entry.sha256 === "string" &&
      /^[a-f0-9]{64}$/i.test(entry.sha256)
    ) {
      ledger.files.set(key, {
        updatedAt: entry.updatedAt,
        sizeBytes: entry.sizeBytes,
        sha256: entry.sha256.toLowerCase(),
      });
    }
  }
  return { ledger, expectedStat };
};

const writeLedger = async (
  file: string,
  workspaceRoot: string,
  owner: WorkspaceOwner,
  ledger: Ledger,
  expectedStat?: WorkspaceFileIdentity | "replace",
): Promise<void> => {
  const rows = [...ledger.files.entries()]
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, LEDGER_MAX_ENTRIES);
  const bytes = Buffer.from(
    JSON.stringify({
      syncedAt: ledger.syncedAt,
      checkedThrough: ledger.checkedThrough,
      files: Object.fromEntries(rows),
    }),
    "utf8",
  );
  try {
    await writeWorkspaceBytesNoFollow(
      file,
      workspaceRoot,
      bytes,
      expectedStat === "replace"
        ? { owner }
        : expectedStat
          ? { owner, expectedStat }
          : { owner, exclusive: true },
    );
  } finally {
    bytes.fill(0);
  }
};

export const readDriveLedgerFiles = async (options: {
  workspaceRoot: string;
  stateDir: string;
  owner: WorkspaceOwner;
}): Promise<Map<string, DriveLedgerEntry>> => {
  try {
    const { ledger } = await readLedger(
      path.join(path.resolve(options.stateDir), LEDGER_FILE),
      path.resolve(options.workspaceRoot),
      options.owner,
    );
    return ledger.files;
  } catch {
    return new Map();
  }
};

export const recordDriveWriteBack = async (options: {
  workspaceRoot: string;
  stateDir: string;
  owner: WorkspaceOwner;
  saved: ReadonlyMap<string, DriveLedgerEntry>;
  removed: ReadonlySet<string>;
  fallback: DriveLedgerSnapshot;
}): Promise<void> => {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const file = path.join(path.resolve(options.stateDir), LEDGER_FILE);
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let read: LedgerRead | null;
    try {
      read = await readLedger(file, workspaceRoot, options.owner);
    } catch {
      read = null;
    }
    const ledger: Ledger =
      read && read.ledger.files.size > 0
        ? read.ledger
        : {
            files: new Map(options.fallback.files),
            syncedAt: options.fallback.syncedAt,
            checkedThrough: options.fallback.checkedThrough,
          };
    for (const drivePath of options.removed) ledger.files.delete(drivePath);
    for (const [drivePath, entry] of options.saved) {
      ledger.files.set(drivePath, entry);
    }
    try {
      await writeLedger(
        file,
        workspaceRoot,
        options.owner,
        ledger,
        read?.expectedStat ?? "replace",
      );
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
};

const presenceWindow = (ledger: Ledger): string[] => {
  const paths = [...ledger.files.keys()].sort();
  if (paths.length <= PRESENCE_MAX) return paths;
  const next = paths.findIndex((value) => value > ledger.checkedThrough);
  const from = next < 0 ? 0 : next;
  return [...paths.slice(from), ...paths.slice(0, from)].slice(0, PRESENCE_MAX);
};

const relativeToPrefix = (prefix: string, drivePath: string): string =>
  prefix && drivePath.startsWith(prefix)
    ? drivePath.slice(prefix.length)
    : drivePath;

type WorkspaceSnapshot = {
  stat: WorkspaceFileIdentity;
  sha256: string | null;
};

const isMissing = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException).code === "ENOENT";

const inspectWorkspaceFile = async (
  target: string,
  workspaceRoot: string,
  owner: WorkspaceOwner,
  maxHashBytes: number,
): Promise<WorkspaceSnapshot | null> => {
  let metadata: WorkspaceFileIdentity;
  try {
    metadata = await statWorkspaceFileNoFollow(target, workspaceRoot, {
      owner,
    });
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  if (metadata.size > maxHashBytes) {
    return { stat: metadata, sha256: null };
  }
  const read = await readWorkspaceFileNoFollow(
    target,
    workspaceRoot,
    maxHashBytes,
    { owner },
  );
  try {
    return {
      stat: read.stat,
      sha256: createHash("sha256").update(read.bytes).digest("hex"),
    };
  } finally {
    read.bytes.fill(0);
  }
};

const isHydratedCopy = (
  snapshot: WorkspaceSnapshot | null,
  hydrated: LedgerEntry | undefined,
): boolean =>
  Boolean(
    hydrated &&
      snapshot &&
      snapshot.stat.size === hydrated.sizeBytes &&
      snapshot.sha256 === hydrated.sha256,
  );

const resolveTarget = (
  workspaceRoot: string,
  relativePath: string,
): string | null => {
  const absolute = path.resolve(workspaceRoot, relativePath);
  const relative = path.relative(workspaceRoot, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return absolute;
};

/**
 * The workspace copy's sha when it provably holds this row's bytes: the row's
 * own hash, or the ledger's for this exact version. Anything else is
 * compared against downloaded bytes.
 */
const alreadyCurrent = async (
  snapshot: WorkspaceSnapshot | null,
  entry: DriveSyncEntry,
  ledger: Ledger,
): Promise<{ sha256: string } | null> => {
  if (!snapshot || snapshot.stat.size !== entry.sizeBytes) return null;
  const recorded = ledger.files.get(entry.path);
  const expected =
    entry.sha256?.toLowerCase() ??
    (recorded?.updatedAt === entry.updatedAt &&
    recorded.sizeBytes === entry.sizeBytes
      ? recorded.sha256
      : undefined);
  return expected && snapshot.sha256 === expected ? { sha256: expected } : null;
};

const writeContained = async (
  target: string,
  workspaceRoot: string,
  owner: WorkspaceOwner,
  bytes: Buffer,
  expectedStat?: WorkspaceFileIdentity,
): Promise<boolean> => {
  try {
    await writeWorkspaceBytesNoFollow(
      target,
      workspaceRoot,
      bytes,
      expectedStat ? { owner, expectedStat } : { owner, exclusive: true },
    );
    return true;
  } catch {
    return false;
  }
};

const readDownloadBytes = async (
  response: Response,
  expectedSize: number,
): Promise<Buffer | null> => {
  const declared = response.headers.get("content-length");
  if (declared) {
    const size = Number(declared);
    if (!Number.isSafeInteger(size) || size < 0 || size > expectedSize) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
  }
  if (!response.body) return expectedSize === 0 ? Buffer.alloc(0) : null;
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > expectedSize) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(Buffer.from(next.value));
    }
    return Buffer.concat(chunks, total);
  } catch {
    return null;
  } finally {
    for (const chunk of chunks) chunk.fill(0);
    reader.releaseLock();
  }
};

const applyTombstones = async (
  workspaceRoot: string,
  owner: WorkspaceOwner,
  prefix: string,
  deleted: DriveSyncTombstone[],
  ledger: Ledger,
): Promise<{ removed: string[]; stale: string[]; dropped: number }> => {
  const removed: string[] = [];
  const stale: string[] = [];
  let dropped = 0;
  for (const entry of deleted) {
    const drivePath = entry.path.trim();
    if (!drivePath) continue;
    const relativePath =
      entry.relativePath || relativeToPrefix(prefix, drivePath);
    const hydrated = ledger.files.get(drivePath);
    if (!hydrated) continue;
    const target = resolveTarget(workspaceRoot, relativePath);
    if (!target) {
      stale.push(drivePath);
      continue;
    }
    let snapshot: WorkspaceSnapshot | null;
    try {
      snapshot = await inspectWorkspaceFile(
        target,
        workspaceRoot,
        owner,
        hydrated.sizeBytes,
      );
    } catch (error) {
      stale.push(drivePath);
      continue;
    }
    if (!snapshot) {
      if (ledger.files.delete(drivePath)) dropped += 1;
      continue;
    }
    if (!isHydratedCopy(snapshot, hydrated)) {
      stale.push(drivePath);
      continue;
    }
    try {
      await unlinkWorkspaceFileNoFollow(target, workspaceRoot, {
        owner,
        expectedStat: snapshot.stat,
      });
    } catch (error) {
      if (!isMissing(error)) {
        stale.push(drivePath);
        continue;
      }
    }
    if (ledger.files.delete(drivePath)) dropped += 1;
    removed.push(drivePath);
  }
  return { removed, stale, dropped };
};

const readTombstones = (value: unknown): DriveSyncTombstone[] => {
  if (!Array.isArray(value)) return [];
  const tombstones: DriveSyncTombstone[] = [];
  for (const raw of value.slice(0, TOMBSTONE_MAX)) {
    if (typeof raw === "string") {
      tombstones.push({ path: raw, relativePath: "", deletedAt: 0 });
      continue;
    }
    const entry = raw as Partial<DriveSyncTombstone> | null;
    if (typeof entry?.path !== "string") continue;
    tombstones.push({
      path: entry.path,
      relativePath:
        typeof entry.relativePath === "string" ? entry.relativePath : "",
      deletedAt: typeof entry.deletedAt === "number" ? entry.deletedAt : 0,
    });
  }
  return tombstones;
};

/**
 * Both live outcomes carry a ledger entry, because both leave this workspace
 * holding the row's bytes. Recording only the downloads is what let a file
 * that was already on disk — every piece of agent output, which hydration
 * takes at its size the turn after it was written — sit in the drive tree with
 * nothing accounting for it, so the tombstone gate could never remove it when
 * the user deleted the row.
 */
type Hydration =
  | { kind: "current"; path: string; updatedAt: number; ledger: LedgerEntry }
  | {
      kind: "downloaded";
      path: string;
      updatedAt: number;
      ledger: LedgerEntry;
    }
  | { kind: "conflict"; path: string; updatedAt: number; driveMoved: false }
  | { kind: "conflict"; path: string; driveMoved: true }
  | { kind: "skipped"; path: string; reason: string };

const listDriveTree = async (
  workspaceRoot: string,
  stateRelative: string,
): Promise<{ paths: string[]; complete: boolean }> => {
  const stateEntry = stateRelative.split(path.sep)[0];
  const paths: string[] = [];
  const pending: string[] = [""];
  let visited = 0;
  while (pending.length > 0) {
    const relative = pending.pop()!;
    const entries = await readdir(path.join(workspaceRoot, relative), {
      withFileTypes: true,
    }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
      throw error;
    });
    for (const entry of entries) {
      if (!relative && entry.name === stateEntry) continue;
      visited += 1;
      if (visited > RESYNC_MAX_ENTRIES || paths.length >= RESYNC_MAX_FILES) {
        return { paths: paths.sort(), complete: false };
      }
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) pending.push(child);
      else if (entry.isFile()) paths.push(child);
    }
  }
  return { paths: paths.sort(), complete: true };
};

const askDrivePresence = async (
  post: (route: string, body: unknown) => Promise<Response>,
  turnId: string,
  paths: readonly string[],
): Promise<Set<string>> => {
  const absent = new Set<string>();
  for (let index = 0; index < paths.length; index += PRESENCE_MAX) {
    const have = paths.slice(index, index + PRESENCE_MAX);
    const response = await post("/api/cloud/drive/sync", {
      turnId,
      include: [],
      have,
    }).catch(() => null);
    if (!response?.ok) {
      throw new Error(
        `Drive resync failed (${response ? response.status : "no response"}).`,
      );
    }
    const answer = (await response.json()) as { absent?: unknown };
    if (!Array.isArray(answer.absent)) {
      throw new Error("Drive resync returned an invalid manifest.");
    }
    const asked = new Set(have);
    for (const value of answer.absent) {
      if (typeof value === "string" && asked.has(value)) absent.add(value);
    }
  }
  return absent;
};

export const materializeDriveFiles = async (options: {
  turnId: string;
  prompt: string;
  workspaceRoot: string;
  owner: WorkspaceOwner;
  workspaceRestored: boolean;
  stateDir: string;
  post: (route: string, body: unknown) => Promise<Response>;
  onProgress?: (message: string) => void;
}): Promise<DriveSyncResult> => {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const rootMetadata = await lstat(workspaceRoot);
  if (
    rootMetadata.isSymbolicLink() ||
    !rootMetadata.isDirectory() ||
    rootMetadata.uid !== options.owner.uid ||
    rootMetadata.gid !== options.owner.gid
  ) {
    throw new Error(
      "Drive hydration requires an existing workspace root owned by the fixed tool identity.",
    );
  }
  const stateDir = path.resolve(options.stateDir);
  const stateRelative = path.relative(workspaceRoot, stateDir);
  if (
    !stateRelative ||
    stateRelative.startsWith("..") ||
    path.isAbsolute(stateRelative)
  ) {
    throw new Error(
      "Drive hydration state must live below the workspace root.",
    );
  }

  const ledgerPath = path.join(stateDir, LEDGER_FILE);
  const ledgerRead = await readLedger(ledgerPath, workspaceRoot, options.owner);
  const { ledger } = ledgerRead;

  const asked = presenceWindow(ledger);
  const syncStartedAt = Date.now();
  const response = await options
    .post("/api/cloud/drive/sync", {
      turnId: options.turnId,
      include: drivePathsInPrompt(options.prompt),
      ...(ledger.syncedAt > 0 ? { since: ledger.syncedAt } : {}),
      ...(asked.length > 0 ? { have: asked } : {}),
    })
    .catch(() => null);
  if (!response?.ok) {
    throw new Error(
      `Drive sync failed (${response ? response.status : "no response"}).`,
    );
  }
  const manifest = (await response.json()) as {
    prefix?: string;
    files?: DriveSyncEntry[];
    skipped?: Array<{
      path: string;
      reason: string;
      updatedAt?: number;
      origin?: string;
    }>;
    deleted?: unknown;
    absent?: unknown;
    syncedAt?: unknown;
    deletedComplete?: unknown;
  };
  if (
    typeof manifest.prefix !== "string" ||
    !Array.isArray(manifest.files) ||
    !Array.isArray(manifest.skipped) ||
    !Array.isArray(manifest.deleted) ||
    !Array.isArray(manifest.absent) ||
    typeof manifest.syncedAt !== "number" ||
    !Number.isFinite(manifest.syncedAt) ||
    typeof manifest.deletedComplete !== "boolean"
  ) {
    throw new Error("Drive sync returned an invalid manifest.");
  }
  let resyncAbsent: Set<string> | null = null;
  let resyncComplete = false;
  if (manifest.deletedComplete === false) {
    if (options.workspaceRestored === false) {
      resyncComplete = true;
    } else {
      const tree = await listDriveTree(workspaceRoot, stateRelative);
      if (tree.paths.length > 0) {
        options.onProgress?.(
          `Checking ${tree.paths.length} drive ${tree.paths.length === 1 ? "file" : "files"} in this workspace against the drive.`,
        );
      }
      const prefixed = tree.paths.map(
        (relative) => `${manifest.prefix}${relative}`,
      );
      resyncAbsent = await askDrivePresence(
        options.post,
        options.turnId,
        prefixed,
      );
      resyncComplete = tree.complete;
    }
  }
  const visible = (entry: { path?: unknown } | null | undefined) =>
    !(entry && typeof entry.path === "string" && isEvidenceThumbnailDrivePath(entry.path));
  manifest.files = manifest.files.filter(visible);
  manifest.skipped = manifest.skipped.filter(visible);
  const entries = manifest.files.slice(0, MANIFEST_FILE_MAX);
  const result: DriveSyncResult = {
    known: new Map(),
    materialized: [],
    skipped: [],
    deleted: [],
    stale: [],
    conflicts: [],
    untracked: [],
    ledger: emptyDriveSync().ledger,
  };

  const prefix = manifest.prefix ?? "";
  const tombstones = readTombstones(manifest.deleted);
  const absent = Array.isArray(manifest.absent)
    ? manifest.absent
        .slice(0, PRESENCE_MAX)
        .filter((value): value is string => typeof value === "string")
    : [];
  const named = new Set(tombstones.map((entry) => entry.path));
  const listedLive = new Set(
    [...entries, ...manifest.skipped].flatMap((entry) =>
      entry && typeof entry.path === "string" ? [entry.path] : [],
    ),
  );
  const untracked = new Set<string>();
  for (const drivePath of [...absent, ...(resyncAbsent ?? [])]) {
    if (prefix && !drivePath.startsWith(prefix)) continue;
    if (!ledger.files.has(drivePath)) {
      if (resyncAbsent?.has(drivePath) && !listedLive.has(drivePath)) {
        untracked.add(drivePath);
      }
      continue;
    }
    if (named.has(drivePath)) continue;
    named.add(drivePath);
    tombstones.push({ path: drivePath, relativePath: "", deletedAt: 0 });
  }
  result.untracked = [...untracked];
  let ledgerDropped = 0;
  if (tombstones.length > 0) {
    const applied = await applyTombstones(
      workspaceRoot,
      options.owner,
      prefix,
      tombstones,
      ledger,
    );
    result.deleted = applied.removed;
    const live = new Set([
      ...entries.flatMap((entry) =>
        entry && typeof entry.path === "string" ? [entry.path] : [],
      ),
      ...(manifest.skipped ?? []).flatMap((entry) =>
        entry && typeof entry.path === "string" ? [entry.path] : [],
      ),
    ]);
    result.stale = applied.stale.filter((drivePath) => !live.has(drivePath));
    ledgerDropped = applied.dropped;
  }
  for (const entry of manifest.skipped ?? []) {
    if (
      !entry ||
      typeof entry.path !== "string" ||
      typeof entry.reason !== "string"
    ) {
      continue;
    }
    const version = entry.updatedAt;
    const hydrated = ledger.files.get(entry.path);
    const target =
      typeof version === "number" && hydrated?.updatedAt === version
        ? resolveTarget(workspaceRoot, relativeToPrefix(prefix, entry.path))
        : null;
    let snapshot: WorkspaceSnapshot | null = null;
    if (target && hydrated) {
      try {
        snapshot = await inspectWorkspaceFile(
          target,
          workspaceRoot,
          options.owner,
          hydrated.sizeBytes,
        );
      } catch {
        snapshot = null;
      }
    }
    if (typeof version !== "number" || !target || !snapshot) {
      result.skipped.push({ path: entry.path, reason: entry.reason });
      continue;
    }
    result.known.set(entry.path, version);
    if (!isHydratedCopy(snapshot, hydrated)) {
      result.conflicts.push({ path: entry.path, driveMoved: false });
      continue;
    }
    result.materialized.push(entry.path);
  }

  const deadline = Date.now() + HYDRATE_BUDGET_MS;
  const hydrate = async (entry: DriveSyncEntry): Promise<Hydration> => {
    if (
      !entry ||
      typeof entry.path !== "string" ||
      typeof entry.relativePath !== "string" ||
      typeof entry.url !== "string" ||
      !Number.isSafeInteger(entry.sizeBytes) ||
      entry.sizeBytes < 0 ||
      entry.sizeBytes > DRIVE_FILE_MAX_BYTES ||
      (entry.sha256 !== undefined && !/^[a-f0-9]{64}$/i.test(entry.sha256))
    ) {
      return {
        kind: "skipped",
        path:
          entry && typeof entry.path === "string"
            ? entry.path
            : "(invalid drive entry)",
        reason: "the drive returned invalid file metadata",
      };
    }
    const target = resolveTarget(workspaceRoot, entry.relativePath);
    if (!target) {
      return {
        kind: "skipped",
        path: entry.path,
        reason: "it does not resolve to a location inside the workspace",
      };
    }
    const hydrated = ledger.files.get(entry.path);
    let present: WorkspaceSnapshot | null;
    try {
      present = await inspectWorkspaceFile(
        target,
        workspaceRoot,
        options.owner,
        Math.max(entry.sizeBytes, hydrated?.sizeBytes ?? 0),
      );
    } catch {
      return {
        kind: "skipped",
        path: entry.path,
        reason: "its workspace path is not a safe owned file location",
      };
    }
    const current = await alreadyCurrent(present, entry, ledger);
    if (current) {
      return {
        kind: "current",
        path: entry.path,
        updatedAt: entry.updatedAt,
        ledger: {
          updatedAt: entry.updatedAt,
          sizeBytes: entry.sizeBytes,
          sha256: current.sha256,
        },
      };
    }
    const ours = isHydratedCopy(present, hydrated);
    if (present && !ours && hydrated?.updatedAt === entry.updatedAt) {
      return {
        kind: "conflict",
        path: entry.path,
        updatedAt: entry.updatedAt,
        driveMoved: false,
      };
    }
    if (Date.now() > deadline) {
      return {
        kind: "skipped",
        path: entry.path,
        reason: "loading it into the workspace ran out of time",
      };
    }
    const download = await fetch(entry.url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    }).catch(() => null);
    const bytes = download?.ok
      ? await readDownloadBytes(download, entry.sizeBytes)
      : null;
    const downloadedSha256 = bytes
      ? createHash("sha256").update(bytes).digest("hex")
      : null;
    if (
      bytes &&
      (bytes.byteLength !== entry.sizeBytes ||
        (entry.sha256 && downloadedSha256 !== entry.sha256.toLowerCase()))
    ) {
      bytes.fill(0);
      return {
        kind: "skipped",
        path: entry.path,
        reason: "the downloaded drive bytes did not match their manifest",
      };
    }
    if (bytes && present && !ours) {
      if (
        present.stat.size !== bytes.byteLength ||
        present.sha256 !== downloadedSha256
      ) {
        bytes.fill(0);
        return { kind: "conflict", path: entry.path, driveMoved: true };
      }
      bytes.fill(0);
      return {
        kind: "current",
        path: entry.path,
        updatedAt: entry.updatedAt,
        ledger: {
          updatedAt: entry.updatedAt,
          sizeBytes: bytes.byteLength,
          sha256: downloadedSha256!,
        },
      };
    }
    if (
      !bytes ||
      !(await writeContained(
        target,
        workspaceRoot,
        options.owner,
        bytes,
        present?.stat,
      ))
    ) {
      bytes?.fill(0);
      return {
        kind: "skipped",
        path: entry.path,
        reason: "loading it into the workspace failed",
      };
    }
    bytes.fill(0);
    return {
      kind: "downloaded",
      path: entry.path,
      updatedAt: entry.updatedAt,
      ledger: {
        updatedAt: entry.updatedAt,
        sizeBytes: entry.sizeBytes,
        sha256: downloadedSha256!,
      },
    };
  };

  const outcomes: Array<Hydration | undefined> = new Array(entries.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const entry = entries[index];
      if (!entry) return;
      outcomes[index] = await hydrate(entry);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(DOWNLOAD_CONCURRENCY, entries.length) },
      worker,
    ),
  );

  let downloaded = 0;
  let reused = 0;
  let ledgerAdded = 0;
  for (const [index, outcome] of outcomes.entries()) {
    if (!outcome) continue;
    if (outcome.kind === "skipped") {
      result.skipped.push({ path: outcome.path, reason: outcome.reason });
      continue;
    }
    if (outcome.kind === "conflict") {
      result.conflicts.push({
        path: outcome.path,
        driveMoved: outcome.driveMoved,
      });
      if (outcome.driveMoved) continue;
      result.known.set(outcome.path, outcome.updatedAt);
      continue;
    }
    result.known.set(outcome.path, outcome.updatedAt);
    result.materialized.push(outcome.path);
    const held = ledger.files.get(outcome.path);
    if (
      held?.updatedAt !== outcome.ledger.updatedAt ||
      held.sizeBytes !== outcome.ledger.sizeBytes ||
      held.sha256 !== outcome.ledger.sha256
    ) {
      ledger.files.set(outcome.path, outcome.ledger);
      ledgerAdded += 1;
    }
    if (outcome.kind === "downloaded") downloaded += 1;
    else reused += 1;
  }

  const answered =
    typeof manifest.syncedAt === "number" &&
    Number.isFinite(manifest.syncedAt) &&
    manifest.syncedAt > 0
      ? Math.floor(manifest.syncedAt)
      : ledger.syncedAt;
  const resolved = resyncComplete
    ? Math.max(answered, syncStartedAt - RESYNC_CLOCK_MARGIN_MS)
    : answered;
  const moved = resolved !== ledger.syncedAt;
  ledger.syncedAt = resolved;
  const walked = asked.at(-1) ?? ledger.checkedThrough;
  const rotated = walked !== ledger.checkedThrough;
  ledger.checkedThrough = walked;
  if (ledgerAdded > 0 || ledgerDropped > 0 || moved || rotated) {
    await writeLedger(
      ledgerPath,
      workspaceRoot,
      options.owner,
      ledger,
      ledgerRead.expectedStat,
    );
  }
  const notes: string[] = [];
  if (downloaded > 0) {
    notes.push(
      `Loaded ${downloaded} drive ${downloaded === 1 ? "file" : "files"} into the workspace${
        reused > 0 ? ` (${reused} already there)` : ""
      }.`,
    );
  }
  if (result.deleted.length > 0) {
    const gone = result.deleted.length;
    notes.push(
      `Removed ${gone} ${gone === 1 ? "file" : "files"} deleted from the drive.`,
    );
  }
  if (result.stale.length > 0) {
    const kept = result.stale.length;
    notes.push(
      `Kept ${kept} changed ${kept === 1 ? "copy" : "copies"} of ${kept === 1 ? "a file" : "files"} deleted from the drive.`,
    );
  }
  if (result.untracked.length > 0) {
    const kept = result.untracked.length;
    notes.push(
      `Kept ${kept} workspace ${kept === 1 ? "file" : "files"} the drive does not have.`,
    );
  }
  if (result.conflicts.length > 0) {
    const kept = result.conflicts.length;
    notes.push(
      `Kept ${kept} workspace ${kept === 1 ? "file" : "files"} with unsaved changes rather than reloading ${kept === 1 ? "it" : "them"} from the drive.`,
    );
  }
  if (notes.length > 0) options.onProgress?.(notes.join(" "));
  result.ledger = {
    files: new Map(ledger.files),
    syncedAt: ledger.syncedAt,
    checkedThrough: ledger.checkedThrough,
  };
  return result;
};
