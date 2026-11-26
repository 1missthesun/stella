import { useCallback, useEffect, useRef, useState } from "react";
import { fontSize, look, radius, useTokens } from "../../theme";
import type { SurfacePointer } from "../../../host/rune-jsx/props";
import { useWindowKeys } from "../window-keys";
import { useAuxWindow } from "../aux-window";

type Point = { x: number; y: number };
type Bounds = { x: number; y: number; width: number; height: number };

type PreparedRegionCaptureResult = {
  screenshot: { dataUrl: string; width: number; height: number } | null;
  window: { app: string; title: string; bounds: Bounds } | null;
};

type VacuumState = { clickPoint: Point; bounds: Bounds; thumbnail: string; result: PreparedRegionCaptureResult };

const MIN_SELECTION_SIZE = 6;
const HOVER_PREVIEW_DEBOUNCE_MS = 100;
const HOVER_PREVIEW_MOVE_THRESHOLD_PX = 6;
const VACUUM_MS = 650;
const DIM = "#0000001f";

/**
 * desktop-ui's WebGL vortex as Rune motion: the capture shrinks into the point that was clicked
 * (or the selection's centre) and fades, over the same 650 ms.
 */
function Vacuum({ vacuum, onDone }: { vacuum: VacuumState; onDone: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const frame = setTimeout(() => setCollapsed(true), 16);
    const finish = setTimeout(() => done.current(), VACUUM_MS);
    return () => {
      clearTimeout(frame);
      clearTimeout(finish);
    };
  }, []);
  const { bounds, clickPoint } = vacuum;
  const origin: [number, number] = [(clickPoint.x - bounds.x) / bounds.width, (clickPoint.y - bounds.y) / bounds.height];
  return (
    <image
      src={vacuum.thumbnail}
      absolute={{ left: bounds.x, top: bounds.y }}
      w={bounds.width}
      h={bounds.height}
      fit="stretch"
      inert
      origin={origin}
      scale={collapsed ? 0.02 : 1}
      rotate={collapsed ? 14 : 0}
      opacity={collapsed ? 0 : 1}
      motion={{ dur: VACUUM_MS / 1000, bounce: 0 }}
    />
  );
}

