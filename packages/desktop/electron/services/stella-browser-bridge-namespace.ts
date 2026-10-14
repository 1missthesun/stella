import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  releaseOwnerLock,
  tryAcquireOwnerLock,
} from "@stella/runtime/host/lifecycle/owner-lock";
import { isInstalledProduct } from "../app-identity.js";
import { resolveDesktopStellaDataDirForInstall } from "../data-paths.js";
import { processIdentityIsLive } from "./process-identity.js";

const execFileAsync = promisify(execFile);

export type BrowserBridgeMode = "shared" | "isolated";

export type BrowserBridgeNamespace = Readonly<{
  mode: BrowserBridgeMode;
  socketDir: string;
  claim: boolean;
  /**
   * This instance is the user's Stella rather than a dev checkout. Named for
   * the packaged builds it once meant; Stella never packages, so it is now
   * decided by `isProductInstance`.
   */
  packaged: boolean;
  extPort: number | null;
  ownsExtensionChannel: boolean;
  dataDir: string | null;
}>;

export const STELLA_BROWSER_BRIDGE_MODE_ENV = "STELLA_BROWSER_BRIDGE";
export const STELLA_BROWSER_ISOLATED_EXT_PORT_ENV =
  "STELLA_BROWSER_ISOLATED_EXT_PORT";
export const STELLA_BROWSER_BRIDGE_ALLOW_DOWNGRADE_ENV =
  "STELLA_BROWSER_BRIDGE_ALLOW_DOWNGRADE";

const SHARED_EXTENSION_PORT = 39040;

const isolatedExtensionPort = (env: NodeJS.ProcessEnv): number | null => {
  const port = Number(env[STELLA_BROWSER_ISOLATED_EXT_PORT_ENV]?.trim());
  return Number.isInteger(port) && port > 1024 && port < 65536 &&
    port !== SHARED_EXTENSION_PORT
    ? port
    : null;
};

const defaultSocketDir = (env: NodeJS.ProcessEnv): string => {
  const runtimeDir = env.XDG_RUNTIME_DIR?.trim();
  if (runtimeDir) return path.join(runtimeDir, "stella-browser");
  const homeDir = os.homedir().trim();
  if (homeDir) return path.join(homeDir, ".stella-browser");
  return path.join(os.tmpdir(), "stella-browser");
};

const isolatedSocketDirName = (dataDir: string): string =>
  `i-${createHash("sha256").update(path.resolve(dataDir)).digest("hex").slice(0, 12)}`;

/**
 * Whether this instance IS the user's Stella, as opposed to a development
 * checkout running alongside it. One question, answered in one place: see
 * `../app-identity.ts` for why `app.isPackaged` cannot answer it and what
 * happened when the bridge namespace tried.
 */
