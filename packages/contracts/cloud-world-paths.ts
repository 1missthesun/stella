/**
 * Paths inside a cloud owner's world, as the cloud tools see them. A cloud
 * turn's reply links its files by these absolute paths (`/workspace/world/
 * drive/reports/a.md`, or the forked `/workspace/forks/<id>/world/drive/...`);
 * every client maps such a link onto the owner's drive rather than treating it
 * as a file on the local machine, which it never is.
 */
const WORLD_DRIVE_LINK_RE =
  /^\/workspace\/(?:forks\/[^/]+\/)?world\/drive\/(.+)$/;

/**
 * The drive-relative path (`reports/a.md`) a world-absolute link names, or
 * null when the path is not inside the world's drive. Traversal segments and
 * the tool host's private `.stella` state directory never resolve.
 */
export const cloudWorldDrivePath = (filePath: string): string | null => {
  const match = WORLD_DRIVE_LINK_RE.exec(filePath.trim());
  return match?.[1] ? safeDriveRelativePath(match[1]) : null;
};

/**
 * `relative` as a drive path a client may fetch, or null. Trailing slashes
 * go; empty, `.` and `..` segments and the tool host's private `.stella`
 * state directory never resolve.
 */
export const safeDriveRelativePath = (relative: string): string | null => {
  const trimmed = relative.replace(/\/+$/, "");
  if (!trimmed) return null;
  const segments = trimmed.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    ) ||
    segments.includes(".stella")
  ) {
    return null;
  }
  return trimmed;
};

/**
 * True when `filePath` names anything inside the cloud sandbox filesystem:
 * the checkpointed world (`/workspace/world/...`, or a fork's
 * `/workspace/forks/<id>/world/...`), the app build root, and the per-turn
 * scratch beside them.
 *
 * The drive is the one part of it a client can fetch, through
 * `cloudWorldDrivePath` and an owner-scoped drive URL. Everything else is
 * reachable only from inside a cloud turn — but none of it, drive included,
 * is a path on the user's own computer, so a client must never fall back to
 * reading such a path off a paired machine. That fallback finds nothing and
 * reports the file as missing, which is false: the file exists, just not
 * there.
 */
export const isCloudWorkspacePath = (filePath: string): boolean => {
  const trimmed = filePath.trim();
  return trimmed === "/workspace" || trimmed.startsWith("/workspace/");
};

const WORLD_APPS_RE = /^\/workspace\/(?:forks\/[^/]+\/)?world\/apps(?:\/|$)/;

/**
 * True when `filePath` is inside the world's apps folder
 * (`/workspace/world/apps/<slug>/...`): the source, manifest and build status
 * of a cloud app Stella builds and hosts. Those are the app's own workings,
 * shown in Apps, never files of the user's.
 */
export const isCloudWorldAppPath = (filePath: string): boolean =>
  WORLD_APPS_RE.test(filePath.trim());

export const cloudWorldDriveName = (drivePath: string): string =>
  drivePath.slice(drivePath.lastIndexOf("/") + 1);

/**
 * The device-neutral link to a file in the owner's Stella Drive:
 * `stella://drive/<drive-relative path>`, written raw inside angle brackets
 * (`[clip](<stella://drive/Launch video/clip.mp4>)`) or URL-encoded. Every
 * client opens it from the drive, whichever device or turn wrote it.
 */
export const DRIVE_LINK_SCHEME = "stella://drive/";

const decodeLinkPart = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/**
 * The drive-relative path a link target names: a `stella://drive/...` link,
 * or a cloud turn's world-absolute `/workspace/world/drive/...` path. Null for
 * anything else, and for traversal or the private `.stella` directory.
 */
export const driveLinkPath = (target: string): string | null => {
  const trimmed = target.trim();
  if (!trimmed) return null;
  if (trimmed.slice(0, DRIVE_LINK_SCHEME.length).toLowerCase() === DRIVE_LINK_SCHEME) {
    return safeDriveRelativePath(
      decodeLinkPart(trimmed.slice(DRIVE_LINK_SCHEME.length)).replace(/^\/+/, ""),
    );
  }
  return cloudWorldDrivePath(trimmed) ?? cloudWorldDrivePath(decodeLinkPart(trimmed));
};

/** One canonical spelling of a drive link, for comparing and keying. */
export const driveLinkTarget = (drivePath: string): string =>
  `${DRIVE_LINK_SCHEME}${drivePath}`;

/** The canonical drive link a `stella://drive/...` target names, or null. */
export const parseDriveLinkTarget = (target: string): string | null => {
  const trimmed = target.trim();
  if (trimmed.slice(0, DRIVE_LINK_SCHEME.length).toLowerCase() !== DRIVE_LINK_SCHEME) {
    return null;
  }
  const drivePath = driveLinkPath(trimmed);
  return drivePath ? driveLinkTarget(drivePath) : null;
};
