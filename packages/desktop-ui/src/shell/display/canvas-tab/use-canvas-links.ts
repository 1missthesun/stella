import { useEffect, useRef, type RefObject } from "react";
import { resolveCanvasLink, type CanvasDocumentLocation } from "@stella/contracts/canvas-links";
import { openCanvasLink } from "./open-canvas-link";

/**
 * Opens the links a canvas's bridge posts the way the same link opens from
 * chat, resolved against where the canvas file lives.
 */
export function useCanvasLinks(
  frameRef: RefObject<HTMLIFrameElement | null>,
  location: CanvasDocumentLocation | null,
): void {
  const locationRef = useRef(location);
  locationRef.current = location;
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // The canvas origin is opaque ("null"), so the sender is
      // identified by its window, never by origin.
      const frameWindow = frameRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow) return;
      const data = event.data;
      // `stella:canvas-open-external` is what canvases served by an
      // older main send for web links.
      const href =
        data?.type === "stella:canvas-link" && typeof data.href === "string"
          ? data.href
          : data?.type === "stella:canvas-open-external" && typeof data.url === "string"
            ? data.url
            : null;
      if (href === null) return;
      // A click in the canvas activates this window too; a canvas
      // script posting on its own does not, so it can't open anything.
      if (navigator.userActivation && !navigator.userActivation.isActive) return;
      const link = resolveCanvasLink(href, locationRef.current);
      if (link.kind === "fragment") {
        frameWindow.postMessage({ type: "stella:canvas-scroll", fragment: link.fragment }, "*");
        return;
      }
      openCanvasLink(link);
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [frameRef]);
}
