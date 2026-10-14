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

  useEffect(() => {
    return window.electronAPI?.display.onUpdate((rawPayload) => {
      const payload = normalizeDisplayPayload(rawPayload);
      if (!payload) return;
      routeDisplayPayload(payload);
    });
  }, [routeDisplayPayload]);

  useEffect(() => {
    return window.electronAPI?.display.onOpenShareLink?.(({ url }) => {
      maybeHandleCanvasShareUrl(url);
    });
  }, []);


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

  useMediaMaterializer({ onMaterialized: routeDisplayPayload });
}
