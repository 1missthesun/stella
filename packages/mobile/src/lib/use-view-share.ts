// A Stella View's link (`<conversationId>/<slug>`): the same `/c/<slug>` links, visibility, expiry
// and revoke as a canvas's (owner-store `shares.saveView`), following the view's newest version.
import { useCallback, useEffect, useMemo, useState } from "react";
import * as Clipboard from "expo-clipboard";
import type { ShareLink } from "@stella/contracts/backend/shares";
import { getBackendClient } from "./backend";

export type ViewShare = {
  link: ShareLink | null;
  isPublic: boolean;
  busy: boolean;
  /** Makes the link public (creating it first) and copies it; returns its URL. */
  publish: () => Promise<string>;
  makePrivate: () => Promise<void>;
};

export function useViewShare(viewId: string | null): ViewShare | null {
  const [link, setLink] = useState<ShareLink | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setLink(null);
    if (!viewId) return;
    try {
      return getBackendClient().watch(
        "shares.view",
        { viewId },
        (value) => setLink(value),
        () => setLink(null),
      );
    } catch {
      return undefined;
    }
  }, [viewId]);
  const publish = useCallback(async (): Promise<string> => {
    if (!viewId) throw new Error("This view hasn't reached your account yet.");
    setBusy(true);
    try {
      const client = getBackendClient();
      const saved = link
        ? await client.call("shares.setVisibility", { slug: link.slug, visibility: "public" })
        : await client.call("shares.saveView", { viewId, visibility: "public" });
      setLink((prior) => ({
        slug: saved.slug,
        url: saved.url,
        title: prior?.title ?? null,
        createdAt: prior?.createdAt ?? Date.now(),
        expiresAt: saved.expiresAt,
        visibility: saved.visibility,
        canvas: null,
        view: viewId,
      }));
      await Clipboard.setStringAsync(saved.url);
      return saved.url;
    } finally {
      setBusy(false);
    }
  }, [link, viewId]);
  const makePrivate = useCallback(async () => {
    if (!link) return;
    setBusy(true);
    try {
      const saved = await getBackendClient().call("shares.setVisibility", { slug: link.slug, visibility: "private" });
      setLink({ ...link, visibility: saved.visibility });
    } finally {
      setBusy(false);
    }
  }, [link]);
  return useMemo(
    () => (viewId ? { link, isPublic: link?.visibility === "public", busy, publish, makePrivate } : null),
    [busy, link, makePrivate, publish, viewId],
  );
}
