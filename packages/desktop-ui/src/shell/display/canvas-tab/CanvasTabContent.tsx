import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useDisplayFileBytes } from "@/shared/hooks/use-display-file-data";
import { DisplayFileSourceContext } from "@/shared/hooks/display-file-source";
import { useDriveFileRevision } from "@/features/cloud/drive-file-versions";
import { useCloudDriveHtml } from "@/features/cloud/use-cloud-drive-html";
import { deviceFileMissingMessage } from "@stella/contracts/device-files";
import { CanvasIllustration } from "../illustrations/CanvasIllustration";
import { CanvasShareBar } from "./CanvasShareBar";
import { PreviewProblem } from "../preview-states";
import type { CanvasHtmlItem } from "./canvas-items";
import { injectCanvasBridge } from "@stella/contracts/canvas-bridge";
import {
  canvasDocumentLocation,
  type CanvasDocumentLocation,
} from "@stella/contracts/canvas-links";
import { useEmbeddedCanvasAssets } from "./use-embedded-canvas-assets";
import { useT } from "@/shared/i18n";
import {
  injectCanvasActionBridge,
  readCanvasActionManifest,
  type CanvasAction,
} from "@stella/contracts/canvas-actions";
import { useCanvasActions } from "./use-canvas-actions";
import { CanvasFrame, type CanvasFrameSource } from "./CanvasFrame";
import { useCanvasLinks } from "./use-canvas-links";
import "./canvas-tab.css";
import type { ReactNode } from "react";

const decoder = new TextDecoder("utf-8");
const CANVAS_HTML_MAX_BYTES = 4 * 1024 * 1024;
const DRIVE_CANVAS_HTML_MAX_BYTES = 48 * 1024 * 1024;


const canvasUrlApi = () => {
    const display = typeof window === "undefined" ? undefined : window.electronAPI?.display;
    return typeof display?.canvasFileUrl === "function" &&
        typeof display.canvasHtmlUrl === "function"
        ? display
        : null;
};
const canvasDriveUrlApi = () => {
    const display = typeof window === "undefined" ? undefined : window.electronAPI?.display;
    return typeof display?.canvasDriveUrl === "function" ? display.canvasDriveUrl : null;
};
const errorMessage = (caught: unknown) => (caught instanceof Error ? caught.message : String(caught)).replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/u, "");
const CanvasLoadingDots = () => (<span className="canvas-tab__loading-dots" aria-hidden>
    <span>.</span>
    <span>.</span>
    <span>.</span>
  </span>);
const CanvasIllustrationSpot = ({ label }: { label?: ReactNode }) => (<div className="canvas-tab__illustration-spot">
    <div className="canvas-tab__illustration-art">
      <CanvasIllustration />
    </div>
    {label ? (<div className="canvas-tab__illustration-label">{label}</div>) : null}
  </div>);