export const isProductInstance = (options: {
  isPackaged: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean => isInstalledProduct(options);

export const resolveBrowserBridgeNamespace = (options: {
  isPackaged: boolean;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): BrowserBridgeNamespace => {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const product = isProductInstance({ isPackaged: options.isPackaged, env });
  const requested = env[STELLA_BROWSER_BRIDGE_MODE_ENV]?.trim().toLowerCase();
  const dataDir = resolveDesktopStellaDataDirForInstall({
    isPackaged: options.isPackaged,
    env,
  });
  const wantsIsolated =
    requested === "isolated" || (requested !== "shared" && !product);
  const mode: BrowserBridgeMode =
    wantsIsolated && platform !== "win32" ? "isolated" : "shared";
  const explicitSocketDir = env.STELLA_BROWSER_SOCKET_DIR?.trim();
  const socketDir =
    explicitSocketDir ||
    (mode === "isolated"
      ? path.join(defaultSocketDir(env), isolatedSocketDirName(dataDir))
      : defaultSocketDir(env));
  return Object.freeze({
    mode,
    socketDir,
    claim: !product && requested === "shared",
    packaged: product,
    extPort:
      mode === "isolated" ? isolatedExtensionPort(env) : SHARED_EXTENSION_PORT,
    ownsExtensionChannel: mode === "shared",
    dataDir,
  });
};

let configuredNamespace: BrowserBridgeNamespace | null = null;

/**
 * Resolve this process's bridge namespace and publish its socket directory in
 * the environment, so every module that reads it (the bridge config, the
 * native-messaging shim, the in-app browser endpoint) and the runtime spawned
 * from this process agree. Must run before those modules load.
 */
export const configureBrowserBridgeNamespace = (options: {
  isPackaged: boolean;
  env?: NodeJS.ProcessEnv;
}): BrowserBridgeNamespace => {
  const env = options.env ?? process.env;
  const namespace = resolveBrowserBridgeNamespace({
    isPackaged: options.isPackaged,
    env,
  });
  if (namespace.mode === "isolated") {
    env.STELLA_BROWSER_SOCKET_DIR = namespace.socketDir;
  }
  configuredNamespace = namespace;
  return namespace;
};

export const getBrowserBridgeNamespace = (): BrowserBridgeNamespace =>
  configuredNamespace ??
  Object.freeze({
    mode: "shared" as const,
    socketDir:
      process.env.STELLA_BROWSER_SOCKET_DIR?.trim() ||
      defaultSocketDir(process.env),
    claim: false,
    packaged: false,
    extPort: SHARED_EXTENSION_PORT,
    ownsExtensionChannel: true,
    dataDir: null,
  });

export const pickFreeLoopbackPort = async (): Promise<number> =>
  await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() =>
        port > 0 ? resolve(port) : reject(new Error("No free loopback port.")),
      );
    });
  });

export const BROWSER_BRIDGE_INSTANCE_ID = randomUUID();

export type BrowserBridgeBinaryIdentity = Readonly<{
  path: string;
  version: string | null;
  sourceSha: string | null;
  size: number;
  mtimeMs: number;
}>;

export type BrowserBridgeOwnerRecord = Readonly<{
  version: 1;
  instanceId: string;
  ownerPid: number;
  ownerStartedAtMs?: number | null;
  daemonPid: number | null;
  daemonStartedAtMs?: number | null;
  mode: BrowserBridgeMode;
  claim: boolean;
  packaged: boolean;
  dataDir: string | null;
  stellaAppDir: string;
  binary: BrowserBridgeBinaryIdentity | null;
  recordedAtMs: number;
}>;

const LAUNCH_GRACE_MS = 60_000;

const ownerRecordPath = (socketDir: string, session: string) =>
  path.join(socketDir, `${session}.owner.json`);

export const recordedOwnerIsLive = (record: BrowserBridgeOwnerRecord) =>
  processIdentityIsLive({
    pid: record.ownerPid,
    startedAtMs: record.ownerStartedAtMs ?? null,
  });

export const recordedDaemonIsLive = (record: BrowserBridgeOwnerRecord) =>
  record.daemonPid !== null &&
  processIdentityIsLive({
    pid: record.daemonPid,
    startedAtMs: record.daemonStartedAtMs ?? null,
  });

export const readBrowserBridgeOwner = (
  socketDir: string,
  session: string,
): BrowserBridgeOwnerRecord | null => {
  try {
    const parsed = JSON.parse(
      readFileSync(ownerRecordPath(socketDir, session), "utf8"),
    ) as Partial<BrowserBridgeOwnerRecord>;
    if (
      parsed?.version !== 1 ||
      typeof parsed.instanceId !== "string" ||
      typeof parsed.ownerPid !== "number"
    ) {
      return null;
    }
    return parsed as BrowserBridgeOwnerRecord;
  } catch {
    return null;
  }
};

export const writeBrowserBridgeOwner = (
  socketDir: string,
  session: string,
  record: BrowserBridgeOwnerRecord,
): void => {
  mkdirSync(socketDir, { recursive: true });
  const target = ownerRecordPath(socketDir, session);
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temp, target);
};

