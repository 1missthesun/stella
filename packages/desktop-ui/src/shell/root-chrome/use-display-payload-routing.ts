import { useCallback, useEffect, type RefObject } from "react";
import { useMediaMaterializer } from "@/app/media/use-media-materializer";
import {
  type DisplayTabPayload,
  normalizeDisplayPayload,
} from "@stella/contracts/desktop/display-payload";
import type { RightSidebarHandle } from "@/shell/RightSidebar";
import { maybeHandleCanvasShareUrl } from "@/features/canvas-share/open-shared-canvas";

type UseDisplayPayloadRoutingOptions = {
  rightSidebarRef: RefObject<RightSidebarHandle | null>;
};

/**
 * Push payloads into the workspace panel.
 *
 * Programmatic payloads register or refresh tabs without opening the
 * workspace panel. The panel should only open from an explicit user action
 * (toggle, keyboard open, or clicking a resource/card).
 * Also seeds the workspace panel with a stable Trash tab when the
 * previous agent run left files in deferred-delete trash, and wires
 * the owner-scoped media materializer so any media job gets surfaced
 * here too.
 */
export function useDisplayPayloadRouting({
  rightSidebarRef,
}: UseDisplayPayloadRoutingOptions): void {
  const routeDisplayPayload = useCallback(
    (payload: DisplayTabPayload) => {
      const ds = rightSidebarRef.current;
      if (!ds) return;
      ds.update(payload);
    },
    [rightSidebarRef],
  );

  // Structured display payloads from main process.
  useEffect(() => {
    return window.electronAPI?.display.onUpdate((rawPayload) => {
      const payload = normalizeDisplayPayload(rawPayload);
      if (!payload) return;
      routeDisplayPayload(payload);
    });
  }, [routeDisplayPayload]);

  // Canvas-share links main caught as a new window or navigation.
  useEffect(() => {
    return window.electronAPI?.display.onOpenShareLink?.(({ url }) => {
      maybeHandleCanvasShareUrl(url);
    });
  }, []);


  // If the previous agent run left files in deferred-delete trash, seed
  // the workspace panel with a stable tab without opening UI. The
  // actual Trash tab UI is intentionally deferred; this just wires
  // discovery and tab routing.
  useEffect(() => {
    let cancelled = false;
    void window.electronAPI?.display
      ?.listTrash?.()
      ?.then((result: { items?: unknown[] } | null) => {
        if (cancelled || !result || !Array.isArray(result.items)) return;
        if (result.items.length === 0) return;
        rightSidebarRef.current?.update({
          kind: "trash",
          title: "Trash",
          createdAt: Date.now(),
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [rightSidebarRef]);

  // Owner-scoped materializer: any media job (this conversation,
  // another device, the agent, the studio, …) gets downloaded into
  // `~/.stella/media/outputs/` and surfaced in the workspace panel.
  useMediaMaterializer({ onMaterialized: routeDisplayPayload });
}
