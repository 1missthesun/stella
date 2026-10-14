export type DeviceFileStat = {
  kind: "file" | "directory";
  sizeBytes: number;
  mimeType: string;
  modifiedAt: number;
};

export type DeviceFolderEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
  sizeBytes: number;
  modifiedAt: number;
};

export type DeviceFolderListing = {
  path: string;
  entries: DeviceFolderEntry[];
  truncated: boolean;
};

export const DEVICE_FILE_READ_LIMITS = {
  rangeBytes: 8 * 1024 * 1024,
  folderEntries: 500,
} as const;

export const DEVICE_FOLDER_CONTENT_TYPE = "application/vnd.stella.folder+json";

export const isDeviceFileStat = (value: unknown): value is DeviceFileStat => {
  if (!value || typeof value !== "object") return false;
  const stat = value as Record<string, unknown>;
  return (
    (stat.kind === "file" || stat.kind === "directory") &&
    typeof stat.sizeBytes === "number" &&
    typeof stat.mimeType === "string"
  );
};

export const parseDeviceFolderListing = (
  value: unknown,
): DeviceFolderListing | null => {
  if (!value || typeof value !== "object") return null;
  const listing = value as Record<string, unknown>;
  if (typeof listing.path !== "string" || !Array.isArray(listing.entries)) {
    return null;
  }
  const entries: DeviceFolderEntry[] = [];
  for (const raw of listing.entries) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    if (
      typeof entry.name !== "string" ||
      typeof entry.path !== "string" ||
      (entry.kind !== "file" && entry.kind !== "directory")
    ) {
      continue;
    }
    entries.push({
      name: entry.name,
      path: entry.path,
      kind: entry.kind,
      sizeBytes: typeof entry.sizeBytes === "number" ? entry.sizeBytes : 0,
      modifiedAt: typeof entry.modifiedAt === "number" ? entry.modifiedAt : 0,
    });
  }
  return { path: listing.path, entries, truncated: listing.truncated === true };
};

export const deviceFileReadRanges = (
  sizeBytes: number,
  rangeBytes: number = DEVICE_FILE_READ_LIMITS.rangeBytes,
): Array<{ offset: number; length: number }> => {
  const ranges: Array<{ offset: number; length: number }> = [];
  for (let offset = 0; offset < sizeBytes; offset += rangeBytes) {
    ranges.push({ offset, length: Math.min(rangeBytes, sizeBytes - offset) });
  }
  return ranges;
};