const CLAIM_LOCK_TIMEOUT_MS = 2_000;
const RELEASE_LOCK_TIMEOUT_MS = 250;
const CLAIM_LOCK_RETRY_MS = 10;

export const withBrowserBridgeClaimLock = async <T>(
  socketDir: string,
  session: string,
  section: () => T,
  timeoutMs = CLAIM_LOCK_TIMEOUT_MS,
): Promise<T> => {
  mkdirSync(socketDir, { recursive: true });
  const lockFile = `${ownerRecordPath(socketDir, session)}.lock`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const lock = tryAcquireOwnerLock(lockFile);
    if (lock.acquired) {
      try {
        return section();
      } finally {
        releaseOwnerLock(lockFile, lock.owner);
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for ${lockFile} (held by pid ${lock.holder?.pid ?? "unknown"}).`,
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, CLAIM_LOCK_RETRY_MS));
  }
};

/** Rewrites the record only while this instance still owns it. */
export const refreshBrowserBridgeOwner = (
  socketDir: string,
  session: string,
  record: BrowserBridgeOwnerRecord,
): Promise<boolean> =>
  withBrowserBridgeClaimLock(socketDir, session, () => {
    const current = readBrowserBridgeOwner(socketDir, session);
    if (current && current.instanceId !== BROWSER_BRIDGE_INSTANCE_ID) return false;
    writeBrowserBridgeOwner(socketDir, session, record);
    return true;
  });

/** Best effort: a record left behind names a dead owner, which the next claimant treats as an orphan. */
export const releaseBrowserBridgeOwner = async (
  socketDir: string,
  session: string,
): Promise<void> => {
  try {
    await withBrowserBridgeClaimLock(
      socketDir,
      session,
      () => {
        const current = readBrowserBridgeOwner(socketDir, session);
        if (current?.instanceId !== BROWSER_BRIDGE_INSTANCE_ID) return;
        unlinkSync(ownerRecordPath(socketDir, session));
      },
      RELEASE_LOCK_TIMEOUT_MS,
    );
  } catch (error) {
    console.warn(
      "[stella-browser-bridge] Left the bridge ownership record in place:",
      error instanceof Error ? error.message : error,
    );
  }
};

/**
 * Whether the recorded owner is a different, still-running instance: its
 * Electron process is alive and either its daemon is alive or it is still
 * launching one.
 */
export const isLiveForeignOwner = (
  record: BrowserBridgeOwnerRecord | null,
  now = Date.now(),
): record is BrowserBridgeOwnerRecord =>
  Boolean(
    record &&
      record.instanceId !== BROWSER_BRIDGE_INSTANCE_ID &&
      record.ownerPid !== process.pid &&
      recordedOwnerIsLive(record) &&
      (recordedDaemonIsLive(record) || now - record.recordedAtMs < LAUNCH_GRACE_MS),
  );

const ownerPriority = (owner: { claim: boolean; packaged: boolean }): number =>
  owner.claim ? 2 : owner.packaged ? 1 : 0;

const parseVersion = (value: string | null): number[] | null => {
  const match = value?.match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1, 4).map((part) => Number(part)) : null;
};

export const compareBridgeBinaryVersions = (
  left: string | null,
  right: string | null,
): number => {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a[index]! !== b[index]!) return a[index]! < b[index]! ? -1 : 1;
  }
  return 0;
};

export type BrowserBridgeTakeoverDecision =
  | Readonly<{ action: "proceed"; replacing: "none" | "own" | "orphan" | "legacy" }>
  | Readonly<{ action: "replace-live"; owner: BrowserBridgeOwnerRecord }>
  | Readonly<{ action: "defer"; owner: BrowserBridgeOwnerRecord; reason: string }>;

export const decideBrowserBridgeTakeover = (args: {
  namespace: BrowserBridgeNamespace;
  owner: BrowserBridgeOwnerRecord | null;
  binary: BrowserBridgeBinaryIdentity | null;
  env?: NodeJS.ProcessEnv;
}): BrowserBridgeTakeoverDecision => {
  const { owner, namespace } = args;
  if (!owner) return { action: "proceed", replacing: "legacy" };
  if (owner.instanceId === BROWSER_BRIDGE_INSTANCE_ID) {
    return { action: "proceed", replacing: "own" };
  }
  if (!isLiveForeignOwner(owner)) {
    return { action: "proceed", replacing: "orphan" };
  }
  const describeOwner = `${owner.packaged ? "the installed Stella app" : "a Stella dev checkout"} (pid ${owner.ownerPid}${owner.dataDir ? `, data ${owner.dataDir}` : ""})`;
  if (ownerPriority(namespace) <= ownerPriority(owner)) {
    return {
      action: "defer",
      owner,
      reason: `The browser bridge is in use by ${describeOwner}. ${
        namespace.packaged
          ? "Stella will take it over when that instance exits."
          : `Set ${STELLA_BROWSER_BRIDGE_MODE_ENV}=shared to claim it from this dev checkout, or leave it unset for an isolated bridge.`
      }`,
    };
  }
  const env = args.env ?? process.env;
  if (
    env[STELLA_BROWSER_BRIDGE_ALLOW_DOWNGRADE_ENV] !== "1" &&
    compareBridgeBinaryVersions(
      args.binary?.version ?? null,
      owner.binary?.version ?? null,
    ) < 0
  ) {
    return {
      action: "defer",
      owner,
      reason: `Refusing to replace the browser bridge of ${describeOwner}: its bridge binary ${owner.binary?.version} is newer than this instance's ${args.binary?.version}. Rebuild or rehydrate stella-browser, or set ${STELLA_BROWSER_BRIDGE_ALLOW_DOWNGRADE_ENV}=1.`,
    };
  }
  return { action: "replace-live", owner };
};

