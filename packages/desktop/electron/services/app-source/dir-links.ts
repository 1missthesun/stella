import fs, { promises as fsp } from "node:fs";
import path from "node:path";
import { git, gitRaw } from "./git.js";

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

const removeFile = async (file: string) => {
  try {
    await fsp.unlink(file);
  } catch (error) {
    // A read-only file (git and bun write some) needs its attribute cleared on Windows.
    if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    await fsp.chmod(file, 0o666);
    await fsp.unlink(file);
  }
};

const removeWalk = async (entry: string): Promise<void> => {
  const stat = await fsp.lstat(entry).catch(() => null);
  if (!stat) return;
  if (stat.isSymbolicLink()) {
    await removeDirectoryLink(entry).catch(() => removeFile(entry));
    return;
  }
  if (!stat.isDirectory()) {
    await removeFile(entry);
    return;
  }
  for (const name of await fsp.readdir(entry)) await removeWalk(path.join(entry, name));
  await fsp.rmdir(entry);
};

/**
 * Removes a folder and everything in it, never following a link out of it.
 * On Windows it walks the tree itself: `git worktree remove` follows
 * junctions (and gives up on a draft's own bun install, ~2,500 of them),
 * and Electron's fs treats a `.asar` file (Electron's default_app.asar in a
 * draft's packages) as a folder and fails on it unless asar is off.
 */
export const removeTree = async (dir: string) => {
  if (process.platform !== "win32") {
    await fsp.rm(dir, { recursive: true, force: true });
    return;
  }
  const electron = process as { noAsar?: boolean };
  const noAsar = electron.noAsar;
  electron.noAsar = true;
  try {
    await removeWalk(dir);
  } finally {
    electron.noAsar = noAsar;
  }
};

/** Removes a scratch copy without ever following one of its links. */
export const removeScratchDir = async (dir: string) => {
  await removeModuleLinks(dir);
  await removeTree(dir);
};

/**
 * Removes a git worktree (a draft, a scratch merge) of the checkout at `cwd`:
 * its links first, then the folder. On Windows the folder is removed by
 * `removeTree`, never by `git worktree remove`, which follows junctions and
 * can't delete a draft's own bun install; git then forgets it (`prune`).
 * `keepChanges` refuses, like `git worktree remove` without --force, when the
 * worktree has uncommitted or untracked files.
 */
export const removeWorktree = async (cwd: string, dir: string, options: { keepChanges?: boolean } = {}) => {
  if (options.keepChanges && fs.existsSync(dir)) {
    // A linked node_modules shows as untracked (a link isn't the ignored folder).
    const changes = (await git(dir, ["status", "--porcelain"]))
      .split("\n")
      .filter((line) => line.trim() && !/^\?\? (.*\/)?node_modules\/?$/.test(line));
    if (changes.length > 0) {
      throw new Error(`${dir} has changes that aren't committed:\n${changes.slice(0, 20).join("\n")}`);
    }
  }
  await removeModuleLinks(dir);
  if (process.platform === "win32") {
    await removeTree(dir);
  } else {
    await gitRaw(cwd, ["worktree", "remove", "--force", dir]);
    await fsp.rm(dir, { recursive: true, force: true });
  }
  await gitRaw(cwd, ["worktree", "prune"]);
};
