import { File } from "expo-file-system";
import type { DeviceFileLocation } from "@stella/contracts/backend/drive";
import {
  DEVICE_FILE_READ_LIMITS,
  DEVICE_FOLDER_CONTENT_TYPE,
  deviceFileReadRanges,
  isDeviceFileStat,
  parseDeviceFolderListing,
  type DeviceFileStat,
  type DeviceFolderListing,
} from "@stella/contracts/device-file-reads";
import {
  DEVICE_FILE_COPY_LIMITS,
  deviceFileElsewhereMessage,
  friendlyDeviceName,
  pickDeviceFileLocation,
} from "@stella/contracts/device-files";
import { EVIDENCE_THUMBNAIL_VARIANT } from "@stella/contracts/chat-evidence-thumbnails";
import { getBackendClient } from "./backend";
import {
  DeviceRequestError,
  decodeUtf8,
  requestDevice,
  type DeviceRequestOptions,
} from "./device-requests";
import { listExecutionDevices } from "./execution-placement";
import { getStoredPhoneAccess, type StoredPhoneAccess } from "./phone-access";

const COMPUTERS_CACHE_MS = 10_000;
const RESOLUTION_CACHE_MS = 15_000;
const PROBE_TIMEOUT_MS = 8_000;
const READ_TIMEOUT_MS = 120_000;
const LIST_TIMEOUT_MS = 30_000;
const OFFICE_PREVIEW_TIMEOUT_MS = 60_000;

export type OnlineComputer = { deviceId: string; label: string };

export type DeviceFileTarget = {
  deviceId: string;
  deviceName: string;
  access: StoredPhoneAccess;
};

export type LinkedFileSource =
  | {
      kind: "device";
      target: DeviceFileTarget;
      stat: DeviceFileStat | null;
    }
  | {
      kind: "drive";
      drivePath: string;
      contentType: string;
      sizeBytes: number;
      deviceName: string;
    };

export class LinkedFileMissingError extends Error {
  constructor(filePath: string) {
    super(`${fileNameOf(filePath)} isn't on any of your computers that are online.`);
    this.name = "LinkedFileMissingError";
  }
}

export const isLinkedFileMissingError = (error: unknown): boolean =>
  error instanceof LinkedFileMissingError;

const fileNameOf = (filePath: string): string =>
  filePath.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || filePath;

const abortError = (): Error => {
  const error = new Error("Artifact loading cancelled.");
  error.name = "AbortError";
  return error;
};

const assertActive = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw abortError();
};

export const locateDeviceFile = async (
  filePath: string,
): Promise<DeviceFileLocation | null> => {
  try {
    const { files } = await getBackendClient().call("drive.locateDeviceFiles", {
      paths: [filePath],
    });
    return pickDeviceFileLocation(files, filePath);
  } catch {
    return null;
  }
};

let computersCache: {
  at: number;
  value: Promise<OnlineComputer[] | null>;
} | null = null;

export const onlineComputers = (): Promise<OnlineComputer[] | null> => {
  const now = Date.now();
  if (computersCache && now - computersCache.at < COMPUTERS_CACHE_MS) {
    return computersCache.value;
  }
  const value = listExecutionDevices()
    .then((devices) =>
      devices
        .filter((device) => device.online)
        .map((device) => ({
          deviceId: device.deviceId,
          label: friendlyDeviceName(device.label),
        })),
    )
    .catch(() => null);
  computersCache = { at: now, value };
  return value;
};

const targetFor = async (
  access: StoredPhoneAccess,
  deviceId: string,
  deviceName: string,
): Promise<DeviceFileTarget> => {
  if (deviceId === access.desktopDeviceId) {
    return { deviceId, deviceName, access };
  }
  const own = await getStoredPhoneAccess(deviceId).catch(() => null);
  return { deviceId, deviceName, access: own ?? access };
};

const requestOptions = (
  target: DeviceFileTarget,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): DeviceRequestOptions => ({
  ...(signal ? { signal } : {}),
  timeoutMs,
  ...(target.deviceId !== target.access.desktopDeviceId
    ? { targetDeviceId: target.deviceId }
    : {}),
});

