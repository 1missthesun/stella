import { randomUUID } from "node:crypto";
import { chromiumUserDataRoots } from "../utils/chromium-browsers.js";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  readdirSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import {
  STELLA_BROWSER_BRIDGE_SESSION,
  STELLA_BROWSER_BRIDGE_TOKEN,
  STELLA_BROWSER_EXTENSION_ID,
  STELLA_NATIVE_MESSAGING_HOST_NAME,
} from "@stella/runtime/kernel/tools/stella-browser-bridge-config";
import { registerStellaNativeMessagingHost } from "../utils/register-stella-native-messaging-host.js";
import {
  BROWSER_BRIDGE_INSTANCE_ID,
  decideBrowserBridgeTakeover,
  getBrowserBridgeNamespace,
  pickFreeLoopbackPort,
  readBrowserBridgeBinaryIdentity,
  readBrowserBridgeDaemonPid,
  readBrowserBridgeOwner,
  refreshBrowserBridgeOwner,
  releaseBrowserBridgeOwner,
  withBrowserBridgeClaimLock,
  writeBrowserBridgeOwner,
  type BrowserBridgeBinaryIdentity,
  type BrowserBridgeNamespace,
  type BrowserBridgeOwnerRecord,
} from "./stella-browser-bridge-namespace.js";
import {
  pidCommandLine,
  pidRunsExecutable,
  processIdentityIsLive,
  processStartedAtMs,
  terminateOwnedProcess,
  type ProcessIdentity,
} from "./process-identity.js";
import {
  activateStagedStellaBrowserBinary,
  resolveStellaBrowserBinaryPath,
  resolveStellaBrowserRoot,
} from "../utils/stella-browser-paths.js";
import { stopChildProcessTree } from "../process-runtime.js";
import {
  forgetOwnedProcess,
  reapLegacyOrphanedBrowserDaemons,
  reapOrphanedOwnedProcesses,
  registerOwnedProcess,
} from "./owned-process-registry.js";
import type {
  BrowserExtensionClientsState,
  BrowserExtensionRouting,
} from "@stella/contracts/desktop/browser-view";
import {
  buildBrowserExtensionClientsState,
  parseDaemonExtensionClients,
  readBrowserExtensionRouting,
  rememberBrowserExtensionClients,
  saveBrowserExtensionRouting,
} from "./browser-extension-routing-store.js";

const execFileAsync = promisify(execFile);

let ownProcessStartedAtMs: number | null | undefined;
const ownStartedAtMs = () =>
  ownProcessStartedAtMs === undefined
    ? (ownProcessStartedAtMs = processStartedAtMs(process.pid))
    : ownProcessStartedAtMs;

const recordedDaemonIdentity = (
  record: BrowserBridgeOwnerRecord,
): ProcessIdentity | null =>
  record.daemonPid === null
    ? null
    : { pid: record.daemonPid, startedAtMs: record.daemonStartedAtMs ?? null };

const DAEMON_READY_TIMEOUT_MS = 10_000;
const COMMAND_TIMEOUT_MS = 10_000;
const DAEMON_SHUTDOWN_TIMEOUT_MS = 2_000;
const DAEMON_READY_PROBE_TIMEOUT_MS = 1_000;
const AGENT_DAEMON_IDLE_TIMEOUT_MS = 30 * 60_000;
const AGENT_CAPABILITY_TTL_MS = 24 * 60 * 60_000;

type ProcessRow = {
  pid: number;
  ppid: number;
  command: string;
};

const parseProcessRows = (output: string): ProcessRow[] =>
  output
    .split(/\r?\n/)
    .map((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (!match) return null;
      return {
        pid: Number.parseInt(match[1]!, 10),
        ppid: Number.parseInt(match[2]!, 10),
        command: match[3]!,
      };
    })
    .filter((row): row is ProcessRow =>
      Boolean(row && Number.isFinite(row.pid) && Number.isFinite(row.ppid)),
    );

export const buildWindowsBundledBrowserProcessQuery = (
  binaryPaths: readonly string[],
): string => {
  const targets = binaryPaths
    .map((binaryPath) => `'${binaryPath.replace(/'/g, "''")}'`)
    .join(", ");
  return [
    `$targets = @(${targets})`,
    [
      "Get-CimInstance Win32_Process",
      "| Where-Object { $_.ExecutablePath -and ($targets -contains $_.ExecutablePath) -and $_.ProcessId -ne $PID -and $_.CommandLine -notlike '*chrome-extension://*' }",
      "| Where-Object { -not (Get-Process -Id $_.ParentProcessId -ErrorAction SilentlyContinue) }",
      "| Select-Object -ExpandProperty ProcessId -Unique",
    ].join(" "),
  ].join("; ");
};

const findOrphanedBundledDaemonPids = async (): Promise<number[]> => {
  const binaryPaths = [resolveStellaBrowserBinaryPath()].filter(
    (value): value is string => Boolean(value),
  );
  if (process.platform === "win32") {
    if (binaryPaths.length === 0) return [];
    try {
      // Exclude Chrome-spawned native messaging hosts: Chrome passes the
      // extension origin (chrome-extension://...) as an argument and owns
      // their lifecycle. Killing them disconnects the extension's native
      // port and kicks off its respawn/reconnect loop. The NSIS installer
      // kills those browser-owned hosts immediately before replacing files.
      const { stdout } = await execFileAsync(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          buildWindowsBundledBrowserProcessQuery(binaryPaths),
        ],
        {
          encoding: "utf8",
          windowsHide: true,
          maxBuffer: 1024 * 1024,
          timeout: 1_500,
        },
      );
      return stdout
        .split(/\r?\n/)
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter((value) => Number.isFinite(value) && value > 0);
    } catch {
      return [];
    }
  }

  try {
    const { stdout } = await execFileAsync(
      "ps",
      ["-axo", "pid=,ppid=,command="],
      {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      },
    );
    return parseProcessRows(stdout)
      .filter(
        (row) =>
          row.pid !== process.pid &&
          row.ppid === 1 &&
          binaryPaths.some((binaryPath) => row.command.includes(binaryPath)),
      )
      .map((row) => row.pid);
  } catch {
    return [];
  }
};

