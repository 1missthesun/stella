import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { BackendClient } from "@stella/contracts/backend/client";
import type { DriveFile } from "@stella/contracts/backend/drive";
import { isEvidenceThumbnailDrivePath } from "@stella/contracts/chat-evidence-thumbnails";
import type { ToolDefinition, ToolContext, ToolResult } from "../types.js";
import {
  DRIVE_TOOL_DESCRIPTION,
  DRIVE_TOOL_NAME,
  DRIVE_TOOL_PARAMETERS,
  DRIVE_TOOL_REPLAY,
} from "./drive-def.js";

export type DriveToolOptions = {
  getCloudBackendAuth?: () => { baseUrl: string; authToken: string } | null;
};

const MAX_FETCH_BYTES = 50 * 1024 * 1024;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

const failure = (message: string): ToolResult => ({ error: message });

const describe = (file: DriveFile): string =>
  `${file.path} (${file.contentType}, ${file.sizeBytes} bytes, ${file.source})`;

const cacheDir = (context: ToolContext): string | null =>
  context.stellaDataDir
    ? path.join(
        context.stellaDataDir,
        "cache",
        "chat-attachments",
        context.conversationId.replace(/[^a-zA-Z0-9_-]/g, "-"),
      )
    : null;

export const createDriveTool = (
  options: DriveToolOptions,
): ToolDefinition => ({
  name: DRIVE_TOOL_NAME,
  replay: DRIVE_TOOL_REPLAY,
  description: DRIVE_TOOL_DESCRIPTION,
  parameters: DRIVE_TOOL_PARAMETERS,
  execute: async (args, context) => {
    const input = (args ?? {}) as {
      action?: unknown;
      path?: unknown;
      prefix?: unknown;
      limit?: unknown;
    };
    const auth = options.getCloudBackendAuth?.();
    if (!auth) {
      return failure(
        "The user's Stella Drive is unavailable: this device is not signed in to Stella Cloud.",
      );
    }
    const action = typeof input.action === "string" ? input.action.trim() : "";
    if (action !== "list" && action !== "fetch") {
      return failure("drive requires action to be either 'list' or 'fetch'.");
    }

    const client = new BackendClient({
      baseUrl: auth.baseUrl,
      getToken: async () => auth.authToken,
    });
    try {
      if (action === "list") {
        const prefix =
          typeof input.prefix === "string" && input.prefix.trim()
            ? input.prefix.trim()
            : undefined;
        const requested = Number(input.limit);
        const limit = Number.isFinite(requested)
          ? Math.min(Math.max(Math.trunc(requested), 1), MAX_LIST_LIMIT)
          : DEFAULT_LIST_LIMIT;
        const listed = await client.call("drive.list", {
          ...(prefix ? { prefix } : {}),
          limit,
        });
        const files = listed.files.filter(
          (file) => !isEvidenceThumbnailDrivePath(file.path),
        );
        if (files.length === 0) {
          return {
            result: prefix
              ? `No files in the user's drive under ${prefix}.`
              : "The user's drive is empty.",
          };
        }
        return {
          result: [
            `${files.length} file(s) in the user's drive${prefix ? ` under ${prefix}` : ""}:`,
            ...files.map((file) => `- ${describe(file)}`),
          ].join("\n"),
          details: { files },
        };
      }

      const drivePath =
        typeof input.path === "string" ? input.path.trim() : "";
      if (!drivePath) {
        return failure("drive fetch requires the file's drive path.");
      }
      const directory = cacheDir(context);
      if (!directory) {
        return failure(
          "drive fetch cannot store the file: this session has no data directory.",
        );
      }
      const file = await client.call("drive.fileUrl", { path: drivePath });
      if (file.sizeBytes > MAX_FETCH_BYTES) {
        return failure(
          `${file.path} is ${file.sizeBytes} bytes, over this session's ${MAX_FETCH_BYTES}-byte limit for fetching a drive file.`,
        );
      }
      const response = await fetch(file.url, {
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) {
        return failure(
          `Downloading ${file.path} from the drive failed (${response.status}).`,
        );
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > MAX_FETCH_BYTES) {
        return failure(
          `${file.path} is larger than this session's ${MAX_FETCH_BYTES}-byte limit for fetching a drive file.`,
        );
      }
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const safeName =
        path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120) ||
        "attachment";
      const localPath = path.join(directory, `${randomUUID()}-${safeName}`);
      await fs.writeFile(localPath, bytes, { flag: "wx", mode: 0o600 });
      return {
        result: `Fetched ${file.path} from the user's drive to ${localPath} (${file.contentType}, ${bytes.byteLength} bytes).`,
        details: {
          drivePath: file.path,
          path: localPath,
          contentType: file.contentType,
          sizeBytes: bytes.byteLength,
        },
      };
    } catch (error) {
      return failure(
        `The user's drive refused that request: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      client.dispose();
    }
  },
});
