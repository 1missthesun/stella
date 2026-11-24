import {
  DisplayFileSourceContext,
  type DisplayFileSource,
} from "./display-file-source";
import { useContext, useEffect, useState } from "react";
import { useOptionalUiState } from "@/context/ui-state";
import { readDeviceFileCopy } from "@/features/cloud/device-file-copy";
import {
  deviceFileMissingMessage,
  type DeviceFileMissingReason,
} from "@stella/contracts/device-files";

export type DisplayFileBlob = {
  url: string;
  mimeType: string;
  blob: Blob;
};

type DisplayFileRead =
  | {
      bytes: Uint8Array;
      mimeType: string;
      truncated?: boolean;
      missing?: false;
    }
  | {
      missing: true;
      mimeType: string;
      path: string;
      reason?: DeviceFileMissingReason;
    };

type FileStamp = { sizeBytes: number; modifiedAt: number | null };

type CacheEntry = {
  promise: Promise<DisplayFileRead>;
  resolved: DisplayFileRead | null;
  blob: Blob | null;
  url: string | null;
  refCount: number;
  idleSince: number;
  stamp: Promise<FileStamp | null> | null;
  checkedAt: number;
  stale: Set<() => void>;
};
const isDisplayFileApiAvailable = () =>
  typeof window !== "undefined" &&
  typeof window.electronAPI?.display?.readFile === "function";
