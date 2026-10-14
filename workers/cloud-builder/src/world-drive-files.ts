import {
  isWorldDrivePath,
  WORLD_DRIVE_DIR,
  worldRelativeToolPath,
} from "./world/path.js";
import { executeWorldTool, type WorldToolFileApi } from "./world/tools.js";
import type { WorldEntry, WorldToolCall, WorldToolResult } from "./world/types.js";
import { WORLD_ROOT } from "./workspace.js";

type DriveRow = {
  path: string;
  sizeBytes: number;
  contentType: string;
  origin: string;
  updatedAt: number;
};

export type DriveOwnerCall = (name: string, args: unknown) => Promise<unknown>;

const DRIVE_WRITE_MAX_BYTES = 8 * 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  md: "text/markdown; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8",
  json: "application/json; charset=utf-8",
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
  zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export const contentTypeForName = (name: string): string => {
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  return (
    (name.includes(".") && CONTENT_TYPES[extension]) ||
    "application/octet-stream"
  );
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
};

const isNotFound = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { code?: unknown }).code === "NOT_FOUND";

const drivePathOf = (worldPath: string): string =>
  worldPath === WORLD_DRIVE_DIR ? "" : worldPath.slice(WORLD_DRIVE_DIR.length + 1);

const driveRoot = (): WorldEntry => ({
  path: WORLD_DRIVE_DIR,
  kind: "dir",
  mode: 0o755,
  mtime: 0,
  size: 0,
});

const fileEntry = (row: DriveRow): WorldEntry => ({
  path: `${WORLD_DRIVE_DIR}/${row.path}`,
  kind: "file",
  mode: 0o644,
  mtime: row.updatedAt,
  size: row.sizeBytes,
});

export type DriveFileSession = WorldToolFileApi & {
  readonly known: ReadonlyMap<string, number>;
};