export const stopOrphanedStellaBrowserDaemons = async () => {
  await reapOrphanedOwnedProcesses(DAEMON_SHUTDOWN_TIMEOUT_MS).catch(() => undefined);
  await reapLegacyOrphanedBrowserDaemons(DAEMON_SHUTDOWN_TIMEOUT_MS).catch(
    () => [],
  );
  const pids = await findOrphanedBundledDaemonPids();
  if (pids.length === 0) return;
  if (process.platform === "win32") {
    await Promise.all(
      pids.map((pid) =>
        execFileAsync("taskkill", ["/pid", String(pid), "/T", "/F"], {
          windowsHide: true,
        }).catch(() => undefined),
      ),
    );
    return;
  }
  const binaryPaths = [resolveStellaBrowserBinaryPath()].filter((value): value is string => Boolean(value));
  await Promise.all(
    pids.map((pid) =>
      terminateOwnedProcess(
        pid,
        () => {
          const command = pidCommandLine(pid);
          return Boolean(
            command && binaryPaths.some((binary) => command.includes(binary)),
          );
        },
        150,
      ),
    ),
  );
};

type StellaBrowserBridgeServiceOptions = {
  stellaAppDir: string;
  stellaDataDir: string;
  onUnexpectedExit?: (error: string) => void;
};

export type StellaBrowserAgentCapability = Readonly<{
  ownerId: string;
  turnId: string;
  ownerLeaseId: string;
  ownerLeaseIssuedAt: number;
  recover?: boolean;
}>;

export type StellaBrowserAgentBackend = Readonly<{
  bridgeSessionId: string;
  capabilityExpiresAt: number;
}>;

type AgentBackendRecord = StellaBrowserAgentCapability &
  StellaBrowserAgentBackend &
  Readonly<{
    cdpUrl: string;
    controlToken: string;
    extensionDelegateToken: string;
    process: ChildProcess;
  }>;

type AgentOwnerLeaseOrder = Readonly<{
  ownerLeaseIssuedAt: number;
  ownerLeaseId: string;
}>;

const compareAgentOwnerLeaseOrder = (
  left: AgentOwnerLeaseOrder,
  right: AgentOwnerLeaseOrder,
): number => {
  if (left.ownerLeaseIssuedAt !== right.ownerLeaseIssuedAt) {
    return left.ownerLeaseIssuedAt < right.ownerLeaseIssuedAt ? -1 : 1;
  }
  if (left.ownerLeaseId === right.ownerLeaseId) return 0;
  return Buffer.compare(
    Buffer.from(left.ownerLeaseId, "utf8"),
    Buffer.from(right.ownerLeaseId, "utf8"),
  );
};

type DaemonResponse = {
  success?: boolean;
  error?: string;
  data?: unknown;
};

export class StellaBrowserBridgeService {
  private readonly stellaAppDir: string;
  private readonly stellaDataDir: string;
  private readonly onUnexpectedExit?: (error: string) => void;

  private daemonProcess: ChildProcess | null = null;
  private launchPromise: Promise<void> | null = null;
  private readonly controlToken = randomUUID();
  private readonly agentBackends = new Map<string, AgentBackendRecord>();
  private readonly agentOwnerLeaseHighWater = new Map<
    string,
    Readonly<{
      ownerLeaseIssuedAt: number;
      ownerLeaseId: string;
      turnId: string;
    }>
  >();
  private readonly agentBackendLaunches = new Map<
    string,
    Readonly<{
      ownerLeaseId: string;
      ownerLeaseIssuedAt: number;
      turnId: string;
      promise: Promise<StellaBrowserAgentBackend>;
    }>
  >();
  private agentBackendGeneration = 0;
  private connectedCdpUrl: string | null = null;
  private connectingCdp: Readonly<{
    url: string;
    promise: Promise<void>;
  }> | null = null;
  private cdpRoutingGeneration = 0;
  private isLaunching = false;
  private stopped = false;
  private readonly namespace: BrowserBridgeNamespace =
    getBrowserBridgeNamespace();
  private binaryIdentity: BrowserBridgeBinaryIdentity | null = null;

  constructor(options: StellaBrowserBridgeServiceOptions) {
    this.stellaAppDir = options.stellaAppDir;
    this.stellaDataDir = options.stellaDataDir;
    this.onUnexpectedExit = options.onUnexpectedExit;
  }

  async getExtensionStatus(): Promise<boolean> {
    const response = await this.sendCommand({
      id: randomUUID(),
      action: "extension_status",
    });
    return (
      typeof response.data === "object" &&
      response.data !== null &&
      "connected" in response.data &&
      response.data.connected === true
    );
  }

  async getExtensionClients(): Promise<BrowserExtensionClientsState> {
    const response = await this.sendCommand({
      id: randomUUID(),
      action: "extension_status",
    });
    const connected = parseDaemonExtensionClients(response.data);
    const record = rememberBrowserExtensionClients(
      this.stellaDataDir,
      connected,
    );
    return buildBrowserExtensionClientsState(record, connected);
  }

