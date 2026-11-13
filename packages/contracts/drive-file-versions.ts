import {
  DRIVE_VERSIONS_MAX_PATHS,
  type DriveFileVersions,
} from "./backend/drive";

/** undefined: not known yet; null: no file at that path. */
export type DriveFileVersion = string | null | undefined;

type VersionsWatchClient = {
  watch(
    view: "drive.versions",
    args: { paths: string[] },
    onValue: (value: DriveFileVersions) => void,
  ): () => void;
};

export type DriveFileVersionStore = {
  /** Keeps `path` live while the returned release is not called. */
  watch(path: string): () => void;
  /** Keeps `path` live while it is among the most recently tracked paths. */
  track(path: string): void;
  version(path: string): DriveFileVersion;
  subscribe(listener: () => void): () => void;
  reset(): void;
};

const RESUBSCRIBE_DELAY_MS = 50;

/**
 * One live `drive.versions` subscription for every Drive path a client has on
 * screen or in a cache, so a file replaced under the same name reaches it.
 */
export const createDriveFileVersionStore = (
  getClient: () => VersionsWatchClient | null,
): DriveFileVersionStore => {
  const watched = new Map<string, number>();
  const tracked = new Map<string, true>();
  const known = new Map<string, string | null>();
  const listeners = new Set<() => void>();
  let stop: (() => void) | null = null;
  let subscribedKey = "";
  let timer: ReturnType<typeof setTimeout> | null = null;

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const wanted = (): string[] => {
    const paths = [...watched.keys()].slice(0, DRIVE_VERSIONS_MAX_PATHS);
    const recent = [...tracked.keys()].reverse();
    for (const path of recent) {
      if (paths.length >= DRIVE_VERSIONS_MAX_PATHS) break;
      if (!watched.has(path)) paths.push(path);
    }
    return paths.sort();
  };

  const apply = (paths: ReadonlySet<string>, value: DriveFileVersions) => {
    let changed = false;
    for (const [path, version] of Object.entries(value)) {
      if (!paths.has(path)) continue;
      if (known.has(path) && known.get(path) === version) continue;
      known.set(path, version);
      changed = true;
    }
    if (changed) emit();
  };

  const resubscribe = () => {
    timer = null;
    const paths = wanted();
    const key = paths.join("\n");
    if (key === subscribedKey) return;
    subscribedKey = key;
    const included = new Set(paths);
    let forgot = false;
    for (const path of known.keys()) {
      if (included.has(path)) continue;
      known.delete(path);
      forgot = true;
    }
    const previous = stop;
    stop = null;
    if (paths.length > 0) {
      const client = getClient();
      if (client) stop = client.watch("drive.versions", { paths }, (value) => apply(included, value));
    }
    previous?.();
    if (forgot) emit();
  };

  const schedule = () => {
    timer ??= setTimeout(resubscribe, RESUBSCRIBE_DELAY_MS);
  };

  return {
    watch(path) {
      watched.set(path, (watched.get(path) ?? 0) + 1);
      schedule();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const count = (watched.get(path) ?? 1) - 1;
        if (count > 0) watched.set(path, count);
        else watched.delete(path);
        schedule();
      };
    },
    track(path) {
      tracked.delete(path);
      tracked.set(path, true);
      while (tracked.size > DRIVE_VERSIONS_MAX_PATHS) {
        tracked.delete(tracked.keys().next().value as string);
      }
      schedule();
    },
    version: (path) => known.get(path),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset() {
      tracked.clear();
      known.clear();
      subscribedKey = "";
      stop?.();
      stop = null;
      schedule();
      emit();
    },
  };
};
