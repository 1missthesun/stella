import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { injectCanvasActionBridge } from "@stella/contracts/canvas-actions";
import { injectCanvasBridge } from "@stella/contracts/canvas-bridge";
import { dispatchComposeText } from "@/shared/lib/stella-orb-chat";
import { useViewerWindow } from "@/shell/workspace-stage/viewer-item-context";
import type { Layout, WebviewMessage, WebviewRequest } from "../../../../host/rune-jsx/props";
import { useRetainedSurfaceActive } from "../../../kit";
import { useTokens } from "../../../theme";
import { publishCanvasSelection } from "../../selection/AskStellaSelectionChip";

export type CanvasFrameSource = { src: string } | { html: string };

/** What the canvas page posts to its host; everything else a page posts to itself stays in the page. */
const OUTGOING = ["stella:canvas-link", "stella:canvas-open-external", "stella:canvas-compose", "stella:canvas-selection", "stella:canvas-scrolled", "stella:rune-canvas-port-out"];

/**
 * In an `<iframe>` the canvas bridges talk to `window.parent` and take the action port from a
 * message whose `source` is the parent. A top-level WebView has no parent, so the page is its own
 * parent: host messages are posted by the page to itself (`source === parent` holds), the bridges'
 * outgoing messages are forwarded to the host, and the action port is a channel made in the page.
 */
const CANVAS_PRELOAD = `(() => {
  const bridge = window.__stellaBridge;
  if (!bridge || bridge.canvas) return;
  const toHost = bridge.post;
  const outgoing = new Set(${JSON.stringify(OUTGOING)});
  try { Object.defineProperty(window, "parent", { get: () => window, configurable: true }); } catch {}
  try { Object.defineProperty(window, "top", { get: () => window, configurable: true }); } catch {}
  let port = null;
  bridge.canvas = true;
  bridge.receive = (data) => {
    if (data && data.type === "stella:rune-canvas-port") {
      if (port) port.close();
      const channel = new MessageChannel();
      port = channel.port1;
      port.onmessage = (event) => toHost({ type: "stella:rune-canvas-port-out", data: event.data }, "*");
      window.postMessage({ type: "stella:canvas-port" }, "*", [channel.port2]);
      return;
    }
    if (data && data.type === "stella:rune-canvas-port-in") {
      if (port) port.postMessage(data.data);
      return;
    }
    window.postMessage(data, "*");
  };
  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || !outgoing.has(event.data.type)) return;
    toHost(event.data, "*");
  }, true);
  let scheme = null;
  const reportScheme = () => {
    const root = document.documentElement;
    let next = root ? getComputedStyle(root).colorScheme : "normal";
    if (!next || next === "normal") next = document.querySelector('meta[name="color-scheme"]')?.content || "normal";
    if (next === scheme) return;
    scheme = next;
    toHost({ type: "stella:rune-canvas-color-scheme", scheme }, "*");
  };
  const watchScheme = () => {
    reportScheme();
    const watch = new MutationObserver(reportScheme);
    watch.observe(document.documentElement, { attributes: true });
    if (document.head) watch.observe(document.head, { childList: true, subtree: true, attributes: true, characterData: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watchScheme, { once: true });
  else watchScheme();
  window.addEventListener("load", reportScheme);
})();`;

/**
 * Chromium's backdrop for an iframe: transparent when the page's used color scheme is the
 * embedder's, otherwise opaque in the page's canvas colour (white for a page that sets none).
 * Before the page reports, it is a page that sets none.
 */
const pageBackdrop = (scheme: string, appDark: boolean): string | undefined => {
  const offered = scheme.split(/\s+/).filter((s) => s === "light" || s === "dark");
  const used = offered.includes(appDark ? "dark" : "light") ? (appDark ? "dark" : "light") : (offered[0] ?? "light");
  if ((used === "dark") === appDark) return undefined;
  return used === "dark" ? "#121212" : "#ffffff";
};

const scrollMemory = new Map<string, { x: number; y: number }>();

const messageData = (m: WebviewMessage): { type?: unknown; [key: string]: unknown } | null => {
  let data: unknown = m.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  return data && typeof data === "object" ? (data as { type?: unknown }) : null;
};

const canvasSelection = (data: { [key: string]: unknown }, frame: Layout | null, host: CanvasFrameHost) => {
  if (!data.selected || !frame || typeof data.text !== "string") return null;
  const rect = data.rect && typeof data.rect === "object" ? (data.rect as Record<string, unknown>) : null;
  const { left, top, width, height } = rect ?? {};
  if (typeof left !== "number" || typeof top !== "number" || typeof width !== "number" || typeof height !== "number") return null;
  return {
    text: data.text,
    rect: { x: frame.x + left, y: frame.y + top, w: width, h: height },
    clear: () => host.post({ type: "stella:canvas-selection-clear" }),
  };
};

/** The page side of a canvas frame: post to it, or hand it the action port. */
export type CanvasFrameHost = {
  post: (data: unknown) => void;
  openPort: (onMessage: (data: unknown) => void) => { post: (data: unknown) => void; close: () => void };
};