  async setExtensionRouting(
    routing: BrowserExtensionRouting,
  ): Promise<BrowserExtensionClientsState> {
    saveBrowserExtensionRouting(this.stellaDataDir, routing);
    await this.applyExtensionRouting();
    return await this.getExtensionClients();
  }

  private async applyExtensionRouting() {
    const { preferredKey, disabledKeys } = readBrowserExtensionRouting(
      this.stellaDataDir,
    );
    await this.sendCommand({
      id: randomUUID(),
      action: "extension_routing_set",
      preferredKey,
      disabledKeys,
    }).catch(() => undefined);
  }

  async reconnectExtension(): Promise<boolean> {
    const response = await this.sendCommand({
      id: randomUUID(),
      action: "extension_reconnect",
    });
    return (
      typeof response.data === "object" &&
      response.data !== null &&
      "retired" in response.data &&
      response.data.retired === true
    );
  }

  async connectCdp(cdpUrl: string): Promise<void> {
    const normalizedUrl = cdpUrl.trim();
    if (!normalizedUrl) {
      throw new Error("A CDP URL is required.");
    }
    if (this.connectedCdpUrl === normalizedUrl) {
      return Promise.resolve();
    }
    if (this.connectingCdp?.url === normalizedUrl) {
      return this.connectingCdp.promise;
    }

    const previousAttempt = this.connectingCdp?.promise;
    const routingGeneration = this.cdpRoutingGeneration;
    const promise = (async () => {
      await previousAttempt?.catch(() => undefined);
      if (this.connectedCdpUrl === normalizedUrl) return;
      await this.sendCommand({
        id: randomUUID(),
        action: "launch",
        cdpUrl: normalizedUrl,
      });
      if (this.cdpRoutingGeneration === routingGeneration) {
        this.connectedCdpUrl = normalizedUrl;
      }
    })();
    this.connectingCdp = { url: normalizedUrl, promise };
    void promise.then(
      () => {
        if (this.connectingCdp?.promise === promise) {
          this.connectingCdp = null;
        }
      },
      () => {
        if (this.connectingCdp?.promise === promise) {
          this.connectingCdp = null;
        }
      },
    );
    await promise;
  }

  async connectAgentCdp(
    capability: StellaBrowserAgentCapability,
    cdpUrl: string,
  ): Promise<StellaBrowserAgentBackend> {
    const ownerId = requireCapabilityString(capability.ownerId, "ownerId");
    const turnId = requireCapabilityString(capability.turnId, "turnId");
    const ownerLeaseId = requireCapabilityString(
      capability.ownerLeaseId,
      "ownerLeaseId",
    );
    const ownerLeaseIssuedAt = requireCapabilityTimestamp(
      capability.ownerLeaseIssuedAt,
    );
    const normalizedUrl = cdpUrl.trim();
    if (!normalizedUrl) throw new Error("A CDP URL is required.");
    await this.start();
    const backendGeneration = this.agentBackendGeneration;

    const highWater = this.agentOwnerLeaseHighWater.get(ownerId);
    if (highWater) {
      const order = compareAgentOwnerLeaseOrder(
        { ownerLeaseIssuedAt, ownerLeaseId },
        highWater,
      );
      if (order < 0) {
        throw new Error(
          "A newer browser session already owns this agent backend.",
        );
      }
      if (order === 0 && turnId !== highWater.turnId) {
        throw new Error(
          "A conflicting browser lease already owns this agent backend generation.",
        );
      }
    }
    this.agentOwnerLeaseHighWater.set(ownerId, {
      ownerLeaseIssuedAt,
      ownerLeaseId,
      turnId,
    });

    const inFlight = this.agentBackendLaunches.get(ownerId);
    if (
      !capability.recover &&
      inFlight?.ownerLeaseId === ownerLeaseId &&
      inFlight.ownerLeaseIssuedAt === ownerLeaseIssuedAt &&
      inFlight.turnId === turnId
    ) {
      return await inFlight.promise;
    }

    const previousLaunch = inFlight?.promise;
    const promise = (async () => {
      await previousLaunch?.catch(() => undefined);
      const existing = this.agentBackends.get(ownerId);
      if (
        !capability.recover &&
        existing?.ownerLeaseId === ownerLeaseId &&
        existing.ownerLeaseIssuedAt === ownerLeaseIssuedAt &&
        existing.turnId === turnId &&
        existing.cdpUrl === normalizedUrl &&
        existing.process.exitCode === null &&
        !existing.process.killed &&
        existing.capabilityExpiresAt > Date.now()
      ) {
        return agentBackendResult(existing);
      }
      if (
        existing &&
        compareAgentOwnerLeaseOrder(
          { ownerLeaseIssuedAt, ownerLeaseId },
          existing,
        ) < 0
      ) {
        throw new Error(
          "A newer browser session already owns this agent backend.",
        );
      }
      if (existing) await this.stopAgentBackend(existing);
      const next = await this.spawnAgentBackend({
        ownerId,
        turnId,
        ownerLeaseId,
        ownerLeaseIssuedAt,
        cdpUrl: normalizedUrl,
      });
      const latestLease = this.agentOwnerLeaseHighWater.get(ownerId);
      if (
        !latestLease ||
        latestLease.ownerLeaseIssuedAt !== ownerLeaseIssuedAt ||
        latestLease.ownerLeaseId !== ownerLeaseId ||
        latestLease.turnId !== turnId
      ) {
        await this.stopAgentBackend(next);
        throw new Error(
          "A newer browser session superseded this agent backend during initialization.",
        );
      }
      if (this.stopped || this.agentBackendGeneration !== backendGeneration) {
        await this.stopAgentBackend(next);
        throw new Error(
          "Browser bridge restarted during agent initialization.",
        );
      }
      this.agentBackends.set(ownerId, next);
      return agentBackendResult(next);
    })();
    this.agentBackendLaunches.set(ownerId, {
      ownerLeaseId,
      ownerLeaseIssuedAt,
      turnId,
      promise,
    });
    void promise.then(
      () => {
        if (this.agentBackendLaunches.get(ownerId)?.promise === promise) {
          this.agentBackendLaunches.delete(ownerId);
        }
      },
      () => {
        if (this.agentBackendLaunches.get(ownerId)?.promise === promise) {
          this.agentBackendLaunches.delete(ownerId);
        }
      },
    );
    return await promise;
  }

