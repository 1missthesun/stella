import { spawn, spawnSync } from "child_process";
import fs from "fs";
import { promises as fsPromises } from "fs";
import path from "path";

const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const IS_WINDOWS = process.platform === "win32";

const unrestrictedPaths = new Set<string>();

const noteUnrestricted = (targetPath: string, error: unknown) => {
  if (unrestrictedPaths.has(targetPath)) return;
  unrestrictedPaths.add(targetPath);
  const code = (error as NodeJS.ErrnoException | null)?.code ?? String(error);
  console.warn(`[private-fs] ${targetPath} is not restricted to this user (${code}).`);
};

const restrictMode = async (targetPath: string, mode: number) => {
  if (IS_WINDOWS) return;
  await fsPromises.chmod(targetPath, mode).catch((error) => noteUnrestricted(targetPath, error));
};

const restrictModeSync = (targetPath: string, mode: number) => {
  if (IS_WINDOWS) return;
  try {
    fs.chmodSync(targetPath, mode);
  } catch (error) {
    noteUnrestricted(targetPath, error);
  }
};

// One inheritable (OI)(CI) grant per directory covers every file written in
// it later; each icacls spawn is Defender-scanned, so a directory is not
// granted twice in a process once icacls has succeeded.
const grantedWindowsDirs = new Set<string>();

const windowsDirGrant = (dirPath: string) => {
  const username = process.env.USERNAME;
  if (!IS_WINDOWS || !username) return null;
  const resolved = path.resolve(dirPath);
  if (grantedWindowsDirs.has(resolved)) return null;
  return { resolved, args: [resolved, "/grant", `${username}:(OI)(CI)F`] };
};

const noteWindowsGrant = (resolved: string, exitCode: number | null) => {
  if (exitCode === 0) {
    grantedWindowsDirs.add(resolved);
  } else {
    noteUnrestricted(resolved, `icacls exit ${exitCode}`);
  }
};

const grantWindowsDir = async (dirPath: string) => {
  const grant = windowsDirGrant(dirPath);
  if (!grant) return;
  const exitCode = await new Promise<number | null>((resolve) => {
    const child = spawn("icacls", grant.args, { stdio: "ignore", windowsHide: true });
    child.on("close", (code) => resolve(code));
    child.on("error", () => resolve(null));
  });
  noteWindowsGrant(grant.resolved, exitCode);
};

const grantWindowsDirSync = (dirPath: string) => {
  const grant = windowsDirGrant(dirPath);
  if (!grant) return;
  const result = spawnSync("icacls", grant.args, { stdio: "ignore", windowsHide: true });
  noteWindowsGrant(grant.resolved, result.error ? null : result.status);
};

export const ensurePrivateDir = async (dirPath: string) => {
  await fsPromises.mkdir(dirPath, { recursive: true, mode: PRIVATE_DIR_MODE });
  await restrictMode(dirPath, PRIVATE_DIR_MODE);
  await grantWindowsDir(dirPath);
};

export const ensurePrivateDirSync = (dirPath: string) => {
  fs.mkdirSync(dirPath, { recursive: true, mode: PRIVATE_DIR_MODE });
  restrictModeSync(dirPath, PRIVATE_DIR_MODE);
  grantWindowsDirSync(dirPath);
};