const statOn = async (
  target: DeviceFileTarget,
  conversationId: string,
  filePath: string,
  signal?: AbortSignal,
): Promise<DeviceFileStat> => {
  const { bytes } = await requestDevice(
    target.access,
    "file.stat",
    { filePath, conversationId },
    requestOptions(target, signal, PROBE_TIMEOUT_MS),
  );
  let value: unknown = null;
  try {
    value = JSON.parse(decodeUtf8(bytes));
  } catch {
    value = null;
  }
  if (!isDeviceFileStat(value)) {
    throw new DeviceRequestError("That computer sent an unreadable answer.", "failed", 200);
  }
  return value;
};

const firstFound = <T>(probes: Promise<T>[]): Promise<T | null> =>
  new Promise((resolve) => {
    let pending = probes.length;
    if (pending === 0) resolve(null);
    for (const probe of probes) {
      probe.then(resolve, () => {
        pending -= 1;
        if (pending === 0) resolve(null);
      });
    }
  });

const errorCode = (error: unknown): string | null =>
  error instanceof DeviceRequestError ? error.code : null;

const resolveUncached = async (
  access: StoredPhoneAccess | null,
  conversationId: string,
  filePath: string,
  preferDeviceId: string | null,
): Promise<LinkedFileSource> => {
  const [location, computers] = await Promise.all([
    locateDeviceFile(filePath),
    access ? onlineComputers() : Promise.resolve([] as OnlineComputer[]),
  ]);
  const labelOf = (deviceId: string): string =>
    computers?.find((computer) => computer.deviceId === deviceId)?.label ??
    (location?.deviceId === deviceId
      ? friendlyDeviceName(location.deviceName)
      : "your computer");
  const isOnline = (deviceId: string): boolean =>
    computers === null
      ? deviceId === access?.desktopDeviceId
      : computers.some((computer) => computer.deviceId === deviceId);

  let pairedError: unknown = null;
  if (access) {
    const candidates = [
      ...new Set(
        [
          preferDeviceId,
          location?.deviceId ?? null,
          ...(computers ?? []).map((computer) => computer.deviceId),
          computers === null ? access.desktopDeviceId : null,
        ].filter((id): id is string => Boolean(id) && isOnline(id as string)),
      ),
    ];
    const first = candidates.filter(
      (id) => id === preferDeviceId || id === location?.deviceId,
    );
    const rest = candidates.filter((id) => !first.includes(id));
    const probe = async (deviceId: string) => {
      const target = await targetFor(access, deviceId, labelOf(deviceId));
      try {
        const stat = await statOn(target, conversationId, filePath);
        return { kind: "device" as const, target, stat };
      } catch (error) {
        if (deviceId === access.desktopDeviceId) pairedError = error;
        throw error;
      }
    };
    for (const deviceId of first) {
      const found = await probe(deviceId).catch(() => null);
      if (found) return found;
    }
    if (rest.length > 0) {
      const found = await firstFound(rest.map(probe));
      if (found) return found;
    }
  }

  if (location?.drivePath) {
    return {
      kind: "drive",
      drivePath: location.drivePath,
      contentType: location.contentType || "application/octet-stream",
      sizeBytes: location.sizeBytes,
      deviceName: friendlyDeviceName(location.deviceName),
    };
  }
  if (
    access &&
    isOnline(access.desktopDeviceId) &&
    pairedError &&
    errorCode(pairedError) !== "not_found"
  ) {
    return {
      kind: "device",
      target: await targetFor(
        access,
        access.desktopDeviceId,
        labelOf(access.desktopDeviceId),
      ),
      stat: null,
    };
  }

  if (location && !isOnline(location.deviceId)) {
    throw new Error(
      deviceFileElsewhereMessage(location.deviceName, {
        oversized: location.sizeBytes > DEVICE_FILE_COPY_LIMITS.maxFileBytes,
      }),
    );
  }
  if (!access) {
    throw new Error("Pair this phone with your computer to open its files here.");
  }
  if (pairedError && errorCode(pairedError) === "forbidden" && pairedError instanceof Error) {
    throw pairedError;
  }
  throw new LinkedFileMissingError(filePath);
};

