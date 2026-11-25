import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useDisplayFileBytes } from "@/shared/hooks/use-display-file-data";
import { DisplayFileSourceContext } from "@/shared/hooks/display-file-source";
import { useDriveFileRevision } from "@/features/cloud/drive-file-versions";
import { useCloudDriveHtml } from "@/features/cloud/use-cloud-drive-html";
import { deviceFileMissingMessage } from "@stella/contracts/device-files";
import type { CanvasHtmlItem } from "@/shell/display/canvas-tab/canvas-items";
import { injectCanvasBridge } from "@stella/contracts/canvas-bridge";
import { canvasDocumentLocation, type CanvasDocumentLocation } from "@stella/contracts/canvas-links";
import { useEmbeddedCanvasAssets } from "@/shell/display/canvas-tab/use-embedded-canvas-assets";
import { useT } from "@/shared/i18n";
import { injectCanvasActionBridge, readCanvasActionManifest, type CanvasAction } from "@stella/contracts/canvas-actions";
import { fontSize, look, useTokens } from "../../../theme";
import { CanvasIllustration } from "../illustrations/CanvasIllustration";
import { PreviewProblem } from "../preview-states";
import { CanvasShareBar } from "./CanvasShareBar";
import { CanvasFrame, type CanvasFrameHost, type CanvasFrameSource } from "./CanvasFrame";
import { useCanvasActions, useCanvasLinks } from "./use-canvas-frame-bridge";

const decoder = new TextDecoder("utf-8");
const CANVAS_HTML_MAX_BYTES = 4 * 1024 * 1024;
const DRIVE_CANVAS_HTML_MAX_BYTES = 48 * 1024 * 1024;

const canvasUrlApi = () => {
  const display = window.electronAPI?.display;
  return typeof display?.canvasFileUrl === "function" && typeof display.canvasHtmlUrl === "function" ? display : null;
};
const canvasDriveUrlApi = () => {
  const display = window.electronAPI?.display;
  return typeof display?.canvasDriveUrl === "function" ? display.canvasDriveUrl : null;
};
const errorMessage = (caught: unknown) => (caught instanceof Error ? caught.message : String(caught)).replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/u, "");

const DOT = (delay: number) => ({ kind: "sequence" as const, period: 1.2, delay, frames: [{ at: 0, opacity: 0.15 }, { at: 0.3, opacity: 1 }, { at: 0.6, opacity: 0.15 }, { at: 1, opacity: 0.15 }] });

/** `.canvas-tab__loading-label` with its three pulsing dots. */
function LoadingLabel() {
  const t = useT();
  const tk = useTokens();
  const text = look(fontSize.xl, 500, { lh: 1.4 });
  return (
    <row align="end" justify="center">
      <text {...text} color={tk.c.textWeak}>
        {t("shell.display.canvas.loading")}
      </text>
      <row ml={1} inert>
        {[0, 0.2, 0.4].map((delay) => (
          <text key={delay} {...text} color={tk.c.textWeak} opacity={0.15} loop={DOT(delay)}>
            .
          </text>
        ))}
      </row>
    </row>
  );
}

const CanvasIllustrationSpot = ({ label }: { label?: ReactNode }) => (
  <col id="canvas-tab-illustration-spot" grow={1} w="full" minH={0} align="center" justify="center" gap={label ? 6 : 14} pad={24} y={label ? -10 : 0}>
    <CanvasIllustration />
    {label ? (
      <row w="full" justify="center">
        {label}
      </row>
    ) : null}
  </col>
);

type Settled = { key: string; src: string | null; error: string | null; actions?: CanvasAction[] };

