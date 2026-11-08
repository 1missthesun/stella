/**
 * The world tree's filesystem work, run as the tool uid (`world-sync.ts`
 * starts this file through setpriv). The tool uid owns the tree and its shell
 * may run concurrently, so a by-path operation there as root could be
 * redirected by a symlink swapped in after a check. Root keeps the network,
 * the world credential, the index and the marker; nothing this process sends
 * back is trusted beyond what the tool uid could already write into the world.
 */
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants as fsConstants, createReadStream } from "node:fs";
import {
  chmod,
  lstat,
  lutimes,
  mkdir,
  open,
  readdir,
  readlink,
  rename,
  rm,
  rmdir,
  symlink,
  utimes,
} from "node:fs/promises";
import path from "node:path";
import {
  isWorldUnsyncedPath,
  WORLD_UNSYNCED_PATHS,
} from "@stella/contracts/cloud-tool-home";

export type WorldListingEntry = {
  path: string;
  kind: "file" | "dir" | "symlink";
  mode: number;
  mtime: number;
  size: number;
  sha256?: string;
  target?: string;
};

export type WorldIndexEntry = Omit<WorldListingEntry, "path">;

export type WorldIndex = Record<string, WorldIndexEntry>;

export type WorldTreeOperation =
  | { op: "delete"; path: string }
  | { op: "dir"; path: string; mode: number }
  | {
      op: "file";
      path: string;
      mode: number;
      mtime: number;
      size: number;
      sha256: string;
    }
  | { op: "symlink"; path: string; target: string; mtime: number }
  | { op: "times"; path: string; mtime: number };

export const WORLD_PATH_LIMIT_BYTES = 1_024;
export const WORLD_FILE_LIMIT_BYTES = 256 * 1024 * 1024;
export const WORLD_ENTRY_LIMIT = 200_000;
const STAGING = ".stella/sync-staging";

const isErrno = (error: unknown, code: string): boolean =>
  error instanceof Error && "code" in error && error.code === code;

export const validateRelativePath = (value: string): string => {
  if (
    !value ||
    Buffer.byteLength(value, "utf8") > WORLD_PATH_LIMIT_BYTES ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`Invalid world path: ${value}`);
  }
  return value;
};

const absoluteWorldPath = (root: string, relative: string): string => {
  const normalized = validateRelativePath(relative);
  const absolute = path.resolve(root, normalized);
  const boundary = `${path.resolve(root)}${path.sep}`;
  if (!absolute.startsWith(boundary)) {
    throw new Error(`World path escapes its root: ${relative}`);
  }
  return absolute;
};

const isNodeModulesDirectory = (relative: string): boolean =>
  relative === "node_modules" || relative.endsWith("/node_modules");

const isDriveCopy = (relative: string): boolean => relative === "drive";

const isSyncStaging = (relative: string): boolean =>
  relative === STAGING || relative.startsWith(`${STAGING}/`);

export const isSyncedPath = (relative: string): boolean =>
  !isSyncStaging(relative) &&
  !isWorldUnsyncedPath(relative) &&
  !isDriveCopy(relative) &&
  !relative.startsWith("drive/");

const indexedNodeModulesDirectories = (index: WorldIndex): Set<string> => {
  const directories = new Set<string>();
  for (const entryPath of Object.keys(index)) {
    const segments = entryPath.split("/");
    for (let at = 0; at < segments.length; at += 1) {
      if (segments[at] === "node_modules") {
        directories.add(segments.slice(0, at + 1).join("/"));
      }
    }
  }
  return directories;
};

const fileSha256 = async (filePath: string): Promise<string> => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
};

