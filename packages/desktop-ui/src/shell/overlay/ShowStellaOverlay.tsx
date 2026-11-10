import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ShowStellaInk,
  ShowStellaOverlayState,
} from "@stella/contracts/desktop/show-stella";
import { ShowStellaRecorder } from "@/features/show-stella/show-stella-recorder";
import { ShowStellaReviewCard } from "./ShowStellaReviewCard";
import { viewAtom } from "@/platform/view-state/view-state";
import { useT } from "@/shared/i18n";
import "./show-stella-overlay.css";

const INK_COLOR = "#ff3b30";
const INK_WIDTH = 4.5;
/** Finished ink stays this long, then fades over INK_FADE_MS. */
const INK_HOLD_MS = 1_400;
const INK_FADE_MS = 600;
const PIN_PULSE_MS = 350;
const PIN_LABEL_MS = 1_200;
const HINT_MS = 4_000;
/** After this many captures the drawing hint is shown only briefly. */
const HINT_FULL_TIMES = 3;

type DrawnStroke = { points: Array<[number, number]>; doneAt: number | null };
type DrawnPin = { number: number; x: number; y: number; at: number };

const hintsShown = viewAtom("showStella.hintsShown", 0);

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const isMac = () => window.electronAPI?.platform === "darwin";

function useInkCanvas(active: boolean) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokes = useRef(new Map<number, DrawnStroke>());
  const pins = useRef(new Map<number, DrawnPin>());
  const frame = useRef<number | null>(null);

  const draw = useCallback(() => {
    frame.current = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * dpr);
    const height = Math.round(window.innerHeight * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const now = performance.now();
    let animating = false;
    for (const [id, stroke] of strokes.current) {
      let alpha = 1;
      if (stroke.doneAt !== null) {
        const age = now - stroke.doneAt - INK_HOLD_MS;
        if (age > INK_FADE_MS) {
          strokes.current.delete(id);
          continue;
        }
        if (age > 0) alpha = 1 - age / INK_FADE_MS;
        animating = true;
      }
      const points = stroke.points;
      if (points.length === 0) continue;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = INK_COLOR;
      ctx.lineWidth = INK_WIDTH;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(points[0]![0], points[0]![1]);
      for (let i = 1; i < points.length - 1; i += 1) {
        const [x, y] = points[i]!;
        const [nx, ny] = points[i + 1]!;
        ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
      }
      const last = points[points.length - 1]!;
      ctx.lineTo(last[0], last[1]);
      ctx.stroke();
    }
    for (const [id, pin] of pins.current) {
      const age = now - pin.at;
      if (age > PIN_LABEL_MS) {
        pins.current.delete(id);
        continue;
      }
      animating = true;
      if (age < PIN_PULSE_MS) {
        const p = age / PIN_PULSE_MS;
        const eased = 1 - (1 - p) ** 3;
        ctx.globalAlpha = 1 - p;
        ctx.strokeStyle = INK_COLOR;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pin.x, pin.y, 6 + eased * 18, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = Math.max(0, 1 - age / PIN_LABEL_MS);
      ctx.fillStyle = INK_COLOR;
      ctx.beginPath();
      ctx.arc(pin.x + 14, pin.y - 14, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "600 11px -apple-system, 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(pin.number), pin.x + 14, pin.y - 13.5);
    }
    ctx.globalAlpha = 1;
    if (animating) frame.current = requestAnimationFrame(draw);
  }, []);

  const schedule = useCallback(() => {
    frame.current ??= requestAnimationFrame(draw);
  }, [draw]);

  const apply = useCallback(
    (ink: ShowStellaInk) => {
      switch (ink.kind) {
        case "stroke":
          strokes.current.set(ink.id, {
            points: ink.points,
            doneAt: ink.done ? performance.now() : null,
          });
          break;
        case "pin":
          pins.current.set(ink.id, { number: ink.number, x: ink.x, y: ink.y, at: performance.now() });
          break;
        case "undo":
          strokes.current.delete(ink.id);
          pins.current.delete(ink.id);
          break;
        case "clear":
          strokes.current.clear();
          pins.current.clear();
          break;
        case "click":
        case "catch":
          break;
      }
      schedule();
    },
    [schedule],
  );

  useEffect(() => {
    if (active) return;
    strokes.current.clear();
    pins.current.clear();
    schedule();
  }, [active, schedule]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return { canvasRef, apply };
}

export function ShowStellaOverlay() {
  const t = useT();
  const [state, setState] = useState<ShowStellaOverlayState>({ phase: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const [hintVisible, setHintVisible] = useState(false);
  const recorder = useRef<{ id: string; recorder: ShowStellaRecorder } | null>(null);
  const interactive = useRef(false);
  const hoveringBar = useRef(false);
  const hoveringCard = useRef(false);
  const [catching, setCatching] = useState(false);
  const catchingRef = useRef(false);
  const recording = state.phase === "recording";
  const { canvasRef, apply } = useInkCanvas(state.phase !== "idle");

  useEffect(() => {
    const api = window.electronAPI?.showStella;
    if (!api) return;
    const stopRecorder = async (captureId: string) => {
      const current = recorder.current;
      if (!current || current.id !== captureId) {
        await api.recorderStopped({ captureId, wav: null, videoMimeType: null, error: "not recording" });
        return;
      }
      recorder.current = null;
      const result = await current.recorder.stop().catch((error: unknown) => ({
        captureId,
        wav: null,
        videoMimeType: null,
        error: (error as Error)?.message ?? "stop failed",
      }));
      await api.recorderStopped(result);
    };
    const cleanups = [
      api.onOverlayState((next) => {
        setState(next);
        if (next.phase !== "recording" || recorder.current?.id === next.captureId) return;
        const instance = new ShowStellaRecorder(next.recorder);
        recorder.current = { id: next.captureId, recorder: instance };
        instance.begin().catch((error: unknown) => {
          if (recorder.current?.recorder === instance) recorder.current = null;
          void instance.stop();
          api.recorderFailed({
            captureId: next.captureId,
            message: (error as Error)?.message ?? "The screen couldn't be recorded.",
          });
        });
      }),
      api.onInk((ink) => {
        if (ink.kind === "catch") {
          catchingRef.current = ink.on;
          setCatching(ink.on);
          return;
        }
        apply(ink);
      }),
      api.onStopRecorder(({ captureId }) => void stopRecorder(captureId)),
    ];
    return () => cleanups.forEach((cleanup) => cleanup?.());
  }, [apply]);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [recording]);

  const captureId = state.phase === "recording" ? state.captureId : null;
  const nativeControls = state.phase === "recording" && state.nativeControls;
  const doneRef = useRef<HTMLButtonElement | null>(null);

  // macOS: the bar only draws; a native panel takes the Done click (and shows
  // the finish card) so clicking never brings Stella forward.
  useEffect(() => {
    if (!captureId) return;
    const report = () => {
      const rect = nativeControls ? doneRef.current?.getBoundingClientRect() : null;
      window.electronAPI?.showStella?.overlayInfo({
        captureId,
        done: rect
          ? {
              x: rect.x + window.screenX,
              y: rect.y + window.screenY,
              width: rect.width,
              height: rect.height,
            }
          : null,
        strings: {
          title: t("app.chat.contextChips.showCapture.title", { duration: "{duration}" }),
          preparing: t("app.chat.contextChips.showCapture.preparing"),
          failed: t("app.chat.contextChips.showCapture.failed"),
          note: t("features.showStella.review.note"),
          send: t("features.showStella.review.send"),
          open: t("features.showStella.review.open"),
          discard: t("features.showStella.review.discard"),
        },
      });
    };
    const frame = requestAnimationFrame(report);
    // Again once the hint has finished sliding in or out.
    const settled = setTimeout(report, 450);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settled);
    };
  }, [captureId, nativeControls, hintVisible, t]);
  useEffect(() => {
    if (!captureId) return;
    const seen = hintsShown.get();
    hintsShown.set(seen + 1);
    setHintVisible(true);
    const timer = setTimeout(() => setHintVisible(false), seen < HINT_FULL_TIMES ? HINT_MS : HINT_MS / 2);
    return () => clearTimeout(timer);
  }, [captureId]);

  /** The overlay takes the mouse over the bar, the finish card, or everywhere while ⇧ is held. */
  const syncInteractive = useCallback(() => {
    const next = hoveringBar.current || hoveringCard.current || catchingRef.current;
    if (interactive.current === next) return;
    interactive.current = next;
    window.electronAPI?.overlay?.setInteractive(next);
  }, []);

  useEffect(() => {
    syncInteractive();
  }, [catching, syncInteractive]);

  useEffect(() => {
    if (recording) return;
    hoveringBar.current = false;
    catchingRef.current = false;
    setCatching(false);
    if (state.phase !== "review") hoveringCard.current = false;
    syncInteractive();
  }, [recording, state.phase, syncInteractive]);

  if (state.phase === "idle") return null;
  if (state.phase === "review") {
    return (
      <ShowStellaReviewCard
        key={state.captureId}
        state={state}
        onHover={(hovered) => {
          hoveringCard.current = hovered;
          syncInteractive();
        }}
      />
    );
  }
  // macOS keeps the overlay below the menu bar, so the display's top edge can
  // sit above the window; keep the edge and bar where they can be seen.
  const display =
    state.phase === "recording"
      ? (() => {
          const top = Math.max(state.display.y, 0);
          return { ...state.display, y: top, height: state.display.height - (top - state.display.y) };
        })()
      : null;
  const shift = isMac() ? "⇧" : "Shift";

  return (
    <>
      <canvas ref={canvasRef} className="show-stella-ink" />
      {display && catching && (
        <div
          className="show-stella-catch"
          style={{ left: display.x, top: display.y, width: display.width, height: display.height }}
          onMouseDown={(event) => event.preventDefault()}
        />
      )}
      {display && (
        <div
          className="show-stella-edge"
          style={{ left: display.x, top: display.y, width: display.width, height: display.height }}
        />
      )}
      {display && state.phase === "recording" && (
        <div
          className={nativeControls ? "show-stella-bar show-stella-bar--passive" : "show-stella-bar"}
          style={{ left: display.x + display.width / 2, top: display.y + 14 }}
          onMouseEnter={() => {
            if (nativeControls) return;
            hoveringBar.current = true;
            syncInteractive();
          }}
          onMouseLeave={() => {
            hoveringBar.current = false;
            syncInteractive();
          }}
        >
          <span className="show-stella-bar__time">{clock(now - state.startedAtMs)}</span>
          <span
            className={
              hintVisible ? "show-stella-bar__hint" : "show-stella-bar__hint show-stella-bar__hint--gone"
            }
          >
            {state.inkAvailable
              ? t("features.showStella.hint", { shift })
              : t("features.showStella.hintNoInk")}
          </span>
          <button
            ref={doneRef}
            type="button"
            className="show-stella-bar__done"
            onClick={() => {
              hoveringBar.current = false;
              syncInteractive();
              window.electronAPI?.showStella?.done();
            }}
          >
            <span className="show-stella-bar__stop" aria-hidden="true" />
            {t("features.showStella.done")}
          </button>
        </div>
      )}
    </>
  );
}
