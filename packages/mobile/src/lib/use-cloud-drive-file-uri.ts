import { useEffect, useState } from "react";
import type { DriveFileUrl } from "@stella/contracts/backend/drive";
import { getBackendClient } from "./backend";

const REFRESH_MARGIN_MS = 30_000;

const cache = new Map<string, DriveFileUrl>();
const inflight = new Map<string, Promise<DriveFileUrl>>();
let generation = 0;

const fresh = (entry: DriveFileUrl | undefined): entry is DriveFileUrl =>
  entry !== undefined && entry.expiresAt > Date.now() + REFRESH_MARGIN_MS;

export const resolveCloudDriveFile = async (
  path: string,
): Promise<DriveFileUrl> => {
  const cached = cache.get(path);
  if (fresh(cached)) return cached;
  const pending = inflight.get(path);
  if (pending) return await pending;
  const owner = generation;
  const request: Promise<DriveFileUrl> = getBackendClient()
    .call("drive.fileUrl", { path })
    .then((entry) => {
      if (owner === generation) cache.set(path, entry);
      return entry;
    })
    .finally(() => {
      if (inflight.get(path) === request) inflight.delete(path);
    });
  inflight.set(path, request);
  return await request;
};

export const resolveCloudDriveFileUri = async (
  path: string,
): Promise<string> => (await resolveCloudDriveFile(path)).url;

export const cloudDriveUrlExpiry = (url: string): number | null => {
  for (const entry of cache.values()) {
    if (entry.url === url) return entry.expiresAt - REFRESH_MARGIN_MS;
  }
  return null;
};

export const clearCloudDriveFileUris = (): void => {
  generation += 1;
  cache.clear();
  inflight.clear();
};

export const useCloudDriveFileUri = (
  path: string | null,
): { uri: string | null; failed: boolean } => {
  const [state, setState] = useState<{
    path: string | null;
    uri: string | null;
    failed: boolean;
  }>(() => {
    const cached = path ? cache.get(path) : undefined;
    return { path, uri: fresh(cached) ? cached.url : null, failed: false };
  });

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      void resolveCloudDriveFileUri(path)
        .then((uri) => {
          if (cancelled) return;
          setState({ path, uri, failed: false });
          const expiresAt = cache.get(path)?.expiresAt ?? 0;
          const delay = Math.max(1_000, expiresAt - Date.now() - REFRESH_MARGIN_MS);
          timer = setTimeout(load, Math.min(delay, 2_147_483_647));
        })
        .catch(() => {
          if (!cancelled) setState({ path, uri: null, failed: true });
        });
    };
    load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [path]);

  if (state.path !== path) {
    const cached = path ? cache.get(path) : undefined;
    return { uri: fresh(cached) ? cached.url : null, failed: false };
  }
  return { uri: state.uri, failed: state.failed };
};
