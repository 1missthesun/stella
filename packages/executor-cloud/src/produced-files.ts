import { spawn } from "node:child_process";
import path from "node:path";
import { isolateToolProcessLaunch } from "@stella/runtime/kernel/tools/process-isolation.js";
import type { ToolProcessIdentity } from "@stella/runtime/kernel/tools/types.js";
import {
  readWorkspaceFileNoFollow,
  statWorkspaceFileNoFollow,
} from "@stella/runtime/kernel/tools/workspace-file-boundary.js";

export const PRODUCED_FILE_AUTHORIZED_BYTES = Symbol(
  "stella.produced-file.authorized-bytes",
);

export type ProducedFileReport = {
  path: string;
  name: string;
  sizeBytes: number;
  contentType: string;
  uploadId?: string;
  [PRODUCED_FILE_AUTHORIZED_BYTES]?: Buffer;
};

export type ProducedFileCollection = {
  files: ProducedFileReport[];
  omitted: string[];
};

export const toDriveFile = (file: ProducedFileReport) => ({
  path: file.path,
  name: file.name,
  sizeBytes: file.sizeBytes,
  contentType: file.contentType,
});

export const INLINE_LIMIT_BYTES = 8 * 1024 * 1024;
const MAX_REPORTED_FILES = 25;

const STATE_DIR_SEGMENT = ".stella";

const CONTENT_TYPES: Record<string, string> = {
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  gif: "image/gif",
  html: "text/html",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  md: "text/markdown",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  pdf: "application/pdf",
  png: "image/png",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  svg: "image/svg+xml",
  txt: "text/plain",
  wav: "audio/wav",
  webp: "image/webp",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
};

export const contentTypeFor = (name: string): string => {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "application/octet-stream";
  return (
    CONTENT_TYPES[name.slice(dot + 1).toLowerCase()] ??
    "application/octet-stream"
  );
};

