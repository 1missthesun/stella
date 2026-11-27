import { steadyNow } from "@stella/contracts/server-clock";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useDisplayFileBytes } from "@/shared/hooks/use-display-file-data";
import { DisplayFileSourceContext } from "@/shared/hooks/display-file-source";
import { driveFileVersions, useDriveFileRevision, useDriveFileVersion } from "@/features/cloud/drive-file-versions";
import { useCloudDriveHtml } from "@/features/cloud/use-cloud-drive-html";
import { subscribeBackendAccount } from "@/platform/backend/backend-client";
import { deviceFileMissingMessage } from "@stella/contracts/device-files";
import type { CanvasHtmlItem } from "@/shell/display/canvas-tab/canvas-items";
import { injectCanvasBridge } from "@stella/contracts/canvas-bridge";
import { canvasDocumentLocation, type CanvasDocumentLocation } from "@stella/contracts/canvas-links";
import { useEmbeddedCanvasAssets } from "@/shell/display/canvas-tab/use-embedded-canvas-assets";
import { useT } from "@/shared/i18n";
import { injectCanvasActionBridge, readCanvasActionManifest, type CanvasAction } from "@stella/contracts/canvas-actions";
import { useRetainedSurfaceActive } from "../../../kit";
import { fontSize, look, useTokens } from "../../../theme";
import { CanvasIllustration } from "../illustrations/CanvasIllustration";
import { PreviewProblem } from "../preview-states";
import { CanvasShareBar } from "./CanvasShareBar";
import { CanvasFrame, type CanvasFrameHost, type CanvasFrameSource } from "./CanvasFrame";
import { useCanvasActions, useCanvasLinks } from "./use-canvas-frame-bridge";
import { ViewTabContent, isViewFile } from "../../../views/ViewTabContent";

const decoder = new TextDecoder("utf-8");
const CANVAS_HTML_MAX_BYTES = 4 * 1024 * 1024;
const DRIVE_CANVAS_HTML_MAX_BYTES = 48 * 1024 * 1024;
const LOCAL_CANVAS_CACHE_MAX = 64;
const DRIVE_CANVAS_CACHE_MAX = 32;
const LOCAL_CANVAS_RECHECK_MS = 1500;

type FileStamp = { sizeBytes: number; modifiedAt: number | null };
type LocalCanvasResolved = { src: string | null; error: string | null; actions?: CanvasAction[] };
type LocalCanvasCacheEntry = { promise: Promise<LocalCanvasResolved>; resolved: LocalCanvasResolved | null; stamp: Promise<FileStamp | null>; checkedAt: number };
type DriveCanvasResolved = { src: string | null; error: string | null; actions?: CanvasAction[]; version: string | null };
type DriveCanvasCacheEntry = { promise: Promise<DriveCanvasResolved>; resolved: DriveCanvasResolved | null; requestedVersion: string | null };

// @reloadable cached canvas URLs; a newer copy resolves them again
const localCanvasCache = new Map<string, LocalCanvasCacheEntry>();
// @reloadable see above
const driveCanvasCache = new Map<string, DriveCanvasCacheEntry>();

subscribeBackendAccount(() => {
  driveCanvasCache.clear();
});

const trimMap = <K, V>(map: Map<K, V>, max: number) => {
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
};

const statLocalCanvas = (filePath: string): Promise<FileStamp | null> => {
  const stat = window.electronAPI?.display?.statPath;
  if (!stat) return Promise.resolve(null);
  return stat(filePath).then(
    (result) => (result && result.kind === "file" ? { sizeBytes: result.sizeBytes, modifiedAt: typeof result.modifiedAt === "number" ? result.modifiedAt : null } : null),
    () => null,
  );
};

const sameFileStamp = (a: FileStamp | null, b: FileStamp | null): boolean => !a || !b || (a.sizeBytes === b.sizeBytes && a.modifiedAt === b.modifiedAt);

const canvasUrlApi = () => {
  const display = window.electronAPI?.display;
  return typeof display?.canvasFileUrl === "function" && typeof display.canvasHtmlUrl === "function" ? display : null;
};
const canvasDriveUrlApi = () => {
  const display = window.electronAPI?.display;
  return typeof display?.canvasDriveUrl === "function" ? display.canvasDriveUrl : null;
};
const errorMessage = (caught: unknown) => (caught instanceof Error ? caught.message : String(caught)).replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/u, "");

