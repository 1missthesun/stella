import { useCallback, useEffect, useMemo, useState } from "react";
import * as Clipboard from "expo-clipboard";
import {
  SHARE_CANVAS_PATTERN,
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

export type CanvasShareToggle = {
  isPublic: boolean;
  busy: boolean;
  toggle: () => Promise<boolean>;
};

export function useCanvasShareToggle(
  canvas: string | null,
  html: string | null,
  title: string | undefined,
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
        : html
          ? await client.call("shares.save", {
              canvas,
              html,
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
  }, [canvas, html, isPublic, link, title]);
  return useMemo(
    () => (canvas ? { isPublic, busy, toggle } : null),
    [busy, canvas, isPublic, toggle],
  );
}
