import { useEffect, useRef, type RefObject } from "react";
import { resolveCanvasLink, type CanvasDocumentLocation, type CanvasLink } from "@stella/contracts/canvas-links";
import { useViewerWindow } from "@/shell/workspace-stage/viewer-item-context";
import { openCanvasLink } from "./open-canvas-link";

const OPENS_IN_STELLA: ReadonlySet<CanvasLink["kind"]> = new Set([
  "web",
  "drive",
  "device",
  "app",
]);

export function useCanvasLinks(
  frameRef: RefObject<HTMLIFrameElement | null>,
  location: CanvasDocumentLocation | null,
): void {
  const viewerWindow = useViewerWindow();
  const locationRef = useRef(location);
  locationRef.current = location;
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // The canvas origin is opaque ("null"), so the sender is
      // identified by its window, never by origin.
      const frameWindow = frameRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow) return;
      const data = event.data;
      const href =
        data?.type === "stella:canvas-link" && typeof data.href === "string"
          ? data.href
          : data?.type === "stella:canvas-open-external" && typeof data.url === "string"
            ? data.url
            : null;
      if (href === null) return;
      // A click in the canvas activates this window too; a canvas
      // script posting on its own does not, so it can't open anything.
      const { userActivation } = viewerWindow.navigator;
      if (userActivation && !userActivation.isActive) return;
      const link = resolveCanvasLink(href, locationRef.current);
      if (link.kind === "fragment") {
        frameWindow.postMessage({ type: "stella:canvas-scroll", fragment: link.fragment }, "*");
        return;
      }
      openCanvasLink(link);
      if (viewerWindow !== window && OPENS_IN_STELLA.has(link.kind)) {
        window.electronAPI?.window?.show?.();
      }
    };
    viewerWindow.addEventListener("message", handleMessage);
    return () => viewerWindow.removeEventListener("message", handleMessage);
  }, [frameRef, viewerWindow]);
}
