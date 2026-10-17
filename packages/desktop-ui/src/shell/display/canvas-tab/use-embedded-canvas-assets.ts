import { useEffect, useState } from "react";
import { embedRelativeHtmlAssets } from "@stella/contracts/html-relative-assets";
import { readDeviceFileCopy } from "@/features/cloud/device-file-copy";
import { backendClient } from "@/platform/backend/backend-client";
import {
  fetchWithInactivity,
  REQUEST_BUDGET_MS,
} from "@stella/contracts/request-deadline";

const MAX_ASSET_BYTES = 16 * 1024 * 1024;
const decoder = new TextDecoder("utf-8");

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
};

const MEDIA_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  flac: "audio/flac",
};

const assetTypeFor = (
  filePath: string,
  reported: string,
  kind: "image" | "media",
) => {
  const prefixes = kind === "image" ? ["image/"] : ["video/", "audio/"];
  if (prefixes.some((prefix) => reported.startsWith(prefix))) return reported;
  const extension = /\.([a-z0-9]+)$/iu.exec(filePath)?.[1]?.toLowerCase() ?? "";
  return (kind === "image" ? IMAGE_TYPES : MEDIA_TYPES)[extension] ?? null;
};

const dataUrlOf = (bytes: Uint8Array, type: string) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read file."));
    reader.readAsDataURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  });

const embedFromDeviceCopies = (
  html: string,
  documentPath: string,
  signal: AbortSignal,
) =>
  embedRelativeHtmlAssets(
    html,
    documentPath,
    async ({ path, kind }) => {
      const copy = await readDeviceFileCopy(path, MAX_ASSET_BYTES);
      if (!copy || copy.truncated || signal.aborted) return null;
      if (kind === "text") return decoder.decode(copy.bytes);
      const type = assetTypeFor(path, copy.mimeType, kind);
      return type ? await dataUrlOf(copy.bytes, type) : null;
    },
    signal,
  );

/**
 * A Drive document's images and videos point at their signed Drive URLs, so
 * video streams with range requests instead of being inlined; its styles and
 * scripts are inlined.
 */
const embedFromDrive = (
  html: string,
  documentPath: string,
  signal: AbortSignal,
) =>
  embedRelativeHtmlAssets(
    html,
    documentPath,
    async ({ path, kind }) => {
      const { url, sizeBytes } = await backendClient.call("drive.fileUrl", {
        path: path.replace(/^\/+/u, ""),
      });
      if (kind !== "text") return url;
      if (sizeBytes > MAX_ASSET_BYTES) return null;
      const response = await fetchWithInactivity(fetch, url, {}, {
        label: "Drive file",
        idleMs: REQUEST_BUDGET_MS.transferIdle,
        signal,
      });
      return response.ok ? await response.text() : null;
    },
    signal,
  );

export type EmbeddedCanvasAssetSource = "device" | "drive";

export const useEmbeddedCanvasAssets = (
  html: string,
  documentPath: string,
  source: EmbeddedCanvasAssetSource | null,
): { html: string; loading: boolean } => {
  const enabled = source !== null;
  const [embedded, setEmbedded] = useState<{
    source: string;
    html: string;
  } | null>(null);
  useEffect(() => {
    if (!enabled || !html) return;
    const controller = new AbortController();
    const settle = (result: string) => {
      if (!controller.signal.aborted) setEmbedded({ source: html, html: result });
    };
    const embed = source === "drive" ? embedFromDrive : embedFromDeviceCopies;
    void embed(html, documentPath, controller.signal).then(
      settle,
      () => settle(html),
    );
    return () => controller.abort();
  }, [html, documentPath, enabled, source]);
  if (!enabled || !html) return { html, loading: false };
  return embedded?.source === html
    ? { html: embedded.html, loading: false }
    : { html: "", loading: true };
};
