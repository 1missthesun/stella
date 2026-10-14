import { pathToFileURL } from "node:url";
import path from "node:path";
import { net, session } from "electron";
import type { DeviceFileSource } from "@stella/contracts/device-files";
import type { DeviceFileLocator } from "../services/device-file-locator.js";
import type { PeerDeviceFiles } from "../services/peer-device-files.js";
import { DEVICE_FILE_READ_LIMITS } from "@stella/contracts/device-file-reads";
import {
  publicDeviceFileSource,
  resolveDeviceFileSource,
  type DeviceFileSourceDeps,
} from "../services/device-file-source.js";

export const MEDIA_SCHEME = "stella-media";
export const MEDIA_ORIGIN = `${MEDIA_SCHEME}://local`;
export const MEDIA_PROBE_PARTITION = "persist:stella-media-probe";

export const MEDIA_SCHEME_PRIVILEGES = {
  scheme: MEDIA_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
  },
} as const;

export const mediaUrlForPath = (filePath: string): string =>
  `${MEDIA_ORIGIN}/${encodeURIComponent(path.resolve(filePath))}`;

const requestedMediaPath = (url: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${MEDIA_SCHEME}:`) return null;
  const encoded = parsed.pathname.replace(/^\//, "");
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded) || null;
  } catch {
    return null;
  }
};

let deviceFiles: DeviceFileSourceDeps | null = null;

export const setDeviceMediaSource = (deps: DeviceFileSourceDeps | null) => {
  deviceFiles = deps;
};

let peerFiles: PeerDeviceFiles | null = null;
let activeConversation: () => string | null = () => null;

export const setPeerMediaSource = (
  peers: PeerDeviceFiles | null,
  getConversationId: () => string | null,
) => {
  peerFiles = peers;
  activeConversation = getConversationId;
};

type PeerHolder = NonNullable<Awaited<ReturnType<PeerDeviceFiles["findHolder"]>>>;
const HOLDER_CACHE_MS = 30_000;
const holders = new Map<string, { at: number; value: Promise<PeerHolder | null> }>();

const findPeerHolder = async (
  requested: string,
  source: Awaited<ReturnType<typeof resolveDeviceFileSource>>,
): Promise<PeerHolder | null> => {
  const peers = peerFiles;
  if (!peers || source.kind === "local") return null;
  const now = Date.now();
  for (const [key, entry] of holders) {
    if (now - entry.at >= HOLDER_CACHE_MS) holders.delete(key);
  }
  const cached = holders.get(requested);
  if (cached) return await cached.value;
  const preferred =
    source.kind === "drive" || source.kind === "elsewhere" ? source.deviceId : null;
  const value = peers
    .findHolder(requested, { preferred, conversationId: activeConversation() })
    .then((found) => (found && found.stat.kind === "file" ? found : null))
    .catch(() => null);
  holders.set(requested, { at: now, value });
  const found = await value;
  if (!found) holders.delete(requested);
  return found;
};

export const describeMediaSource = async (
  requested: string,
): Promise<DeviceFileSource> => {
  const source = await resolveDeviceFileSource(requested, deviceFiles);
  const holder = await findPeerHolder(requested, source);
  if (holder) return { kind: "device", deviceName: holder.computer.label };
  return publicDeviceFileSource(source);
};

const parseRange = (
  header: string | null,
  sizeBytes: number,
): { start: number; end: number } | null => {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;
  if (!rawStart) {
    const suffix = Number(rawEnd);
    return { start: Math.max(0, sizeBytes - suffix), end: sizeBytes - 1 };
  }
  const start = Number(rawStart);
  const end = rawEnd ? Math.min(Number(rawEnd), sizeBytes - 1) : sizeBytes - 1;
  return start <= end ? { start, end } : null;
};

const streamFromPeer = async (
  peers: PeerDeviceFiles,
  holder: PeerHolder,
  requested: string,
  request: Request,
): Promise<Response> => {
  const sizeBytes = holder.stat.sizeBytes;
  const headers = new Headers({
    "access-control-allow-origin": "*",
    "accept-ranges": "bytes",
    "content-type": holder.stat.mimeType || "application/octet-stream",
  });
  if (request.method === "HEAD") {
    headers.set("content-length", String(sizeBytes));
    return new Response(null, { status: 200, headers });
  }
  const asked = parseRange(request.headers.get("range"), sizeBytes);
  if (request.headers.get("range") && !asked) {
    headers.set("content-range", `bytes */${sizeBytes}`);
    return new Response(null, { status: 416, headers });
  }
  const start = asked?.start ?? 0;
  const end = Math.min(
    asked?.end ?? sizeBytes - 1,
    start + DEVICE_FILE_READ_LIMITS.rangeBytes - 1,
  );
  const read = await peers.read(
    holder.computer.deviceId,
    requested,
    { offset: start, length: end - start + 1 },
    activeConversation(),
  );
  headers.set("content-length", String(read.bytes.byteLength));
  headers.set(
    "content-range",
    `bytes ${start}-${start + read.bytes.byteLength - 1}/${sizeBytes}`,
  );
  return new Response(read.bytes, { status: 206, headers });
};

const withMediaHeaders = (upstream: Response, contentType?: string): Response => {
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set("access-control-allow-origin", "*");
  responseHeaders.set("accept-ranges", "bytes");
  if (contentType && !responseHeaders.get("content-type")) {
    responseHeaders.set("content-type", contentType);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
};

const rangeHeaders = (request: Request): Headers => {
  const headers = new Headers();
  const range = request.headers.get("range");
  if (range) headers.set("range", range);
  return headers;
};

const streamDriveCopy = async (
  locator: DeviceFileLocator,
  drivePath: string,
  request: Request,
): Promise<Response> => {
  for (const fresh of [false, true]) {
    const file = await locator.copyUrl(drivePath, { fresh });
    const upstream = await net.fetch(file.url, {
      method: request.method === "HEAD" ? "HEAD" : "GET",
      headers: rangeHeaders(request),
    });
    if ((upstream.status === 401 || upstream.status === 403) && !fresh) {
      await upstream.body?.cancel().catch(() => undefined);
      continue;
    }
    return withMediaHeaders(upstream, file.contentType);
  }
  return new Response("Drive copy unavailable", { status: 502 });
};

export const serveMediaProtocol = (
  partition: string,
  options: { devices?: boolean } = {},
) => {
  const partitionSession = session.fromPartition(partition);
  if (partitionSession.protocol.isProtocolHandled(MEDIA_SCHEME)) return;
  const useDevices = options.devices ?? true;
  partitionSession.protocol.handle(MEDIA_SCHEME, async (request) => {
    const requested = requestedMediaPath(request.url);
    if (!requested) return new Response("Bad media path", { status: 400 });
    const devices = useDevices ? deviceFiles : null;
    try {
      const source = await resolveDeviceFileSource(requested, devices);
      if (source.kind === "local") {
        return withMediaHeaders(
          await net.fetch(pathToFileURL(source.filePath).toString(), {
            headers: rangeHeaders(request),
            bypassCustomProtocolHandlers: true,
          }),
        );
      }
      const holder = useDevices ? await findPeerHolder(requested, source) : null;
      if (holder && peerFiles) {
        return await streamFromPeer(peerFiles, holder, requested, request);
      }
      if (source.kind === "drive" && devices) {
        return await streamDriveCopy(devices.locator, source.drivePath, request);
      }
      return new Response("Not found", { status: 404 });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
};
