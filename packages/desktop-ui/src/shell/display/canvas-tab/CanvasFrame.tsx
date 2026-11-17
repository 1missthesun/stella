import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { injectCanvasActionBridge } from "@stella/contracts/canvas-actions";
import { injectCanvasBridge } from "@stella/contracts/canvas-bridge";
import { CANVAS_FRAME_SANDBOX, CANVAS_HOST_FILE, canvasHostMessageType } from "@stella/contracts/canvas-host";

/** A canvas served from its own address (desktop), or HTML for the web's canvas host page. */
export type CanvasFrameSource = { src: string } | { html: string };

const canvasHostUrl = (): string => new URL(CANVAS_HOST_FILE, document.baseURI).href;

/**
 * The sandboxed iframe a canvas runs in (see canvas-host.ts). `onDocument`
 * runs each time the canvas document is in place: on desktop its load; on
 * the web once the host page has written it. `onNavigatedAway` runs when a
 * desktop canvas loads a second document.
 */
export function CanvasFrame({
  frameRef,
  source,
  title,
  className,
  onDocument,
  onNavigatedAway,
}: {
  frameRef: MutableRefObject<HTMLIFrameElement | null>;
  source: CanvasFrameSource;
  title: string;
  className?: string;
  onDocument?: () => void;
  onNavigatedAway?: () => void;
}) {
  const html = "html" in source ? source.html : null;
  const htmlRef = useRef(html);
  htmlRef.current = html;
  const onDocumentRef = useRef(onDocument);
  onDocumentRef.current = onDocument;
  const loadsRef = useRef(0);
  const generation = useRef({ html, count: 0 });
  if (generation.current.html !== html) generation.current = { html, count: generation.current.count + 1 };
  const hosted = html !== null;

  useEffect(() => {
    if (!hosted) return;
    const onMessage = (event: MessageEvent) => {
      const frameWindow = frameRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow) return;
      const type = canvasHostMessageType(event.data);
      if (type === "stella:canvas-host-ready") {
        frameWindow.postMessage({ type: "stella:canvas-html", html: htmlRef.current ?? "" }, "*");
      } else if (type === "stella:canvas-written") {
        onDocumentRef.current?.();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [hosted, frameRef]);

  return (
    <iframe
      key={hosted ? `host:${generation.current.count}` : "src"}
      ref={frameRef}
      title={title}
      className={className}
      src={hosted ? canvasHostUrl() : (source as { src: string }).src}
      sandbox={CANVAS_FRAME_SANDBOX}
      referrerPolicy="no-referrer"
      onLoad={() => {
        if (hosted) return;
        onDocumentRef.current?.();
        // The first load is the canvas document. Main stops a canvas
        // navigating itself, so a later load means something got past that.
        loadsRef.current += 1;
        if (loadsRef.current > 1) {
          loadsRef.current = 0;
          onNavigatedAway?.();
        }
      }}
    />
  );
}

/**
 * Where HTML the app holds renders: registered with Electron main and served
 * from `stella-canvas:` on desktop, or handed to the canvas host page on the
 * web, with the same bridges either way.
 */
export function useHtmlCanvasSource(html: string): { source: CanvasFrameSource | null; error: string | null } {
  const display = typeof window === "undefined" ? undefined : window.electronAPI?.display;
  const register = typeof display?.canvasHtmlUrl === "function" ? display.canvasHtmlUrl : null;
  const hosted = useMemo(() => (register ? null : injectCanvasBridge(injectCanvasActionBridge(html))), [html, register]);
  const [registered, setRegistered] = useState<{ html: string; src: string | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!register) return;
    let cancelled = false;
    void register(html).then(
      ({ url }) => {
        if (!cancelled) setRegistered({ html, src: url, error: null });
      },
      (caught: unknown) => {
        if (!cancelled) setRegistered({ html, src: null, error: caught instanceof Error ? caught.message : String(caught) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [html, register]);
  if (hosted !== null) return { source: { html: hosted }, error: null };
  const settled = registered?.html === html ? registered : null;
  return { source: settled?.src ? { src: settled.src } : null, error: settled?.error ?? null };
}