const tempPathFor = (filePath: string) =>
  `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;

/** Windows refuses a rename over a file another process has open (antivirus, an indexer, a reader) for a moment. */
const RENAME_RETRY_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);
const RENAME_ATTEMPTS = IS_WINDOWS ? 10 : 1;
const RENAME_RETRY_MS = 25;

const sleepSync = (ms: number) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const syncDirSync = (dirPath: string) => {
  // A directory can't be opened for fsync on Windows; there the rename is
  // durable once MoveFileEx returns.
  if (IS_WINDOWS) return;
  try {
    const fd = fs.openSync(dirPath, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Best effort: some filesystems refuse a directory fsync.
  }
};

const renameReplacingSync = (from: string, to: string) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code ?? "";
      if (attempt >= RENAME_ATTEMPTS || !RENAME_RETRY_CODES.has(code)) throw error;
      sleepSync(RENAME_RETRY_MS * attempt);
    }
  }
};

const renameReplacing = async (from: string, to: string) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await fsPromises.rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code ?? "";
      if (attempt >= RENAME_ATTEMPTS || !RENAME_RETRY_CODES.has(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_MS * attempt));
    }
  }
};

/**
 * Writes the whole file or nothing: the content goes to a temp file beside
 * it, is flushed to disk, and replaces the file by rename. Writing in place
 * left torn files (a crash or power loss mid-write keeps part of the new
 * content and the old file's tail), which readers then took for empty.
 */
export const writePrivateFile = async (
  filePath: string,
  content: string,
) => {
  const dir = path.dirname(filePath);
  await ensurePrivateDir(dir);
  const tempPath = tempPathFor(filePath);
  try {
    const handle = await fsPromises.open(tempPath, "w", PRIVATE_FILE_MODE);
    try {
      await handle.writeFile(content, "utf-8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await restrictMode(tempPath, PRIVATE_FILE_MODE);
    await renameReplacing(tempPath, filePath);
  } catch (error) {
    await fsPromises.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
  syncDirSync(dir);
};

export const writePrivateFileSync = (
  filePath: string,
  content: string,
) => {
  const dir = path.dirname(filePath);
  ensurePrivateDirSync(dir);
  const tempPath = tempPathFor(filePath);
  try {
    const fd = fs.openSync(tempPath, "w", PRIVATE_FILE_MODE);
    try {
      fs.writeFileSync(fd, content, "utf-8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    restrictModeSync(tempPath, PRIVATE_FILE_MODE);
    renameReplacingSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // The temp file is gone already or can't be removed; the error below matters more.
    }
    throw error;
  }
  syncDirSync(dir);
};

/**
 * The text of the first complete JSON value at the start of `raw`, or null.
 * A file torn by an in-place write is the new content followed by the old
 * file's tail, so this is the newest whole state it holds.
 */
export const leadingJsonValue = (raw: string): string | null => {
  let index = 0;
  while (index < raw.length && /\s/.test(raw[index]!)) index += 1;
  const opener = raw[index];
  if (opener !== "{" && opener !== "[") return null;
  let depth = 0;
  let inString = false;
  for (let at = index; at < raw.length; at += 1) {
    const char = raw[at];
    if (inString) {
      if (char === "\\") at += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) return raw.slice(index, at + 1);
    }
  }
  return null;
};

export type PrivateJsonRead =
  | { kind: "missing" }
  | { kind: "ok"; value: unknown }
  | {
      kind: "damaged";
      /** What could be saved, already written back in place of the damaged file. */
      recovered: unknown;
      /** Where the damaged file was copied, beside it, before anything else touched it. */
      damagedCopy: string | null;
      error: string;
    };

/** Damaged versions already reported in this process (path, size, mtime), so a hot reader doesn't copy one on every read. */
const reportedDamage = new Map<string, Extract<PrivateJsonRead, { kind: "damaged" }>>();

/**
 * Reads a JSON state file without ever silently treating a damaged one as
 * empty: the damaged file is copied beside it (`<name>.damaged-<time>`),
 * the newest whole state at its start is recovered and written back, and
 * the damage is logged. The caller decides what else to say (the local
 * scheduler tells the user and Stella which schedules came back).
 */
export const readPrivateJsonFileSync = (filePath: string, label = path.basename(filePath)): PrivateJsonRead => {
  let raw: string;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") return { kind: "missing" };
    throw error;
  }
  try {
    return { kind: "ok", value: JSON.parse(raw) };
  } catch (error) {
    const key = `${filePath}\u0000${stat.size}\u0000${stat.mtimeMs}`;
    const known = reportedDamage.get(key);
    if (known) return known;
    const message = error instanceof Error ? error.message : String(error);
    let damagedCopy: string | null = `${filePath}.damaged-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    try {
      writePrivateFileSync(damagedCopy, raw);
    } catch (copyError) {
      console.error(`[private-fs] Could not keep a copy of damaged ${label}:`, copyError);
      damagedCopy = null;
    }
    let recovered: unknown;
    const prefix = leadingJsonValue(raw);
    if (prefix) {
      try {
        recovered = JSON.parse(prefix);
      } catch {
        recovered = undefined;
      }
    }
    if (recovered !== undefined) {
      try {
        writePrivateFileSync(filePath, JSON.stringify(recovered, null, 2));
      } catch (writeError) {
        console.error(`[private-fs] Could not write back the recovered ${label}:`, writeError);
      }
    }
    console.error(
      `[private-fs] ${label} was damaged (${message}; ${raw.length} bytes). ` +
        (recovered !== undefined
          ? `Recovered the ${prefix!.length}-byte state at its start and wrote it back`
          : "Nothing in it could be recovered") +
        (damagedCopy ? `; the damaged file is kept at ${damagedCopy}.` : "."),
    );
    const result = { kind: "damaged" as const, recovered, damagedCopy, error: message };
    reportedDamage.set(key, result);
    return result;
  }
};

/**
 * The JSON in a state file, or undefined when it is missing. A damaged file
 * gives what could be recovered from it (copied aside and logged by
 * `readPrivateJsonFileSync`), never a silent empty.
 */
export const readPrivateJsonValueSync = (filePath: string, label?: string): unknown => {
  const read = readPrivateJsonFileSync(filePath, label);
  return read.kind === "ok" ? read.value : read.kind === "damaged" ? read.recovered : undefined;
};