const readDisplayFileRaw = async (
  filePath: string,
  unavailableMessage: string | undefined,
  conversationId: string | null,
  maxBytes: number | undefined,
): Promise<DisplayFileRead> => {
  if (!isDisplayFileApiAvailable()) {
    const copy = await readDeviceFileCopy(filePath, maxBytes);
    if (copy) return copy;
    throw new Error(
      unavailableMessage ?? "File preview requires the Electron host runtime.",
    );
  }
  try {
    return await window.electronAPI!.display.readFile(filePath, {
      conversationId,
      maxBytes,
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    throw new Error(
      message.replace(
        /^Error invoking remote method '[^']*': (?:\w*Error: )?/u,
        "",
      ),
    );
  }
};
// @reloadable a cache of file reads; a newer copy starts empty
const cache = new Map<string, CacheEntry>();

export const readDisplayFileOnce = (
  filePath: string,
  conversationId: string | null,
): Promise<DisplayFileRead> =>
  readDisplayFileRaw(filePath, undefined, conversationId, undefined);
const IDLE_CACHE_MAX_BYTES = 192 * 1024 * 1024;
const IDLE_CACHE_MAX_ENTRIES = 96;
const RECHECK_MS = 1500;
const displayFileCacheKey = (
  filePath: string,
  conversationId: string | null,
  version?: string | number,
  maxBytes?: number,
) =>
  `${conversationId ?? ""}\0${filePath}\0${version ?? ""}\0${maxBytes ?? ""}`;
const blobFromBytes = (entry: CacheEntry): Blob | null => {
  if (entry.blob) return entry.blob;
  const resolved = entry.resolved;
  if (!resolved || resolved.missing) return null;
  // `Blob` snapshots its parts, so an ArrayBuffer-backed view goes in as-is
  // (no extra full-buffer copy); only a shared buffer, which is not a valid
  // BlobPart, is copied first.
  const bytes = resolved.bytes;
  const part =
    bytes.buffer instanceof ArrayBuffer
      ? (bytes as Uint8Array<ArrayBuffer>)
      : new Uint8Array(bytes);
  const blob = new Blob([part], {
    type: resolved.mimeType || "application/octet-stream",
  });
  entry.blob = blob;
  return blob;
};
const objectUrlFor = (entry: CacheEntry): string | null => {
  if (entry.url) return entry.url;
  const blob = blobFromBytes(entry);
  if (!blob) return null;
  entry.url = URL.createObjectURL(blob);
  return entry.url;
};
const finalizeEvict = (cacheKey: string, entry: CacheEntry) => {
  if (entry.url) {
    URL.revokeObjectURL(entry.url);
    entry.url = null;
  }
  entry.blob = null;
  if (cache.get(cacheKey) === entry) cache.delete(cacheKey);
};

const entryBytes = (entry: CacheEntry): number =>
  entry.resolved && !entry.resolved.missing ? entry.resolved.bytes.byteLength : 0;

const trimIdle = () => {
  const idle = [...cache.entries()]
    .filter(([, entry]) => entry.refCount === 0 && entry.resolved)
    .sort((a, b) => a[1].idleSince - b[1].idleSince);
  let bytes = idle.reduce((sum, [, entry]) => sum + entryBytes(entry), 0);
  let count = idle.length;
  for (const [key, entry] of idle) {
    if (bytes <= IDLE_CACHE_MAX_BYTES && count <= IDLE_CACHE_MAX_ENTRIES) break;
    bytes -= entryBytes(entry);
    count -= 1;
    finalizeEvict(key, entry);
  }
};

const statFile = (
  filePath: string,
  conversationId: string | null,
): Promise<FileStamp | null> => {
  const stat = window.electronAPI?.display?.statPath;
  if (!stat) return Promise.resolve(null);
  return stat(filePath, { conversationId }).then(
    (result) =>
      result && result.kind === "file"
        ? {
            sizeBytes: result.sizeBytes,
            modifiedAt:
              typeof result.modifiedAt === "number" ? result.modifiedAt : null,
          }
        : null,
    () => null,
  );
};

const sameStamp = (a: FileStamp | null, b: FileStamp | null): boolean =>
  !a || !b || (a.sizeBytes === b.sizeBytes && a.modifiedAt === b.modifiedAt);

const recheck = (
  cacheKey: string,
  entry: CacheEntry,
  filePath: string,
  conversationId: string | null,
) => {
  const read = entry.stamp;
  if (!read || Date.now() - entry.checkedAt < RECHECK_MS) return;
  entry.checkedAt = Date.now();
  void Promise.all([read, statFile(filePath, conversationId)]).then(
    ([before, now]) => {
      if (cache.get(cacheKey) !== entry || sameStamp(before, now)) return;
      cache.delete(cacheKey);
      for (const notify of [...entry.stale]) notify();
      if (entry.refCount === 0) finalizeEvict(cacheKey, entry);
    },
  );
};
const acquire = (
  filePath: string,
  unavailableMessage: string | undefined,
  conversationId: string | null,
  version: string | number | undefined,
  maxBytes: number | undefined,
  source: DisplayFileSource | null,
): CacheEntry => {
  const cacheKey = displayFileCacheKey(
    filePath,
    conversationId,
    version,
    maxBytes,
  );
  let entry = cache.get(cacheKey);
  if (!entry) {
    const promise: Promise<DisplayFileRead> = source
      ? source.read(filePath, maxBytes)
      : readDisplayFileRaw(
          filePath,
          unavailableMessage,
          conversationId,
          maxBytes,
        );
    const created: CacheEntry = {
      promise,
      resolved: null,
      blob: null,
      url: null,
      refCount: 0,
      idleSince: 0,
      stamp: source ? null : statFile(filePath, conversationId),
      checkedAt: Date.now(),
      stale: new Set(),
    };
    entry = created;
    cache.set(cacheKey, created);
    void promise
      .then((result) => {
        if (cache.get(cacheKey) !== created) return;
        if (result.missing) {
          cache.delete(cacheKey);
          return;
        }
        created.resolved = result;
        if (created.refCount === 0) {
          created.idleSince = performance.now();
          trimIdle();
        }
      })
      .catch(() => {
        if (cache.get(cacheKey) === created) cache.delete(cacheKey);
      });
  } else if (entry.resolved) {
    recheck(cacheKey, entry, filePath, conversationId);
  }
  entry.refCount += 1;
  return entry;
};
const release = (cacheKey: string, entry: CacheEntry) => {
  entry.refCount = Math.max(0, entry.refCount - 1);
  if (entry.refCount > 0) return;
  entry.idleSince = performance.now();
  if (cache.get(cacheKey) !== entry) {
    finalizeEvict(cacheKey, entry);
    return;
  }
  trimIdle();
};

export const prefetchDisplayFile = (
  filePath: string,
  conversationId: string | null,
  onReady?: (url: string) => void,
): (() => void) => {
  const cacheKey = displayFileCacheKey(filePath, conversationId);
  const entry = acquire(filePath, undefined, conversationId, undefined, undefined, null);
  let released = false;
  void entry.promise.then(
    () => {
      const url = released ? null : objectUrlFor(entry);
      if (url) onReady?.(url);
    },
    () => undefined,
  );
  return () => {
    if (released) return;
    released = true;
    release(cacheKey, entry);
  };
};
export function useDisplayFileBytes(
  filePath: string,
  unavailableMessage?: string,
  conversationIdOverride?: string | null,
  version?: string | number,
  maxBytes?: number,
): {
  bytes: Uint8Array | null;
  error: string | null;
  loading: boolean;
  missing: boolean;
  truncated: boolean;
} {
  const source = useContext(DisplayFileSourceContext);
  const uiState = useOptionalUiState();
  const conversationId = source
    ? source.key
    : conversationIdOverride !== undefined
      ? conversationIdOverride
      : (uiState?.state.conversationId ?? null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reread, setReread] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMissing(false);
    setTruncated(false);
    setBytes(null);
    const cacheKey = displayFileCacheKey(
      filePath,
      conversationId,
      version,
      maxBytes,
    );
    const entry = acquire(
      filePath,
      unavailableMessage,
      conversationId,
      version,
      maxBytes,
      source,
    );
    const onStale = () => {
      if (!cancelled) setReread((count) => count + 1);
    };
    entry.stale.add(onStale);
    void entry.promise
      .then((result) => {
        if (cancelled) return;
        if (result.missing) {
          setMissing(true);
          setError(deviceFileMissingMessage(result.reason, filePath));
          return;
        }
        setBytes(result.bytes);
        setTruncated(result.truncated === true);
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      entry.stale.delete(onStale);
      release(cacheKey, entry);
    };
  }, [conversationId, filePath, maxBytes, unavailableMessage, version, source, reread]);
  return { bytes, error, loading, missing, truncated };
}

