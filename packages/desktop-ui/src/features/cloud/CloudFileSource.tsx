import { serverNow, steadyNow } from "@stella/contracts/server-clock";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { isDocumentFolderAsset } from "@stella/contracts/html-relative-assets";
import type { DriveFileUrl } from "@stella/contracts/backend/drive";
import { DisplayFileSourceContext } from "@/shared/hooks/display-file-source";
import { backendClient } from "@/platform/backend/backend-client";
import { driveFileVersions, useDriveFileRevision } from "./drive-file-versions";
import {
  fetchWithInactivity,
  REQUEST_BUDGET_MS,
} from "@stella/contracts/request-deadline";

const drivePathFor = (documentPath: string, filePath: string): string => {
  const document = `/${documentPath}`;
  const requested = filePath.startsWith("/") ? filePath : `/${filePath}`;
  if (requested === document) return documentPath;
  if (isDocumentFolderAsset(document, requested)) return requested.slice(1);
  throw new Error("This file isn’t beside the Drive document.");
};

type DriveRead = { bytes: Uint8Array; truncated: boolean; mimeType: string };

const LINK_MARGIN_MS = 60_000;
const KEPT_READS = 16;
const KEPT_READ_BYTES = 128 * 1024 * 1024;

const JUST_FETCHED_MS = 10_000;

// @reloadable signed links and downloads; a newer copy asks again
const links = new Map<string, { at: number; value: Promise<DriveFileUrl> }>();
// @reloadable see above
const reads = new Map<string, { value: Promise<DriveRead>; bytes: number }>();

export const driveFileLink = async (path: string): Promise<DriveFileUrl> => {
  const pending = links.get(path);
  if (pending) {
    const link = await pending.value.catch(() => null);
    const known = driveFileVersions.version(path);
    if (
      link &&
      link.expiresAt - LINK_MARGIN_MS > serverNow() &&
      (known === link.version ||
        (known === undefined && steadyNow() - pending.at < JUST_FETCHED_MS))
    ) {
      return link;
    }
  }
  const value = backendClient.call("drive.fileUrl", { path });
  const entry = { at: steadyNow(), value };
  links.set(path, entry);
  value.catch(() => {
    if (links.get(path) === entry) links.delete(path);
  });
  return await value;
};

const download = async (url: string, maxBytes: number): Promise<DriveRead> => {
  const response = await fetchWithInactivity(
    fetch,
    url,
    { headers: { Range: `bytes=0-${maxBytes}` } },
    { label: "Drive file", idleMs: REQUEST_BUDGET_MS.transferIdle },
  );
  if (!response.ok) throw new Error("Couldn’t load this Drive file.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("This Drive file has no readable content.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - size;
      chunks.push(value.subarray(0, remaining));
      size += Math.min(value.length, remaining);
      if (value.length > remaining) { truncated = true; break; }
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return { bytes, truncated, mimeType: response.headers.get("content-type") ?? "application/octet-stream" };
};

const keepRead = (key: string, value: Promise<DriveRead>) => {
  const entry = { value, bytes: 0 };
  reads.set(key, entry);
  value.then(
    (read) => {
      entry.bytes = read.bytes.byteLength;
      let total = 0;
      for (const kept of reads.values()) total += kept.bytes;
      for (const [oldKey, kept] of reads) {
        if (reads.size <= KEPT_READS && total <= KEPT_READ_BYTES) break;
        if (kept === entry) continue;
        total -= kept.bytes;
        reads.delete(oldKey);
      }
    },
    () => {
      if (reads.get(key) === entry) reads.delete(key);
    },
  );
};

export const readDriveFile = async (path: string, maxBytes: number): Promise<DriveRead> => {
  const link = await driveFileLink(path);
  const key = `${path}\0${link.version}\0${maxBytes}`;
  const kept = reads.get(key);
  if (kept) {
    reads.delete(key);
    reads.set(key, kept);
    return await kept.value;
  }
  const value = download(link.url, maxBytes);
  keepRead(key, value);
  return await value;
};

export function CloudFileSource({ path, children }: { path: string; children: ReactNode }) {
  const id = useId();
  const revision = useDriveFileRevision(path);
  const [base, setBase] = useState<{ path: string; tag: string | null }>(() => ({
    path,
    tag: driveFileVersions.version(path) ?? null,
  }));
  const current = base.path === path ? base : { path, tag: driveFileVersions.version(path) ?? null };
  if (current !== base) setBase(current);
  useEffect(() => {
    if (current.tag !== null) return;
    let live = true;
    void driveFileLink(path).then(
      (link) => {
        if (live) setBase({ path, tag: link.version });
      },
      () => {
        if (live) setBase({ path, tag: `mount:${id}` });
      },
    );
    return () => {
      live = false;
    };
  }, [current.tag, id, path]);
  useEffect(() => {
    driveFileVersions.track(path);
  }, [path]);
  const tag = revision || current.tag;
  const source = useMemo(() => tag === null ? null : ({
    key: `drive:${path}:${tag}`,
    drivePath: path,
    async mediaUrl() {
      return (await driveFileLink(path)).url;
    },
    async read(filePath: string, maxBytes = 32 * 1024 * 1024) {
      return await readDriveFile(drivePathFor(path, filePath), maxBytes);
    },
  }), [path, tag]);
  if (!source) return null;
  return <DisplayFileSourceContext.Provider value={source}>{children}</DisplayFileSourceContext.Provider>;
}
