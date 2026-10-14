import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatCliBridgeEndpoint } from "../kernel/connectors/cli-bridge-endpoint.js";

const RUNTIME_SUBDIR = "runtime";
const LOGS_SUBDIR = "logs";

type RuntimePathOptions = {
  platform?: NodeJS.Platform;
  runtimeStateDir?: string;
  homeDir?: string;
  runtimeIpcDir?: string;
};

const resolveRuntimeStateDir = (options?: RuntimePathOptions): string => {
  if (options?.runtimeStateDir) return path.resolve(options.runtimeStateDir);
  if (options?.homeDir) {
    return path.join(path.resolve(options.homeDir), ".stella");
  }
  const configured = process.env.STELLA_RUNTIME_STATE_DIR?.trim();
  return configured
    ? path.resolve(configured)
    : path.join(os.homedir(), ".stella");
};

export const resolveLogDir = (
  stellaAppDir: string,
  options?: RuntimePathOptions,
): string =>
  path.join(
    resolveRuntimeStateDir(options),
    LOGS_SUBDIR,
    hashStellaAppDir(stellaAppDir),
  );

export type RuntimePaths = {
  rootHash: string;
  rootDir: string;
  ipcDir: string;
  pidFile: string;
  lockFile: string;
  socketPath: string;
  /**
   * Companion local-IPC endpoint the worker listens on for sidecar
   * processes (e.g. the `stella-computer` daemon spawn path) and the
   * in-process node_repl `connect` client — credential dialogs, brokered
   * connector actions, permission prompts.
   * Sidecars discover the path via the `STELLA_CLI_BRIDGE_SOCK` env var
   * injected by `runtime/kernel/tools/shell.ts`. Kept under the same
   * per-root namespace so multi-install machines don't collide. POSIX
   * socket paths are len(homedir)-dependent and capped at 104 bytes on
   * macOS (BSD `sun_path`, 103 usable), so the per-session endpoint from
   * `createSecureCliBridgeEndpoint` lives under the short private `ipcDir`
   * (`<ipcDir>/<22-char nonce>/b.sock`) and `startCliBridgeServer` enforces a
   * defensive ceiling before binding.
   */
  cliBridgeSocketPath: string;
  logDir: string;
  logFile: string;
  hostExecutableFile: string;
  buildStampFile: string;
  pendingWorkerRestartFile: string;
  rootMarkerFile: string;
};

export const hashStellaAppDir = (stellaAppDir: string): string => {
  const normalized = path.resolve(stellaAppDir);
  return crypto
    .createHash("sha256")
    .update(normalized)
    .digest("hex")
    .slice(0, 16);
};

const windowsNamedPipePath = (name: string, rootHash: string): string =>
  `\\\\.\\pipe\\stella-${name}-${rootHash}`;

export const createSecureCliBridgeEndpoint = (
  paths: Pick<RuntimePaths, "ipcDir" | "rootHash">,
  options?: { platform?: NodeJS.Platform; nonce?: string; token?: string },
): string => {
  const platform = options?.platform ?? process.platform;
  const nonce = (
    options?.nonce ?? crypto.randomBytes(16).toString("base64url")
  ).replace(/[^A-Za-z0-9_-]/gu, "");
  if (nonce.length < 22) {
    throw new Error(
      "CLI bridge nonce must contain at least 128 bits of entropy.",
    );
  }
  if (platform === "win32") {
    const token = (
      options?.token ?? crypto.randomBytes(32).toString("base64url")
    ).replace(/[^A-Za-z0-9_-]/gu, "");
    if (token.length < 43) {
      throw new Error(
        "CLI bridge token must contain at least 256 bits of entropy.",
      );
    }
    return formatCliBridgeEndpoint({
      path: `\\\\.\\pipe\\stella-cli-bridge-${paths.rootHash}-${nonce}`,
      token,
    });
  }
  // The nonce MUST stay its own directory component: startCliBridgeServer
  // chmods the socket's parent directory to 0700 (that per-session dir is
  // the unpredictability barrier) and removes it on stop. Components stay
  // under the short IPC root: long durable state paths must never leak back
  // into a bounded Unix-domain socket pathname.
  return path.join(paths.ipcDir, nonce, "b.sock");
};