  start() {
    if (this.stopped) {
      this.stopped = false;
    }
    if (this.daemonProcess || this.launchPromise) {
      return this.launchPromise ?? Promise.resolve();
    }
    const launchPromise = this.launchBridge().finally(() => {
      if (this.launchPromise === launchPromise) {
        this.launchPromise = null;
      }
    });
    this.launchPromise = launchPromise;
    return launchPromise;
  }

  async stop() {
    this.stopped = true;
    this.resetCdpRouting();
    this.agentBackendGeneration += 1;

    await Promise.allSettled([
      ...Array.from(this.agentBackends.values(), (backend) =>
        this.stopAgentBackend(backend),
      ),
      ...Array.from(this.agentBackendLaunches.values(), ({ promise }) =>
        promise.then(
          () => undefined,
          () => undefined,
        ),
      ),
    ]);
    this.agentBackends.clear();
    this.agentBackendLaunches.clear();
    this.agentOwnerLeaseHighWater.clear();

    const daemon = this.daemonProcess;
    if (daemon) {
      const closePromise = this.sendCommand({
        id: randomUUID(),
        action: "close",
      }).catch(() => undefined);

      await Promise.race([closePromise, delay(1_500)]).catch(() => undefined);
    }
    await stopChildProcessTree(daemon);
    await this.stopOrphanedBundledDaemons();
    this.daemonProcess = null;
    await releaseBrowserBridgeOwner(
      this.namespace.socketDir,
      STELLA_BROWSER_BRIDGE_SESSION,
    );
  }

  private async launchBridge() {
    if (this.stopped) {
      return;
    }

    this.isLaunching = true;

    try {
      const takeover = await this.claimNamespace();
      if (this.stopped) return;

      if (this.namespace.ownsExtensionChannel) {
        const registration = await registerStellaNativeMessagingHost();
        if (!registration.ok) {
          throw new Error(
            registration.error ??
              "Could not register the browser extension connector. Stella may need permission to update browser settings.",
          );
        }
      }

      if (this.stopped) return;

      await this.closeExistingSession(takeover.replaceDaemon);
      if (this.stopped) return;
      const extPort = this.namespace.extPort ?? (await pickFreeLoopbackPort());
      if (this.stopped) return;
      this.spawnDaemon(extPort);
      await this.recordOwnership();
      await this.waitForDaemonReady();
      await this.sendCommand({
        id: randomUUID(),
        action: "launch",
        provider: "extension",
      });
      await this.applyExtensionRouting();
      await Promise.all(
        Array.from(this.agentBackends.values(), (backend) =>
          this.registerAgentExtensionDelegate(backend),
        ),
      );
    } catch (error) {
      await this.killDaemonProcess();
      throw error;
    } finally {
      this.isLaunching = false;
    }
  }

  private async claimNamespace(): Promise<{
    replaceDaemon: ProcessIdentity | null;
  }> {
    const stellaBrowserRoot = resolveStellaBrowserRoot();
    activateStagedStellaBrowserBinary(stellaBrowserRoot);
    const binaryPath = resolveStellaBrowserBinaryPath(stellaBrowserRoot);
    this.binaryIdentity = binaryPath
      ? await readBrowserBridgeBinaryIdentity(binaryPath)
      : null;
    const { owner, decision } = await withBrowserBridgeClaimLock(
      this.namespace.socketDir,
      STELLA_BROWSER_BRIDGE_SESSION,
      () => {
        const owner = readBrowserBridgeOwner(
          this.namespace.socketDir,
          STELLA_BROWSER_BRIDGE_SESSION,
        );
        const decision = decideBrowserBridgeTakeover({
          namespace: this.namespace,
          owner,
          binary: this.binaryIdentity,
        });
        if (decision.action !== "defer" && !this.stopped) {
          try {
            writeBrowserBridgeOwner(
              this.namespace.socketDir,
              STELLA_BROWSER_BRIDGE_SESSION,
              this.ownershipRecord(),
            );
          } catch (error) {
            console.warn(
              "[stella-browser-bridge] Could not record bridge ownership:",
              error instanceof Error ? error.message : error,
            );
          }
        }
        return { owner, decision };
      },
    );
    if (decision.action === "defer") {
      console.warn(`[stella-browser-bridge] ${decision.reason}`);
      throw new Error(decision.reason);
    }
    if (decision.action === "replace-live") {
      console.warn(
        `[stella-browser-bridge] Claiming the shared browser bridge from pid ${decision.owner.ownerPid} (${decision.owner.packaged ? "installed app" : "dev checkout"}).`,
      );
      return { replaceDaemon: recordedDaemonIdentity(decision.owner) };
    }
    return {
      replaceDaemon:
        decision.replacing === "orphan" && owner
          ? recordedDaemonIdentity(owner)
          : null,
    };
  }

