import { useCallback, useEffect, type RefObject } from "react";
import { useMediaMaterializer } from "@/app/media/use-media-materializer";
import {
  type DisplayTabPayload,
  normalizeDisplayPayload,
} from "@stella/contracts/desktop/display-payload";
import type { WorkspaceStageHandle } from "@/shell/workspace-stage/WorkspaceStage";
import { maybeHandleCanvasShareUrl } from "@/features/canvas-share/open-shared-canvas";

type UseDisplayPayloadRoutingOptions = {
  rightSidebarRef: RefObject<WorkspaceStageHandle | null>;
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
        rightSidebarRef.current?.update(
          {
            kind: "trash",
            title: "Trash",
            createdAt: Date.now(),
          },
          { tab: false },
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [rightSidebarRef]);

  // Generated media already shows inline in the chat: register it for the
  // viewer's strip without adding a top-bar tab for every image.
  const routeMaterializedPayload = useCallback(
    (payload: DisplayTabPayload) => {
      rightSidebarRef.current?.update(payload, { tab: false });
    },
    [rightSidebarRef],
  );

  useMediaMaterializer({ onMaterialized: routeMaterializedPayload });
}
