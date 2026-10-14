import { promises as fs } from "fs";
import path from "path";
import {
  TOOL_RESULT_AUTHORIZED_IMAGES,
  type ToolContext,
  type ToolResult,
} from "./types.js";
import {
  expandHomePath,
  detectLineEnding,
  MAX_FILE_BYTES,
  normalizeToLF,
  restoreLineEndings,
  stripBom,
  toolContextHome,
} from "./utils.js";
import {
  applyAnchoredEdit,
  formatWithHashLines,
  parseAnchor,
  type AnchoredEditResult,
} from "./hashline.js";
import { isBlockedPath } from "./command-safety.js";
import { sanitizeToolVisibleText } from "./safety.js";
import { withFileWriteLock, writeFileWithNulGuard } from "./file-write-lock.js";
import {
  imageMimeTypeFromPath,
  resolveImageMimeType,
} from "../shared/image-mime.js";
import {
  getSkillReadDedupStub,
  isSkillInstructionPath,
  recordFullSkillRead,
} from "./skill-read-dedup.js";
import {
  readWorkspaceFileNoFollow,
  writeWorkspaceFileNoFollow,
} from "./workspace-file-boundary.js";
import { decodeAndValidateImage } from "./image-decode-validation.js";
import { READ_IMAGE_CAPS, READ_IMAGE_MAX_SOURCE_BYTES } from "../shared/image-caps.js";
import type { SupportedImageMediaType } from "../shared/image-payload.js";
import { formatDimensionNote, resizeImage } from "../shared/image-resize.js";
import {
  applyEditsToContent,
  applyStringReplacement,
  parseEditSpecs,
  prepareEditArguments,
} from "./edit-text.js";

const isPathInsideRoot = (candidate: string, root: string): boolean => {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
};

export const requireAbsoluteFilePath = (
  rawPath: unknown,
  home?: string,
): string => {
  const raw = String(rawPath ?? "");
  const expandedPath = expandHomePath(raw, home);
  if (!path.isAbsolute(expandedPath)) {
    throw new Error(
      `File tool paths must be absolute. Received relative path '${raw}'. ` +
        `Pass a full absolute path (e.g. /Users/you/projects/foo/bar.ts); ` +
        `the file tools do not resolve relative to the shell's working directory.`,
    );
  }
  return path.resolve(expandedPath);
};

export const resolveFilePath = (
  rawPath: unknown,
  context?: ToolContext,
): string => {
  const resolvedPath = requireAbsoluteFilePath(
    rawPath,
    toolContextHome(context),
  );
  const scopedRoot = context?.toolWorkspaceRoot?.trim()
    ? path.resolve(context.toolWorkspaceRoot)
    : null;

  if (scopedRoot && !isPathInsideRoot(resolvedPath, scopedRoot)) {
    throw new Error("Path is outside the shared session workspace.");
  }

  return resolvedPath;
};

