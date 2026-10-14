import { randomUUID } from "node:crypto";
import {
  DEVICE_REQUEST_DEVICE_HEADERS,
  buildDeviceRequestChallenge,
  buildDeviceRequestDeviceProofMessage,
  deviceRequestPath,
  deviceRequestParamsHash,
  type DeviceRequestErrorCode,
} from "@stella/contracts/turn-plane/device-requests";
import {
  DEVICES_PATH,
  type DevicesResponse,
} from "@stella/contracts/turn-plane/placement";
import {
  isDeviceFileStat,
  parseDeviceFolderListing,
  type DeviceFileStat,
  type DeviceFolderListing,
} from "@stella/contracts/device-file-reads";

const REQUEST_TIMEOUT_MS = 60_000;
const DEVICES_CACHE_MS = 10_000;
const PROBE_TIMEOUT_MS = 8_000;

export class PeerDeviceFileError extends Error {
  readonly code: DeviceRequestErrorCode | "network";
  constructor(message: string, code: DeviceRequestErrorCode | "network") {
    super(message);
    this.name = "PeerDeviceFileError";
    this.code = code;
  }
}

export type PeerComputer = { deviceId: string; label: string };

export type PeerDeviceFiles = {
  onlineComputers: () => Promise<PeerComputer[]>;
  stat: (
    deviceId: string,
    filePath: string,
    conversationId?: string | null,
  ) => Promise<DeviceFileStat>;
  read: (
    deviceId: string,
    filePath: string,
    range: { offset: number; length: number } | null,
    conversationId?: string | null,
  ) => Promise<{ bytes: Uint8Array; mimeType: string }>;
  list: (
    deviceId: string,
    filePath: string,
    conversationId?: string | null,
  ) => Promise<DeviceFolderListing>;
  findHolder: (
    filePath: string,
    options?: { preferred?: string | null; conversationId?: string | null },
  ) => Promise<{ computer: PeerComputer; stat: DeviceFileStat } | null>;
  setSelectedDevice: (deviceId: string | null) => void;
};

type Deps = {
  getBackendUrl: () => string | null;
  getAuthToken: () => Promise<string | null>;
  getDeviceId: () => string | null;
  sign: (message: string) => Promise<string>;
  fetchImpl?: typeof fetch;
};

const readError = async (response: Response): Promise<PeerDeviceFileError> => {
  let code: DeviceRequestErrorCode = "failed";
  let message = "That computer could not answer.";
  try {
    const parsed = (await response.json()) as {
      error?: { code?: unknown; message?: unknown };
    };
    if (typeof parsed?.error?.code === "string") {
      code = parsed.error.code as DeviceRequestErrorCode;
    }
    if (typeof parsed?.error?.message === "string" && parsed.error.message.trim()) {
      message = parsed.error.message.trim();
    }
  } catch {
    // Keep the generic copy.
  }
  return new PeerDeviceFileError(message, code);
};