const binaryIdentityCache = new Map<string, BrowserBridgeBinaryIdentity>();

const readHydrationSourceSha = (binaryPath: string): string | null => {
  try {
    const manifest = JSON.parse(
      readFileSync(
        path.join(path.dirname(binaryPath), ".stella-browser.json"),
        "utf8",
      ),
    ) as { sourceSha?: unknown };
    return typeof manifest.sourceSha === "string" ? manifest.sourceSha : null;
  } catch {
    return null;
  }
};

export const readBrowserBridgeBinaryIdentity = async (
  binaryPath: string,
): Promise<BrowserBridgeBinaryIdentity | null> => {
  let size = 0;
  let mtimeMs = 0;
  try {
    const stats = statSync(binaryPath);
    size = stats.size;
    mtimeMs = Math.round(stats.mtimeMs);
  } catch {
    return null;
  }
  const key = `${binaryPath}\0${size}\0${mtimeMs}`;
  const cached = binaryIdentityCache.get(key);
  if (cached) return cached;
  let version: string | null = null;
  try {
    const { stdout } = await execFileAsync(binaryPath, ["--version"], {
      encoding: "utf8",
      timeout: 3_000,
      windowsHide: true,
    });
    version = stdout.trim().match(/(\d+\.\d+\.\d+\S*)/)?.[1] ?? null;
  } catch {
    version = null;
  }
  const identity = Object.freeze({
    path: binaryPath,
    version,
    sourceSha: readHydrationSourceSha(binaryPath),
    size,
    mtimeMs,
  });
  binaryIdentityCache.set(key, identity);
  return identity;
};

export const readBrowserBridgeDaemonPid = (
  socketDir: string,
  session: string,
): number | null => {
  try {
    const pid = Number.parseInt(
      readFileSync(path.join(socketDir, `${session}.pid`), "utf8").trim(),
      10,
    );
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
};
