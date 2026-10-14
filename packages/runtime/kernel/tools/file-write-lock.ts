import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

const queues = new Map<string, Promise<void>>();

const errorCode = (error: unknown): string | undefined =>
  error && typeof error === "object" && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;

/** The file a path names on disk, symlinks resolved. */
const canonicalPath = async (filePath: string): Promise<string> => {
  const resolved = path.resolve(filePath);
  try {
    return await fs.realpath(resolved);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  const parent = path.dirname(resolved);
  if (parent === resolved) return resolved;
  return path.join(await canonicalPath(parent), path.basename(resolved));
};

const withLockKey = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
  const prev = queues.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) {
      queues.delete(key);
    }
  });
  return run;
};

/**
 * Run `fn` with this process's exclusive lock on the file `filePath` names.
 * Other processes are not excluded; `replaceFileText` refuses a write over
 * content the caller did not read.
 */
export const withFileWriteLock = async <T>(
  filePath: string,
  fn: () => Promise<T>,
): Promise<T> => withLockKey(await canonicalPath(filePath), fn);

export const withFileWriteLocks = async <T>(
  filePaths: string[],
  fn: () => Promise<T>,
): Promise<T> => {
  const keys = [
    ...new Set(await Promise.all(filePaths.map(canonicalPath))),
  ].sort();
  const run = keys.reduceRight<() => Promise<T>>(
    (inner, key) => () => withLockKey(key, inner),
    fn,
  );
  return run();
};

export class FileChangedError extends Error {
  constructor(filePath: string) {
    super(
      `${filePath} changed on disk after it was read, so nothing was written. Read it again and redo the edit.`,
    );
    this.name = "FileChangedError";
  }
}

/**
 * Replace the text of the file `filePath` names (through symlinks) with
 * `content`, published by an atomic rename so no reader sees half a file.
 * `expected`: the text the caller read (`null`: the file must not exist);
 * anything else on disk refuses the write with `FileChangedError`.
 * `exclusive`: create only, failing if the file exists.
 */
export const replaceFileText = async (
  filePath: string,
  content: string,
  options: { expected?: string | null; exclusive?: boolean } = {},
): Promise<void> => {
  const target = await canonicalPath(filePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const existing = await fs.stat(target).catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  });
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${randomUUID()}.tmp`,
  );
  await fs.writeFile(temporary, content, {
    encoding: "utf-8",
    flag: "wx",
    ...(existing ? { mode: existing.mode & 0o7777 } : {}),
  });
  try {
    if (options.exclusive) {
      await fs.link(temporary, target);
      return;
    }
    if (options.expected !== undefined) {
      const current = await fs
        .readFile(target, "utf-8")
        .catch((error: unknown) => {
          if (errorCode(error) === "ENOENT") return null;
          throw error;
        });
      if (current !== options.expected) throw new FileChangedError(filePath);
    }
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
};
