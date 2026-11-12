import fs, { promises as fsp } from "node:fs";
import path from "node:path";

/**
 * Directory links from a scratch copy into the app checkout (its
 * `node_modules`), made and removed the same way on every platform.
 *
 * Windows: a plain directory symlink needs administrator rights or Developer
 * Mode, so an ordinary user gets EPERM. A junction needs neither, takes an
 * absolute local target (any local drive), and is what bun itself uses there.
 * Node reports a junction as a symbolic link (`lstat().isSymbolicLink()`) and
 * `unlink` removes just the junction.
 *
 * Removing: never let anything walk into a link. On Windows `git worktree
 * remove` and Git Bash's `rm -rf` follow a junction and delete the files it
 * points at, which here would be the running app's packages. So every link a
 * scratch copy holds is unlinked with `removeModuleLinks` before anything
 * removes the folder.
 */

export const directoryLinkType = (platform: NodeJS.Platform = process.platform) =>
  platform === "win32" ? ("junction" as const) : ("dir" as const);

/** Linking failed (a drive without links, a policy, antivirus): the caller falls back. */
export class DirectoryLinkError extends Error {
  readonly code: string | undefined;
  constructor(link: string, cause: unknown) {
    const code = (cause as NodeJS.ErrnoException | null)?.code;
    super(
      `Couldn't link ${link} to the app's packages${code ? ` (${code})` : ""}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = "DirectoryLinkError";
    this.code = code;
  }
}

export const linkDirectory = async (target: string, link: string) => {
  try {
    await fsp.symlink(path.resolve(target), link, directoryLinkType());
  } catch (error) {
    throw new DirectoryLinkError(link, error);
  }
};

export const linkDirectorySync = (target: string, link: string) => {
  try {
    fs.symlinkSync(path.resolve(target), link, directoryLinkType());
  } catch (error) {
    throw new DirectoryLinkError(link, error);
  }
};

export const isDirectoryLink = (file: string): boolean =>
  fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink() === true;

/** Removes `file` only when it is a link (never what it points at). */
export const removeDirectoryLink = async (file: string): Promise<boolean> => {
  const stat = await fsp.lstat(file).catch(() => null);
  if (!stat?.isSymbolicLink()) return false;
  try {
    await fsp.unlink(file);
  } catch (error) {
    // A directory link some Windows builds won't unlink: rmdir drops the
    // reparse point itself, never the target's contents.
    if (process.platform !== "win32") throw error;
    await fsp.rmdir(file);
  }
  return true;
};

export const removeDirectoryLinkSync = (file: string): boolean => {
  if (!isDirectoryLink(file)) return false;
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if (process.platform !== "win32") throw error;
    fs.rmdirSync(file);
  }
  return true;
};

/** The `node_modules` links a scratch copy can hold: the root's and each package's. */
export const removeModuleLinks = async (dir: string) => {
  await removeDirectoryLink(path.join(dir, "node_modules"));
  const packages = await fsp
    .readdir(path.join(dir, "packages"), { withFileTypes: true })
    .catch(() => []);
  for (const entry of packages) {
    if (entry.isDirectory()) {
      await removeDirectoryLink(path.join(dir, "packages", entry.name, "node_modules"));
    }
  }
};

/** Removes a scratch copy without ever following one of its links. */
export const removeScratchDir = async (dir: string) => {
  await removeModuleLinks(dir);
  await fsp.rm(dir, { recursive: true, force: true });
};