export const listWorldTree = async (
  root: string,
  previous: WorldIndex,
): Promise<{ entries: WorldListingEntry[]; index: WorldIndex }> => {
  const entries: WorldListingEntry[] = [];
  const index: WorldIndex = {};
  const durableNodeModules = indexedNodeModulesDirectories(previous);
  const walk = async (
    relative: string,
    insideDurableNodeModules = false,
  ): Promise<void> => {
    const absolute = relative ? absoluteWorldPath(root, relative) : root;
    const names = (await readdir(absolute)).sort((left, right) =>
      left.localeCompare(right),
    );
    for (const name of names) {
      const child = relative ? `${relative}/${name}` : name;
      if (Buffer.byteLength(child, "utf8") > WORLD_PATH_LIMIT_BYTES) {
        throw new Error(`World path exceeds 1024 UTF-8 bytes: ${child}`);
      }
      if (!isSyncedPath(child)) continue;
      const childPath = absoluteWorldPath(root, child);
      const stat = await lstat(childPath);
      const kind = stat.isSymbolicLink()
        ? "symlink"
        : stat.isDirectory()
          ? "dir"
          : stat.isFile()
            ? "file"
            : null;
      if (!kind) {
        throw new Error(
          `World contains an unsupported filesystem entry: ${child}`,
        );
      }
      const durableNodeModulesEntry =
        insideDurableNodeModules || durableNodeModules.has(child);
      if (
        kind === "dir" &&
        isNodeModulesDirectory(child) &&
        !durableNodeModulesEntry
      ) {
        continue;
      }
      const common = {
        mode: stat.mode & 0o7777,
        mtime: Math.trunc(stat.mtimeMs),
        size: kind === "dir" ? 0 : stat.size,
      };
      if (kind === "symlink") {
        const target = await readlink(childPath);
        entries.push({ path: child, ...common, kind, target });
        index[child] = { ...common, kind, target };
      } else if (kind === "dir") {
        entries.push({ path: child, ...common, kind });
        index[child] = { ...common, kind };
        await walk(child, durableNodeModulesEntry);
      } else {
        if (stat.size > WORLD_FILE_LIMIT_BYTES) {
          throw new Error(`World file exceeds 256 MiB: ${child}`);
        }
        const prior = previous[child];
        const sha256 =
          prior?.kind === "file" &&
          prior.sha256 &&
          prior.size === common.size &&
          prior.mtime === common.mtime
            ? prior.sha256
            : await fileSha256(childPath);
        entries.push({ path: child, ...common, kind, sha256 });
        index[child] = { ...common, kind, sha256 };
      }
      if (entries.length > WORLD_ENTRY_LIMIT) {
        throw new Error("World projection exceeds 200000 entries.");
      }
    }
  };
  await walk("");
  return { entries, index };
};

export const indexWorldNodeModules = async (
  root: string,
): Promise<WorldIndex> => {
  const index: WorldIndex = {};
  let visited = 0;
  const walk = async (relative: string): Promise<void> => {
    const absolute = relative ? absoluteWorldPath(root, relative) : root;
    for (const name of await readdir(absolute)) {
      const child = relative ? `${relative}/${name}` : name;
      if (Buffer.byteLength(child, "utf8") > WORLD_PATH_LIMIT_BYTES) {
        throw new Error(`World path exceeds 1024 UTF-8 bytes: ${child}`);
      }
      if (!isSyncedPath(child)) continue;
      const stat = await lstat(absoluteWorldPath(root, child));
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
      visited += 1;
      if (visited > WORLD_ENTRY_LIMIT) {
        throw new Error("World projection exceeds 200000 entries.");
      }
      if (isNodeModulesDirectory(child)) {
        index[child] = {
          kind: "dir",
          mode: stat.mode & 0o7777,
          size: 0,
          mtime: Math.trunc(stat.mtimeMs),
        };
        continue;
      }
      await walk(child);
    }
  };
  await walk("");
  return index;
};

const removeTree = async (target: string): Promise<void> => {
  try {
    await rm(target, { recursive: true, force: true });
  } catch (error) {
    if (!isErrno(error, "EACCES") && !isErrno(error, "EPERM")) throw error;
    const chmodded = spawn("/bin/chmod", ["-R", "u+rwX", "--", target], {
      stdio: "ignore",
    });
    await new Promise<void>((resolve, reject) => {
      chmodded.once("error", reject);
      chmodded.once("close", () => resolve());
    });
    await rm(target, { recursive: true, force: true });
  }
};

const ensureDirectoryPath = async (
  root: string,
  relative: string,
): Promise<void> => {
  let current = root;
  for (const segment of validateRelativePath(relative).split("/")) {
    current = path.join(current, segment);
    try {
      const stat = await lstat(current);
      if (stat.isDirectory()) continue;
      await removeTree(current);
    } catch (error) {
      if (!isErrno(error, "ENOENT")) throw error;
    }
    await mkdir(current, { mode: 0o755 });
  }
};

const ensureParentDirectories = async (root: string, relative: string) => {
  const parent = path.posix.dirname(relative);
  if (parent !== ".") await ensureDirectoryPath(root, parent);
};

const clearSyncedEntries = async (
  root: string,
  relative = "",
): Promise<void> => {
  const absolute = relative ? absoluteWorldPath(root, relative) : root;
  for (const name of await readdir(absolute)) {
    const child = relative ? `${relative}/${name}` : name;
    if (isWorldUnsyncedPath(child) || isDriveCopy(child)) continue;
    const childPath = absoluteWorldPath(root, child);
    if (WORLD_UNSYNCED_PATHS.some((entry) => entry.startsWith(`${child}/`))) {
      const stat = await lstat(childPath);
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        await clearSyncedEntries(root, child);
        continue;
      }
    }
    await removeTree(childPath);
  }
};

