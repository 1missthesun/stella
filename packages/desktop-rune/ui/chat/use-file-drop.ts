import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { ChatContext } from "@/shared/types/electron";
import { attachFilesToContext } from "@/features/chat/lib/file-attach";

type UseFileDropOptions = {
  setChatContext: Dispatch<SetStateAction<ChatContext | null>>;
  disabled?: boolean;
};

export type RuneDropHandlers = {
  onDropFiles: (paths: string[]) => void;
  onDropHover: (over: boolean) => void;
};

type UseFileDropReturn = {
  isDragOver: boolean;
  isWindowDragActive: boolean;
  dropHandlers: RuneDropHandlers;
};

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

export function useFileDrop({ setChatContext, disabled = false }: UseFileDropOptions): UseFileDropReturn {
  const [isDragOver, setIsDragOver] = useState(false);
  const onDropHover = useCallback((over: boolean) => setIsDragOver(!disabled && over), [disabled]);
  const onDropFiles = useCallback(
    (paths: string[]) => {
      setIsDragOver(false);
      if (disabled || paths.length === 0) return;
      void attachFilesToContext(paths.map(fileFromPath), setChatContext);
    },
    [disabled, setChatContext],
  );
  return { isDragOver, isWindowDragActive: isDragOver, dropHandlers: { onDropFiles, onDropHover } };
}
