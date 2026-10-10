/**
 * Reading a file or folder that lives on one of the owner's computers, from
 * a phone or from another computer (`file.read`, `file.stat`, `file.list`
 * device requests, `turn-plane/device-requests.ts`).
 *
 * A file larger than one relayed response is read in ranges: `file.stat`
 * first for its size, then `file.read` with `offset` and `length`.
 */

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
  /** More entries exist than the listing carries. */
  truncated: boolean;
};

export const DEVICE_FILE_READ_LIMITS = {
  /** Bytes one ranged `file.read` asks for. */
  rangeBytes: 8 * 1024 * 1024,
  /** Entries one `file.list` returns. */
  folderEntries: 500,
} as const;

/** What a folder's Drive manifest is typed as in the device-file records. */
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

/** The byte ranges a file of `sizeBytes` is read in. */
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
