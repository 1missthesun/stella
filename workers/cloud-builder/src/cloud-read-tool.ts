import type { TSchema } from "@sinclair/typebox";
import { Effect } from "effect";
import {
  READ_TOOL_DESCRIPTION,
  READ_TOOL_NAME,
  READ_TOOL_PARAMETERS,
  READ_TOOL_REPLAY,
} from "@stella/runtime/kernel/tools/defs/read-def.js";
import { sanitizeToolVisibleText } from "@stella/runtime/kernel/tools/safety.js";
import { runToolEffect } from "@stella/runtime/kernel/tools/effect-runtime.js";
import {
  detectImageMimeTypeFromBytes,
  imageMimeTypeFromPath,
} from "@stella/runtime/kernel/shared/image-mime.js";
import {
  base64EncodedLength,
  DURABLE_OBJECT_READ_IMAGE_CAPS,
  READ_IMAGE_MAX_SOURCE_BYTES,
} from "@stella/runtime/kernel/shared/image-caps.js";
import type { CloudCodeSourceAgentTool } from "./cloud-code-tool.js";
import { fitImageWithImagesBinding } from "./cloud-image-fit.js";
import type {
  CloudHomeStore,
  CloudSkillCatalogSnapshot,
} from "./cloud-home-store.js";
import {
  readCloudSkillFile,
  resolveCloudSkillPath,
} from "./cloud-skills.js";
import { WORLD_ROOT } from "./workspace.js";
import { expandWorldHome } from "./world/path.js";

const MAX_SKILL_TEXT_CHARS = 120_000;
const DEFAULT_READ_LIMIT = 2000;
const MAX_READ_LINES = 5000;

const IMAGE_READ_CHUNK_BYTES = 4 * 1024 * 1024;

const IMAGE_READ_DEADLINE_MS = 60_000;

const base64FromBytes = (bytes: Uint8Array): string => {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
};

export type CloudReadToolOptions = Readonly<{
  images?: ImagesBinding;
  skills?: { home: CloudHomeStore; snapshot: CloudSkillCatalogSnapshot };
  world?: {
    tool(call: {
      name: "Read";
      arguments: Record<string, unknown>;
    }): Promise<{ ok: boolean; output: string }>;
    /**
     * Bytes for an image path. Absent on a world binding that predates this,
     * in which case an image falls through to the text Read and reports the
     * world's own refusal rather than crashing.
     */
    stat?(path: string): Promise<{ kind: string; size: number } | null>;
    readFile?(
      path: string,
      options?: { offset?: number; length?: number },
    ): Promise<Uint8Array | null>;
  };
}>;

const readWhole = async (
  world: NonNullable<CloudReadToolOptions["world"]>,
  path: string,
  size: number,
): Promise<Uint8Array | null> => {
  if (!world.readFile) return null;
  const bytes = new Uint8Array(size);
  let offset = 0;
  while (offset < size) {
    const chunk = await world.readFile(path, {
      offset,
      length: Math.min(IMAGE_READ_CHUNK_BYTES, size - offset),
    });
    if (!chunk || chunk.length === 0) break;
    bytes.set(chunk.subarray(0, size - offset), offset);
    offset += chunk.length;
  }
  return offset === size ? bytes : null;
};

const failure = (message: string) => ({
  content: [{ type: "text" as const, text: message }],
  details: null,
  isError: true,
});

const windowLines = (
  text: string,
  offsetValue: unknown,
  limitValue: unknown,
): { body: string; start: number; end: number; total: number; more: boolean } => {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const offset = Number(offsetValue ?? 1);
  const limit = Number(limitValue ?? DEFAULT_READ_LIMIT);
  const start = Number.isFinite(offset) ? Math.max(1, Math.trunc(offset)) : 1;
  const count = Math.min(
    MAX_READ_LINES,
    Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : DEFAULT_READ_LIMIT,
  );
  const selected = lines.slice(start - 1, start - 1 + count);
  const end = selected.length === 0 ? start - 1 : start + selected.length - 1;
  return {
    body: selected
      .map((line, index) => `${String(start + index).padStart(6, " ")}#${line}`)
      .join("\n"),
    start,
    end,
    total: lines.length,
    more: end < lines.length,
  };
};

