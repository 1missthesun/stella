import { createReadStream, promises as fsPromises } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
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
import { contentTypeFromName } from "@stella/contracts/attachment-content-type";
import {
  fetchWithInactivity,
  REQUEST_BUDGET_MS,
} from "@stella/contracts/request-deadline";

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
    if (suffix <= 0 || sizeBytes === 0) return null;
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

// Media elements seek with Range requests; a 200 with the whole file instead
// of a 206 leaves the element unseekable, so scrubbing snaps back to the start.
const serveLocalFile = async (filePath: string, request: Request): Promise<Response> => {
  const stat = await fsPromises.stat(filePath);
  if (!stat.isFile()) return new Response("Not found", { status: 404 });
  const sizeBytes = stat.size;
  const headers = new Headers({
    "access-control-allow-origin": "*",
    "accept-ranges": "bytes",
  });
  // Unknown extensions go without a type so Chromium sniffs them, as it did for file:// loads.
  const contentType = contentTypeFromName(filePath);
  if (contentType) headers.set("content-type", contentType);
  if (request.method === "HEAD") {
    headers.set("content-length", String(sizeBytes));
    return new Response(null, { status: 200, headers });
  }
  const rangeHeader = request.headers.get("range");
  const asked = parseRange(rangeHeader, sizeBytes);
  if (rangeHeader && !asked) {
    headers.set("content-range", `bytes */${sizeBytes}`);
    return new Response(null, { status: 416, headers });
  }
  if (sizeBytes === 0) {
    headers.set("content-length", "0");
    return new Response(null, { status: 200, headers });
  }
  const start = asked?.start ?? 0;
  const end = asked?.end ?? sizeBytes - 1;
  headers.set("content-length", String(end - start + 1));
  if (asked) headers.set("content-range", `bytes ${start}-${end}/${sizeBytes}`);
  const body = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(body, { status: asked ? 206 : 200, headers });
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
    const upstream = await fetchWithInactivity(
      (url, init) => net.fetch(url, init),
      file.url,
      {
        method: request.method === "HEAD" ? "HEAD" : "GET",
        headers: rangeHeaders(request),
      },
      { label: "Drive media", idleMs: REQUEST_BUDGET_MS.transferIdle },
    );
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
        return await serveLocalFile(source.filePath, request);
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