type BlobResult = {
  blob: DisplayFileBlob | null;
  missing: boolean;
  message?: string;
};

type BlobState = {
  key: string;
  files: Array<DisplayFileBlob | null>;
  error: string | null;
  loading: boolean;
  missing: boolean[];
  missingMessages: Array<string | null>;
};

const blobOf = (entry: CacheEntry): DisplayFileBlob | null => {
  const url = objectUrlFor(entry);
  const blob = entry.blob;
  if (!url || !blob || !entry.resolved || entry.resolved.missing) return null;
  return {
    url,
    mimeType: entry.resolved.mimeType || "application/octet-stream",
    blob,
  };
};

const cachedState = (
  key: string,
  filePaths: string[],
  conversationId: string | null,
): BlobState => {
  const empty = filePaths.map(() => null);
  const files: Array<DisplayFileBlob | null> = [];
  for (const filePath of filePaths) {
    const entry = cache.get(displayFileCacheKey(filePath, conversationId));
    const blob = entry?.resolved ? blobOf(entry) : null;
    if (!entry || !blob) {
      return {
        key,
        files: empty,
        error: null,
        loading: true,
        missing: filePaths.map(() => false),
        missingMessages: empty,
      };
    }
    if (entry.refCount === 0) entry.idleSince = performance.now();
    files.push(blob);
  }
  return {
    key,
    files,
    error: null,
    loading: false,
    missing: filePaths.map(() => false),
    missingMessages: empty,
  };
};

export function useDisplayFileBlobs(
  filePaths: string[],
  unavailableMessage?: string,
  conversationIdOverride?: string | null,
): {
  files: Array<DisplayFileBlob | null>;
  error: string | null;
  loading: boolean;
  missing: boolean[];
  missingMessages: Array<string | null>;
} {
  const source = useContext(DisplayFileSourceContext);
  const uiState = useOptionalUiState();
  const conversationId = source
    ? source.key
    : conversationIdOverride !== undefined
      ? conversationIdOverride
      : (uiState?.state.conversationId ?? null);
  const pathsKey = filePaths.join("|");
  const key = `${conversationId ?? ""}\0${pathsKey}`;
  const [reread, setReread] = useState(0);
  const [stored, setStored] = useState<BlobState>(() =>
    cachedState(key, filePaths, conversationId),
  );
  let state = stored;
  if (state.key !== key) {
    state = cachedState(key, filePaths, conversationId);
    setStored(state);
  }
  useEffect(() => {
    let cancelled = false;
    const paths = pathsKey ? pathsKey.split("|") : [];
    const acquired = paths.map((filePath) => ({
      cacheKey: displayFileCacheKey(filePath, conversationId),
      entry: acquire(
        filePath,
        unavailableMessage,
        conversationId,
        undefined,
        undefined,
        source,
      ),
    }));
    const onStale = () => {
      if (!cancelled) setReread((count) => count + 1);
    };
    for (const { entry } of acquired) entry.stale.add(onStale);
    const update = (next: Omit<BlobState, "key">) => {
      if (cancelled) return;
      setStored((previous) =>
        previous.key === key &&
        previous.loading === next.loading &&
        previous.error === next.error &&
        previous.files.every((file, index) => file?.url === next.files[index]?.url) &&
        previous.missing.every((value, index) => value === next.missing[index])
          ? previous
          : { key, ...next },
      );
    };
    const seeded = acquired.map(({ entry }) =>
      entry.resolved ? blobOf(entry) : undefined,
    );
    if (!seeded.every((blob) => blob)) {
      update({
        files: paths.map(() => null),
        error: null,
        loading: true,
        missing: paths.map(() => false),
        missingMessages: paths.map(() => null),
      });
    }
    let failure: string | null = null;
    void Promise.all(
      acquired.map(async ({ entry }, index): Promise<BlobResult> => {
        let result: DisplayFileRead | undefined;
        try {
          result = await entry.promise;
        } catch (caught) {
          failure = caught instanceof Error ? caught.message : String(caught);
          return { blob: null, missing: false };
        }
        if (result?.missing || entry.resolved?.missing) {
          return {
            blob: null,
            missing: true,
            message: deviceFileMissingMessage(
              result?.missing ? result.reason : undefined,
              paths[index],
            ),
          };
        }
        const blob = blobOf(entry);
        return blob ? { blob, missing: false } : { blob: null, missing: true };
      }),
    ).then((results) => {
      update({
        files: results.map((r) => r.blob),
        error: failure,
        loading: false,
        missing: results.map((r) => r.missing),
        missingMessages: results.map((r) => r.message ?? null),
      });
    });
    return () => {
      cancelled = true;
      for (const { cacheKey, entry } of acquired) {
        entry.stale.delete(onStale);
        release(cacheKey, entry);
      }
    };
  }, [key, pathsKey, conversationId, unavailableMessage, source, reread]);
  return {
    files: state.files,
    error: state.error,
    loading: state.loading,
    missing: state.missing,
    missingMessages: state.missingMessages,
  };
}
