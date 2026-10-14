import {
  linkSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  processIdentityIsLive,
  readProcessIdentity,
} from "../../kernel/shared/process-identity.js";

export type LockOwner = Readonly<{ pid: number; identity: string | null }>;

export type OwnerLockResult =
  | { readonly acquired: true; readonly owner: LockOwner }
  | { readonly acquired: false; readonly holder: LockOwner | null };

/** A lock older than this with no readable owner is a crashed legacy writer's. */
const UNREADABLE_LOCK_STALE_MS = 5_000;

const readOwner = (file: string): { raw: string; owner: LockOwner | null } | null => {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    return { raw, owner: { pid: Number(trimmed), identity: null } };
  }
  try {
    const parsed = JSON.parse(trimmed) as { pid?: unknown; identity?: unknown };
    if (typeof parsed.pid === "number" && Number.isInteger(parsed.pid) && parsed.pid > 0) {
      return {
        raw,
        owner: {
          pid: parsed.pid,
          identity: typeof parsed.identity === "string" ? parsed.identity : null,
        },
      };
    }
  } catch {
  }
  return { raw, owner: null };
};

const isStale = (file: string, read: { owner: LockOwner | null }): boolean => {
  if (read.owner) return !processIdentityIsLive(read.owner.pid, read.owner.identity);
  try {
    return Date.now() - statSync(file).mtimeMs > UNREADABLE_LOCK_STALE_MS;
  } catch {
    return false;
  }
};

const removeQuietly = (file: string) => {
  try {
    unlinkSync(file);
  } catch {
  }
};

const createWithContent = (lockFile: string, content: string): boolean => {
  const temp = `${lockFile}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(temp, content, { mode: 0o600 });
  try {
    linkSync(temp, lockFile);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    removeQuietly(temp);
  }
};

const takeOverStale = (lockFile: string, staleRaw: string): void => {
  const tombstone = `${lockFile}.${process.pid}.stale`;
  try {
    renameSync(lockFile, tombstone);
  } catch {
    return;
  }
  const moved = readOwner(tombstone);
  if (moved && moved.raw !== staleRaw) {
    try {
      linkSync(tombstone, lockFile);
    } catch {
    }
  }
  removeQuietly(tombstone);
};

export const readLiveLockOwner = (lockFile: string): LockOwner | null => {
  const owner = readOwner(lockFile)?.owner;
  return owner && processIdentityIsLive(owner.pid, owner.identity) ? owner : null;
};

export const tryAcquireOwnerLock = (lockFile: string): OwnerLockResult => {
  const owner: LockOwner = {
    pid: process.pid,
    identity: readProcessIdentity(process.pid),
  };
  const content = JSON.stringify(owner);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (createWithContent(lockFile, content)) return { acquired: true, owner };
    const read = readOwner(lockFile);
    if (!read) continue;
    if (!isStale(lockFile, read)) return { acquired: false, holder: read.owner };
    takeOverStale(lockFile, read.raw);
  }
  return { acquired: false, holder: readOwner(lockFile)?.owner ?? null };
};

export const releaseOwnerLock = (lockFile: string, owner: LockOwner): void => {
  const read = readOwner(lockFile);
  if (read?.owner?.pid !== owner.pid || read.owner.identity !== owner.identity) return;
  removeQuietly(lockFile);
};
