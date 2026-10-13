/**
 * `Read` for the cloud orchestrator — the device tool's exact model-visible
 * surface (see `defs/read-def.ts`) over the two trees a cloud turn can see:
 *
 *  - `~/.stella/skills/<slug>/...` — the owner's mirrored skills, pinned for
 *    the turn and integrity-checked by the cloud home store;
 *  - `/workspace/world/...` — the owner's world (projects, apps) through the
 *    world Durable Object, and its `drive/` through the user's drive itself,
 *    exactly as a resident cloud agent reads them.
 *
 * An image under the world root is read as pixels, which is what the shared
 * description has always advertised: "inspect a local PNG, JPG, JPEG, GIF, or
 * WEBP image. Image files are attached to the conversation as vision input."
 * Both placements show the model that byte-identical sentence, so returning
 * `Binary files are not supported` here made the tool's own contract false in
 * the cloud. The orchestrator tool protocol already carries image blocks
 * (`toolResultFromOrchestrator` turns them into authorized tool images), so
 * this reads the bytes out of the world instead of handing them to the world's
 * text-only Read. An image larger than the model takes is fitted to the shared
 * shared Read target (cloud-image-fit.ts), as the runtime's Read does, and the
 * result says it was resized.
 *
 * Skills stay text-only: that store hands back text and holds no binaries.
 */

import type { TSchema } from "@sinclair/typebox";
import {
  READ_TOOL_DESCRIPTION,
  READ_TOOL_NAME,
  READ_TOOL_PARAMETERS,
  READ_TOOL_REPLAY,
} from "@stella/runtime/kernel/tools/defs/read-def.js";
import { sanitizeToolVisibleText } from "@stella/runtime/kernel/tools/safety.js";
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

/**
 * Bytes per read of an image's file: under both the world store's and the
 * drive's per-read ceiling (8MiB each), so a photo up to the shared
 * `READ_IMAGE_MAX_SOURCE_BYTES` is read in a few ranges.
 */
const IMAGE_READ_CHUNK_BYTES = 4 * 1024 * 1024;

/** An image Read that has not finished by then answers with a tool error. */
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
  /**
   * Fits an oversized image to the shared Read target, as the runtime's Read does
   * with Photon. Without it an image is inlined only when it already fits.
   */
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

/** A whole file through `readFile`'s bounded ranges. */
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

/** The device Read's `offset`/`limit` window over a text body. */
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

/**
 * An image Read: the whole file in bounded ranges, fitted to the Read target
 * with the room a Durable Object row needs (the result is stored as one).
 */
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
  // The runtime Read's wording (packages/runtime/kernel/tools/file.ts).
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
    // The world is HOME in the cloud, as it is for the agents' shells.
    const worldPath = expandWorldHome(filePath);
    if (!worldPath.startsWith("/")) {
      return failure(
        `File tool paths must be absolute. Received relative path '${filePath}'. The user's cloud files live under ${WORLD_ROOT}/ (drive/, projects/<name>/, apps/<name>/).`,
      );
    }

    // An image is pixels, not lines, so `offset`/`limit` have no meaning and
    // the world's line-windowing Read would only refuse the bytes. Extension
    // first because it costs nothing; the magic numbers then decide, so a
    // mislabeled `.png` is reported as what it actually is rather than sent
    // to a provider that will reject it.
    const world = options.world;
    if (imageMimeTypeFromPath(worldPath) && world.stat && world.readFile) {
      // Whatever happens below ends as a result: a store, the Images
      // service, or a slow read never leaves the turn waiting on this call.
      // Undefined (no such file) falls through so not-found stays one message.
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const image = await Promise.race([
          (async () => {
            const entry = await world.stat!(worldPath).catch(() => null);
            if (!entry || entry.kind !== "file") return undefined;
            return await readImage(world, options.images, worldPath, entry.size);
          })(),
          new Promise<ReturnType<typeof failure>>((resolve) => {
            timer = setTimeout(
              () =>
                resolve(
                  failure(
                    `Reading that image took longer than ${IMAGE_READ_DEADLINE_MS / 1000} seconds; try again: ${worldPath}`,
                  ),
                ),
              IMAGE_READ_DEADLINE_MS,
            );
          }),
        ]);
        if (image) return image;
      } catch (error) {
        return failure(
          `That image could not be read${error instanceof Error && error.message ? ` (${error.message})` : ""}: ${worldPath}`,
        );
      } finally {
        if (timer !== undefined) clearTimeout(timer);
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