const loadLocalCanvasUrl = (filePath: string, options?: { force?: boolean }): LocalCanvasCacheEntry | null => {
  const api = canvasUrlApi();
  if (!api) return null;
  if (!options?.force) {
    const existing = localCanvasCache.get(filePath);
    if (existing) {
      localCanvasCache.delete(filePath);
      localCanvasCache.set(filePath, existing);
      return existing;
    }
  }
  const stamp = statLocalCanvas(filePath);
  const promise: Promise<LocalCanvasResolved> = api.canvasFileUrl(filePath).then(
    (result): LocalCanvasResolved => ("url" in result ? { src: result.url, error: null, ...(result.actions ? { actions: result.actions } : {}) } : { src: null, error: result.message ?? deviceFileMissingMessage("deleted", filePath) }),
    (caught: unknown): LocalCanvasResolved => ({ src: null, error: errorMessage(caught) }),
  );
  const entry: LocalCanvasCacheEntry = { promise, resolved: null, stamp, checkedAt: steadyNow() };
  localCanvasCache.delete(filePath);
  localCanvasCache.set(filePath, entry);
  trimMap(localCanvasCache, LOCAL_CANVAS_CACHE_MAX);
  void promise.then((result) => {
    if (localCanvasCache.get(filePath) !== entry) return;
    if (!result.src) {
      localCanvasCache.delete(filePath);
      return;
    }
    entry.resolved = result;
  });
  return entry;
};

const loadDriveCanvasUrl = (drivePath: string, options?: { version?: string | null; forceRefresh?: boolean }): DriveCanvasCacheEntry | null => {
  const canvasDriveUrl = canvasDriveUrlApi();
  if (!canvasDriveUrl) return null;
  const normalized = drivePath.replace(/^\/+/u, "");
  const version = options?.version ?? null;
  const forceRefresh = options?.forceRefresh === true;
  if (!forceRefresh) {
    const existing = driveCanvasCache.get(normalized);
    if (existing && (!version || existing.resolved?.version === version || existing.requestedVersion === version)) {
      driveCanvasCache.delete(normalized);
      driveCanvasCache.set(normalized, existing);
      return existing;
    }
  }
  const promise: Promise<DriveCanvasResolved> = canvasDriveUrl(normalized, { ...(version ? { version } : {}), ...(forceRefresh ? { forceRefresh: true } : {}) }).then(
    ({ url, actions, version: resolvedVersion }): DriveCanvasResolved => ({ src: url, error: null, ...(actions ? { actions } : {}), version: resolvedVersion ?? version }),
    (caught: unknown): DriveCanvasResolved => ({ src: null, error: errorMessage(caught), version }),
  );
  const entry: DriveCanvasCacheEntry = { promise, resolved: null, requestedVersion: version };
  driveCanvasCache.delete(normalized);
  driveCanvasCache.set(normalized, entry);
  trimMap(driveCanvasCache, DRIVE_CANVAS_CACHE_MAX);
  void promise.then((result) => {
    if (driveCanvasCache.get(normalized) !== entry) return;
    if (!result.src) {
      driveCanvasCache.delete(normalized);
      return;
    }
    entry.resolved = result;
  });
  return entry;
};

export const prefetchLocalCanvasUrl = (filePath: string): void => {
  void loadLocalCanvasUrl(filePath);
};

export const prefetchDriveCanvasUrl = (drivePath: string): void => {
  const normalized = drivePath.replace(/^\/+/u, "");
  if (!normalized || !/\.html?$/iu.test(normalized)) return;
  driveFileVersions.track(normalized);
  const known = driveFileVersions.version(normalized);
  void loadDriveCanvasUrl(normalized, { ...(typeof known === "string" ? { version: known } : {}) });
};

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