export function RegionCapture() {
  const tokens = useTokens();
  const { api, snapshot } = useAuxWindow();
  const captureApi = api?.capture;
  const overlayApi = api?.overlay;
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [currentPoint, setCurrentPoint] = useState<Point | null>(null);
  const [vacuum, setVacuum] = useState<VacuumState | null>(null);
  const [isPreparingCapture, setIsPreparingCapture] = useState(false);
  const [dimSuppressedAfterVacuum, setDimSuppressedAfterVacuum] = useState(false);
  const hoverPointRef = useRef<Point | null>(null);
  const lastProbedPointRef = useRef<Point | null>(null);
  const lastProbeAtRef = useRef(0);
  const hoverPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<Point | null>(null);
  const currentRef = useRef<Point | null>(null);
  startRef.current = startPoint;
  currentRef.current = currentPoint;

  const selection =
    startPoint && currentPoint
      ? { x: Math.min(startPoint.x, currentPoint.x), y: Math.min(startPoint.y, currentPoint.y), width: Math.abs(startPoint.x - currentPoint.x), height: Math.abs(startPoint.y - currentPoint.y) }
      : null;

  const clearSelection = useCallback(() => {
    setStartPoint(null);
    setCurrentPoint(null);
    setDimSuppressedAfterVacuum(false);
  }, []);

  const clearWindowPreview = useCallback(() => {
    if (hoverPreviewTimerRef.current) {
      clearTimeout(hoverPreviewTimerRef.current);
      hoverPreviewTimerRef.current = null;
    }
    hoverPointRef.current = null;
    lastProbedPointRef.current = null;
    overlayApi?.hideWindowHighlight?.();
  }, [overlayApi]);

  const probeLatestHoverPoint = useCallback(() => {
    const latest = hoverPointRef.current;
    if (!latest) return;
    const prev = lastProbedPointRef.current;
    if (prev && Math.abs(prev.x - latest.x) + Math.abs(prev.y - latest.y) < HOVER_PREVIEW_MOVE_THRESHOLD_PX) return;
    lastProbedPointRef.current = latest;
    lastProbeAtRef.current = performance.now();
    overlayApi?.previewWindowHighlightAtPoint?.(latest);
  }, [overlayApi]);

  const previewWindowAtPoint = useCallback(
    (point: Point) => {
      hoverPointRef.current = point;
      if (hoverPreviewTimerRef.current) return;
      if (performance.now() - lastProbeAtRef.current >= HOVER_PREVIEW_DEBOUNCE_MS) probeLatestHoverPoint();
      hoverPreviewTimerRef.current = setTimeout(() => {
        hoverPreviewTimerRef.current = null;
        probeLatestHoverPoint();
      }, HOVER_PREVIEW_DEBOUNCE_MS);
    },
    [probeLatestHoverPoint],
  );

  const cancel = useCallback(() => {
    setIsPreparingCapture(false);
    captureApi?.cancelRegion?.();
    clearWindowPreview();
    clearSelection();
  }, [captureApi, clearSelection, clearWindowPreview]);

  useWindowKeys(["escape"], cancel, true, snapshot.id);

  const finishVacuum = useCallback(() => {
    setVacuum((current) => {
      if (current) captureApi?.commitPreparedRegionCapture?.(current.result);
      return null;
    });
    setDimSuppressedAfterVacuum(true);
    setIsPreparingCapture(false);
  }, [captureApi]);

  const release = async (at: Point) => {
    const start = startRef.current;
    if (!start) return;
    clearWindowPreview();
    const endPoint = currentRef.current ?? at;
    const resolvedSelection = { x: Math.min(start.x, endPoint.x), y: Math.min(start.y, endPoint.y), width: Math.abs(start.x - endPoint.x), height: Math.abs(start.y - endPoint.y) };
    if (resolvedSelection.width < MIN_SELECTION_SIZE || resolvedSelection.height < MIN_SELECTION_SIZE) {
      setIsPreparingCapture(true);
      clearSelection();
      const getWindowCapture = captureApi?.getWindowCapture;
      if (!getWindowCapture) {
        captureApi?.submitRegionClick?.(endPoint);
        return;
      }
      const capture = await getWindowCapture(endPoint);
      if (capture) {
        setIsPreparingCapture(false);
        setVacuum({ clickPoint: endPoint, ...capture });
      } else {
        captureApi?.submitRegionClick?.(endPoint);
      }
      return;
    }
    const centerPoint = { x: resolvedSelection.x + Math.round(resolvedSelection.width / 2), y: resolvedSelection.y + Math.round(resolvedSelection.height / 2) };
    setIsPreparingCapture(true);
    clearSelection();
    const prepareRegionSelection = captureApi?.prepareRegionSelection;
    if (prepareRegionSelection) {
      const result = await prepareRegionSelection(resolvedSelection);
      if (result?.screenshot) {
        setIsPreparingCapture(false);
        setVacuum({ clickPoint: centerPoint, bounds: resolvedSelection, thumbnail: result.screenshot.dataUrl, result });
        return;
      }
    }
    captureApi?.submitRegionSelection?.(resolvedSelection);
  };

  const onPointer = (e: SurfacePointer) => {
    const point = { x: e.x, y: e.y };
    if (e.kind === "down") {
      if (e.button === "right") {
        cancel();
        return;
      }
      if (e.button !== "left") return;
      setIsPreparingCapture(false);
      clearWindowPreview();
      setStartPoint(point);
      setCurrentPoint(point);
      return;
    }
    if (e.kind === "move") {
      if (!startRef.current) {
        if (!vacuum && !isPreparingCapture) previewWindowAtPoint(point);
        return;
      }
      setCurrentPoint((previous) => (previous && previous.x === point.x && previous.y === point.y ? previous : point));
      return;
    }
    if (e.kind === "up" && e.button === "left") void release(point);
  };

  return (
    <box absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} cursor="default">
      <surface absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} fill="#00000003" focusable autoFocus onPointer={onPointer} />
      {!selection && !vacuum && !isPreparingCapture && !dimSuppressedAfterVacuum ? <box absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} fill={DIM} inert /> : null}
      {selection ? (
        <>
          <box absolute={{ left: 0, top: 0, right: 0 }} h={selection.y} fill={DIM} inert />
          <box absolute={{ left: 0, top: selection.y + selection.height, right: 0, bottom: 0 }} fill={DIM} inert />
          <box absolute={{ left: 0, top: selection.y }} w={selection.x} h={selection.height} fill={DIM} inert />
          <box absolute={{ left: selection.x + selection.width, top: selection.y, right: 0 }} h={selection.height} fill={DIM} inert />
          <box absolute={{ left: selection.x, top: selection.y }} w={selection.width} h={selection.height} border="#ffffffb3" borderWidth={1} inert />
        </>
      ) : null}
      {vacuum ? <Vacuum key={vacuum.thumbnail} vacuum={vacuum} onDone={finishVacuum} /> : null}
      <box absolute={{ left: 16, top: 16 }} py={8 + 1} px={12 + 1} radius={radius.md} border={tokens.c.border} fill={tokens.c.card} shadows={tokens.shadow.overlay} inert>
        <text {...look(fontSize.sm, 400, { em: 0.2 / fontSize.sm })} color={tokens.c.textBase} nowrap>
          Click to capture window - drag to capture region - Right-click or Esc to cancel
        </text>
      </box>
    </box>
  );
}
