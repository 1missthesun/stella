import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  normalizeServerOrigin,
  parsePairingLink,
  parseServerDiscovery,
  SELF_HOST_DISCOVERY_PATH,
  type PairingClaimRequest,
  type PairingLink,
  type ServerDiscovery,
} from "@stella/contracts/self-host";
import {
  DESKTOP_HOSTED_SERVER_ID,
  type DesktopServerEntry,
  type DesktopServerState,
  type SelfHostConnectResult,
  type SelfHostSwitchResult,
} from "@stella/contracts/desktop/self-host";
import type {
  SelfHostInspectResult,
  SelfHostPairingStartResult,
  SelfHostPairingStatusResult,
} from "@stella/contracts/desktop/self-host";
import {
  checkServerSession,
  forgetServerData,
  hasServerSession,
  launcherServerId,
  serverDataDir,
  writeServerSession,
} from "./auth-service.js";
import {
  fetchWithDeadline,
  isRequestTimeout,
  REQUEST_BUDGET_MS,
} from "@stella/contracts/request-deadline";

export const SERVER_FILE_NAME = "server.json";
const SERVER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type ServerFile = {
  origin: string;
  serverId: string;
  name: string;
  urls?: {
    canvasShare?: string | null;
    sites?: string | null;
    appsHost?: string | null;
    appsAuthHost?: string | null;
  };
};

const launcherDataDir = (): string | null =>
  process.env.STELLA_LAUNCHER_DATA_DIR?.trim() || null;

const serverFilePath = (): string | null => {
  const dir = launcherDataDir();
  return dir ? path.join(dir, SERVER_FILE_NAME) : null;
};

type ServerRecord = ServerFile & { addedAt: number };

const parseServerFile = (file: string): ServerRecord | null => {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<ServerRecord>;
    const origin = normalizeServerOrigin(parsed.origin ?? "");
    if (!origin || typeof parsed.serverId !== "string" || !SERVER_ID_PATTERN.test(parsed.serverId)) {
      return null;
    }
    return {
      origin,
      serverId: parsed.serverId,
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : "Stella",
      urls: parsed.urls && typeof parsed.urls === "object" ? parsed.urls : undefined,
      addedAt: typeof parsed.addedAt === "number" ? parsed.addedAt : 0,
    };
  } catch {
    return null;
  }
};

export const readServerFile = (): ServerFile | null => {
  const file = serverFilePath();
  if (!file) return null;
  const record = parseServerFile(file);
  if (!record) return null;
  const { addedAt: _addedAt, ...value } = record;
  return value;
};