export const createPeerDeviceFiles = (deps: Deps): PeerDeviceFiles => {
  const fetchImpl = deps.fetchImpl ?? fetch;
  let devicesCache: { at: number; owner: string; value: Promise<PeerComputer[]> } | null =
    null;
  let selectedDeviceId: string | null = null;

  const base = () => deps.getBackendUrl()?.trim().replace(/\/+$/, "") || null;

  const request = async (
    deviceId: string,
    method: "file.read" | "file.stat" | "file.list",
    params: Record<string, unknown>,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<Response> => {
    const baseUrl = base();
    const token = await deps.getAuthToken().catch(() => null);
    const ownDeviceId = deps.getDeviceId();
    if (!baseUrl || !token || !ownDeviceId) {
      throw new PeerDeviceFileError(
        "Sign in to open files from your other computers.",
        "unauthorized",
      );
    }
    const requestId = `peer:${randomUUID()}`;
    const paramsJson = JSON.stringify(params);
    const challenge = buildDeviceRequestChallenge({
      requestId,
      method,
      paramsHash: await deviceRequestParamsHash(paramsJson),
      targetDeviceId: deviceId,
    });
    const issuedAt = Date.now();
    const signature = await deps.sign(
      buildDeviceRequestDeviceProofMessage({
        requesterDeviceId: ownDeviceId,
        targetDeviceId: deviceId,
        challenge,
        issuedAt,
      }),
    );
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${deviceRequestPath(deviceId)}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          [DEVICE_REQUEST_DEVICE_HEADERS.deviceId]: ownDeviceId,
          [DEVICE_REQUEST_DEVICE_HEADERS.signature]: signature,
          [DEVICE_REQUEST_DEVICE_HEADERS.issuedAt]: String(issuedAt),
        },
        body: JSON.stringify({ requestId, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new PeerDeviceFileError(
        "Couldn't reach Stella's cloud to open that file.",
        "network",
      );
    }
    if (!response.ok) throw await readError(response);
    return response;
  };

  const withConversation = (conversationId?: string | null) =>
    conversationId?.trim() ? { conversationId: conversationId.trim() } : {};

  const stat: PeerDeviceFiles["stat"] = async (deviceId, filePath, conversationId) => {
    const response = await request(deviceId, "file.stat", {
      filePath,
      ...withConversation(conversationId),
    });
    const value = (await response.json().catch(() => null)) as unknown;
    if (!isDeviceFileStat(value)) {
      throw new PeerDeviceFileError("That computer sent an unreadable answer.", "failed");
    }
    return value;
  };

  const onlineComputers = async (): Promise<PeerComputer[]> => {
    const baseUrl = base();
    const token = await deps.getAuthToken().catch(() => null);
    if (!baseUrl || !token) return [];
    const owner = `${baseUrl}\0${token.slice(-24)}`;
    const now = Date.now();
    if (devicesCache && devicesCache.owner === owner && now - devicesCache.at < DEVICES_CACHE_MS) {
      return await devicesCache.value;
    }
    const value = (async () => {
      const response = await fetchImpl(`${baseUrl}${DEVICES_PATH}`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return [];
      const body = (await response.json().catch(() => null)) as DevicesResponse | null;
      const own = deps.getDeviceId();
      return (body?.devices ?? [])
        .filter((device) => device.online && device.deviceId !== own)
        .map((device) => ({
          deviceId: device.deviceId,
          label: device.label?.trim() || "another computer",
        }));
    })().catch(() => [] as PeerComputer[]);
    devicesCache = { at: now, owner, value };
    return await value;
  };

  return {
    onlineComputers,
    stat,
    read: async (deviceId, filePath, range, conversationId) => {
      const response = await request(deviceId, "file.read", {
        filePath,
        ...withConversation(conversationId),
        ...(range ? { offset: range.offset, length: range.length } : {}),
      });
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        mimeType:
          response.headers.get("content-type")?.split(";")[0]?.trim() ||
          "application/octet-stream",
      };
    },
    list: async (deviceId, filePath, conversationId) => {
      const response = await request(deviceId, "file.list", {
        filePath,
        ...withConversation(conversationId),
      });
      const listing = parseDeviceFolderListing(await response.json().catch(() => null));
      if (!listing) {
        throw new PeerDeviceFileError("That computer sent an unreadable answer.", "failed");
      }
      return listing;
    },
    findHolder: async (filePath, options = {}) => {
      const computers = await onlineComputers();
      if (computers.length === 0) return null;
      const probe = async (computer: PeerComputer) => {
        const found = await request(computer.deviceId, "file.stat", {
          filePath,
          ...withConversation(options.conversationId),
        }, PROBE_TIMEOUT_MS)
          .then(async (response) => (await response.json()) as unknown)
          .catch(() => null);
        if (!isDeviceFileStat(found)) throw new Error("absent");
        return { computer, stat: found };
      };
      const ranked = [options.preferred ?? null, selectedDeviceId].filter(
        (deviceId, index, all): deviceId is string =>
          !!deviceId && all.indexOf(deviceId) === index,
      );
      const probes = new Map(computers.map((computer) => [computer.deviceId, probe(computer)]));
      for (const pending of probes.values()) pending.catch(() => null);
      for (const deviceId of ranked) {
        const found = await probes.get(deviceId)?.catch(() => null);
        if (found) return found;
      }
      const rest = computers
        .filter((computer) => !ranked.includes(computer.deviceId))
        .map((computer) => probes.get(computer.deviceId)!);
      if (rest.length === 0) return null;
      return await Promise.any(rest).catch(() => null);
    },
    setSelectedDevice: (deviceId) => {
      selectedDeviceId = deviceId?.trim() || null;
    },
  };
};