const writeToolFile = async (
  filePath: string,
  content: string,
  context?: ToolContext,
): Promise<void> => {
  const scopedRoot = context?.toolWorkspaceRoot?.trim();
  if (scopedRoot) {
    await writeWorkspaceFileNoFollow(
      filePath,
      scopedRoot,
      content,
      context?.toolProcessIdentity ? { owner: context.toolProcessIdentity } : {},
    );
    return;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await writeFileWithNulGuard(filePath, content);
};

export const writeTextFile = async (
  rawPath: unknown,
  content: string,
  context?: ToolContext,
): Promise<{ path: string; created: boolean }> => {
  const filePath = resolveFilePath(rawPath, context);
  const pathBlock = isBlockedPath(filePath, context);
  if (pathBlock) {
    throw new Error(pathBlock);
  }

  return withFileWriteLock(filePath, async () => {
    let existed = false;
    let originalEnding: "\r\n" | "\n" = "\n";

    try {
      const rawContent = await fs.readFile(filePath, "utf-8");
      existed = true;
      const { text } = stripBom(rawContent);
      originalEnding = detectLineEnding(text);
    } catch {
      existed = false;
    }

    const normalizedContent = normalizeToLF(content);
    const finalContent = existed
      ? restoreLineEndings(normalizedContent, originalEnding)
      : content;

    await writeToolFile(filePath, finalContent, context);

    return { path: filePath, created: !existed };
  });
};

export const replaceTextInFile = async (
  args: {
    filePath: unknown;
    oldString: string;
    newString: string;
    replaceAll?: boolean;
  },
  context?: ToolContext,
): Promise<{ path: string; replacements: number; noChange?: boolean }> => {
  const filePath = resolveFilePath(args.filePath, context);
  const replaceAll = Boolean(args.replaceAll ?? false);

  const pathBlock = isBlockedPath(filePath, context);
  if (pathBlock) {
    throw new Error(pathBlock);
  }

  return withFileWriteLock(filePath, async () => {
    let rawContent: string;
    try {
      rawContent = await fs.readFile(filePath, "utf-8");
    } catch (error) {
      throw new Error(`Error reading file: ${(error as Error).message}`);
    }

    const { bom, text: content } = stripBom(rawContent);
    const originalEnding = detectLineEnding(content);
    const applied = applyStringReplacement(
      normalizeToLF(content),
      args.oldString,
      args.newString,
      replaceAll,
    );
    if (applied.noChange) {
      return { path: filePath, replacements: 0, noChange: true };
    }

    const final = bom + restoreLineEndings(applied.content, originalEnding);
    await writeToolFile(filePath, final, context);

    return { path: filePath, replacements: applied.replacements };
  });
};

export const applyAnchoredEditToFile = async (
  args: {
    filePath: unknown;
    anchor: unknown;
    endAnchor?: unknown;
    newText: string;
    insertAfter?: boolean;
  },
  context?: ToolContext,
): Promise<{ path: string } & AnchoredEditResult> => {
  const filePath = resolveFilePath(args.filePath, context);
  const pathBlock = isBlockedPath(filePath, context);
  if (pathBlock) {
    throw new Error(pathBlock);
  }

  const anchor = parseAnchor(args.anchor);
  const endAnchor =
    args.endAnchor === undefined ||
    args.endAnchor === null ||
    args.endAnchor === ""
      ? undefined
      : parseAnchor(args.endAnchor);

  return withFileWriteLock(filePath, async () => {
    let rawContent: string;
    try {
      rawContent = await fs.readFile(filePath, "utf-8");
    } catch (error) {
      throw new Error(`Error reading file: ${(error as Error).message}`);
    }

    const { bom, text } = stripBom(rawContent);
    const originalEnding = detectLineEnding(text);
    const normalizedContent = normalizeToLF(text);

    const applied = applyAnchoredEdit(normalizedContent, {
      anchor,
      newText: args.newText,
      ...(endAnchor ? { endAnchor } : {}),
      ...(args.insertAfter ? { insertAfter: true } : {}),
    });

    if (applied.content === normalizedContent) {
      return { path: filePath, ...applied };
    }

    const final = bom + restoreLineEndings(applied.content, originalEnding);
    await writeToolFile(filePath, final, context);
    return { path: filePath, ...applied };
  });
};

export const applyEditsToFile = async (
  args: { filePath: unknown; edits: unknown },
  context?: ToolContext,
): Promise<{ path: string; edits: number; lines: number[] }> => {
  const filePath = resolveFilePath(args.filePath, context);
  const pathBlock = isBlockedPath(filePath, context);
  if (pathBlock) {
    throw new Error(pathBlock);
  }
  const specs = parseEditSpecs(args.edits);

  return withFileWriteLock(filePath, async () => {
    let rawContent: string;
    try {
      rawContent = await fs.readFile(filePath, "utf-8");
    } catch (error) {
      throw new Error(`Error reading file: ${(error as Error).message}`);
    }

    const { bom, text } = stripBom(rawContent);
    const originalEnding = detectLineEnding(text);
    const applied = applyEditsToContent(normalizeToLF(text), specs);
    const final = bom + restoreLineEndings(applied.content, originalEnding);
    await writeToolFile(filePath, final, context);
    return { path: filePath, edits: specs.length, lines: applied.lines };
  });
};

const readImageResult = async (
  filePath: string,
  bytes: Buffer,
  imageMimeType: string,
): Promise<ToolResult> => {
  const decoded = await decodeAndValidateImage(bytes);
  if (!decoded || decoded.mimeType !== imageMimeType) {
    return {
      result: `Image file could not be decoded safely: ${filePath}`,
      details: { path: filePath, mimeType: imageMimeType },
    };
  }
  const resized = await resizeImage(bytes, decoded.mimeType, READ_IMAGE_CAPS);
  if (!resized) {
    return {
      result: `Image file could not be fitted to the model's image limits: ${filePath} (${decoded.width}x${decoded.height}, ${bytes.length} bytes)`,
      details: { path: filePath, mimeType: decoded.mimeType },
    };
  }
  const note = formatDimensionNote(resized, {
    bytes: bytes.length,
    mimeType: decoded.mimeType,
  });
  const data = resized.wasResized
    ? Buffer.from(resized.data, "base64")
    : bytes;
  return {
    result: `Image file: ${filePath} (${resized.originalWidth}x${resized.originalHeight})${note ? `\n${note}` : ""}`,
    details: {
      path: filePath,
      mimeType: resized.mimeType,
      width: resized.width,
      height: resized.height,
      ...(resized.wasResized
        ? {
            originalMimeType: decoded.mimeType,
            originalWidth: resized.originalWidth,
            originalHeight: resized.originalHeight,
            originalBytes: bytes.length,
          }
        : {}),
    },
    [TOOL_RESULT_AUTHORIZED_IMAGES]: [
      {
        data,
        mimeType: resized.mimeType as SupportedImageMediaType,
        sourcePath: filePath,
      },
    ],
  };
};

export const handleRead = async (
  args: Record<string, unknown>,
  context?: ToolContext,
): Promise<ToolResult> => {
  try {
    const filePath = resolveFilePath(args.file_path, context);
    const pathBlock = isBlockedPath(filePath, context);
    if (pathBlock) {
      throw new Error(pathBlock);
    }
    const readBudget = imageMimeTypeFromPath(filePath)
      ? READ_IMAGE_MAX_SOURCE_BYTES
      : MAX_FILE_BYTES;
    const scopedRoot = context?.toolWorkspaceRoot?.trim();
    const opened = scopedRoot
      ? await readWorkspaceFileNoFollow(
          filePath,
          scopedRoot,
          readBudget,
          context?.toolProcessIdentity
            ? { owner: context.toolProcessIdentity }
            : undefined,
        )
      : await (async () => {
          const stat = await fs.stat(filePath);
          if (!stat.isFile()) {
            throw new Error(`Path is not a file: ${filePath}`);
          }
          if (stat.size > readBudget) {
            throw new Error(
              `File too large to read safely (${stat.size} bytes, limit ${readBudget}): ${filePath}`,
            );
          }
          return {
            path: filePath,
            bytes: await fs.readFile(filePath),
            stat,
          };
        })();
    const stat = opened.stat;
    const header = opened.bytes.subarray(0, 12);
    const imageMimeType = resolveImageMimeType(opened.path, header);
    if (imageMimeType) {
      return await readImageResult(opened.path, opened.bytes, imageMimeType);
    }

    const skillSignature = `${stat.mtimeMs}:${stat.size}`;
    const skillDedupStub = getSkillReadDedupStub({
      filePath,
      signature: skillSignature,
      ...(context ? { context } : {}),
    });
    if (skillDedupStub) {
      return {
        result: skillDedupStub,
        details: { path: filePath, unchanged: true, dedup: true },
      };
    }

    const textFilePath = opened.path;
    const content = opened.bytes.toString("utf8");
    const offset = Number(args.offset ?? 1);
    const limit = Number(args.limit ?? 2000);
    const rawLines = normalizeToLF(content).split("\n");
    const displayLines = normalizeToLF(
      sanitizeToolVisibleText(content, { codeFile: true }),
    ).split("\n");
    const formatted = formatWithHashLines(
      rawLines,
      displayLines,
      offset,
      limit,
    );
    const totalLines = content.split("\n").length;
    const startLine = Math.max(1, Number.isFinite(offset) ? offset : 1);
    const safeLimit = Math.max(0, Number.isFinite(limit) ? limit : 2000);
    const servedEveryLine =
      startLine === 1 &&
      safeLimit >= totalLines &&
      !content.split("\n").some((line) => line.length > 2000);
    if (isSkillInstructionPath(textFilePath) && servedEveryLine) {
      recordFullSkillRead({
        filePath: textFilePath,
        signature: skillSignature,
        ...(context ? { context } : {}),
      });
    }
    return {
      result: `File: ${textFilePath}\n${formatted.header}\n\n${formatted.body}`,
    };
  } catch (error) {
    return { error: `Error reading file: ${(error as Error).message}` };
  }
};

export const handleWrite = async (
  args: Record<string, unknown>,
  context?: ToolContext,
): Promise<ToolResult> => {
  const content = String(args.content ?? "");

  try {
    const { path: filePath, created } = await writeTextFile(
      args.file_path,
      content,
      context,
    );
    return {
      result: created ? `Created ${filePath}` : `Wrote ${filePath}`,
    };
  } catch (error) {
    return { error: `Error writing file: ${(error as Error).message}` };
  }
};

export const handleEdit = async (
  args: Record<string, unknown>,
  context?: ToolContext,
): Promise<ToolResult> => {
  try {
    const prepared = prepareEditArguments(args);
    if (prepared.edits !== undefined) {
      if (prepared.replace_all === true) {
        throw new Error(
          "replace_all is not supported with edits[]; make a single old_string call with replace_all=true instead.",
        );
      }
      const applied = await applyEditsToFile(
        { filePath: prepared.file_path, edits: prepared.edits },
        context,
      );
      return {
        result: `Applied ${applied.edits} edit(s) to ${applied.path} (at line${applied.lines.length === 1 ? "" : "s"} ${applied.lines.join(", ")})`,
      };
    }

    if (args.new_string === undefined || args.new_string === null) {
      throw new Error(
        'new_string is required (use "" to delete), or pass edits[] for several replacements.',
      );
    }
    const hasAnchor =
      args.anchor !== undefined && args.anchor !== null && args.anchor !== "";
    if (hasAnchor) {
      const { path: filePath, ...applied } = await applyAnchoredEditToFile(
        {
          filePath: args.file_path,
          anchor: args.anchor,
          endAnchor: args.end_anchor,
          newText: String(args.new_string ?? ""),
          insertAfter: Boolean(args.insert_after ?? false),
        },
        context,
      );
      const range =
        applied.startLine === applied.endLine
          ? `line ${applied.startLine}`
          : `lines ${applied.startLine}-${applied.endLine}`;
      const action = applied.linesRemoved === 0 ? "Inserted after" : "Replaced";
      return {
        result: `${action} ${range} in ${filePath} (-${applied.linesRemoved}/+${applied.linesAdded} lines)`,
      };
    }

    const {
      path: filePath,
      replacements,
      noChange,
    } = await replaceTextInFile(
      {
        filePath: args.file_path,
        oldString: String(args.old_string ?? ""),
        newString: String(args.new_string ?? ""),
        replaceAll: Boolean(args.replace_all ?? false),
      },
      context,
    );
    if (noChange) {
      return {
        result: `Edit already applied to ${filePath}; no write was needed.`,
      };
    }
    return {
      result: `Replaced ${replacements} occurrence(s) in ${filePath}`,
    };
  } catch (error) {
    return { error: (error as Error).message };
  }
};