const resolutions = new Map<
  string,
  { at: number; value: Promise<LinkedFileSource> }
>();

const withAbort = <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
};

export const resolveLinkedFile = (
  access: StoredPhoneAccess | null,
  conversationId: string,
  filePath: string,
  options?: { signal?: AbortSignal; preferDeviceId?: string | null },
): Promise<LinkedFileSource> => {
  const preferDeviceId = options?.preferDeviceId ?? null;
  const key = `${access?.desktopDeviceId ?? ""}\0${preferDeviceId ?? ""}\0${conversationId}\0${filePath}`;
  const now = Date.now();
  const cached = resolutions.get(key);
  if (cached && now - cached.at < RESOLUTION_CACHE_MS) {
    return withAbort(cached.value, options?.signal);
  }
  const value = resolveUncached(access, conversationId, filePath, preferDeviceId);
  resolutions.set(key, { at: now, value });
  value.catch(() => {
    if (resolutions.get(key)?.value === value) resolutions.delete(key);
  });
  return withAbort(value, options?.signal);
};

export const linkedSourceIsFolder = (source: LinkedFileSource): boolean =>
  source.kind === "device"
    ? source.stat?.kind === "directory"
    : source.contentType === DEVICE_FOLDER_CONTENT_TYPE;

export const linkedSourceSize = (source: LinkedFileSource): number | null =>
  source.kind === "device" ? (source.stat?.sizeBytes ?? null) : source.sizeBytes;

export const linkedSourceDeviceId = (source: LinkedFileSource): string | null =>
  source.kind === "device" ? source.target.deviceId : null;

const readOnce = async (
  target: DeviceFileTarget,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; contentType: string }> =>
  await requestDevice(
    target.access,
    "file.read",
    params,
    requestOptions(target, signal, READ_TIMEOUT_MS),
  );

const driveCopyUrl = async (
  drivePath: string,
): Promise<{ url: string; contentType: string }> => {
  const file = await getBackendClient().call("drive.fileUrl", { path: drivePath });
  return { url: file.url, contentType: file.contentType };
};

const tooLarge = (): Error =>
  new Error("That file is too large to open on your phone.");

export const readLinkedFileBytes = async (
  source: LinkedFileSource,
  conversationId: string,
  filePath: string,
  options: { signal?: AbortSignal; maxBytes: number },
): Promise<{ bytes: Uint8Array; mimeType: string }> => {
  const { signal, maxBytes } = options;
  if (source.kind === "drive") {
    if (source.sizeBytes > maxBytes) throw tooLarge();
    const file = await driveCopyUrl(source.drivePath);
    const response = await fetch(file.url, { signal });
    if (!response.ok) {
      throw new Error("Couldn't load the copy of this file in your Drive.");
    }
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mimeType: file.contentType || source.contentType,
    };
  }
  const stat = source.stat;
  if (!stat || stat.sizeBytes <= DEVICE_FILE_READ_LIMITS.rangeBytes) {
    const { bytes, contentType } = await readOnce(
      source.target,
      { filePath, conversationId },
      signal,
    );
    return { bytes, mimeType: stat?.mimeType || contentType };
  }
  if (stat.sizeBytes > maxBytes) throw tooLarge();
  const out = new Uint8Array(stat.sizeBytes);
  for (const range of deviceFileReadRanges(stat.sizeBytes)) {
    assertActive(signal);
    const { bytes } = await readOnce(
      source.target,
      { filePath, conversationId, offset: range.offset, length: range.length },
      signal,
    );
    out.set(bytes.subarray(0, range.length), range.offset);
  }
  return { bytes: out, mimeType: stat.mimeType };
};

type ProgressListener = (receivedBytes: number, totalBytes: number) => void;
const progressListeners = new Map<string, Set<ProgressListener>>();

export const subscribeLinkedFileProgress = (
  filePath: string,
  listener: ProgressListener,
): (() => void) => {
  const listeners = progressListeners.get(filePath) ?? new Set();
  listeners.add(listener);
  progressListeners.set(filePath, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) progressListeners.delete(filePath);
  };
};

const emitProgress = (filePath: string, received: number, total: number) => {
  for (const listener of progressListeners.get(filePath) ?? []) {
    listener(received, total);
  }
};

