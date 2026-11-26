import { useCallback, useEffect, useReducer, useRef, type Dispatch } from "react";
import { mix, useTokens } from "../../theme";
import { useAuxWindow } from "../aux-window";
import { RegionCapture } from "./RegionCapture";
import { ShowStellaOverlay } from "./ShowStellaOverlay";

type WindowBounds = { x: number; y: number; width: number; height: number };
type WindowHighlightTone = "default" | "subtle";

type OverlayState = { windowHighlightBounds: WindowBounds | null; windowHighlightTone: WindowHighlightTone; regionCaptureActive: boolean };

type OverlayAction = { type: "overlay:windowHighlight"; bounds: WindowBounds | null; tone?: WindowHighlightTone } | { type: "region"; active: boolean };

const initialState: OverlayState = { windowHighlightBounds: null, windowHighlightTone: "default", regionCaptureActive: false };

function overlayReducer(state: OverlayState, action: OverlayAction): OverlayState {
  switch (action.type) {
    case "overlay:windowHighlight":
      return { ...state, windowHighlightBounds: action.bounds, windowHighlightTone: action.bounds ? (action.tone ?? "default") : "default" };
    case "region":
      return state.regionCaptureActive === action.active ? state : { ...state, regionCaptureActive: action.active };
    default:
      return state;
  }
}

function useOverlayIPC(dispatch: Dispatch<OverlayAction>) {
  const { api } = useAuxWindow();
  useEffect(() => {
    if (!api) return;
    const cleanups = [
      api.overlay.onWindowHighlight?.((payload) => {
        dispatch({ type: "overlay:windowHighlight", bounds: payload ? { x: payload.x, y: payload.y, width: payload.width, height: payload.height } : null, tone: payload?.tone });
      }),
      api.overlay.onStartRegionCapture?.(() => dispatch({ type: "region", active: true })),
      api.overlay.onEndRegionCapture?.(() => dispatch({ type: "region", active: false })),
    ];
    return () => {
      for (const cleanup of cleanups) cleanup?.();
    };
  }, [api, dispatch]);
}

/** `.capture-window-ring`: a primary border with outer and inner glows. */
function WindowRing({ bounds, tone }: { bounds: WindowBounds; tone: WindowHighlightTone }) {
  const tokens = useTokens();
  const p = tokens.c.primary;
  const a = (pct: number) => mix(p, pct, "transparent");
  const subtle = tone === "subtle";
  const glow = subtle
    ? [
        { x: 0, y: 0, blur: 0, spread: 1, color: a(20) },
        { x: 0, y: 0, blur: 18, spread: 4, color: a(12) },
        { x: 0, y: 0, blur: 38, spread: 8, color: a(7) },
        { x: 0, y: 0, blur: 28, spread: 8, color: a(10), inset: true },
        { x: 0, y: 0, blur: 56, spread: 14, color: a(5), inset: true },
      ]
    : [
        { x: 0, y: 0, blur: 0, spread: 1, color: a(45) },
        { x: 0, y: 0, blur: 30, spread: 6, color: a(28) },
        { x: 0, y: 0, blur: 64, spread: 14, color: a(16) },
        { x: 0, y: 0, blur: 52, spread: 14, color: a(22), inset: true },
        { x: 0, y: 0, blur: 96, spread: 24, color: a(12), inset: true },
      ];
  return (
    <box
      absolute={{ left: bounds.x, top: bounds.y }}
      w={bounds.width}
      h={bounds.height}
      radius={10}
      border={a(subtle ? 42 : 82)}
      borderWidth={3}
      shadows={glow}
      inert
      enter={{ opacity: 0, dur: 0.12, bounce: 0 }}
    />
  );
}

/** desktop-ui's `OverlayRoot`: the window highlight, Show Stella's marks and bar, and region capture. */
export function OverlayRoot() {
  const { api } = useAuxWindow();
  const [state, dispatch] = useReducer(overlayReducer, initialState);
  const interactiveRef = useRef<boolean | null>(null);

  useOverlayIPC(dispatch);

  const updateInteractive = useCallback(
    (shouldBeInteractive: boolean) => {
      if (interactiveRef.current === shouldBeInteractive) return;
      interactiveRef.current = shouldBeInteractive;
      api?.overlay?.setInteractive?.(shouldBeInteractive);
    },
    [api],
  );

  useEffect(() => {
    interactiveRef.current = null;
    updateInteractive(state.regionCaptureActive);
  }, [state.regionCaptureActive, updateInteractive]);

  return (
    <box w="full" h="full" clip={0}>
      {state.windowHighlightBounds ? <WindowRing bounds={state.windowHighlightBounds} tone={state.windowHighlightTone} /> : null}
      <ShowStellaOverlay />
      {state.regionCaptureActive ? <RegionCapture /> : null}
    </box>
  );
}
