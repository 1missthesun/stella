import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { injectCanvasActionBridge } from "@stella/contracts/canvas-actions";
import { injectCanvasBridge } from "@stella/contracts/canvas-bridge";
import { dispatchComposeText } from "@/shared/lib/stella-orb-chat";
import { useViewerWindow } from "@/shell/workspace-stage/viewer-item-context";
import { useRetainedSurfaceActive } from "@/ui/retained-surface";
import { CANVAS_FRAME_SANDBOX, CANVAS_HOST_FILE, canvasHostMessageType } from "@stella/contracts/canvas-host";

export type CanvasFrameSource = { src: string } | { html: string };

const canvasHostUrl = (): string => new URL(CANVAS_HOST_FILE, document.baseURI).href;

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
  const documentRef = useRef<Document | null>(null);
  const scrollRef = useRef({ x: 0, y: 0 });
  const viewerWindow = useViewerWindow();
  const active = useRetainedSurfaceActive();
  const activeRef = useRef(active);
  activeRef.current = active;
  const generation = useRef({ html, count: 0 });
  if (generation.current.html !== html) generation.current = { html, count: generation.current.count + 1 };
  const hosted = html !== null;

  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage(
      { type: "stella:canvas-visibility", active },
      "*",
    );
  }, [active, frameRef]);

  useEffect(() => {
    if (!hosted) return;
    const onMessage = (event: MessageEvent) => {
      const frameWindow = frameRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow) return;
      const type = canvasHostMessageType(event.data);
      if (type === "stella:canvas-host-ready") {
        frameWindow.postMessage({ type: "stella:canvas-html", html: htmlRef.current ?? "" }, "*");
      } else if (type === "stella:canvas-written") {
        if (!activeRef.current) {
          frameWindow.postMessage(
            { type: "stella:canvas-visibility", active: false },
            "*",
          );
        }
        onDocumentRef.current?.();
      }
    };
    viewerWindow.addEventListener("message", onMessage);
    return () => viewerWindow.removeEventListener("message", onMessage);
  }, [hosted, frameRef, viewerWindow]);

  useEffect(() => {
    if (hosted) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data;
      if (data?.type === "stella:canvas-scrolled") {
        const { x, y } = data;
        if (Number.isFinite(x) && Number.isFinite(y)) scrollRef.current = { x, y };
      } else if (
        data?.type === "stella:canvas-compose" &&
        viewerWindow !== window &&
        typeof data.text === "string" &&
        data.text.trim()
      ) {
        dispatchComposeText({ text: data.text.trim(), selectedText: null });
        window.electronAPI?.window?.show?.();
      }
    };
    viewerWindow.addEventListener("message", onMessage);
    return () => viewerWindow.removeEventListener("message", onMessage);
  }, [hosted, frameRef, viewerWindow]);

  return (
    <iframe
      key={hosted ? `host:${generation.current.count}` : "src"}
      ref={frameRef}
      title={title}
      className={className}
      src={hosted ? canvasHostUrl() : (source as { src: string }).src}
      sandbox={CANVAS_FRAME_SANDBOX}
      referrerPolicy="no-referrer"
      onLoad={(event) => {
        if (hosted) return;
        const frame = event.currentTarget;
        const moved =
          documentRef.current !== null &&
          documentRef.current !== frame.ownerDocument;
        documentRef.current = frame.ownerDocument;
        if (moved) {
          loadsRef.current = 0;
          frame.contentWindow?.postMessage(
            { type: "stella:canvas-scroll", ...scrollRef.current },
            "*",
          );
        }
        if (!activeRef.current) {
          frame.contentWindow?.postMessage(
            { type: "stella:canvas-visibility", active: false },
            "*",
          );
        }
        onDocumentRef.current?.();
        loadsRef.current += 1;
        if (loadsRef.current > 1) {
          loadsRef.current = 0;
          onNavigatedAway?.();
        }
      }}
    />
  );
}

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