const frameHost = (id: string, portListener: { current: ((data: unknown) => void) | null }): CanvasFrameHost => ({
  post: (data) => void stella.engine.webview.post(id, data).catch(() => {}),
  openPort: (onMessage) => {
    portListener.current = onMessage;
    void stella.engine.webview.post(id, { type: "stella:rune-canvas-port" }).catch(() => {});
    return {
      post: (data) => void stella.engine.webview.post(id, { type: "stella:rune-canvas-port-in", data }).catch(() => {}),
      close: () => {
        if (portListener.current === onMessage) portListener.current = null;
      },
    };
  },
});

/** desktop-ui's `CanvasFrame` as a lazy OS WebView: the canvas URL (served by main's canvas protocol) or bridged HTML. */
export function CanvasFrame({
  id,
  source,
  title,
  onDocument,
  onNavigatedAway,
  onMessage,
}: {
  id: string;
  source: CanvasFrameSource;
  title: string;
  onDocument?: (host: CanvasFrameHost) => void;
  onNavigatedAway?: () => void;
  onMessage?: (data: { type?: unknown; [key: string]: unknown }, host: CanvasFrameHost) => void;
}) {
  const viewerWindow = useViewerWindow();
  const portListener = useRef<((data: unknown) => void) | null>(null);
  const host = useMemo(() => frameHost(id, portListener), [id]);
  const loads = useRef(0);
  const latest = useRef({ onDocument, onNavigatedAway, onMessage });
  latest.current = { onDocument, onNavigatedAway, onMessage };
  const web = stella.host?.web;
  const protocols = useMemo(() => web?.schemes() ?? [], [web]);
  const html = "html" in source ? source.html : undefined;
  const frameRect = useRef<Layout | null>(null);
  const showsChip = useRef(false);
  const isMain = viewerWindow === window;
  const active = useRetainedSurfaceActive();
  const activeRef = useRef(active);
  activeRef.current = active;
  const appDark = useTokens().dark;
  const [scheme, setScheme] = useState("normal");

  useEffect(() => {
    host.post({ type: "stella:canvas-visibility", active });
  }, [active, host]);

  useEffect(
    () => () => {
      if (showsChip.current) publishCanvasSelection(null);
    },
    [],
  );

  const onLoad = useCallback(
    (e: { phase: "started" | "finished" }) => {
      if (e.phase !== "finished") return;
      const saved = scrollMemory.get(id);
      if (loads.current === 0 && saved) host.post({ type: "stella:canvas-scroll", ...saved });
      if (!activeRef.current) host.post({ type: "stella:canvas-visibility", active: false });
      latest.current.onDocument?.(host);
      loads.current += 1;
      if (loads.current > 1) {
        loads.current = 0;
        latest.current.onNavigatedAway?.();
      }
    },
    [host, id],
  );

  const onPageMessage = useCallback(
    (m: WebviewMessage) => {
      const data = messageData(m);
      if (!data) return;
      if (data.type === "stella:rune-canvas-port-out") {
        portListener.current?.(data.data);
        return;
      }
      if (data.type === "stella:rune-canvas-color-scheme") {
        if (typeof data.scheme === "string") setScheme(data.scheme);
        return;
      }
      if (data.type === "stella:canvas-scrolled") {
        const { x, y } = data as { x?: unknown; y?: unknown };
        if (typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)) scrollMemory.set(id, { x, y });
      } else if (data.type === "stella:canvas-compose" && typeof data.text === "string" && data.text.trim()) {
        if (isMain && showsChip.current) {
          showsChip.current = false;
          publishCanvasSelection(null);
        }
        dispatchComposeText({ text: data.text.trim(), selectedText: null });
        if (!isMain) window.electronAPI?.window?.show?.();
      } else if (data.type === "stella:canvas-selection" && isMain) {
        const selection = canvasSelection(data, frameRect.current, host);
        if (selection || showsChip.current) publishCanvasSelection(selection);
        showsChip.current = selection !== null;
      }
      latest.current.onMessage?.(data, host);
    },
    [host, id, isMain],
  );

  return (
    <webview
      id={id}
      grow={1}
      minH={0}
      w="full"
      label={title}
      transparent
      fill={pageBackdrop(scheme, appDark)}
      {...(html !== undefined ? { html } : { url: (source as { src: string }).src })}
      preload={CANVAS_PRELOAD}
      protocols={protocols}
      onRequest={(r: WebviewRequest) => web?.request(undefined, r)}
      onLoad={onLoad}
      onMessage={onPageMessage}
      onLayout={(r) => {
        frameRect.current = r;
      }}
    />
  );
}

/** desktop-ui's `useHtmlCanvasSource`: HTML registered with main's canvas protocol, or bridged inline when there is none. */
export function useHtmlCanvasSource(html: string): { source: CanvasFrameSource | null; error: string | null } {
  const display = window.electronAPI?.display;
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
