import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import {
  createDriveFileVersionStore,
  type DriveFileVersion,
} from "@stella/contracts/drive-file-versions";
import {
  backendClient,
  subscribeBackendAccount,
} from "@/platform/backend/backend-client";

export const driveFileVersions = createDriveFileVersionStore(() => backendClient);

subscribeBackendAccount(() => driveFileVersions.reset());

const versionMark = (version: DriveFileVersion): string =>
  version === undefined ? "\u0000" : version === null ? "\u0001" : version;

export const useDriveFileVersions = (
  paths: readonly string[],
): readonly DriveFileVersion[] => {
  const key = paths.join("\n");
  useEffect(() => {
    if (!key) return;
    const releases = key.split("\n").map((path) => driveFileVersions.watch(path));
    return () => {
      for (const release of releases) release();
    };
  }, [key]);
  const snapshot = useCallback(
    () => (key ? key.split("\n").map((path) => versionMark(driveFileVersions.version(path))).join("\n") : ""),
    [key],
  );
  const joined = useSyncExternalStore(driveFileVersions.subscribe, snapshot);
  const cached = useRef<{
    key: string;
    joined: string;
    versions: readonly DriveFileVersion[];
  }>({ key: "", joined: "", versions: [] });
  if (cached.current.key !== key || cached.current.joined !== joined) {
    cached.current = {
      key,
      joined,
      versions: paths.map((path) => driveFileVersions.version(path)),
    };
  }
  return cached.current.versions;
};

export const useDriveFileVersion = (path: string | null): DriveFileVersion =>
  useDriveFileVersions(path ? [path] : [])[0];

/**
 * "" while the file is still the version first seen here, then the new
 * version once it is replaced: a key that refetches only on a real change.
 */
export const useDriveFileRevision = (path: string | null): string => {
  const version = useDriveFileVersion(path);
  const first = useRef<{ path: string | null; version: DriveFileVersion }>({
    path,
    version: undefined,
  });
  if (first.current.path !== path) first.current = { path, version: undefined };
  if (first.current.version === undefined && version !== undefined) {
    first.current.version = version;
  }
  return version === undefined || version === first.current.version ? "" : (version ?? "missing");
};
