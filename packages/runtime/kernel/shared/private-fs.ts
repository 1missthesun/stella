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

export const writePrivateFile = async (
  filePath: string,
  content: string,
) => {
  await ensurePrivateDir(path.dirname(filePath));
  await fsPromises.writeFile(filePath, content, {
    encoding: "utf-8",
    mode: PRIVATE_FILE_MODE,
  });
  await restrictMode(filePath, PRIVATE_FILE_MODE);
};

export const writePrivateFileSync = (
  filePath: string,
  content: string,
) => {
  ensurePrivateDirSync(path.dirname(filePath));
  fs.writeFileSync(filePath, content, {
    encoding: "utf-8",
    mode: PRIVATE_FILE_MODE,
  });
  restrictModeSync(filePath, PRIVATE_FILE_MODE);
};
