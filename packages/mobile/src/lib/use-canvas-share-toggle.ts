import { useCallback, useEffect, useState } from "react";
import * as Clipboard from "expo-clipboard";
import {
  SHARE_CANVAS_PATTERN,
  type ShareLink,
} from "@stella/contracts/backend/shares";
import { getBackendClient } from "./backend";

/** The canvas slug behind a canvas artifact: its own, else its file name. */
export const canvasSlugFor = (
  slug: string | undefined,
  filePath: string,
): string | null => {
  if (slug && SHARE_CANVAS_PATTERN.test(slug)) return slug;
  const base = filePath.split(/[\\/]/).pop()?.replace(/\.html?$/i, "") ?? "";
  return SHARE_CANVAS_PATTERN.test(base) ? base : null;
};

export type CanvasShareToggle = {
  /** The link is public: anyone with it can open the canvas. */
  isPublic: boolean;
  busy: boolean;
  /**
   * Make the canvas public and copy its link, or make it private again.
   * Resolves to whether the canvas ended up public.
   */
  toggle: () => Promise<boolean>;
};

/**
 * Every canvas already has a private link; sharing is making it public, and
 * the link stays the same either way. A canvas never saved to a link gets one
 * here, public from the start.
 */
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
  return canvas ? { isPublic, busy, toggle } : null;
}