  private ownershipRecord(): BrowserBridgeOwnerRecord {
    const daemonPid = this.daemonProcess?.pid ?? null;
    return {
      version: 1,
      instanceId: BROWSER_BRIDGE_INSTANCE_ID,
      ownerPid: process.pid,
      ownerStartedAtMs: ownStartedAtMs(),
      daemonPid,
      daemonStartedAtMs:
        daemonPid === null ? null : processStartedAtMs(daemonPid),
      mode: this.namespace.mode,
      claim: this.namespace.claim,
      packaged: this.namespace.packaged,
      dataDir: this.namespace.dataDir,
      stellaAppDir: this.stellaAppDir,
      binary: this.binaryIdentity,
      recordedAtMs: Date.now(),
    };
  }

  private async recordOwnership() {
    try {
      if (
        !(await refreshBrowserBridgeOwner(
          this.namespace.socketDir,
          STELLA_BROWSER_BRIDGE_SESSION,
          this.ownershipRecord(),
        ))
      ) {
        console.warn(
          "[stella-browser-bridge] Another Stella claimed the browser bridge during launch; not recording this daemon.",
        );
      }
    } catch (error) {
      console.warn(
        "[stella-browser-bridge] Could not record bridge ownership:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  private spawnDaemon(extPort: number) {
    this.resetCdpRouting();
    const stellaBrowserRoot = resolveStellaBrowserRoot();
    activateStagedStellaBrowserBinary(stellaBrowserRoot);
    const binPath = resolveStellaBrowserBinaryPath(stellaBrowserRoot);
    if (!binPath) {
      throw new Error(
        "The native Stella Browser service is unavailable. Reinstall Stella or restore the browser service artifact.",
      );
    }
    if (process.platform !== "win32") {
      try {
        accessSync(binPath, constants.X_OK);
      } catch {
        chmodSync(binPath, 0o755);
      }
    }

    const daemon = spawn(
      binPath,
      ["service", "run", "--session", STELLA_BROWSER_BRIDGE_SESSION],
      {
        cwd: stellaBrowserRoot,
        env: {
          ...process.env,
          STELLA_BROWSER_SOCKET_DIR: this.namespace.socketDir,
          STELLA_BROWSER_PARENT_PID: String(process.pid),
          STELLA_BROWSER_EXT_PORT: String(extPort),
          STELLA_BROWSER_EXT_TOKEN: STELLA_BROWSER_BRIDGE_TOKEN,
          STELLA_BROWSER_CONTROL_TOKEN: this.controlToken,
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        detached: process.platform !== "win32",
      },
    );

    daemon.stdout?.on("data", (chunk: Buffer | string) => {
      const message = String(chunk).trim();
      if (message) {
        console.debug("[stella-browser-bridge]", message);
      }
    });

    daemon.stderr?.on("data", (chunk: Buffer | string) => {
      const message = String(chunk).trim();
      if (message) {
        console.warn("[stella-browser-bridge]", message);
      }
    });

    registerOwnedProcess({
      kind: "stella-browser-daemon",
      pid: daemon.pid,
      executable: binPath,
      commandFragments: ["service", "run", "--session", STELLA_BROWSER_BRIDGE_SESSION],
      ownerAppDir: this.stellaAppDir,
    });
    daemon.once("exit", (code, signal) => {
      forgetOwnedProcess(daemon.pid);
      if (this.daemonProcess !== daemon) {
        return;
      }

      this.daemonProcess = null;
      this.resetCdpRouting();

      if (this.stopped || this.isLaunching) {
        return;
      }

      const reason = signal
        ? `Bridge process exited via ${signal}.`
        : `Bridge process exited with code ${code ?? 0}.`;
      this.onUnexpectedExit?.(reason);
    });

    daemon.once("error", (error) => {
      if (this.daemonProcess !== daemon) {
        return;
      }
      this.daemonProcess = null;
      this.resetCdpRouting();
      if (this.stopped || this.isLaunching) {
        return;
      }
      this.onUnexpectedExit?.(
        `Failed to start browser bridge: ${error.message}`,
      );
    });

    this.daemonProcess = daemon;
  }

  private async spawnAgentBackend(
    input: StellaBrowserAgentCapability & Readonly<{ cdpUrl: string }>,
  ): Promise<AgentBackendRecord> {
    const stellaBrowserRoot = resolveStellaBrowserRoot();
    activateStagedStellaBrowserBinary(stellaBrowserRoot);
    const binPath = resolveStellaBrowserBinaryPath(stellaBrowserRoot);
    if (!binPath) {
      throw new Error(
        "The native Stella Browser service is unavailable. Reinstall Stella or restore the browser service artifact.",
      );
    }
    if (process.platform !== "win32") {
      try {
        accessSync(binPath, constants.X_OK);
      } catch {
        chmodSync(binPath, 0o755);
      }
    }

    const bridgeSessionId = `agent-${randomUUID().replaceAll("-", "")}`;
    const controlToken = randomUUID();
    const extensionDelegateToken = randomUUID();
    const capabilityExpiresAt = Date.now() + AGENT_CAPABILITY_TTL_MS;
    const daemon = spawn(
      binPath,
      ["service", "run", "--session", bridgeSessionId],
      {
        cwd: stellaBrowserRoot,
        env: {
          ...process.env,
          STELLA_BROWSER_SOCKET_DIR: this.namespace.socketDir,
          STELLA_BROWSER_PARENT_PID: String(process.pid),
          STELLA_BROWSER_CONTROL_TOKEN: controlToken,
          STELLA_BROWSER_EXTENSION_PROXY_SESSION: STELLA_BROWSER_BRIDGE_SESSION,
          STELLA_BROWSER_EXTENSION_DELEGATE_TOKEN: extensionDelegateToken,
          STELLA_BROWSER_REQUIRED_OWNER_ID: input.ownerId,
          STELLA_BROWSER_REQUIRED_TURN_ID: input.turnId,
          STELLA_BROWSER_REQUIRED_OWNER_LEASE_ID: input.ownerLeaseId,
          STELLA_BROWSER_REQUIRED_OWNER_LEASE_ISSUED_AT: String(
            input.ownerLeaseIssuedAt,
          ),
          STELLA_BROWSER_CAPABILITY_EXPIRES_AT_MS: String(capabilityExpiresAt),
          STELLA_BROWSER_IDLE_TIMEOUT_MS: String(AGENT_DAEMON_IDLE_TIMEOUT_MS),
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        detached: process.platform !== "win32",
      },
    );
    const backend: AgentBackendRecord = {
      ...input,
      bridgeSessionId,
      capabilityExpiresAt,
      controlToken,
      extensionDelegateToken,
      process: daemon,
    };
    daemon.stdout?.on("data", (chunk: Buffer | string) => {
      const message = String(chunk).trim();
      if (message) console.debug("[stella-browser-agent]", message);
    });
    daemon.stderr?.on("data", (chunk: Buffer | string) => {
      const message = String(chunk).trim();
      if (message) console.warn("[stella-browser-agent]", message);
    });
    const forgetBackend = () => {
      if (this.agentBackends.get(input.ownerId)?.process === daemon) {
        this.agentBackends.delete(input.ownerId);
      }
      void this.revokeAgentExtensionDelegate(backend).catch(() => undefined);
    };
    registerOwnedProcess({
      kind: "stella-browser-daemon",
      pid: daemon.pid,
      executable: binPath,
      commandFragments: ["service", "run", "--session", bridgeSessionId],
      ownerAppDir: this.stellaAppDir,
    });
    daemon.once("exit", () => forgetOwnedProcess(daemon.pid));
    daemon.once("exit", forgetBackend);
    daemon.once("error", forgetBackend);

    try {
      await this.waitForAgentDaemonReady(backend);
      await this.registerAgentExtensionDelegate(backend);
      await this.sendCommandToSession(
        bridgeSessionId,
        {
          id: randomUUID(),
          action: "launch",
          cdpUrl: input.cdpUrl,
          controlToken,
          ownerId: input.ownerId,
          sessionId: input.ownerId,
          turnId: input.turnId,
          ownerLeaseId: input.ownerLeaseId,
          ownerLeaseIssuedAt: input.ownerLeaseIssuedAt,
        },
        COMMAND_TIMEOUT_MS,
      );
      return backend;
    } catch (error) {
      await stopChildProcessTree(daemon).catch(() => undefined);
      throw error;
    }
  }

  private async waitForAgentDaemonReady(backend: AgentBackendRecord) {
    const deadline = Date.now() + DAEMON_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (backend.process.exitCode !== null) {
        throw new Error("Agent browser daemon exited before it became ready.");
      }
      try {
        await this.sendCommandToSession(
          backend.bridgeSessionId,
          {
            id: randomUUID(),
            action: "state_list",
            controlToken: backend.controlToken,
          },
          DAEMON_READY_PROBE_TIMEOUT_MS,
        );
        return;
      } catch {
        await delay(100);
      }
    }
    throw new Error("Agent browser daemon did not become ready in time.");
  }

  private async registerAgentExtensionDelegate(backend: AgentBackendRecord) {
    await this.sendCommand({
      id: randomUUID(),
      action: "extension_delegate_register",
      extensionDelegateToken: backend.extensionDelegateToken,
      ownerId: backend.ownerId,
      sessionId: backend.ownerId,
      turnId: backend.turnId,
      ownerLeaseId: backend.ownerLeaseId,
      ownerLeaseIssuedAt: backend.ownerLeaseIssuedAt,
      capabilityExpiresAt: backend.capabilityExpiresAt,
    });
  }

  private async revokeAgentExtensionDelegate(backend: AgentBackendRecord) {
    await this.sendCommand({
      id: randomUUID(),
      action: "extension_delegate_revoke",
      extensionDelegateToken: backend.extensionDelegateToken,
    });
  }

  private async stopAgentBackend(backend: AgentBackendRecord) {
    if (this.agentBackends.get(backend.ownerId)?.process === backend.process) {
      this.agentBackends.delete(backend.ownerId);
    }
    await this.revokeAgentExtensionDelegate(backend).catch(() => undefined);
    await Promise.race([
      this.sendCommandToSession(
        backend.bridgeSessionId,
        {
          id: randomUUID(),
          action: "close",
          controlToken: backend.controlToken,
        },
        1_000,
      ).catch(() => undefined),
      delay(1_100),
    ]).catch(() => undefined);
    await stopChildProcessTree(backend.process).catch(() => undefined);
  }

  private resetCdpRouting() {
    this.cdpRoutingGeneration += 1;
    this.connectedCdpUrl = null;
    this.connectingCdp = null;
  }

  private async waitForDaemonReady() {
    const deadline = Date.now() + DAEMON_READY_TIMEOUT_MS;

    while (Date.now() < deadline) {
      if (this.stopped) {
        throw new Error("Browser bridge startup cancelled.");
      }

      if (this.daemonProcess?.exitCode !== null) {
        throw new Error("Browser bridge daemon exited before it became ready.");
      }

      const answeringPid = readBrowserBridgeDaemonPid(
        this.namespace.socketDir,
        STELLA_BROWSER_BRIDGE_SESSION,
      );
      if (answeringPid !== this.daemonProcess?.pid) {
        await delay(100);
        continue;
      }

      try {
        await this.sendCommand(
          {
            id: randomUUID(),
            action: "state_list",
          },
          DAEMON_READY_PROBE_TIMEOUT_MS,
        );
        return;
      } catch {
        await delay(100);
      }
    }

    const answeringPid = readBrowserBridgeDaemonPid(
      this.namespace.socketDir,
      STELLA_BROWSER_BRIDGE_SESSION,
    );
    if (answeringPid != null && answeringPid !== this.daemonProcess?.pid) {
      throw new Error(
        `Browser bridge socket is served by pid ${answeringPid}, not the daemon this instance started (pid ${String(this.daemonProcess?.pid)}).`,
      );
    }
    throw new Error("Browser bridge daemon did not become ready in time.");
  }

  private async closeExistingSession(
    replaceDaemon: ProcessIdentity | null = null,
  ) {
    const daemonPort = getPortForSession(STELLA_BROWSER_BRIDGE_SESSION);

    if (
      replaceDaemon !== null &&
      replaceDaemon.pid !== this.daemonProcess?.pid
    ) {
      await this.stopRecordedDaemon(replaceDaemon);
    }

    await this.sendCommand(
      {
        id: randomUUID(),
        action: "close",
      },
      1_500,
    ).catch(() => undefined);

    const daemonStopped = await this.waitForPortToClose(
      daemonPort,
      DAEMON_SHUTDOWN_TIMEOUT_MS,
    );
    if (!daemonStopped) {
      await this.killProcessListeningOnPort(daemonPort);
      await this.waitForPortToClose(daemonPort, DAEMON_SHUTDOWN_TIMEOUT_MS);
    }
    await this.stopOrphanedBundledDaemons();
  }

  /**
   * Stop a daemon named by an ownership record. Its control token is another
   * instance's, so `close` would be refused; signal it directly. Windows
   * daemons are cleared by their control port instead.
   */
  private async stopRecordedDaemon(daemon: ProcessIdentity) {
    if (process.platform === "win32") return;
    const stillOwned = () =>
      processIdentityIsLive(daemon) &&
      Boolean(pidCommandLine(daemon.pid)?.includes("service run"));
    await terminateOwnedProcess(daemon.pid, stillOwned, DAEMON_SHUTDOWN_TIMEOUT_MS);
  }

  private sendCommand(
    command: Record<string, unknown>,
    timeoutMs = COMMAND_TIMEOUT_MS,
  ): Promise<DaemonResponse> {
    return this.sendCommandToSession(
      STELLA_BROWSER_BRIDGE_SESSION,
      { ...command, controlToken: this.controlToken },
      timeoutMs,
    );
  }

  private async sendCommandToSession(
    session: string,
    command: Record<string, unknown>,
    timeoutMs = COMMAND_TIMEOUT_MS,
  ): Promise<DaemonResponse> {
    const socket = await this.openConnection(session);

    return await new Promise<DaemonResponse>((resolve, reject) => {
      let settled = false;
      let responseBuffer = "";

      const timeout = setTimeout(() => {
        settleReject(new Error("Timed out waiting for browser bridge daemon."));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timeout);
        socket.removeAllListeners();
        socket.destroy();
      };

      const settleResolve = (response: DaemonResponse) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(response);
      };

      const settleReject = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };

      socket.on("data", (chunk: Buffer | string) => {
        responseBuffer += String(chunk);
        const newlineIndex = responseBuffer.indexOf("\n");
        if (newlineIndex === -1) {
          return;
        }

        const line = responseBuffer.slice(0, newlineIndex).trim();
        if (!line) {
          return;
        }

        try {
          const response = JSON.parse(line) as DaemonResponse;
          if (response.success === false) {
            settleReject(
              new Error(response.error || "Browser bridge command failed."),
            );
            return;
          }
          settleResolve(response);
        } catch (error) {
          settleReject(
            new Error(
              `Failed to parse browser bridge response: ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
          );
        }
      });

      socket.once("error", (error) => {
        settleReject(
          new Error(`Failed to reach browser bridge daemon: ${error.message}`),
        );
      });

      socket.once("close", () => {
        if (!settled) {
          settleReject(
            new Error("Browser bridge daemon closed before replying."),
          );
        }
      });

      socket.write(`${JSON.stringify(command)}\n`);
    });
  }

  private async openConnection(
    session = STELLA_BROWSER_BRIDGE_SESSION,
  ): Promise<net.Socket> {
    const endpoint =
      process.platform === "win32"
        ? {
            port: getPortForSession(session),
            host: "127.0.0.1",
          }
        : { path: getSocketPath(session) };

    return await new Promise<net.Socket>((resolve, reject) => {
      const socket = net.createConnection(endpoint);
      socket.once("connect", () => {
        socket.removeListener("error", rejectConnection);
        resolve(socket);
      });
      const rejectConnection = (error: Error) => {
        socket.destroy();
        reject(error);
      };
      socket.once("error", rejectConnection);
    });
  }

  private async isTcpPortListening(
    port: number,
    timeoutMs = 250,
  ): Promise<boolean> {
    if (!Number.isFinite(port) || port <= 0) {
      return false;
    }

    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const socket = net.createConnection({ port, host: "127.0.0.1" });
      const settle = (listening: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        socket.removeAllListeners();
        socket.destroy();
        resolve(listening);
      };
      const timeout = setTimeout(() => settle(false), timeoutMs);
      timeout.unref?.();
      socket.once("connect", () => settle(true));
      socket.once("error", () => settle(false));
    });
  }

  private async killDaemonProcess() {
    await stopChildProcessTree(this.daemonProcess);
  }

  private async stopOrphanedBundledDaemons() {
    await stopOrphanedStellaBrowserDaemons();
  }

  private async getListeningProcessesForPort(port: number): Promise<number[]> {
    if (!Number.isFinite(port) || port <= 0) {
      return [];
    }

    try {
      if (process.platform === "win32") {
        const { stdout } = await execFileAsync(
          "powershell",
          [
            "-NoProfile",
            "-Command",
            `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`,
          ],
          {
            encoding: "utf8",
            windowsHide: true,
            maxBuffer: 1024 * 1024,
          },
        );

        return stdout
          .split(/\r?\n/)
          .map((value) => Number.parseInt(value.trim(), 10))
          .filter((value) => Number.isFinite(value) && value > 0);
      }

      const { stdout } = await execFileAsync(
        "lsof",
        ["-ti", `tcp:${port}`, "-s", "tcp:listen"],
        {
          encoding: "utf8",
          maxBuffer: 1024 * 1024,
        },
      );

      return stdout
        .split(/\r?\n/)
        .map((value) => Number.parseInt(value.trim(), 10))
        .filter((value) => Number.isFinite(value) && value > 0);
    } catch {
      return [];
    }
  }

  private async waitForPortToClose(port: number, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;

    if (process.platform === "win32") {
      while (Date.now() < deadline) {
        if (!(await this.isTcpPortListening(port))) {
          return true;
        }
        await delay(150);
      }

      return !(await this.isTcpPortListening(port));
    }

    while (Date.now() < deadline) {
      if ((await this.getListeningProcessesForPort(port)).length === 0) {
        return true;
      }
      await delay(100);
    }

    return (await this.getListeningProcessesForPort(port)).length === 0;
  }

  private async killProcessListeningOnPort(port: number) {
    const binaryPath = resolveStellaBrowserBinaryPath();
    const isBridgeDaemon = (pid: number) =>
      process.platform === "win32"
        ? binaryPath !== null && pidRunsExecutable(pid, binaryPath)
        : Boolean(pidCommandLine(pid)?.includes("service run"));
    const pids = await this.getListeningProcessesForPort(port);
    await Promise.all(
      pids.map(async (pid) => {
        if (!isBridgeDaemon(pid)) {
          console.warn(
            `[stella-browser-bridge] Port ${port} is held by pid ${pid}, which is not a browser bridge daemon; leaving it running.`,
          );
          return;
        }
        if (process.platform === "win32") {
          await execFileAsync("taskkill", ["/pid", String(pid), "/T", "/F"], {
            windowsHide: true,
          }).catch(() => undefined);
          return;
        }
        await terminateOwnedProcess(
          pid,
          () => isBridgeDaemon(pid),
          DAEMON_SHUTDOWN_TIMEOUT_MS,
        );
      }),
    );
  }
}

const getSocketDir = () => getBrowserBridgeNamespace().socketDir;

const requireCapabilityString = (value: string, name: string) => {
  const normalized = value.trim();
  if (!normalized || normalized.length > 512 || normalized.includes("\0")) {
    throw new Error(`${name} must be a non-empty capability string.`);
  }
  return normalized;
};

const requireCapabilityTimestamp = (value: number) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("ownerLeaseIssuedAt must be a positive integer.");
  }
  return value;
};

const agentBackendResult = (
  backend: AgentBackendRecord,
): StellaBrowserAgentBackend => ({
  bridgeSessionId: backend.bridgeSessionId,
  capabilityExpiresAt: backend.capabilityExpiresAt,
});

const getSocketPath = (session: string) =>
  path.join(getSocketDir(), `${session}.sock`);

export const isStellaBrowserBridgeBinaryInstalled = (): boolean => {
  try {
    const stellaBrowserRoot = resolveStellaBrowserRoot();
    activateStagedStellaBrowserBinary(stellaBrowserRoot);
    const binaryPath = resolveStellaBrowserBinaryPath(stellaBrowserRoot);
    return Boolean(binaryPath && existsSync(binaryPath));
  } catch {
    return false;
  }
};

export const isStellaExtensionInstalled = (): boolean => {
  for (const root of chromiumUserDataRoots()) {
    let entries;
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        if (
          existsSync(
            path.join(
              root,
              entry.name,
              "Extensions",
              STELLA_BROWSER_EXTENSION_ID,
            ),
          )
        ) {
          return true;
        }
      } catch {
        // Ignore unreadable profile paths; keep probing the rest.
      }
    }
  }
  return false;
};

export const isBrowserBridgeEagerStartWorthwhile = (): boolean => {
  try {
    const manifestPath = path.join(
      getSocketDir(),
      `${STELLA_NATIVE_MESSAGING_HOST_NAME}.json`,
    );
    if (existsSync(manifestPath)) {
      return true;
    }
  } catch {
    // existsSync only throws on pathological inputs; treat as "no signal".
  }

  return isStellaExtensionInstalled();
};

const getPortForSession = (session: string) => {
  let hash = 0;
  for (const char of session) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }

  const normalized = hash === -2147483648 ? 2147483648 : Math.abs(hash);
  return 49152 + (normalized % 16383);
};
