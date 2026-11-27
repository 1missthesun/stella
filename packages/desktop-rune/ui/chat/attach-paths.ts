import type { Dispatch, SetStateAction } from "react";
import type { ChatContext } from "@/shared/types/electron";
import { applyProcessedAttachments, attachFilesToContext } from "@/features/chat/lib/file-attach";
import { platformCapabilities } from "@/platform/capabilities";
import { attachmentContentType } from "@stella/contracts/attachment-content-type";

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", heic: "image/heic", avif: "image/avif", bmp: "image/bmp",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json", html: "text/html",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", zip: "application/zip",
};

/** A dropped path as the `File` Electron hands the renderer: the bytes, plus `path` for `getPathForFile`. */
export const fileFromPath = (filePath: string): File => {
  const name = filePath.split(/[\\/]/).pop() ?? filePath;
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const source = Bun.file(filePath);
  const file = new File([source], name, { type: MIME_BY_EXT[ext] ?? source.type ?? "", lastModified: source.lastModified });
  Object.defineProperty(file, "path", { value: filePath, enumerable: false });
  return file;
};

type SetChatContext = Dispatch<SetStateAction<ChatContext | null>>;

const PREVIEW_MAX_EDGE_PX = 1024;
const PREVIEW_IMAGE_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"]);

const nameOf = (filePath: string) => filePath.split(/[\\/]/).pop() ?? filePath;
const isPreviewImage = (filePath: string) => PREVIEW_IMAGE_TYPES.has(attachmentContentType({ declared: "", name: nameOf(filePath) }));

type Screenshot = { dataUrl: string; width: number; height: number; previewUrl?: string; filePath?: string };

/**
 * desktop-ui's `attachFilesToContext` for files the engine hands over by path. Images become
 * screenshot tiles with a preview decoded off the UI thread (desktop-ui decodes them with
 * `createImageBitmap` and a canvas, which Rune's UI doesn't have); `inline` images (a pasted
 * bitmap the engine saved to a temporary file) carry their bytes instead of the path.
 */
export async function attachPathsToContext(paths: readonly string[], setChatContext: SetChatContext, options?: { inline?: readonly string[] }): Promise<void> {
  const preview = globalThis.stella.host?.imagePreview;
  if (platformCapabilities.browserUploads || !preview) {
    await attachFilesToContext(paths.map(fileFromPath), setChatContext);
    return;
  }
  const inline = new Set(options?.inline ?? []);
  const images = paths.filter(isPreviewImage);
  const others = paths.filter((filePath) => !isPreviewImage(filePath));
  const decoded = await Promise.all(
    images.map(async (filePath): Promise<Screenshot | string> => {
      const shown = await preview(filePath, PREVIEW_MAX_EDGE_PX);
      if (!shown) return filePath;
      if (!inline.has(filePath)) return { dataUrl: shown.dataUrl, previewUrl: shown.dataUrl, filePath, width: shown.width, height: shown.height };
      const type = attachmentContentType({ declared: "", name: nameOf(filePath) });
      const bytes = Buffer.from(await Bun.file(filePath).arrayBuffer()).toString("base64");
      return { dataUrl: `data:${type};base64,${bytes}`, previewUrl: shown.dataUrl, width: shown.width, height: shown.height };
    }),
  );
  const screenshots = decoded.filter((entry): entry is Screenshot => typeof entry !== "string");
  const undecoded = decoded.filter((entry): entry is string => typeof entry === "string");
  applyProcessedAttachments({ screenshots, files: [] }, setChatContext);
  const files = [...undecoded, ...others];
  if (files.length > 0) await attachFilesToContext(files.map(fileFromPath), setChatContext);
}