const LocalFileCanvasHeroFrameContent = ({ item }: { item: CanvasHtmlItem }) => {
  const key = `${item.filePath}\0${item.createdAt}`;
  const [resolved, setResolved] = useState<Settled | null>(null);
  useEffect(() => {
    const api = canvasUrlApi();
    if (!api) return;
    let cancelled = false;
    void api.canvasFileUrl(item.filePath).then(
      (result) => {
        if (cancelled) return;
        setResolved("url" in result ? { key, src: result.url, error: null, ...(result.actions ? { actions: result.actions } : {}) } : { key, src: null, error: result.message ?? deviceFileMissingMessage("deleted", item.filePath) });
      },
      (caught: unknown) => {
        if (!cancelled) setResolved({ key, src: null, error: errorMessage(caught) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [item.filePath, key]);
  const settled = resolved?.key === key ? resolved : null;
  return <CanvasHeroFrameDocument item={item} location={canvasDocumentLocation(item.filePath, false)} frame={settled?.src ? { src: settled.src } : null} error={settled?.error ?? null} loading={!settled} actions={settled?.actions} />;
};

const DriveCanvasHeroFrameContent = ({ item, drivePath }: { item: CanvasHtmlItem; drivePath: string }) => {
  const revision = useDriveFileRevision(drivePath);
  const key = `${drivePath}\0${item.createdAt}\0${revision}`;
  const [resolved, setResolved] = useState<Settled | null>(null);
  useEffect(() => {
    const canvasDriveUrl = canvasDriveUrlApi();
    if (!canvasDriveUrl) return;
    let cancelled = false;
    void canvasDriveUrl(drivePath).then(
      ({ url, actions }) => {
        if (!cancelled) setResolved({ key, src: url, error: null, ...(actions ? { actions } : {}) });
      },
      (caught: unknown) => {
        if (!cancelled) setResolved({ key, src: null, error: errorMessage(caught) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [drivePath, key]);
  const settled = resolved?.key === key ? resolved : null;
  return <CanvasHeroFrameDocument item={item} location={canvasDocumentLocation(drivePath, true)} frame={settled?.src ? { src: settled.src } : null} error={settled?.error ?? null} loading={!settled} actions={settled?.actions} />;
};

const HtmlCanvasHeroFrameContent = ({ item, html, error, loading, limited = false, drivePath, actions }: { item: CanvasHtmlItem; html: string; error: string | null; loading: boolean; limited?: boolean; drivePath?: string; actions?: CanvasAction[] }) => {
  const hasCanvasOrigin = canvasUrlApi() !== null;
  const location = drivePath ? canvasDocumentLocation(drivePath, true) : canvasDocumentLocation(item.filePath, Boolean(item.driveBacked));
  const bridged = useMemo(() => (html && !hasCanvasOrigin ? injectCanvasBridge(injectCanvasActionBridge(html)) : html), [html, hasCanvasOrigin]);
  const [registered, setRegistered] = useState<{ html: string; src: string | null; error: string | null } | null>(null);
  useEffect(() => {
    const api = canvasUrlApi();
    if (!api || !html) return;
    let cancelled = false;
    void api.canvasHtmlUrl(html, drivePath ? { drivePath } : undefined).then(
      ({ url }) => {
        if (!cancelled) setRegistered({ html, src: url, error: null });
      },
      (caught: unknown) => {
        if (!cancelled) setRegistered({ html, src: null, error: errorMessage(caught) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [html, drivePath]);
  if (!hasCanvasOrigin) return <CanvasHeroFrameDocument item={item} location={location} frame={bridged ? { html: bridged } : null} error={error} loading={loading} limited={limited} actions={actions} />;
  const settled = html && registered?.html === html ? registered : null;
  return <CanvasHeroFrameDocument item={item} location={location} frame={settled?.src ? { src: settled.src } : null} error={error ?? settled?.error ?? null} loading={loading || (Boolean(html) && !settled)} limited={limited} actions={actions} />;
};

const BytesCanvasHeroFrameContent = ({ item }: { item: CanvasHtmlItem }) => {
  const fileSource = useContext(DisplayFileSourceContext);
  const fromDrive = Boolean(fileSource?.drivePath);
  const { bytes, error, loading, truncated } = useDisplayFileBytes(item.filePath, "Canvas preview requires the Stella desktop app.", undefined, item.createdAt, fromDrive ? DRIVE_CANVAS_HTML_MAX_BYTES : CANVAS_HTML_MAX_BYTES);
  const html = useMemo(() => (bytes ? decoder.decode(bytes) : ""), [bytes]);
  const actions = useMemo(() => readCanvasActionManifest(html), [html]);
  const embedded = useEmbeddedCanvasAssets(html, item.filePath, canvasUrlApi() ? null : fromDrive ? "drive" : fileSource ? null : "device");
  return <HtmlCanvasHeroFrameContent item={item} html={embedded.html} error={error} loading={loading || embedded.loading} limited={truncated} actions={actions} {...(fileSource?.drivePath ? { drivePath: fileSource.drivePath } : {})} />;
};

const CloudCanvasHeroFrameContent = ({ item }: { item: CanvasHtmlItem }) => {
  const revision = useDriveFileRevision(item.filePath.replace(/^\/+/u, ""));
  const { html, error, loading } = useCloudDriveHtml(item.filePath, `${item.createdAt}:${revision}`);
  const actions = useMemo(() => readCanvasActionManifest(html ?? ""), [html]);
  const documentPath = item.filePath.startsWith("/") ? item.filePath : `/${item.filePath}`;
  const embedded = useEmbeddedCanvasAssets(html ?? "", documentPath, canvasUrlApi() ? null : "drive");
  return <HtmlCanvasHeroFrameContent item={item} html={embedded.html} error={error} loading={loading || embedded.loading} drivePath={item.filePath} actions={actions} />;
};

const CanvasHeroFrameContent = ({ item }: { item: CanvasHtmlItem }) => {
  const fileSource = useContext(DisplayFileSourceContext);
  const drivePath = item.driveBacked ? item.filePath.replace(/^\/+/u, "") : fileSource?.drivePath;
  if (drivePath && /\.html?$/iu.test(drivePath) && canvasDriveUrlApi()) return <DriveCanvasHeroFrameContent item={item} drivePath={drivePath} />;
  if (item.driveBacked) return <CloudCanvasHeroFrameContent item={item} />;
  if (fileSource || !canvasUrlApi()) return <BytesCanvasHeroFrameContent item={item} />;
  return <LocalFileCanvasHeroFrameContent item={item} />;
};

const canvasIdentity = (item: CanvasHtmlItem) => ({
  canvas: item.slug ?? (item.filePath.split(/[\\/]/u).pop() ?? item.filePath).replace(/\.html?$/iu, ""),
  title: item.title,
});

const frameId = (item: CanvasHtmlItem, reset: number) => `canvas-frame-${item.id.replace(/[^\w-]/gu, "_")}-${item.createdAt}-${reset}`;

function CanvasHeroFrameDocument({ item, location, frame, error, loading, limited = false, actions }: { item: CanvasHtmlItem; location: CanvasDocumentLocation | null; frame: CanvasFrameSource | null; error: string | null; loading: boolean; limited?: boolean; actions?: CanvasAction[] }) {
  const t = useT();
  const tk = useTokens();
  const identity = useMemo(() => canvasIdentity(item), [item]);
  const { onFrameLoad } = useCanvasActions({ actions, identity });
  const onLink = useCanvasLinks(location);
  const [navigationReset, setNavigationReset] = useState(0);
  const onMessage = useCallback((data: { type?: unknown; [key: string]: unknown }, host: CanvasFrameHost) => onLink(data, host), [onLink]);
  if (error) {
    return (
      <col grow={1} center pad={24} title={item.filePath}>
        <PreviewProblem error={error || t("shell.display.canvas.loadFailed")} />
      </col>
    );
  }
  if (loading || !frame) return <CanvasIllustrationSpot label={<LoadingLabel />} />;
  return (
    <>
      <col id="canvas-tab-frame-wrap" grow={1} minH={0}>
        <CanvasFrame key={`${item.id}:${item.createdAt}:${navigationReset}`} id={frameId(item, navigationReset)} title={item.title} source={frame} onDocument={onFrameLoad} onMessage={onMessage} onNavigatedAway={() => setNavigationReset((value) => value + 1)} />
      </col>
      {limited ? (
        <row role="status" shrink={false} px={12} py={6} borderSides={[1, 0, 0, 0]} border={tk.c.borderWeak}>
          <text {...look(fontSize.sm, 400)} color={tk.c.textWeak}>
            {t("shell.display.preview.limited")}
          </text>
        </row>
      ) : null}
    </>
  );
}

/** desktop-ui's `CanvasTabContent`: the share bar over the canvas page in its own WebView. */
export const CanvasTabContent = ({ item }: { item: CanvasHtmlItem }) => (
  <col id="canvas-tab" grow={1} minH={0}>
    <col id="canvas-tab-hero" grow={1} minH={0} clip={0}>
      <CanvasShareBar item={item} />
      <CanvasHeroFrameContent key={`${item.id}:${item.createdAt}`} item={item} />
    </col>
  </col>
);