export const isWindowsNamedPipePath = (socketPath: string): boolean =>
  /^\\\\[.?]\\pipe\\/i.test(socketPath);

export const runtimeIpcPathUsesFilesystem = (socketPath: string): boolean =>
  !isWindowsNamedPipePath(socketPath);

export const runtimeIpcListenUrl = (socketPath: string): string =>
  isWindowsNamedPipePath(socketPath)
    ? `pipe://${socketPath}`
    : `unix://${socketPath}`;

const ensureOwnedPrivateDirectory = async (
  directory: string,
): Promise<void> => {
  try {
    await fs.mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const stat = await fs.lstat(directory);
  const expectedUid =
    typeof process.getuid === "function" ? process.getuid() : null;
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    (expectedUid != null && stat.uid !== expectedUid) ||
    (stat.mode & 0o777) !== 0o700
  ) {
    throw new Error(
      `Runtime IPC directory is not a private owner-only directory: ${directory}`,
    );
  }
};

export const ensurePrivateRuntimeIpcDir = async (
  ipcDir: string,
): Promise<void> => {
  await ensureOwnedPrivateDirectory(path.dirname(ipcDir));
  await ensureOwnedPrivateDirectory(ipcDir);
};

export const ensureRuntimeIpcDir = async (
  paths: Pick<RuntimePaths, "ipcDir" | "socketPath">,
): Promise<void> => {
  if (!runtimeIpcPathUsesFilesystem(paths.socketPath)) return;
  await ensurePrivateRuntimeIpcDir(paths.ipcDir);
};

export const resolveRuntimePaths = (
  stellaAppDir: string,
  options?: RuntimePathOptions,
): RuntimePaths => {
  const rootHash = hashStellaAppDir(stellaAppDir);
  const baseDir = path.join(resolveRuntimeStateDir(options), RUNTIME_SUBDIR);
  const rootDir = path.join(baseDir, rootHash);
  const logDir = resolveLogDir(stellaAppDir, options);
  const platform = options?.platform ?? process.platform;
  const configuredIpcDir = process.env.STELLA_RUNTIME_IPC_DIR?.trim();
  const ipcBaseDir = path.resolve(
    options?.runtimeIpcDir?.trim() || configuredIpcDir || "/tmp",
    `stella-${typeof process.getuid === "function" ? process.getuid() : "user"}`,
  );
  const ipcDir = path.join(ipcBaseDir, rootHash);
  const socketPath =
    platform === "win32"
      ? windowsNamedPipePath("runtime", rootHash)
      : path.join(ipcDir, "r.sock");
  const cliBridgeSocketPath =
    platform === "win32"
      ? windowsNamedPipePath("cli-bridge", rootHash)
      : path.join(ipcDir, "c.sock");
  return {
    rootHash,
    rootDir,
    ipcDir,
    pidFile: path.join(rootDir, "runtime.pid"),
    lockFile: path.join(rootDir, "runtime.lock"),
    // macOS caps Unix domain socket paths at 104 bytes (BSD), Linux at 108.
    // Keep sockets in a short per-user /tmp namespace; durable control files
    // and logs remain under Electron userData.
    socketPath,
    cliBridgeSocketPath,
    logDir,
    logFile: path.join(logDir, "runtime.log"),
    hostExecutableFile: path.join(rootDir, "host-executable.txt"),
    buildStampFile: path.join(rootDir, "build-stamp.txt"),
    pendingWorkerRestartFile: path.join(rootDir, "pending-worker-restart.json"),
    rootMarkerFile: path.join(rootDir, "root.txt"),
  };
};