const LocalFileCanvasHeroFrameContent = ({ item }: { item: CanvasHtmlItem }) => {
    const key = `${item.filePath}\0${item.createdAt}`;
    const [resolved, setResolved] = useState<{
        key: string;
        src: string | null;
        error: string | null;
        actions?: CanvasAction[];
    } | null>(null);
    useEffect(() => {
        const api = canvasUrlApi();
        if (!api)
            return;
        let cancelled = false;
        void api.canvasFileUrl(item.filePath).then((result) => {
            if (cancelled)
                return;
            setResolved("url" in result
                ? { key, src: result.url, error: null, ...(result.actions ? { actions: result.actions } : {}) }
                : { key, src: null, error: result.message ?? deviceFileMissingMessage("deleted", item.filePath) });
        }, (caught: unknown) => {
            if (!cancelled)
                setResolved({ key, src: null, error: errorMessage(caught) });
        });
        return () => {
            cancelled = true;
        };
    }, [item.filePath, key]);
    const settled = resolved?.key === key ? resolved : null;
    return <CanvasHeroFrameDocument item={item} location={canvasDocumentLocation(item.filePath, false)} frame={settled?.src ? { src: settled.src } : null} error={settled?.error ?? null} loading={!settled} actions={settled?.actions}/>;
};
const DriveCanvasHeroFrameContent = ({ item, drivePath }: { item: CanvasHtmlItem; drivePath: string }) => {
    const revision = useDriveFileRevision(drivePath);
    const key = `${drivePath}\0${item.createdAt}\0${revision}`;
    const [resolved, setResolved] = useState<{
        key: string;
        src: string | null;
        error: string | null;
        actions?: CanvasAction[];
    } | null>(null);
    useEffect(() => {
        const canvasDriveUrl = canvasDriveUrlApi();
        if (!canvasDriveUrl)
            return;
        let cancelled = false;
        void canvasDriveUrl(drivePath).then(({ url, actions }) => {
            if (!cancelled)
                setResolved({ key, src: url, error: null, ...(actions ? { actions } : {}) });
        }, (caught: unknown) => {
            if (!cancelled)
                setResolved({ key, src: null, error: errorMessage(caught) });
        });
        return () => {
            cancelled = true;
        };
    }, [drivePath, key]);
    const settled = resolved?.key === key ? resolved : null;
    return <CanvasHeroFrameDocument item={item} location={canvasDocumentLocation(drivePath, true)} frame={settled?.src ? { src: settled.src } : null} error={settled?.error ?? null} loading={!settled} actions={settled?.actions}/>;
};
const HtmlCanvasHeroFrameContent = ({ item, html, error, loading, limited = false, drivePath, actions, }: {
  item: CanvasHtmlItem;
  html: string;
  error: string | null;
  loading: boolean;
  limited?: boolean;
  drivePath?: string;
  actions?: CanvasAction[];
}) => {
    const hasCanvasOrigin = canvasUrlApi() !== null;
    const location = drivePath
        ? canvasDocumentLocation(drivePath, true)
        : canvasDocumentLocation(item.filePath, Boolean(item.driveBacked));
    const bridged = useMemo(
        () => (html && !hasCanvasOrigin ? injectCanvasBridge(injectCanvasActionBridge(html)) : html),
        [html, hasCanvasOrigin],
    );
    const [registered, setRegistered] = useState<{
        html: string;
        src: string | null;
        error: string | null;
    } | null>(null);
    useEffect(() => {
        const api = canvasUrlApi();
        if (!api || !html)
            return;
        let cancelled = false;
        void api.canvasHtmlUrl(html, drivePath ? { drivePath } : undefined).then(({ url }) => {
            if (!cancelled)
                setRegistered({ html, src: url, error: null });
        }, (caught: unknown) => {
            if (!cancelled)
                setRegistered({ html, src: null, error: errorMessage(caught) });
        });
        return () => {
            cancelled = true;
        };
    }, [html, drivePath]);
    if (!hasCanvasOrigin) {
        return <CanvasHeroFrameDocument item={item} location={location} frame={bridged ? { html: bridged } : null} error={error} loading={loading} limited={limited} actions={actions}/>;
    }
    const settled = html && registered?.html === html ? registered : null;
    return <CanvasHeroFrameDocument item={item} location={location} frame={settled?.src ? { src: settled.src } : null} error={error ?? settled?.error ?? null} loading={loading || (Boolean(html) && !settled)} limited={limited} actions={actions}/>;
};
const BytesCanvasHeroFrameContent = ({ item }: { item: CanvasHtmlItem }) => {
    const fileSource = useContext(DisplayFileSourceContext);
    const fromDrive = Boolean(fileSource?.drivePath);
    const { bytes, error, loading, truncated } = useDisplayFileBytes(item.filePath, "Canvas preview requires the Stella desktop app.", undefined, item.createdAt, fromDrive ? DRIVE_CANVAS_HTML_MAX_BYTES : CANVAS_HTML_MAX_BYTES);
    const html = useMemo(() => (bytes ? decoder.decode(bytes) : ""), [bytes]);
    const actions = useMemo(() => readCanvasActionManifest(html), [html]);
    const embedded = useEmbeddedCanvasAssets(html, item.filePath, canvasUrlApi() ? null : fromDrive ? "drive" : fileSource ? null : "device");
    return <HtmlCanvasHeroFrameContent item={item} html={embedded.html} error={error} loading={loading || embedded.loading} limited={truncated} actions={actions} {...(fileSource?.drivePath ? { drivePath: fileSource.drivePath } : {})}/>;
};
const CloudCanvasHeroFrameContent = ({ item }: { item: CanvasHtmlItem }) => {
    const revision = useDriveFileRevision(item.filePath.replace(/^\/+/u, ""));
    const { html, error, loading } = useCloudDriveHtml(item.filePath, `${item.createdAt}:${revision}`);
    const actions = useMemo(() => readCanvasActionManifest(html ?? ""), [html]);
    const documentPath = item.filePath.startsWith("/") ? item.filePath : `/${item.filePath}`;
    const embedded = useEmbeddedCanvasAssets(html ?? "", documentPath, canvasUrlApi() ? null : "drive");
    return <HtmlCanvasHeroFrameContent item={item} html={embedded.html} error={error} loading={loading || embedded.loading} drivePath={item.filePath} actions={actions}/>;
};
const CanvasHeroFrameContent = ({ item }: { item: CanvasHtmlItem }) => {
    const fileSource = useContext(DisplayFileSourceContext);
    const drivePath = item.driveBacked ? item.filePath.replace(/^\/+/u, "") : fileSource?.drivePath;
    if (drivePath && /\.html?$/iu.test(drivePath) && canvasDriveUrlApi())
        return <DriveCanvasHeroFrameContent item={item} drivePath={drivePath}/>;
    if (item.driveBacked)
        return <CloudCanvasHeroFrameContent item={item}/>;
    if (fileSource || !canvasUrlApi())
        return <BytesCanvasHeroFrameContent item={item}/>;
    return <LocalFileCanvasHeroFrameContent item={item}/>;
};
const canvasIdentity = (item: CanvasHtmlItem) => ({
    canvas: item.slug ?? (item.filePath.split(/[\\/]/u).pop() ?? item.filePath).replace(/\.html?$/iu, ""),
    title: item.title,
});
const CanvasHeroFrameDocument = ({ item, location, frame, error, loading, limited = false, actions, }: {
  item: CanvasHtmlItem;
  location: CanvasDocumentLocation | null;
  frame: CanvasFrameSource | null;
  error: string | null;
  loading: boolean;
  limited?: boolean;
  actions?: CanvasAction[];
}) => {
    const t = useT();
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const identity = useMemo(() => canvasIdentity(item), [item]);
    const { onFrameLoad } = useCanvasActions({
        frame: () => iframeRef.current,
        actions,
        identity,
    });
    const [navigationReset, setNavigationReset] = useState(0);
    useCanvasLinks(iframeRef, location);
    if (error) {
        return (<div className="canvas-tab__frame-state" title={item.filePath}>
        <PreviewProblem error={error || t("shell.display.canvas.loadFailed")}/>
      </div>);
    }
    if (loading || !frame) {
        return (<CanvasIllustrationSpot label={<div className="canvas-tab__loading-label">
            {t("shell.display.canvas.loading")}
            <CanvasLoadingDots />
          </div>}/>);
    }
    return (<>
      <div className="canvas-tab__frame-wrap">
      <CanvasFrame key={`${item.id}:${item.createdAt}:${navigationReset}`} frameRef={iframeRef} title={item.title} className="canvas-tab__iframe" source={frame} onDocument={onFrameLoad} onNavigatedAway={() => setNavigationReset((value) => value + 1)}/>
      </div>
      {limited ? (<div className="display-preview-limit" role="status">
          {t("shell.display.preview.limited")}
        </div>) : null}
    </>);
};
export const CanvasTabContent = ({ item }: { item: CanvasHtmlItem }) => {
    return (<div className="canvas-tab">
      <div className="canvas-tab__hero">
        <CanvasShareBar item={item}/>
        <CanvasHeroFrameContent key={`${item.id}:${item.createdAt}`} item={item}/>
      </div>
    </div>);
};