/** Bytes in from a stream, consumed exactly as the caller asks for them. */
export class ExactReader {
  private buffered: Buffer[] = [];
  private bufferedBytes = 0;
  private done = false;
  constructor(private readonly source: AsyncIterator<Buffer>) {}

  private async fill(): Promise<boolean> {
    if (this.done) return false;
    const next = await this.source.next();
    if (next.done) {
      this.done = true;
      return false;
    }
    this.buffered.push(next.value);
    this.bufferedBytes += next.value.byteLength;
    return true;
  }

  private take(bytes: number): Buffer {
    const all = Buffer.concat(this.buffered);
    this.buffered = all.byteLength > bytes ? [all.subarray(bytes)] : [];
    this.bufferedBytes = all.byteLength - bytes;
    return all.subarray(0, bytes);
  }

  async line(limit: number): Promise<string | null> {
    for (;;) {
      const all = Buffer.concat(this.buffered);
      this.buffered = all.byteLength ? [all] : [];
      const end = all.indexOf(0x0a);
      if (end >= 0) return this.take(end + 1).subarray(0, end).toString("utf8");
      if (this.bufferedBytes > limit) throw new Error("World operation is too long.");
      if (!(await this.fill())) {
        if (this.bufferedBytes === 0) return null;
        throw new Error("World operation stream ended mid-line.");
      }
    }
  }

  async *exactly(bytes: number): AsyncGenerator<Buffer> {
    let remaining = bytes;
    while (remaining > 0) {
      if (this.bufferedBytes === 0 && !(await this.fill())) {
        throw new Error("World operation stream ended mid-file.");
      }
      const chunk = this.take(Math.min(remaining, this.bufferedBytes));
      remaining -= chunk.byteLength;
      yield chunk;
    }
  }
}

const writeStagedFile = async (
  staged: string,
  entry: Extract<WorldTreeOperation, { op: "file" }>,
  bytes: AsyncIterable<Buffer>,
): Promise<void> => {
  const handle = await open(
    staged,
    fsConstants.O_CREAT |
      fsConstants.O_EXCL |
      fsConstants.O_WRONLY |
      fsConstants.O_NOFOLLOW,
    0o600,
  );
  const hasher = createHash("sha256");
  let size = 0;
  try {
    for await (const chunk of bytes) {
      size += chunk.byteLength;
      hasher.update(chunk);
      let offset = 0;
      while (offset < chunk.byteLength) {
        const written = await handle.write(
          chunk,
          offset,
          chunk.byteLength - offset,
        );
        offset += written.bytesWritten;
      }
    }
    await handle.chmod(entry.mode & 0o7777);
    await handle.utimes(entry.mtime / 1_000, entry.mtime / 1_000);
  } finally {
    await handle.close();
  }
  if (size !== entry.size || hasher.digest("hex") !== entry.sha256) {
    throw new Error(`World blob integrity check failed for ${entry.path}.`);
  }
};

const parseOperation = (line: string): WorldTreeOperation => {
  const value = JSON.parse(line) as WorldTreeOperation;
  validateRelativePath(value.path);
  const integer = (input: unknown) => Number.isSafeInteger(input);
  if (
    (value.op === "dir" && integer(value.mode)) ||
    value.op === "delete" ||
    (value.op === "times" && integer(value.mtime)) ||
    (value.op === "symlink" &&
      typeof value.target === "string" &&
      integer(value.mtime)) ||
    (value.op === "file" &&
      integer(value.mode) &&
      integer(value.mtime) &&
      integer(value.size) &&
      value.size >= 0 &&
      value.size <= WORLD_FILE_LIMIT_BYTES &&
      /^[0-9a-f]{64}$/u.test(value.sha256))
  ) {
    return value;
  }
  throw new Error("World operation is invalid.");
};