const LocalFileCanvasHeroFrameContent = ({ item }: { item: CanvasHtmlItem }) => {
  const active = useRetainedSurfaceActive();
  const [reloadSeq, setReloadSeq] = useState(0);
  const [resolved, setResolved] = useState<{ filePath: string; value: LocalCanvasResolved } | null>(() => {
    const cached = localCanvasCache.get(item.filePath)?.resolved;
    return cached ? { filePath: item.filePath, value: cached } : null;
  });
  const lastCreatedAtRef = useRef(item.createdAt);
  useEffect(() => {
    let cancelled = false;
    const entry = loadLocalCanvasUrl(item.filePath);
    if (!entry) return;
    if (entry.resolved) setResolved({ filePath: item.filePath, value: entry.resolved });
    void entry.promise.then((value) => {
      if (!cancelled) setResolved({ filePath: item.filePath, value });
    });
    return () => {
      cancelled = true;
    };
  }, [item.filePath]);
  useEffect(() => {
    if (!active) return;
    const entry = localCanvasCache.get(item.filePath);
    const createdAtBumped = item.createdAt > lastCreatedAtRef.current;
    lastCreatedAtRef.current = item.createdAt;
    if (!entry?.resolved) return;
    if (!createdAtBumped && steadyNow() - entry.checkedAt < LOCAL_CANVAS_RECHECK_MS) return;
    entry.checkedAt = steadyNow();
    let cancelled = false;
    void Promise.all([entry.stamp, statLocalCanvas(item.filePath)]).then(([before, now]) => {
      if (cancelled || sameFileStamp(before, now)) return;
      const fresh = loadLocalCanvasUrl(item.filePath, { force: true });
      if (!fresh) return;
      void fresh.promise.then((value) => {
        if (cancelled) return;
        setResolved({ filePath: item.filePath, value });
        setReloadSeq((seq) => seq + 1);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [active, item.filePath, item.createdAt]);
  const settled = resolved?.filePath === item.filePath ? resolved.value : (localCanvasCache.get(item.filePath)?.resolved ?? null);
  return <CanvasHeroFrameDocument item={item} reloadSeq={reloadSeq} location={canvasDocumentLocation(item.filePath, false)} frame={settled?.src ? { src: settled.src } : null} error={settled?.error ?? null} loading={!settled} actions={settled?.actions} />;
};

const DriveCanvasHeroFrameContent = ({ item, drivePath }: { item: CanvasHtmlItem; drivePath: string }) => {
  const normalized = drivePath.replace(/^\/+/u, "");
  const liveVersion = useDriveFileVersion(normalized);
  const [reloadSeq, setReloadSeq] = useState(0);
  const [resolved, setResolved] = useState<{ drivePath: string; value: DriveCanvasResolved } | null>(() => {
    const cached = driveCanvasCache.get(normalized)?.resolved;
    return cached ? { drivePath: normalized, value: cached } : null;
  });
  useEffect(() => {
    driveFileVersions.track(normalized);
  }, [normalized]);
  useEffect(() => {
    let cancelled = false;
    const existing = driveCanvasCache.get(normalized);
    const versionString = typeof liveVersion === "string" ? liveVersion : null;
    const versionChanged = Boolean(versionString && existing?.resolved?.version && existing.resolved.version !== versionString);
    const entry = loadDriveCanvasUrl(normalized, { ...(versionString ? { version: versionString } : {}), ...(versionChanged ? { forceRefresh: true } : {}) });
    if (!entry) return;
    if (entry.resolved && !versionChanged) {
      setResolved({ drivePath: normalized, value: entry.resolved });
      return;
    }
    void entry.promise.then((value) => {
      if (cancelled) return;
      setResolved({ drivePath: normalized, value });
      if (versionChanged) setReloadSeq((seq) => seq + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [normalized, liveVersion]);
  const settled = resolved?.drivePath === normalized ? resolved.value : (driveCanvasCache.get(normalized)?.resolved ?? null);
  return <CanvasHeroFrameDocument item={item} reloadSeq={reloadSeq} location={canvasDocumentLocation(normalized, true)} frame={settled?.src ? { src: settled.src } : null} error={settled?.error ?? null} loading={!settled} actions={settled?.actions} />;
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
  const { bytes, error, loading, truncated } = useDisplayFileBytes(item.filePath, "Canvas preview requires the Stella desktop app.", undefined, undefined, fromDrive ? DRIVE_CANVAS_HTML_MAX_BYTES : CANVAS_HTML_MAX_BYTES);
  const html = useMemo(() => (bytes ? decoder.decode(bytes) : ""), [bytes]);
  const actions = useMemo(() => readCanvasActionManifest(html), [html]);
  const embedded = useEmbeddedCanvasAssets(html, item.filePath, canvasUrlApi() ? null : fromDrive ? "drive" : fileSource ? null : "device");
  return <HtmlCanvasHeroFrameContent item={item} html={embedded.html} error={error} loading={loading || embedded.loading} limited={truncated} actions={actions} {...(fileSource?.drivePath ? { drivePath: fileSource.drivePath } : {})} />;
};

const CloudCanvasHeroFrameContent = ({ item }: { item: CanvasHtmlItem }) => {
  const revision = useDriveFileRevision(item.filePath.replace(/^\/+/u, ""));
  const { html, error, loading } = useCloudDriveHtml(item.filePath, revision);
  const actions = useMemo(() => readCanvasActionManifest(html ?? ""), [html]);
  const documentPath = item.filePath.startsWith("/") ? item.filePath : `/${item.filePath}`;
  const embedded = useEmbeddedCanvasAssets(html ?? "", documentPath, canvasUrlApi() ? null : "drive");
  return <HtmlCanvasHeroFrameContent item={item} html={embedded.html} error={error} loading={loading || embedded.loading} drivePath={item.filePath} actions={actions} />;
};

const CanvasHeroFrameContent = ({ item }: { item: CanvasHtmlItem }) => {
  const fileSource = useContext(DisplayFileSourceContext);
  const drivePath = item.cloudDrivePath ?? (item.driveBacked ? item.filePath.replace(/^\/+/u, "") : fileSource?.drivePath);
  if (drivePath && /\.html?$/iu.test(drivePath) && canvasDriveUrlApi()) return <DriveCanvasHeroFrameContent item={item} drivePath={drivePath} />;
  if (item.driveBacked) return <CloudCanvasHeroFrameContent item={item} />;
  if (fileSource || !canvasUrlApi()) return <BytesCanvasHeroFrameContent item={item} />;
  return <LocalFileCanvasHeroFrameContent item={item} />;
};

const canvasIdentity = (item: CanvasHtmlItem) => ({
  canvas: item.slug ?? (item.filePath.split(/[\\/]/u).pop() ?? item.filePath).replace(/\.html?$/iu, ""),
  title: item.title,
});

const frameId = (item: CanvasHtmlItem, reloadSeq: number, reset: number) => `canvas-frame-${item.id.replace(/[^\w-]/gu, "_")}-${reloadSeq}-${reset}`;

function CanvasHeroFrameDocument({ item, reloadSeq = 0, location, frame, error, loading, limited = false, actions }: { item: CanvasHtmlItem; reloadSeq?: number; location: CanvasDocumentLocation | null; frame: CanvasFrameSource | null; error: string | null; loading: boolean; limited?: boolean; actions?: CanvasAction[] }) {
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
        <CanvasFrame key={`${item.id}:${reloadSeq}:${navigationReset}`} id={frameId(item, reloadSeq, navigationReset)} title={item.title} source={frame} onDocument={onFrameLoad} onMessage={onMessage} onNavigatedAway={() => setNavigationReset((value) => value + 1)} />
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

/** desktop-ui's `CanvasTabContent`: the share bar over the canvas page in its own WebView; a Stella View (`*.view.tsx`) draws natively instead. */
export const CanvasTabContent = ({ item }: { item: CanvasHtmlItem }) =>
  isViewFile(item.filePath) && !item.driveBacked ? (
    <col id="canvas-tab" grow={1} minH={0}>
      <ViewTabContent key={item.filePath} filePath={item.filePath} />
    </col>
  ) : (
  <col id="canvas-tab" grow={1} minH={0}>
    <col id="canvas-tab-hero" grow={1} minH={0} clip={0}>
      <CanvasShareBar item={item} />
      <CanvasHeroFrameContent key={item.id} item={item} />
    </col>
  </col>
);
