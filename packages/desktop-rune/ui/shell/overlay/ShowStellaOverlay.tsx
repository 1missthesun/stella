import { useCallback, useEffect, useRef, useState } from "react";
import type { ShowStellaInk, ShowStellaOverlayState } from "@stella/contracts/desktop/show-stella";
import { ShowStellaRecorder } from "../../replace/features/show-stella/show-stella-recorder";
import { viewAtom } from "@/platform/view-state/view-state";
import { useT } from "@/shared/i18n";
import { Icon, Icons } from "../../kit";
import { systemFontFamily } from "../../theme/system-font";
import type { VectorPath } from "../../../host/rune-jsx/props";
import { useAuxWindow } from "../aux-window";
import { ShowStellaReviewCard } from "./ShowStellaReviewCard";

const INK_COLOR = "#ff3b30";
const INK_WIDTH = 4.5;
const INK_HOLD_MS = 1_400;
const INK_FADE_MS = 600;
const PIN_PULSE_MS = 350;
const PIN_LABEL_MS = 1_200;
const HINT_MS = 4_000;
const HINT_FULL_TIMES = 3;

type DrawnStroke = { id: number; points: Array<[number, number]>; done: boolean };
type DrawnPin = { id: number; number: number; x: number; y: number };

const hintsShown = viewAtom("showStella.hintsShown", 0);

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/** desktop-ui's canvas stroke: quadratic segments through each point's midpoints. */
const strokePath = (points: Array<[number, number]>): string => {
  if (points.length === 0) return "";
  let d = `M${points[0]![0]} ${points[0]![1]}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const [x, y] = points[i]!;
    const [nx, ny] = points[i + 1]!;
    d += ` Q${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`;
  }
  const last = points[points.length - 1]!;
  return `${d} L${last[0]} ${last[1]}`;
};

function Stroke({ stroke, width, height, onGone }: { stroke: DrawnStroke; width: number; height: number; onGone: (id: number) => void }) {
  const [fading, setFading] = useState(false);
  useEffect(() => {
    if (!stroke.done) return;
    const fade = setTimeout(() => setFading(true), INK_HOLD_MS);
    const gone = setTimeout(() => onGone(stroke.id), INK_HOLD_MS + INK_FADE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(gone);
    };
  }, [stroke.done, stroke.id, onGone]);
  const paths: VectorPath[] = [{ d: strokePath(stroke.points), stroke: INK_COLOR, strokeWidth: INK_WIDTH, cap: "round" }];
  return <vector absolute={{ left: 0, top: 0 }} w={width} h={height} viewBox={[width, height]} paths={paths} inert opacity={fading ? 0 : 1} motion={{ dur: INK_FADE_MS / 1000, bounce: 0 }} />;
}

function Pin({ pin, onGone }: { pin: DrawnPin; onGone: (id: number) => void }) {
  const family = systemFontFamily();
  useEffect(() => {
    const gone = setTimeout(() => onGone(pin.id), PIN_LABEL_MS);
    return () => clearTimeout(gone);
  }, [pin.id, onGone]);
  return (
    <>
      <box absolute={{ left: pin.x - 24, top: pin.y - 24 }} w={48} h={48} radius={24} border={INK_COLOR} borderWidth={2} inert opacity={0} enter={{ scale: 0.25, opacity: 1, dur: PIN_PULSE_MS / 1000, bounce: 0 }} />
      <box absolute={{ left: pin.x + 5, top: pin.y - 23 }} w={18} h={18} radius={9} center fill={INK_COLOR} inert opacity={0} enter={{ opacity: 1, dur: PIN_LABEL_MS / 1000, bounce: 0 }}>
        <text family={family} size={11} weight={600} lineHeight={11} color="#ffffff">
          {String(pin.number)}
        </text>
      </box>
    </>
  );
}

function useInk(active: boolean) {
  const [strokes, setStrokes] = useState<Map<number, DrawnStroke>>(() => new Map());
  const [pins, setPins] = useState<Map<number, DrawnPin>>(() => new Map());

  const apply = useCallback((ink: ShowStellaInk) => {
    switch (ink.kind) {
      case "stroke":
        setStrokes((prev) => new Map(prev).set(ink.id, { id: ink.id, points: ink.points, done: ink.done }));
        break;
      case "pin":
        setPins((prev) => new Map(prev).set(ink.id, { id: ink.id, number: ink.number, x: ink.x, y: ink.y }));
        break;
      case "undo":
        setStrokes((prev) => {
          const next = new Map(prev);
          next.delete(ink.id);
          return next;
        });
        setPins((prev) => {
          const next = new Map(prev);
          next.delete(ink.id);
          return next;
        });
        break;
      case "clear":
        setStrokes(new Map());
        setPins(new Map());
        break;
      case "click":
      case "catch":
        break;
    }
  }, []);

  const strokeGone = useCallback((id: number) => {
    setStrokes((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);
  const pinGone = useCallback((id: number) => {
    setPins((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  useEffect(() => {
    if (active) return;
    setStrokes(new Map());
    setPins(new Map());
  }, [active]);

  return { strokes, pins, apply, strokeGone, pinGone };
}

export function ShowStellaOverlay() {
  const t = useT();
  const { api, snapshot } = useAuxWindow();
  const family = systemFontFamily();
  const [state, setState] = useState<ShowStellaOverlayState>({ phase: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const [hintVisible, setHintVisible] = useState(false);
  const recorder = useRef<{ id: string; recorder: ShowStellaRecorder } | null>(null);
  const interactive = useRef(false);
  const hoveringBar = useRef(false);
  const hoveringCard = useRef(false);
  const [catching, setCatching] = useState(false);
  const catchingRef = useRef(false);
  const doneRect = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const recording = state.phase === "recording";
  const ink = useInk(state.phase !== "idle");
  const applyInk = ink.apply;

  useEffect(() => {
    const show = api?.showStella;
    if (!show) return;
    const stopRecorder = async (captureId: string) => {
      const current = recorder.current;
      if (!current || current.id !== captureId) {
        await show.recorderStopped({ captureId, wav: null, videoMimeType: null, error: "not recording" });
        return;
      }
      recorder.current = null;
      const result = await current.recorder.stop().catch((error: unknown) => ({ captureId, wav: null, videoMimeType: null, error: (error as Error)?.message ?? "stop failed" }));
      await show.recorderStopped(result);
    };
    const cleanups = [
      show.onOverlayState((next) => {
        setState(next);
        if (next.phase !== "recording" || recorder.current?.id === next.captureId) return;
        const instance = new ShowStellaRecorder(next.recorder, show);
        recorder.current = { id: next.captureId, recorder: instance };
        instance.begin().catch((error: unknown) => {
          if (recorder.current?.recorder === instance) recorder.current = null;
          void instance.stop();
          show.recorderFailed({ captureId: next.captureId, message: (error as Error)?.message ?? "The screen couldn't be recorded." });
        });
      }),
      show.onInk((next) => {
        if (next.kind === "catch") {
          catchingRef.current = next.on;
          setCatching(next.on);
          return;
        }
        applyInk(next);
      }),
      show.onStopRecorder(({ captureId }) => void stopRecorder(captureId)),
    ];
    return () => cleanups.forEach((cleanup) => cleanup?.());
  }, [api, applyInk]);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [recording]);

  const captureId = state.phase === "recording" ? state.captureId : null;
  const nativeControls = state.phase === "recording" && state.nativeControls;

  const report = useCallback(() => {
    if (!captureId) return;
    const rect = nativeControls ? doneRect.current : null;
    api?.showStella?.overlayInfo({
      captureId,
      done: rect ? { x: rect.x + snapshot.bounds.x, y: rect.y + snapshot.bounds.y, width: rect.w, height: rect.h } : null,
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
  }, [api, captureId, nativeControls, snapshot.bounds.x, snapshot.bounds.y, t]);

  useEffect(() => {
    if (!captureId) return;
    const frame = setTimeout(report, 16);
    const settled = setTimeout(report, 450);
    return () => {
      clearTimeout(frame);
      clearTimeout(settled);
    };
  }, [captureId, hintVisible, report]);

  useEffect(() => {
    if (!captureId) return;
    const seen = hintsShown.get();
    hintsShown.set(seen + 1);
    setHintVisible(true);
    const timer = setTimeout(() => setHintVisible(false), seen < HINT_FULL_TIMES ? HINT_MS : HINT_MS / 2);
    return () => clearTimeout(timer);
  }, [captureId]);

  const syncInteractive = useCallback(() => {
    const next = hoveringBar.current || hoveringCard.current || catchingRef.current;
    if (interactive.current === next) return;
    interactive.current = next;
    api?.overlay?.setInteractive(next);
  }, [api]);

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
  const shift = process.platform === "darwin" ? "⇧" : "Shift";
  const { width, height } = snapshot.bounds;
  const barText = { family, size: 12.5, weight: 500, lineHeight: 12.5 };

  return (
    <>
      {display && catching ? <box absolute={{ left: display.x, top: display.y }} w={display.width} h={display.height} fill="#00000001" cursor="default" /> : null}
      {display ? <box absolute={{ left: display.x, top: display.y }} w={display.width} h={display.height} border="#e5372b99" borderWidth={2} inert /> : null}
      {[...ink.strokes.values()].map((stroke) => (
        <Stroke key={stroke.id} stroke={stroke} width={width} height={height} onGone={ink.strokeGone} />
      ))}
      {[...ink.pins.values()].map((pin) => (
        <Pin key={pin.id} pin={pin} onGone={ink.pinGone} />
      ))}
      {display && state.phase === "recording" ? (
        <row absolute={{ left: display.x, top: display.y + 14 }} w={display.width} justify="center">
          <row
            align="center"
            gap={12}
            h={34}
            pl={14}
            pr={4}
            radius={10}
            fill="#16161af0"
            shadows={[{ x: 0, y: 6, blur: 24, color: "#00000038" }]}
            inert={nativeControls}
            enter={{ opacity: 0, y: -6, dur: 0.16, bounce: 0 }}
            onHover={(inside) => {
              if (nativeControls && inside) return;
              hoveringBar.current = inside;
              syncInteractive();
            }}
          >
            <box mr={-6}>
              <Icon icon={Icons.stella.Record} size={14} strokeWidth={1.75} color="#e5372b" />
            </box>
            <text mono size={12.5} weight={500} lineHeight={12.5} features="'tnum' 1" minW={34} color="#f4f2ec">
              {clock(now - state.startedAtMs)}
            </text>
            <box maxW={hintVisible ? 420 : 0} ml={hintVisible ? 0 : -12} opacity={hintVisible ? 1 : 0} clip={0} motion={{ dur: 0.32, bounce: 0 }}>
              <text {...barText} color="#a9a7a0" nowrap>
                {state.inkAvailable ? t("features.showStella.hint", { shift }) : t("features.showStella.hintNoInk")}
              </text>
            </box>
            <box
              role="button"
              h={26}
              px={11}
              gap={7}
              center
              radius={7}
              fill="#f4f2ec"
              hoverFill="#ffffff"
              cursor="pointer"
              onLayout={(r) => {
                doneRect.current = { x: r.x, y: r.y, w: r.w, h: r.h };
              }}
              onPress={() => {
                hoveringBar.current = false;
                syncInteractive();
                api?.showStella?.done();
              }}
            >
              <box w={8} h={8} radius={2} fill="#e5372b" />
              <text family={family} size={12.5} weight={600} lineHeight={12.5} color="#16161a">
                {t("features.showStella.done")}
              </text>
            </box>
          </row>
        </row>
      ) : null}
    </>
  );
}