export const createDriveFileSession = (options: {
  call: DriveOwnerCall;
  turnId: string;
}): DriveFileSession => {
  const known = new Map<string, number>();
  const noteRow = (row: DriveRow): void => {
    known.set(row.path, row.updatedAt);
  };
  const stat = async (path: string): Promise<WorldEntry | null> => {
    const drivePath = drivePathOf(path);
    if (!drivePath) return driveRoot();
    const answer = (await options.call("drive.turnStat", {
      path: drivePath,
    })) as { file: DriveRow | null; directory: boolean };
    if (answer.file) {
      noteRow(answer.file);
      return fileEntry(answer.file);
    }
    return answer.directory
      ? { path, kind: "dir", mode: 0o755, mtime: 0, size: 0 }
      : null;
  };
  return {
    known,
    stat,
    list: async (prefix, listOptions = {}) => {
      const drivePrefix = drivePathOf(prefix);
      const cursor = listOptions.cursor ?? "";
      const drivePrefixed = `${WORLD_DRIVE_DIR}/`;
      let after = "";
      if (cursor.startsWith(drivePrefixed)) after = cursor.slice(drivePrefixed.length);
      else if (cursor > drivePrefixed) return { entries: [] };
      const answer = (await options.call("drive.turnList", {
        ...(drivePrefix ? { prefix: drivePrefix } : {}),
        after,
        limit: Math.max(1, Math.min(500, listOptions.limit ?? 500)),
      })) as { files: DriveRow[]; more: boolean };
      const entries = answer.files.map(fileEntry);
      const last = entries.at(-1);
      return { entries, ...(answer.more && last ? { cursor: last.path } : {}) };
    },
    readFile: async (path, readOptions = {}) => {
      const drivePath = drivePathOf(path);
      if (!drivePath) throw new Error(`Path is not a file: ${path}`);
      try {
        const answer = (await options.call("drive.turnRead", {
          path: drivePath,
          ...(readOptions.offset !== undefined ? { offset: readOptions.offset } : {}),
          ...(readOptions.length !== undefined ? { length: readOptions.length } : {}),
        })) as DriveRow & { bytes: Uint8Array };
        noteRow(answer);
        return new Uint8Array(answer.bytes);
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    writeFile: async (path, bytes) => {
      const drivePath = drivePathOf(path);
      if (!drivePath) throw new Error(`Path is not a file: ${path}`);
      if (bytes.byteLength > DRIVE_WRITE_MAX_BYTES) {
        throw new Error(
          "A file this large is saved to the drive from the sandbox; write it with Bash.",
        );
      }
      const name = drivePath.slice(drivePath.lastIndexOf("/") + 1);
      const knownUpdatedAt = known.get(drivePath);
      const answer = (await options.call("drive.turnFiles", {
        turnId: options.turnId,
        hydratesDrive: true,
        files: [
          {
            path: drivePath,
            name,
            sizeBytes: bytes.byteLength,
            contentType: contentTypeForName(name),
            contentBase64: toBase64(bytes),
            ...(knownUpdatedAt !== undefined ? { knownUpdatedAt } : {}),
          },
        ],
      })) as {
        files: Array<{ path: string; updatedAt: number }>;
        skipped: Array<{ path: string; reason: string }>;
        renamed: Array<{ from: string; to: string; reason: string }>;
      };
      const landed = answer.files[0];
      if (landed) known.set(landed.path, landed.updatedAt);
      const renamed = answer.renamed[0];
      if (renamed) throw new Error(renamed.reason);
      if (!landed) {
        throw new Error(
          answer.skipped[0]?.reason ?? `${drivePath} could not be saved to the drive.`,
        );
      }
      return {
        path,
        kind: "file",
        mode: 0o644,
        mtime: landed.updatedAt,
        size: bytes.byteLength,
        revision: 0,
      };
    },
    remove: async (path, removeOptions = {}) => {
      const drivePath = drivePathOf(path);
      const entry = await stat(path);
      if (!entry) throw new Error(`Path not found: ${path}`);
      if (entry.kind !== "file" || !drivePath) {
        throw new Error(
          removeOptions.recursive
            ? "Folders of the user's drive are deleted one file at a time."
            : `Directory is not empty: ${path}`,
        );
      }
      const answer = (await options.call("drive.turnDelete", {
        turnId: options.turnId,
        files: [{ path: drivePath, knownUpdatedAt: known.get(drivePath) }],
      })) as { deleted: string[]; kept: Array<{ path: string; reason: string }> };
      const kept = answer.kept[0];
      if (kept) throw new Error(kept.reason);
      known.delete(drivePath);
      return { revision: 0 };
    },
    rename: async () => {
      throw new Error("Files in the user's drive are moved by writing the new path and deleting the old one.");
    },
  };
};

export const createWorldFilesWithDrive = (
  world: WorldToolFileApi,
  drive: WorldToolFileApi,
): WorldToolFileApi => {
  const pick = (path: string): WorldToolFileApi =>
    isWorldDrivePath(path) ? drive : world;
  return {
    stat: (path) => pick(path).stat(path),
    readFile: (path, options) => pick(path).readFile(path, options),
    writeFile: (path, bytes, options) => pick(path).writeFile(path, bytes, options),
    remove: (path, options) => pick(path).remove(path, options),
    rename: async (from, to) => {
      if (isWorldDrivePath(from) || isWorldDrivePath(to)) {
        return await drive.rename(from, to);
      }
      return await world.rename(from, to);
    },
    list: async (prefix, options = {}) => {
      if (prefix !== "") return await pick(prefix).list(prefix, options);
      const limit = Math.max(1, Math.min(10_000, options.limit ?? 1_000));
      const [stored, held] = await Promise.all([
        world.list("", { ...options, limit }),
        drive.list(WORLD_DRIVE_DIR, { ...options, limit }),
      ]);
      const bounds = [
        stored.cursor ? stored.entries.at(-1)?.path : undefined,
        held.cursor ? held.entries.at(-1)?.path : undefined,
      ].filter((value): value is string => value !== undefined);
      const boundary = bounds.length > 0 ? bounds.sort()[0] : undefined;
      let entries = [
        // A world that stored the drive before it moved out may still list it.
        ...stored.entries.filter((entry) => !isWorldDrivePath(entry.path)),
        ...held.entries,
      ]
        .filter((entry) => boundary === undefined || entry.path <= boundary)
        .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
      let more = boundary !== undefined;
      if (entries.length > limit) {
        entries = entries.slice(0, limit);
        more = true;
      }
      const cursor = entries.at(-1)?.path ?? boundary;
      return { entries, ...(more && cursor ? { cursor } : {}) };
    },
  };
};

const driveOnlyWorld = (drive: WorldToolFileApi): WorldToolFileApi => ({
  ...drive,
  stat: async (path) =>
    path === ""
      ? { path: "", kind: "dir", mode: 0o755, mtime: 0, size: 0 }
      : isWorldDrivePath(path)
        ? await drive.stat(path)
        : null,
  list: async (prefix, options) =>
    prefix === ""
      ? await drive.list(WORLD_DRIVE_DIR, options)
      : isWorldDrivePath(prefix)
        ? await drive.list(prefix, options)
        : { entries: [] },
});

type WorldToolReach = "world" | "drive" | "both";

const resolvedWorldPath = (value: unknown): string | null => {
  try {
    return worldRelativeToolPath(value, WORLD_ROOT);
  } catch {
    return null;
  }
};

const PATCH_PATH_LINE = /^\*\*\* (?:Add File|Delete File|Update File|Move to): (.+)$/gmu;

export const worldToolReach = (call: WorldToolCall): WorldToolReach => {
  if (call.name === "apply_patch") {
    const patch = String(call.arguments.input ?? call.arguments.patch ?? "");
    for (const match of patch.matchAll(PATCH_PATH_LINE)) {
      const path = resolvedWorldPath(match[1]?.trim());
      if (path !== null && isWorldDrivePath(path)) return "both";
    }
    return "world";
  }
  if (call.name === "Grep" || call.name === "glob") {
    if (call.arguments.path === undefined) return "both";
    const path = resolvedWorldPath(call.arguments.path);
    if (path === "") return "both";
    return path !== null && isWorldDrivePath(path) ? "drive" : "world";
  }
  const path = resolvedWorldPath(call.arguments.file_path);
  return path !== null && isWorldDrivePath(path) ? "drive" : "world";
};

export type WorldStoreTools = WorldToolFileApi & {
  tool(call: WorldToolCall): Promise<WorldToolResult>;
  listWorkspaceApps?(): Promise<unknown>;
};

export const runWorldToolWithDrive = async (
  call: WorldToolCall,
  world: WorldStoreTools,
  drive: WorldToolFileApi,
): Promise<WorldToolResult> => {
  const reach = worldToolReach(call);
  if (reach === "world") return await world.tool(call);
  if (call.name === "Grep" || call.name === "glob") {
    const fromDrive = await executeWorldTool(driveOnlyWorld(drive), call, WORLD_ROOT);
    if (reach === "drive") return fromDrive;
    const fromWorld = await world.tool(call);
    return mergeSearchResults(call.name, fromWorld, fromDrive);
  }
  const result = await executeWorldTool(
    createWorldFilesWithDrive(world, drive),
    call,
    WORLD_ROOT,
  );
  if (
    result.ok &&
    world.listWorkspaceApps &&
    JSON.stringify(call.arguments).includes("stella.app.json")
  ) {
    const apps = await world.listWorkspaceApps();
    return {
      ...result,
      output: `${result.output}\nApp build status: ${JSON.stringify(apps)}`,
    };
  }
  return result;
};

const FOUND = "Found matches:\n\n";

const mergeSearchResults = (
  name: "Grep" | "glob",
  world: WorldToolResult,
  drive: WorldToolResult,
): WorldToolResult => {
  if (!drive.ok) return world.ok ? world : drive;
  if (!world.ok) return drive;
  if (name === "glob") {
    const lines = [world.output, drive.output].filter((text) => text.trim() !== "");
    return { ok: true, output: lines.join("\n"), revision: world.revision };
  }
  const empty = (output: string) => output.startsWith("No matches found");
  if (empty(drive.output)) return world;
  if (empty(world.output)) return { ...drive, revision: world.revision };
  const output =
    world.output.startsWith(FOUND) && drive.output.startsWith(FOUND)
      ? `${world.output.trimEnd()}\n${drive.output.slice(FOUND.length)}`
      : `${world.output.trimEnd()}\n\n${drive.output}`;
  return { ok: true, output, revision: world.revision };
};