const removeQuietly = (file: File): void => {
  try {
    if (file.exists) file.delete();
  } catch {
  }
};

export const downloadLinkedFile = async (
  source: LinkedFileSource,
  conversationId: string,
  filePath: string,
  target: File,
  options: { signal?: AbortSignal; maxBytes: number },
): Promise<{ uri: string; mimeType: string; sizeBytes: number }> => {
  const { signal, maxBytes } = options;
  const known = linkedSourceSize(source);
  if (known !== null && known > maxBytes) throw tooLarge();
  const part = new File(`${target.uri}.part`);
  removeQuietly(part);
  part.create({ overwrite: true, intermediates: true });
  let mimeType = "application/octet-stream";
  try {
    if (source.kind === "drive") {
      const file = await driveCopyUrl(source.drivePath);
      mimeType = file.contentType || source.contentType;
      await File.downloadFileAsync(file.url, part, { idempotent: true });
    } else if (!source.stat || source.stat.sizeBytes <= DEVICE_FILE_READ_LIMITS.rangeBytes) {
      const { bytes, contentType } = await readOnce(
        source.target,
        { filePath, conversationId },
        signal,
      );
      if (bytes.byteLength > maxBytes) throw tooLarge();
      mimeType = source.stat?.mimeType || contentType;
      part.write(bytes);
    } else {
      const total = source.stat.sizeBytes;
      mimeType = source.stat.mimeType;
      let received = 0;
      emitProgress(filePath, 0, total);
      for (const range of deviceFileReadRanges(total)) {
        assertActive(signal);
        const { bytes } = await readOnce(
          source.target,
          { filePath, conversationId, offset: range.offset, length: range.length },
          signal,
        );
        if (range.offset === 0 && bytes.byteLength === total) {
          part.write(bytes);
          received = total;
          break;
        }
        if (bytes.byteLength !== range.length) {
          throw new Error("The file changed while it was loading. Try again.");
        }
        part.write(bytes, { append: true });
        received += bytes.byteLength;
        emitProgress(filePath, received, total);
      }
    }
    assertActive(signal);
    removeQuietly(target);
    part.moveSync(target);
  } catch (error) {
    removeQuietly(part);
    throw error;
  }
  return { uri: target.uri, mimeType, sizeBytes: target.size ?? known ?? 0 };
};

export const listLinkedFolder = async (
  source: LinkedFileSource,
  conversationId: string,
  filePath: string,
  signal?: AbortSignal,
): Promise<DeviceFolderListing> => {
  let value: unknown = null;
  if (source.kind === "device") {
    const { bytes } = await requestDevice(
      source.target.access,
      "file.list",
      { filePath, conversationId },
      requestOptions(source.target, signal, LIST_TIMEOUT_MS),
    );
    try {
      value = JSON.parse(decodeUtf8(bytes));
    } catch {
      value = null;
    }
  } else {
    const file = await driveCopyUrl(source.drivePath);
    const response = await fetch(file.url, { signal });
    if (!response.ok) {
      throw new Error("Couldn't load this folder's listing from your Drive.");
    }
    value = await response.json().catch(() => null);
  }
  const listing = parseDeviceFolderListing(value);
  if (!listing) throw new Error("Couldn't read this folder's listing.");
  return listing;
};

export const readLinkedThumbnail = async (
  source: Extract<LinkedFileSource, { kind: "device" }>,
  conversationId: string,
  filePath: string,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; mimeType: string }> => {
  const { bytes, contentType } = await readOnce(
    source.target,
    { filePath, conversationId, variant: EVIDENCE_THUMBNAIL_VARIANT },
    signal,
  );
  return { bytes, mimeType: contentType };
};

export const renderLinkedOfficePreview = async (
  source: Extract<LinkedFileSource, { kind: "device" }>,
  conversationId: string,
  filePath: string,
  signal?: AbortSignal,
): Promise<string> => {
  const { bytes } = await requestDevice(
    source.target.access,
    "officePreview.render",
    { filePath, conversationId },
    requestOptions(source.target, signal, OFFICE_PREVIEW_TIMEOUT_MS),
  );
  return decodeUtf8(bytes);
};