/** Apply a pull's operations, read from `input` (one JSON line each, a file's bytes after its line). */
export const applyWorldOperations = async (
  root: string,
  input: AsyncIterable<Buffer>,
): Promise<number> => {
  const reader = new ExactReader(input[Symbol.asyncIterator]());
  const staging = absoluteWorldPath(root, STAGING);
  let applied = 0;
  for (;;) {
    const line = await reader.line(WORLD_PATH_LIMIT_BYTES * 8);
    if (line === null) return applied;
    const operation = parseOperation(line);
    const destination = absoluteWorldPath(root, operation.path);
    if (operation.op === "delete") {
      const stat = await lstat(destination).catch((error: unknown) => {
        if (isErrno(error, "ENOENT")) return null;
        throw error;
      });
      if (stat?.isDirectory()) {
        await rmdir(destination).catch((error: unknown) => {
          if (!isErrno(error, "ENOTEMPTY") && !isErrno(error, "EEXIST")) {
            throw error;
          }
        });
      } else if (stat) {
        await rm(destination, { force: true });
      }
    } else if (operation.op === "dir") {
      await ensureParentDirectories(root, operation.path);
      const stat = await lstat(destination).catch((error: unknown) => {
        if (isErrno(error, "ENOENT")) return null;
        throw error;
      });
      if (stat && !stat.isDirectory()) {
        await removeTree(destination);
      }
      if (!stat || !stat.isDirectory()) {
        await mkdir(destination, { mode: operation.mode & 0o7777 });
      }
      await chmod(destination, operation.mode & 0o7777);
    } else if (operation.op === "file") {
      await ensureDirectoryPath(root, STAGING);
      const staged = path.join(staging, randomUUID());
      try {
        await writeStagedFile(
          staged,
          operation,
          reader.exactly(operation.size),
        );
        await ensureParentDirectories(root, operation.path);
        await removeTree(destination);
        await rename(staged, destination);
      } finally {
        await rm(staged, { force: true });
      }
    } else if (operation.op === "symlink") {
      await ensureParentDirectories(root, operation.path);
      await removeTree(destination);
      await symlink(operation.target, destination);
      await lutimes(destination, operation.mtime / 1_000, operation.mtime / 1_000);
    } else {
      await utimes(destination, operation.mtime / 1_000, operation.mtime / 1_000);
    }
    applied += 1;
  }
};

/** Replace the synced part of the tree with the tar stream on `input`. */
export const extractWorldTree = async (
  root: string,
  input: NodeJS.ReadableStream,
): Promise<void> => {
  await clearSyncedEntries(root);
  const tar = spawn("/usr/bin/tar", ["-x", "-f", "-", "-C", root, "--no-same-owner", "--preserve-permissions"], {
    stdio: ["pipe", "ignore", "inherit"],
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    tar.once("error", reject);
    tar.once("exit", resolve);
  });
  tar.stdin.on("error", () => undefined);
  input.pipe(tar.stdin);
  const exitCode = await exited;
  if (exitCode !== 0) throw new Error(`World tar extraction exited ${exitCode}.`);
};

/** Write each requested file's exact bytes to `output`, refusing any that is no longer that regular file's size. */
export const readWorldFiles = async (
  root: string,
  files: readonly { path: string; size: number }[],
  output: NodeJS.WritableStream,
): Promise<void> => {
  const write = async (chunk: Buffer) => {
    if (!output.write(chunk)) {
      await new Promise<void>((resolve) => output.once("drain", resolve));
    }
  };
  for (const file of files) {
    const handle = await open(
      absoluteWorldPath(root, file.path),
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size !== file.size) {
        throw new Error(`World file changed while it was sent: ${file.path}`);
      }
      let remaining = file.size;
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      while (remaining > 0) {
        const { bytesRead } = await handle.read(
          buffer,
          0,
          Math.min(buffer.byteLength, remaining),
          null,
        );
        if (bytesRead === 0) {
          throw new Error(`World file changed while it was sent: ${file.path}`);
        }
        remaining -= bytesRead;
        await write(Buffer.from(buffer.subarray(0, bytesRead)));
      }
    } finally {
      await handle.close();
    }
  }
};

const readAll = async (input: AsyncIterable<Buffer>): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of input) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
};

const writeJson = async (value: unknown): Promise<void> =>
  await new Promise<void>((resolve, reject) =>
    process.stdout.write(`${JSON.stringify(value)}\n`, (error) =>
      error ? reject(error) : resolve(),
    ),
  );

const main = async (): Promise<void> => {
  const [operation, root] = process.argv.slice(2);
  if (!root || !path.isAbsolute(root)) throw new Error("World root is required.");
  const stdin = process.stdin as AsyncIterable<Buffer>;
  if (operation === "list") {
    const previous = JSON.parse(await readAll(stdin)) as WorldIndex;
    await writeJson(await listWorldTree(root, previous));
  } else if (operation === "node-modules") {
    await writeJson(await indexWorldNodeModules(root));
  } else if (operation === "apply") {
    await writeJson({ applied: await applyWorldOperations(root, stdin) });
  } else if (operation === "extract") {
    await extractWorldTree(root, process.stdin);
    await writeJson({ extracted: true });
  } else if (operation === "read") {
    const files = JSON.parse(await readAll(stdin)) as { path: string; size: number }[];
    await readWorldFiles(root, files, process.stdout);
  } else {
    throw new Error(`Unknown world tree operation: ${operation}`);
  }
};

if (import.meta.main) {
  await main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
