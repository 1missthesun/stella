const WORLD_DRIVE_LINK_RE =
  /^\/workspace\/(?:forks\/[^/]+\/)?world\/drive\/(.+)$/;

export const cloudWorldDrivePath = (filePath: string): string | null => {
  const match = WORLD_DRIVE_LINK_RE.exec(filePath.trim());
  return match?.[1] ? safeDriveRelativePath(match[1]) : null;
};

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

export const isCloudWorkspacePath = (filePath: string): boolean => {
  const trimmed = filePath.trim();
  return trimmed === "/workspace" || trimmed.startsWith("/workspace/");
};

const WORLD_APPS_RE = /^\/workspace\/(?:forks\/[^/]+\/)?world\/apps(?:\/|$)/;

export const isCloudWorldAppPath = (filePath: string): boolean =>
  WORLD_APPS_RE.test(filePath.trim());

export const cloudWorldDriveName = (drivePath: string): string =>
  drivePath.slice(drivePath.lastIndexOf("/") + 1);

export const DRIVE_LINK_SCHEME = "stella://drive/";

const decodeLinkPart = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

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

export const driveLinkTarget = (drivePath: string): string =>
  `${DRIVE_LINK_SCHEME}${drivePath}`;

export const parseDriveLinkTarget = (target: string): string | null => {
  const trimmed = target.trim();
  if (trimmed.slice(0, DRIVE_LINK_SCHEME.length).toLowerCase() !== DRIVE_LINK_SCHEME) {
    return null;
  }
  const drivePath = driveLinkPath(trimmed);
  return drivePath ? driveLinkTarget(drivePath) : null;
};
