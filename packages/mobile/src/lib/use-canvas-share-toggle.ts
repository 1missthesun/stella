import { useCallback, useEffect, useMemo, useState } from "react";
import * as Clipboard from "expo-clipboard";
import {
  SHARE_CANVAS_PATTERN,
  SHARE_MAX_HTML_BYTES,
  type ShareLink,
} from "@stella/contracts/backend/shares";
import { getBackendClient } from "./backend";

export const canvasSlugFor = (
  slug: string | undefined,
  filePath: string,
): string | null => {
  if (slug && SHARE_CANVAS_PATTERN.test(slug)) return slug;
  const base = filePath.split(/[\\/]/).pop()?.replace(/\.html?$/i, "") ?? "";
  return SHARE_CANVAS_PATTERN.test(base) ? base : null;
};

class CanvasTooLargeError extends Error {}

const megabytes = (bytes: number): string => {
  const value = bytes / (1024 * 1024);
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} MB`;
};

/** The reason to show when it is something the user can act on (a size limit, a missing file). */
export const canvasShareFailureReason = (error: unknown): string | undefined => {
  if (error instanceof CanvasTooLargeError) return error.message;
  const code =
    error && typeof error === "object" && "code" in error ? error.code : null;
  return (code === "BAD_REQUEST" || code === "NOT_FOUND") && error instanceof Error
    ? error.message
    : undefined;
};

export type CanvasShareToggle = {
  isPublic: boolean;
  busy: boolean;
  toggle: () => Promise<boolean>;
};

const checkedShareHtml = (html: string): string => {
  const bytes = new TextEncoder().encode(html).byteLength;
  if (bytes > SHARE_MAX_HTML_BYTES) {
    throw new CanvasTooLargeError(
      `This canvas is ${megabytes(bytes)}; a public link can hold up to ${megabytes(SHARE_MAX_HTML_BYTES)}.`,
    );
  }
  return html;
};

export function useCanvasShareToggle(
  canvas: string | null,
  html: string | null,
  title: string | undefined,
  drivePath: string | null = null,
): CanvasShareToggle | null {
  const [link, setLink] = useState<ShareLink | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setLink(null);
    if (!canvas) return;
    try {
      return getBackendClient().watch(
        "shares.canvas",
        { canvas },
        (value) => setLink(value),
        () => setLink(null),
      );
    } catch {
      return undefined;
    }
  }, [canvas]);
  const isPublic = link?.visibility === "public";
  const toggle = useCallback(async (): Promise<boolean> => {
    if (!canvas) return false;
    setBusy(true);
    try {
      const client = getBackendClient();
      if (isPublic && link) {
        const saved = await client.call("shares.setVisibility", {
          slug: link.slug,
          visibility: "private",
        });
        setLink({ ...link, visibility: saved.visibility });
        return false;
      }
      const saved = link
        ? await client.call("shares.setVisibility", {
            slug: link.slug,
            visibility: "public",
          })
        : drivePath && /\.html?$/iu.test(drivePath)
          ? await client.call("shares.saveDriveDocument", {
              canvas,
              path: drivePath,
              ...(title ? { title: title.slice(0, 300) } : {}),
              visibility: "public",
            })
          : html
            ? await client.call("shares.save", {
                canvas,
                html: checkedShareHtml(html),
                ...(title ? { title: title.slice(0, 300) } : {}),
                visibility: "public",
              })
            : null;
      if (!saved) return false;
      setLink({
        slug: saved.slug,
        url: saved.url,
        title: link?.title ?? title ?? null,
        createdAt: link?.createdAt ?? Date.now(),
        expiresAt: saved.expiresAt,
        visibility: saved.visibility,
        canvas,
      });
      await Clipboard.setStringAsync(saved.url);
      return true;
    } finally {
      setBusy(false);
    }
  }, [canvas, drivePath, html, isPublic, link, title]);
  return useMemo(
    () => (canvas ? { isPublic, busy, toggle } : null),
    [busy, canvas, isPublic, toggle],
  );
}