const readImage = async (
  world: NonNullable<CloudReadToolOptions["world"]>,
  images: ImagesBinding | undefined,
  worldPath: string,
  size: number,
) => {
  if (size > READ_IMAGE_MAX_SOURCE_BYTES) {
    return failure(
      `That image is ${size} bytes, over the ${READ_IMAGE_MAX_SOURCE_BYTES}-byte limit for reading an image into the conversation: ${worldPath}`,
    );
  }
  const bytes = await readWhole(world, worldPath, size);
  if (!bytes) {
    return failure(`That image could not be read in full: ${worldPath}`);
  }
  const mimeType = detectImageMimeTypeFromBytes(bytes);
  if (!mimeType) {
    return failure(
      `That file is named like an image but its bytes are not a complete PNG, JPEG, GIF, or WEBP: ${worldPath}`,
    );
  }
  const caps = DURABLE_OBJECT_READ_IMAGE_CAPS;
  const fitted = images
    ? await fitImageWithImagesBinding(images, bytes, mimeType, caps)
    : base64EncodedLength(bytes.length) < caps.maxBytes
      ? { bytes, mimeType, note: undefined }
      : null;
  if (!fitted) {
    return failure(
      images
        ? `Image file could not be decoded: ${worldPath}`
        : `That image is ${bytes.length} bytes, too large to show the model here: ${worldPath}`,
    );
  }
  const dimensions =
    "originalWidth" in fitted
      ? ` (${fitted.originalWidth}x${fitted.originalHeight})`
      : "";
  return {
    content: [
      {
        type: "text" as const,
        text: `Image file: ${worldPath}${dimensions}${fitted.note ? `\n${fitted.note}` : ""}`,
      },
      {
        type: "image" as const,
        data: base64FromBytes(fitted.bytes),
        mimeType: fitted.mimeType,
      },
    ],
    details: {
      path: worldPath,
      mimeType: fitted.mimeType,
      sizeBytes: fitted.bytes.length,
      ...(fitted.note
        ? { originalMimeType: mimeType, originalBytes: bytes.length }
        : {}),
    },
  };
};

export const createCloudReadTool = (
  options: CloudReadToolOptions,
): CloudCodeSourceAgentTool => ({
  name: READ_TOOL_NAME,
  replay: READ_TOOL_REPLAY,
  label: "Read",
  workingText: "Reading",
  description: READ_TOOL_DESCRIPTION,
  parameters: READ_TOOL_PARAMETERS as unknown as TSchema,
  execute: async (_toolCallId, params) => {
    const args = (params ?? {}) as Record<string, unknown>;
    const filePath =
      typeof args.file_path === "string" ? args.file_path.trim() : "";
    if (!filePath) return failure("file_path is required.");

    if (options.skills) {
      const { ref, skillsPath } = resolveCloudSkillPath(
        options.skills.snapshot,
        filePath,
      );
      if (skillsPath) {
        if (!ref) {
          return failure(
            `File not found: ${filePath}. The <skills> block lists every skill available in this session.`,
          );
        }
        let text: string;
        try {
          text = await readCloudSkillFile(
            options.skills.home,
            options.skills.snapshot,
            ref,
          );
        } catch (error) {
          return failure(
            error instanceof Error && error.message.trim()
              ? `File not found: ${filePath} (${error.message})`
              : `File not found: ${filePath}`,
          );
        }
        if (text.length > MAX_SKILL_TEXT_CHARS) {
          return failure(
            "That skill file is too large for model context. Read a narrower text asset.",
          );
        }
        const window = windowLines(
          sanitizeToolVisibleText(text, { codeFile: true }),
          args.offset,
          args.limit,
        );
        const continuation = window.more
          ? ` More lines remain; continue with offset=${window.end + 1}.`
          : "";
        return {
          content: [
            {
              type: "text",
              text: `File: ${filePath}\nLines ${window.start}-${window.end} of ${window.total}.${continuation}\n\n${window.body}`,
            },
          ],
          details: {
            path: filePath,
            skillId: ref.entry.skillId,
            versionId: ref.entry.versionId,
            skillPath: ref.path,
          },
        };
      }
    }

    if (!options.world) {
      return failure(
        `File not found: ${filePath}. Only ${WORLD_ROOT}/... (the user's cloud drive, projects, and apps) and ~/.stella/skills/... exist in this session.`,
      );
    }
    const worldPath = expandWorldHome(filePath);
    if (!worldPath.startsWith("/")) {
      return failure(
        `File tool paths must be absolute. Received relative path '${filePath}'. The user's cloud files live under ${WORLD_ROOT}/ (drive/, projects/<name>/, apps/<name>/).`,
      );
    }

    const world = options.world;
    if (imageMimeTypeFromPath(worldPath) && world.stat && world.readFile) {
      try {
        const image = await runToolEffect(
          Effect.raceFirst(
            Effect.tryPromise({
              try: async () => {
                const entry = await world.stat!(worldPath).catch(() => null);
                if (!entry || entry.kind !== "file") return undefined;
                return await readImage(world, options.images, worldPath, entry.size);
              },
              catch: (error) => error,
            }),
            Effect.sleep(IMAGE_READ_DEADLINE_MS).pipe(
              Effect.map(() =>
                failure(
                  `Reading that image took longer than ${IMAGE_READ_DEADLINE_MS / 1000} seconds; try again: ${worldPath}`,
                ),
              ),
            ),
          ),
        );
        if (image) return image;
      } catch (error) {
        return failure(
          `That image could not be read${error instanceof Error && error.message ? ` (${error.message})` : ""}: ${worldPath}`,
        );
      }
    }

    const result = await options.world.tool({
      name: "Read",
      arguments: {
        file_path: worldPath,
        ...(args.offset !== undefined ? { offset: args.offset } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
      },
    });
    return {
      content: [{ type: "text", text: result.output || "(no output)" }],
      details: { path: worldPath },
      ...(result.ok ? {} : { isError: true }),
    };
  },
});