const writeJsonAtomic = (file: string, value: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const staging = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(staging, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(staging, file);
};

const savedServerFile = (serverId: string): string | null => {
  const dir = serverDataDir(serverId);
  return dir ? path.join(dir, SERVER_FILE_NAME) : null;
};

const readSavedServer = (serverId: string): ServerRecord | null => {
  const file = savedServerFile(serverId);
  const record = file ? parseServerFile(file) : null;
  return record?.serverId === serverId ? record : null;
};

const rememberServer = (value: ServerFile) => {
  const file = savedServerFile(value.serverId);
  if (!file) return;
  const addedAt = readSavedServer(value.serverId)?.addedAt || Date.now();
  writeJsonAtomic(file, { ...value, addedAt });
};

const savedServerIds = (): string[] => {
  const probe = serverDataDir(DESKTOP_HOSTED_SERVER_ID);
  if (!probe) return [];
  try {
    return fs
      .readdirSync(path.dirname(probe), { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name !== DESKTOP_HOSTED_SERVER_ID &&
          SERVER_ID_PATTERN.test(entry.name),
      )
      .map((entry) => entry.name);
  } catch {
    return [];
  }
};

export const applySelfHostedServerEnv = () => {
  const serverId = launcherServerId();
  if (!serverId) return;
  process.env.VITE_STELLA_SELF_HOSTED = "1";
  const file = readServerFile();
  if (!file || file.serverId !== serverId) return;
  const set = (key: string, value: string | null | undefined) => {
    const origin = value ? normalizeServerOrigin(value) : null;
    if (origin && !process.env[key]?.trim()) process.env[key] = origin;
  };
  set("VITE_STELLA_APPS_HOST", file.urls?.appsHost);
  set("VITE_STELLA_APPS_AUTH_HOST", file.urls?.appsAuthHost);
  if (file.urls?.canvasShare) {
    process.env.VITE_CANVAS_SHARE_BASE_URL = file.urls.canvasShare;
    process.env.CANVAS_SHARE_BASE_URL = file.urls.canvasShare;
  }
};

const withTimeout = async (url: string, init: RequestInit = {}): Promise<Response> =>
  await fetchWithDeadline(fetch, url, init, {
    label: "Stella server",
    timeoutMs: REQUEST_BUDGET_MS.lookup,
  });

const describeNetworkError = (error: unknown): string =>
  isRequestTimeout(error)
    ? "The server took too long to answer."
    : "Couldn't reach the server. Check the address and your connection.";

const readError = async (response: Response, fallback: string): Promise<string> => {
  const body = (await response.json().catch(() => null)) as
    | { error?: unknown; message?: unknown }
    | null;
  const message = typeof body?.message === "string" ? body.message : typeof body?.error === "string" ? body.error : "";
  return message.trim() || fallback;
};

const fetchDiscovery = async (origin: string): Promise<ServerDiscovery> => {
  let response: Response;
  try {
    response = await withTimeout(`${origin}${SELF_HOST_DISCOVERY_PATH}`, {
      headers: { Accept: "application/json" },
    });
  } catch (error) {
    throw new Error(describeNetworkError(error));
  }
  if (!response.ok) {
    throw new Error("That address isn't a Stella server (no server info at /.well-known/stella).");
  }
  const discovery = parseServerDiscovery(await response.json().catch(() => null));
  if (!discovery) throw new Error("The server's info couldn't be read.");
  if (!SERVER_ID_PATTERN.test(discovery.serverId)) throw new Error("The server's id isn't valid.");
  if (normalizeServerOrigin(discovery.urls.backend) !== origin) {
    throw new Error("The server's info names a different address.");
  }
  return discovery;
};

const serverFileFor = (origin: string, discovery: ServerDiscovery): ServerFile => ({
  origin,
  serverId: discovery.serverId,
  name: discovery.name,
  urls: {
    canvasShare: discovery.urls.canvasShare,
    sites: discovery.urls.sites,
    appsHost: discovery.urls.appsHost,
    appsAuthHost: discovery.urls.appsAuthHost,
  },
});

const devicePlatform = (): PairingClaimRequest["platform"] =>
  process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux";

const deviceName = (): string => {
  const host = os.hostname().replace(/\.local$/i, "").trim();
  return (host || "Desktop").slice(0, 80);
};

export type SelfHostServiceOptions = {
  getBackendUrl: () => string | null;
  getAuthToken: () => Promise<string | null>;
  applySessionToken: (token: string) => Promise<unknown>;
  relaunch: () => void;
  canRelaunchThroughLauncher: () => boolean;
  onPairingLink: (link: string) => void;
};

export class SelfHostService {
  private pendingLink: string | null = null;

  constructor(private readonly options: SelfHostServiceOptions) {}

  getState(): DesktopServerState {
    const serverId = launcherServerId();
    const file = serverId ? readServerFile() : null;
    return {
      canSwitch: Boolean(launcherDataDir()) && this.options.canRelaunchThroughLauncher(),
      selfHosted: Boolean(serverId),
      serverId,
      name: serverId ? (file?.serverId === serverId ? file.name : null) : null,
      backendUrl: this.options.getBackendUrl(),
    };
  }

  receiveLink(url: string) {
    if (!parsePairingLink(url)) return;
    this.pendingLink = url;
    this.options.onPairingLink(url);
  }

  takePendingLink(): string | null {
    const link = this.pendingLink;
    this.pendingLink = null;
    return link;
  }

  private parse(text: string): PairingLink | null {
    return parsePairingLink(typeof text === "string" ? text.trim() : "");
  }

  async inspectLink(text: string): Promise<SelfHostInspectResult> {
    const link = this.parse(text);
    if (!link) return { ok: false, error: "That isn't a Stella pairing link. It starts with stella://pair." };
    try {
      return { ok: true, server: link.server, discovery: await fetchDiscovery(link.server) };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  async connect(text: string): Promise<SelfHostConnectResult> {
    const link = this.parse(text);
    if (!link) return { ok: false, error: "That isn't a Stella pairing link. It starts with stella://pair." };
    if (!this.getState().canSwitch) {
      return { ok: false, error: "This version of the Stella app can't switch servers yet. Update Stella and try again." };
    }
    let discovery: ServerDiscovery;
    try {
      discovery = await fetchDiscovery(link.server);
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
    const claim: PairingClaimRequest = {
      pairingId: link.pairingId,
      secret: link.secret,
      deviceName: deviceName(),
      platform: devicePlatform(),
    };
    let sessionToken: string;
    try {
      const response = await withTimeout(`${link.server}/api/auth/device-pairing/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(claim),
      });
      if (!response.ok) {
        return {
          ok: false,
          error: await readError(
            response,
            response.status === 429
              ? "Too many tries. Wait a minute and try again."
              : "This pairing link has expired or was already used. Make a new one on the server.",
          ),
        };
      }
      const body = (await response.json().catch(() => null)) as { sessionToken?: unknown } | null;
      sessionToken = typeof body?.sessionToken === "string" ? body.sessionToken.trim() : "";
    } catch (error) {
      return { ok: false, error: describeNetworkError(error) };
    }
    if (!sessionToken) return { ok: false, error: "The server didn't return a session." };

    if (launcherServerId() === discovery.serverId) {
      await this.options.applySessionToken(sessionToken);
      try {
        rememberServer(serverFileFor(link.server, discovery));
      } catch {
        // The session is live; the list entry is backfilled on the next listing.
      }
      return { ok: true, relaunching: false };
    }
    const server = serverFileFor(link.server, discovery);
    try {
      writeServerSession(discovery.serverId, link.server, sessionToken);
      rememberServer(server);
      this.writeServerFile(server);
    } catch (error) {
      return { ok: false, error: `Couldn't save the connection: ${(error as Error).message}` };
    }
    setTimeout(() => this.options.relaunch(), 400);
    return { ok: true, relaunching: true };
  }

  useDefault(): SelfHostConnectResult {
    const file = serverFilePath();
    if (!file || !this.getState().canSwitch) {
      return { ok: false, error: "This version of the Stella app can't switch servers yet." };
    }
    try {
      fs.rmSync(file, { force: true });
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
    setTimeout(() => this.options.relaunch(), 400);
    return { ok: true, relaunching: true };
  }

  listServers(): DesktopServerEntry[] {
    const activeId = launcherServerId();
    if (activeId && !readSavedServer(activeId)) {
      const current = readServerFile();
      if (current?.serverId === activeId) {
        try {
          rememberServer(current);
        } catch {
          // Listed from server.json below either way.
        }
      }
    }
    const records = savedServerIds()
      .map((id) => readSavedServer(id))
      .filter((record): record is ServerRecord => record !== null)
      .sort((a, b) => a.addedAt - b.addedAt);
    return [
      {
        id: DESKTOP_HOSTED_SERVER_ID,
        kind: "hosted",
        name: "Stella",
        origin: null,
        active: !activeId,
        signedIn: true,
      },
      ...records.map((record): DesktopServerEntry => ({
        id: record.serverId,
        kind: "self-hosted",
        name: record.name,
        origin: record.origin,
        active: record.serverId === activeId,
        signedIn: record.serverId === activeId || hasServerSession(record.serverId),
      })),
    ];
  }

  async switchServer(serverId: string): Promise<SelfHostSwitchResult> {
    if (!this.getState().canSwitch) {
      return { ok: false, reason: "error", error: "This version of the Stella app can't switch servers yet." };
    }
    if (serverId === DESKTOP_HOSTED_SERVER_ID) {
      const result = this.useDefault();
      return result.ok ? result : { ok: false, reason: "error", error: result.error };
    }
    if (serverId === launcherServerId()) return { ok: true, relaunching: false };
    const record = readSavedServer(serverId);
    if (!record) return { ok: false, reason: "error", error: "This server isn't saved on this computer." };
    let server: ServerFile = record;
    try {
      const discovery = await fetchDiscovery(record.origin);
      if (discovery.serverId !== serverId) {
        return { ok: false, reason: "error", error: "That address now runs a different server. Remove it and connect again." };
      }
      server = serverFileFor(record.origin, discovery);
    } catch (error) {
      return { ok: false, reason: "error", error: (error as Error).message };
    }
    const session = await checkServerSession(serverId, record.origin);
    if (session === "unreachable") {
      return { ok: false, reason: "error", error: "Couldn't reach the server. Check your connection and try again." };
    }
    if (session === "expired") {
      return {
        ok: false,
        reason: "needs_pairing",
        error: `Your sign-in to ${server.name} has expired. Paste a new pairing link from the server to connect again.`,
      };
    }
    try {
      rememberServer(server);
      this.writeServerFile(server);
    } catch (error) {
      return { ok: false, reason: "error", error: `Couldn't switch: ${(error as Error).message}` };
    }
    setTimeout(() => this.options.relaunch(), 400);
    return { ok: true, relaunching: true };
  }

  removeServer(serverId: string): { ok: boolean } {
    if (
      serverId === DESKTOP_HOSTED_SERVER_ID ||
      !SERVER_ID_PATTERN.test(serverId) ||
      serverId === launcherServerId()
    ) {
      return { ok: false };
    }
    try {
      forgetServerData(serverId);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  private writeServerFile(value: ServerFile) {
    const file = serverFilePath();
    if (!file) throw new Error("The launcher's data folder is unknown.");
    writeJsonAtomic(file, value);
  }

  private async ownerRequest(pathname: string, init: RequestInit = {}): Promise<Response> {
    const backend = this.options.getBackendUrl();
    const token = await this.options.getAuthToken();
    if (!backend || !token) throw new Error("Sign in to this server first.");
    return await withTimeout(`${backend}${pathname}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });
  }

  async startPairing(): Promise<SelfHostPairingStartResult> {
    if (!launcherServerId()) return { ok: false, error: "Only a self-hosted server pairs devices this way." };
    try {
      const response = await this.ownerRequest("/api/auth/device-pairing/start", {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!response.ok) return { ok: false, error: await readError(response, "The server couldn't start pairing.") };
      const body = (await response.json().catch(() => null)) as {
        pairingId?: unknown;
        link?: unknown;
        expiresAt?: unknown;
      } | null;
      const link = typeof body?.link === "string" ? body.link : "";
      if (typeof body?.pairingId !== "string" || !parsePairingLink(link) || typeof body.expiresAt !== "number") {
        return { ok: false, error: "The server's pairing answer couldn't be read." };
      }
      return { ok: true, pairingId: body.pairingId, link, expiresAt: body.expiresAt };
    } catch (error) {
      return { ok: false, error: (error as Error).message || describeNetworkError(error) };
    }
  }

  async pairingStatus(pairingId: string): Promise<SelfHostPairingStatusResult> {
    if (typeof pairingId !== "string" || !pairingId) return { ok: false, error: "Missing pairing." };
    try {
      const response = await this.ownerRequest(
        `/api/auth/device-pairing/status?pairingId=${encodeURIComponent(pairingId)}`,
      );
      if (!response.ok) return { ok: false, error: await readError(response, "The server couldn't check pairing.") };
      const body = (await response.json().catch(() => null)) as {
        status?: unknown;
        deviceName?: unknown;
        claimedAt?: unknown;
      } | null;
      const status = body?.status;
      if (status !== "pending" && status !== "claimed" && status !== "expired" && status !== "canceled") {
        return { ok: false, error: "The server's pairing status couldn't be read." };
      }
      return {
        ok: true,
        status,
        deviceName: typeof body?.deviceName === "string" ? body.deviceName : null,
        claimedAt: typeof body?.claimedAt === "number" ? body.claimedAt : null,
      };
    } catch (error) {
      return { ok: false, error: (error as Error).message || describeNetworkError(error) };
    }
  }

  async cancelPairing(pairingId: string): Promise<{ ok: boolean }> {
    if (typeof pairingId !== "string" || !pairingId) return { ok: false };
    try {
      const response = await this.ownerRequest("/api/auth/device-pairing/cancel", {
        method: "POST",
        body: JSON.stringify({ pairingId }),
      });
      return { ok: response.ok };
    } catch {
      return { ok: false };
    }
  }
}
