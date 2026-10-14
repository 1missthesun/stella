import {
  DisplayFileSourceContext,
  type DisplayFileSource,
} from "./display-file-source";
import { useContext, useEffect, useMemo, useState } from "react";
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

type CacheEntry = {
  promise: Promise<DisplayFileRead>;
  resolved: DisplayFileRead | null;
  blob: Blob | null;
  url: string | null;
  refCount: number;
  evictionTimer: ReturnType<typeof setTimeout> | null;
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
const cache = new Map<string, CacheEntry>();
const CACHE_GRACE_MS = 750;
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
      evictionTimer: null,
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
      })
      .catch(() => {
        if (cache.get(cacheKey) === created) cache.delete(cacheKey);
      });
  }
  if (entry.evictionTimer) {
    clearTimeout(entry.evictionTimer);
    entry.evictionTimer = null;
  }
  entry.refCount += 1;
  return entry;
};
const release = (cacheKey: string, entry: CacheEntry) => {
  entry.refCount = Math.max(0, entry.refCount - 1);
  if (entry.refCount > 0) return;
  if (entry.evictionTimer) clearTimeout(entry.evictionTimer);
  entry.evictionTimer = setTimeout(() => {
    if (entry.refCount === 0) finalizeEvict(cacheKey, entry);
  }, CACHE_GRACE_MS);
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
      release(cacheKey, entry);
    };
  }, [conversationId, filePath, maxBytes, unavailableMessage, version, source]);
  return { bytes, error, loading, missing, truncated };
}

type BlobResult = {
  blob: DisplayFileBlob | null;
  missing: boolean;
  message?: string;
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
  const [files, setFiles] = useState<Array<DisplayFileBlob | null>>(() =>
    filePaths.map(() => null),
  );
  const [missing, setMissing] = useState<boolean[]>(() =>
    filePaths.map(() => false),
  );
  const [missingMessages, setMissingMessages] = useState<Array<string | null>>(
    () => filePaths.map(() => null),
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const key = useMemo(
    () => `${conversationId ?? ""}\0${filePaths.join("|")}`,
    [conversationId, filePaths],
  );
  useEffect(() => {
    let cancelled = false;
    const acquired = filePaths.map((filePath) => ({
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
    const seeded = acquired.map(({ entry }): BlobResult | undefined => {
      const resolved = entry.resolved;
      if (!resolved) return undefined;
      if (resolved.missing) return { blob: null, missing: true };
      const url = objectUrlFor(entry);
      const blob = entry.blob;
      if (!url || !blob) return { blob: null, missing: true };
      return {
        blob: {
          url,
          mimeType: resolved.mimeType || "application/octet-stream",
          blob,
        },
        missing: false,
      };
    });
    if (seeded.every((result) => result !== undefined)) {
      setFiles(seeded.map((result) => result.blob));
      setMissing(seeded.map((result) => result.missing));
      setError(null);
      setLoading(false);
    } else {
      setLoading(true);
      setError(null);
      setMissing(filePaths.map(() => false));
      setFiles(filePaths.map(() => null));
    }
    void Promise.all(
      acquired.map(async ({ entry }, index): Promise<BlobResult> => {
        let result: DisplayFileRead | undefined;
        try {
          result = await entry.promise;
        } catch (caught) {
          if (!cancelled) {
            setError(caught instanceof Error ? caught.message : String(caught));
          }
          return { blob: null, missing: false };
        }
        if (result?.missing || entry.resolved?.missing) {
          return {
            blob: null,
            missing: true,
            message: deviceFileMissingMessage(
              result?.missing ? result.reason : undefined,
              filePaths[index],
            ),
          };
        }
        const url = objectUrlFor(entry);
        const blob = entry.blob;
        if (!url || !blob) return { blob: null, missing: true };
        return {
          blob: {
            url,
            mimeType: entry.resolved?.mimeType ?? "application/octet-stream",
            blob,
          },
          missing: false,
        };
      }),
    ).then((results) => {
      if (cancelled) return;
      setFiles(results.map((r) => r.blob));
      setMissing(results.map((r) => r.missing));
      setMissingMessages(results.map((r) => r.message ?? null));
      setLoading(false);
    });
    return () => {
      cancelled = true;
      for (const { cacheKey, entry } of acquired) release(cacheKey, entry);
    };
  }, [key, unavailableMessage, source]);
  return { files, error, loading, missing, missingMessages };
}