const safeFileSize = (size: number | bigint): number | null => {
  if (typeof size === "bigint") {
    if (size < 0n || size > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(size);
  }
  return Number.isSafeInteger(size) && size >= 0 ? size : null;
};

const toWorkspaceRelative = (
  absolutePath: string,
  workspaceRoot: string,
): string | null => {
  const relative = path.relative(workspaceRoot, absolutePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return relative.split(path.sep).join("/");
};

const assertStrictProcessIdentity = (identity: ToolProcessIdentity): void => {
  if (identity.requireNoNewPrivileges !== true) {
    throw new Error(
      "Cloud produced-file processes require the strict tool identity.",
    );
  }
};

export const buildProducedFilesGitCheckIgnoreLaunch = (
  identity: ToolProcessIdentity,
  platform: NodeJS.Platform = process.platform,
) => {
  assertStrictProcessIdentity(identity);
  return isolateToolProcessLaunch({
    command: "/usr/bin/git",
    commandArgs: ["check-ignore", "--stdin", "-z"],
    identity,
    platform,
  });
};

const filterGitIgnored = async (
  workspaceRoot: string,
  relativePaths: string[],
  identity: ToolProcessIdentity,
): Promise<string[]> =>
  new Promise((resolve) => {
    const launch = buildProducedFilesGitCheckIgnoreLaunch(identity);
    const child = spawn(launch.command, launch.args, {
      cwd: workspaceRoot,
      env: {
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
        HOME: identity.home,
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        LOGNAME: identity.user,
        PATH: "/usr/bin:/bin",
        USER: identity.user,
      },
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 15_000,
    });
    const stdout: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.on("error", () => resolve(relativePaths));
    child.on("close", () => {
      const ignored = new Set(
        Buffer.concat(stdout).toString("utf8").split("\0").filter(Boolean),
      );
      resolve(relativePaths.filter((value) => !ignored.has(value)));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(`${relativePaths.join("\0")}\0`);
  });

export const collectProducedFiles = async (options: {
  workspaceRoot: string;
  processIdentity: ToolProcessIdentity;
  linked: readonly string[];
  gitAware: boolean;
  drivePrefix: string;
  limit?: number;
}): Promise<ProducedFileCollection> => {
  const limit = options.limit ?? MAX_REPORTED_FILES;
  assertStrictProcessIdentity(options.processIdentity);
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const linked of options.linked) {
    const trimmed = linked.trim();
    if (!trimmed) continue;
    const relative = toWorkspaceRelative(
      path.resolve(options.workspaceRoot, trimmed),
      options.workspaceRoot,
    );
    if (!relative || seen.has(relative)) continue;
    if (relative.split("/").includes(STATE_DIR_SEGMENT)) continue;
    seen.add(relative);
    candidates.push(relative);
  }
  if (candidates.length === 0) return { files: [], omitted: [] };

  const tracked = options.gitAware
    ? await filterGitIgnored(
        options.workspaceRoot,
        candidates,
        options.processIdentity,
      )
    : candidates;

  const workspaceRoot = path.resolve(options.workspaceRoot);
  const owner = {
    uid: options.processIdentity.uid,
    gid: options.processIdentity.gid,
  };
  const files: ProducedFileReport[] = [];
  const omitted: string[] = [];
  for (const relative of tracked) {
    const candidatePath = path.join(workspaceRoot, relative);
    const metadata = await statWorkspaceFileNoFollow(
      candidatePath,
      workspaceRoot,
      { owner },
    ).catch(() => null);
    if (!metadata) continue;
    const metadataSize = safeFileSize(metadata.size);
    if (metadataSize === null) continue;
    const drivePath = `${options.drivePrefix}${relative}`;
    if (files.length >= limit) {
      omitted.push(drivePath);
      continue;
    }

    let authorizedBytes: Buffer | undefined;
    let sizeBytes = metadataSize;
    if (metadataSize < INLINE_LIMIT_BYTES) {
      const authorized = await readWorkspaceFileNoFollow(
        candidatePath,
        workspaceRoot,
        INLINE_LIMIT_BYTES - 1,
        { owner },
      ).catch(() => null);
      if (!authorized) continue;
      authorizedBytes = authorized.bytes;
      const authorizedSize = safeFileSize(authorized.stat.size);
      if (authorizedSize === null) {
        authorizedBytes.fill(0);
        continue;
      }
      sizeBytes = authorizedSize;
      if (authorizedBytes.byteLength !== sizeBytes) {
        authorizedBytes.fill(0);
        continue;
      }
    }
    const name = relative.split("/").pop() ?? relative;
    const report: ProducedFileReport = {
      path: drivePath,
      name,
      sizeBytes,
      contentType: contentTypeFor(name),
    };
    if (authorizedBytes) {
      Object.defineProperty(report, PRODUCED_FILE_AUTHORIZED_BYTES, {
        configurable: false,
        enumerable: false,
        value: authorizedBytes,
        writable: false,
      });
    }
    files.push(report);
  }
  return { files, omitted };
};

export type ProducedFileDelivery = {
  stored: Set<string>;
  versions: Map<string, number>;
  skipped: Array<{ path: string; reason: string }>;
  renamed: Array<{ from: string; to: string; reason: string }>;
  replaced: Array<{ path: string; reason: string }>;
};

export const reportProducedFiles = async (options: {
  turnId: string;
  files: ProducedFileReport[];
  known?: ReadonlyMap<string, number>;
  batchPrefix?: string;
  post: (route: string, body: unknown) => Promise<Response>;
}): Promise<ProducedFileDelivery> => {
  type Payload = ReturnType<typeof toDriveFile> & {
    contentBase64?: string;
    uploadId?: string;
    knownUpdatedAt?: number;
  };
  const delivery: ProducedFileDelivery = {
    stored: new Set<string>(),
    versions: new Map<string, number>(),
    skipped: [],
    renamed: [],
    replaced: [],
  };
  const batches: Payload[][] = [];
  let batch: Payload[] = [];
  let batchBytes = 0;
  for (const file of options.files) {
    const knownUpdatedAt = options.known?.get(file.path);
    let payload: Payload = {
      ...toDriveFile(file),
      ...(knownUpdatedAt === undefined ? {} : { knownUpdatedAt }),
    };
    const bytes = file[PRODUCED_FILE_AUTHORIZED_BYTES];
    if (
      file.sizeBytes < INLINE_LIMIT_BYTES &&
      bytes &&
      bytes.byteLength === file.sizeBytes
    ) {
      payload = {
        ...payload,
        contentBase64: Buffer.from(bytes).toString("base64"),
      };
    } else if (file.uploadId) {
      payload = { ...payload, uploadId: file.uploadId };
    } else {
      delivery.skipped.push({
        path: file.path,
        reason: `${file.path} could not be read to save it to the drive, so it is only in this sandbox.`,
      });
      continue;
    }
    const cost = payload.contentBase64 !== undefined ? file.sizeBytes : 0;
    if (batch.length > 0 && batchBytes + cost > INLINE_LIMIT_BYTES) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(payload);
    batchBytes += cost;
  }
  if (batch.length > 0) batches.push(batch);

  // 413 means nothing in the batch landed and its body says why. Every
  // delivery of a batch carries the same `batchKey`; the route records it on
  // the rows it writes, so a re-send after a lost response replays as the
  // same writer instead of reading as a second one.
  const send = async (
    entries: Payload[],
    batchKey: string,
  ): Promise<Response | null> => {
    const response = await options
      .post("/api/cloud/drive/files", {
        turnId: options.turnId,
        batchKey,
        files: entries,
      })
      .catch(() => null);
    return response && (response.ok || response.status === 413)
      ? response
      : null;
  };

  for (const [index, entries] of batches.entries()) {
    const batchKey = `${options.batchPrefix ?? ""}${index}`;
    const response =
      (await send(entries, batchKey)) ?? (await send(entries, batchKey));
    if (!response) {
      for (const entry of entries) {
        delivery.skipped.push({
          path: entry.path,
          reason: `${entry.path} could not be saved to the drive, so it is only in this sandbox.`,
        });
      }
      continue;
    }
    const payload = (await response.json().catch(() => ({}))) as {
      files?: Array<{ path?: string; stored?: boolean; updatedAt?: number }>;
      skipped?: Array<{ path?: string; reason?: string }>;
      renamed?: Array<{ from?: string; to?: string; reason?: string }>;
      replaced?: Array<{ path?: string; reason?: string }>;
    };
    for (const file of payload.files ?? []) {
      if (!file.stored || !file.path) continue;
      delivery.stored.add(file.path);
      if (typeof file.updatedAt === "number") {
        delivery.versions.set(file.path, file.updatedAt);
      }
    }
    for (const entry of payload.skipped ?? []) {
      if (entry.path) {
        delivery.skipped.push({
          path: entry.path,
          reason: entry.reason ?? "it was not delivered",
        });
      }
    }
    for (const entry of payload.renamed ?? []) {
      if (entry.from && entry.to) {
        delivery.renamed.push({
          from: entry.from,
          to: entry.to,
          reason: entry.reason ?? `saved as ${entry.to}`,
        });
      }
    }
    for (const entry of payload.replaced ?? []) {
      if (entry.path && entry.reason) {
        delivery.replaced.push({ path: entry.path, reason: entry.reason });
      }
    }
  }
  return delivery;
};
