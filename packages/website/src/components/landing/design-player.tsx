"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { prefersReducedMotion } from "./motion";
import type { Look } from "./redesigns";
import p from "./design-player.module.css";

type Redesigns = typeof import("./redesigns");

type Step = { look: string; ask: string; hold: number };

/** Small tweaks, then new abilities, then whole redesigns: each ask is sent, then the window changes under it. */
const STEPS: Step[] = [
  { look: "tangerine", ask: "Make your accent tangerine.", hold: 700 },
  { look: "paper", ask: "Light mode. Warm, like paper.", hold: 700 },
  { look: "serif", ask: "Now set it in a serif.", hold: 700 },
  { look: "letter", ask: "Lose the bubbles. Make it read like a letter.", hold: 900 },
  { look: "pin", ask: "Stay on top. Fade when I'm not using you.", hold: 1700 },
  { look: "pet", ask: "Make a little you that lives on my desktop.", hold: 2000 },
  { look: "pen", ask: "Give me a pen so I can draw right on you.", hold: 1150 },
  { look: "penReal", ask: "Make this real.", hold: 900 },
  { look: "trail", ask: "I run trails. Make yourself my trail map.", hold: 1300 },
  { look: "crayon", ask: "Make it look like my kid drew it.", hold: 1100 },
  { look: "anime", ask: "Make it a 90s anime opening.", hold: 1100 },
  { look: "nodes", ask: "Node graph, please.", hold: 1000 },
  { look: "platformer", ask: "Make it a platformer.", hold: 1000 },
  { look: "ops", ask: "Now a 90s anime command center.", hold: 1200 },
  { look: "blocks", ask: "Build it out of blocks.", hold: 1700 },
];

const SWAP_MS = 900;
/** The ask is sent from the composer and rises to the window's corner; the swap starts as it settles. */
const SEND_MS = 1100;
const LEAD_MS = SEND_MS - 50;
const durOf = (step: Step) => LEAD_MS + SWAP_MS + step.hold;
const SKIN_T0 = 1.2;
const STILL_T = 2.6;
const DESIGN = { wide: { w: 1480, h: 900 }, tall: { w: 840, h: 1400 } } as const;
type Layout = keyof typeof DESIGN;

let modulePromise: Promise<Redesigns> | null = null;
const loadRedesigns = () => (modulePromise ??= import("./redesigns"));

/** Skin time, published once per drawn frame so only the live skin re-renders. */
function createClock() {
  let t = SKIN_T0;
  const subs = new Set<() => void>();
  return {
    get: () => t,
    set(next: number) {
      if (next === t) return;
      t = next;
      for (const fn of subs) fn();
    },
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
type Clock = ReturnType<typeof createClock>;

const TALL_QUERY = "(max-width: 700px), (max-aspect-ratio: 5/6)";
const subscribeTall = (fn: () => void) => {
  const q = window.matchMedia(TALL_QUERY);
  q.addEventListener("change", fn);
  return () => q.removeEventListener("change", fn);
};
const useLayout = (): Layout =>
  useSyncExternalStore(
    subscribeTall,
    () => (window.matchMedia(TALL_QUERY).matches ? "tall" : "wide"),
    () => "wide",
  );

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
const subscribeReduced = (fn: () => void) => {
  const q = window.matchMedia(REDUCED_QUERY);
  q.addEventListener("change", fn);
  return () => q.removeEventListener("change", fn);
};
const useReducedMotion = () => useSyncExternalStore(subscribeReduced, prefersReducedMotion, () => false);

const NO_CLOCK = { subscribe: () => () => {}, get: () => 0 };

/** One look in the frame. A drawn skin follows the clock while it's the look in focus, else holds `still`. */
function LookLayer({ look, layout, clock, still }: { look: Look; layout: Layout; clock: Clock | null; still: number }) {
  const source = clock && look.kind === "drawn" ? clock : NO_CLOCK;
  const live = useSyncExternalStore(source.subscribe, source.get, source.get);
  if (look.kind === "fluid") {
    const { Skin } = look;
    return <Skin />;
  }
  const { w, h } = DESIGN[layout];
  const { Skin } = look;
  return (
    <div className={p.drawn} style={{ width: w, height: h }}>
      <Skin t={clock ? live : still} w={w} h={h} />
    </div>
  );
}

/** The user's message, shrunk to its longest line the way a chat bubble hugs wrapped text. */
function Bubble({ text, leaving = false, follows = false }: { text: string; leaving?: boolean; follows?: boolean }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const span = el?.firstElementChild;
    if (!el || !span) return;
    el.style.width = "";
    const scale = el.getBoundingClientRect().width / Math.max(1, el.offsetWidth) || 1;
    const range = document.createRange();
    range.selectNodeContents(span);
    let line = 0;
    for (const rect of range.getClientRects()) line = Math.max(line, rect.width / scale);
    const cs = getComputedStyle(el);
    el.style.width = `${Math.ceil(line + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)) + 1}px`;
  }, [text]);
  return (
    <p ref={ref} className={p.bubble} data-out={leaving ? "1" : undefined} data-follows={follows ? "1" : undefined}>
      <span>{text}</span>
    </p>
  );
}

/** A look mounted in the frame; `id` keeps its DOM across pre-mount, focus and blur-out. */
type Layer = { id: number; look: number; still: number };

type View = {
  /** The ask on screen; -1 before the first one. */
  step: number;
  /** The ask leaving as the next is said. */
  prevStep: number | null;
  /** The look in focus: a STEPS index, or -1 for Stella as it ships. */
  shown: Layer;
  /** The look blurring out during a swap. */
  leaving: Layer | null;
  /** The next look, mounted hidden just before its swap so the swap itself does no work. */
  pending: Layer | null;
  nextId: number;
};

const IDLE: View = { step: -1, prevStep: null, shown: { id: 0, look: -1, still: STILL_T }, leaving: null, pending: null, nextId: 1 };
const PREMOUNT_MS = 380;

/**
 * Asks and the windows they produce, played through on their own: the ask appears as the
 * user's message bubble over the window, then the window takes its new look with the
 * desktop's reload focus pull. One clock drives it, so the pause button and leaving the
 * viewport stop it exactly where it is.
 */
export function DesignPlayer() {
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const [mod, setMod] = useState<Redesigns | null>(null);
  const [visible, setVisible] = useState(false);
  const [held, setHeld] = useState(false);
  const [view, setView] = useState<View>(IDLE);
  const [clock] = useState(createClock);
  const layout = useLayout();
  const layoutRef = useRef(layout);
  useLayoutEffect(() => {
    layoutRef.current = layout;
  });
  const reduced = useReducedMotion();

  const current: View = reduced && mod && view.step < 0 ? { ...IDLE, step: 0, shown: { id: 0, look: 0, still: STILL_T } } : view;
  const viewRef = useRef(current);
  useLayoutEffect(() => {
    viewRef.current = current;
  });
  const timeRef = useRef({ elapsed: 0, lookStart: 0, total: 0, swapping: false, premounted: false });
  const readyRef = useRef(new Set<string>());

  const paused = held || !visible;

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const near = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        near.disconnect();
        void loadRedesigns().then(setMod);
      },
      { rootMargin: "150% 0px 150% 0px" },
    );
    const seen = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false), { threshold: 0.35 });
    near.observe(el);
    seen.observe(el);
    return () => {
      near.disconnect();
      seen.disconnect();
    };
  }, []);

  const prepare = (i: number) => {
    if (!mod) return;
    const step = STEPS[(i + STEPS.length) % STEPS.length];
    if (readyRef.current.has(step.look)) return;
    const look = mod.LOOKS[step.look];
    const { w, h } = DESIGN[layoutRef.current];
    const warmed = new Promise<void>((resolve) => {
      if (look.kind !== "drawn" || !look.warm) return resolve();
      const warm = look.warm;
      const run = () => {
        warm(w, h);
        resolve();
      };
      if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(run, { timeout: 800 });
      else window.setTimeout(run, 0);
    });
    void Promise.all([mod.loadFonts(look.fonts), warmed]).then(() => readyRef.current.add(step.look));
  };

  useEffect(() => {
    if (!mod) return;
    prepare(0);
    prepare(1);
  }, [mod]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const fit = () => {
      const fw = frame.clientWidth;
      const fh = frame.clientHeight;
      const { w } = DESIGN[layout];
      const k = fw / w;
      const sink = parseFloat(getComputedStyle(frame).getPropertyValue("--bubble-sink")) || 0;
      const inset = Math.min(56, Math.max(14, fw * 0.045));
      const chatRight = layout === "wide" ? (w - 760 * 1.22) / 2 : 50;
      const composerTop = (layout === "wide" ? 112 : 130) * k;
      frame.style.setProperty("--k", String(k));
      frame.style.setProperty("--send-x", `${-Math.max(0, chatRight * k - inset).toFixed(1)}px`);
      frame.style.setProperty("--send-y", `${(fh - sink - composerTop).toFixed(1)}px`);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(frame);
    return () => ro.disconnect();
  }, [layout]);

  const say = (i: number, elapsed = 0) => {
    const v = viewRef.current;
    const step = (i + STEPS.length) % STEPS.length;
    timeRef.current.elapsed = elapsed;
    timeRef.current.swapping = false;
    timeRef.current.premounted = false;
    prepare(step + 1);
    setView({ ...v, step, prevStep: v.step >= 0 && v.step !== step ? v.step : null, leaving: null, pending: null });
  };

  const swap = () => {
    const v = viewRef.current;
    const time = timeRef.current;
    time.swapping = true;
    const leaving = { ...v.shown, still: clock.get() };
    time.lookStart = time.total;
    clock.set(SKIN_T0);
    const pending = v.pending?.look === v.step ? v.pending : null;
    setView({
      ...v,
      prevStep: null,
      shown: pending ?? { id: v.nextId, look: v.step, still: SKIN_T0 },
      leaving,
      pending: null,
      nextId: pending ? v.nextId : v.nextId + 1,
    });
  };

  const premount = () => {
    const v = viewRef.current;
    timeRef.current.premounted = true;
    setView({ ...v, pending: { id: v.nextId, look: v.step, still: SKIN_T0 }, nextId: v.nextId + 1 });
  };

  useEffect(() => {
    if (!mod || reduced || paused) return;
    const time = timeRef.current;
    if (viewRef.current.step < 0) say(0);
    const fps = window.matchMedia("(pointer: coarse)").matches ? 30 : 60;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(100, now - last);
      last = now;
      const v = viewRef.current;
      const step = STEPS[v.step];
      const lead = LEAD_MS;
      time.total += dt;
      time.elapsed += dt;
      const ready = readyRef.current.has(step.look);
      if (!time.premounted && !time.swapping && ready && time.elapsed >= lead - PREMOUNT_MS) premount();
      if (!time.swapping && time.elapsed >= lead) {
        if (ready) swap();
        else time.elapsed = lead;
      }
      if (time.elapsed >= durOf(step)) say(v.step + 1);
      const skinT = SKIN_T0 + (time.total - time.lookStart) / 1000;
      clock.set(Math.round(skinT * fps) / fps);
      const fill = fillRef.current;
      if (fill) fill.style.transform = `scaleX(${Math.min(1, time.elapsed / durOf(step)).toFixed(4)})`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mod, reduced, paused]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (i: number) => {
    const v = viewRef.current;
    if (i === v.shown.look && v.step === i) return;
    if (reduced) {
      readyRef.current.add(STEPS[i].look);
      prepare(i);
      setView({ step: i, prevStep: null, shown: { id: v.nextId, look: i, still: STILL_T }, leaving: v.shown, pending: null, nextId: v.nextId + 1 });
      return;
    }
    setHeld(false);
    say(i);
  };

  const lookAt = (i: number): Look | null => (mod ? (i < 0 ? mod.START : mod.LOOKS[STEPS[i].look]) : null);
  const live = visible && !reduced;
  const layers = [
    current.pending && { layer: current.pending, role: "pending" },
    { layer: current.shown, role: current.leaving ? "enter" : "shown" },
    current.leaving && { layer: current.leaving, role: "leaving" },
  ]
    .filter((x): x is { layer: Layer; role: string } => Boolean(x))
    .sort((a, b) => a.layer.id - b.layer.id);

  return (
    <div
      ref={rootRef}
      className={p.player}
      data-layout={layout}
      style={{ ["--send" as string]: `${SEND_MS}ms`, ["--swap" as string]: `${SWAP_MS}ms` }}
      data-paused={paused && !reduced ? "1" : "0"}
    >
      <div ref={frameRef} className={p.frame} aria-hidden="true" onClick={() => !reduced && setHeld((h) => !h)}>
        {layers.map(({ layer, role }) => {
          const look = lookAt(layer.look);
          const focused = role === "shown" || role === "enter";
          return (
            <div key={layer.id} className={p.look} data-role={role} data-live={live && focused ? "1" : "0"}>
              {look ? <LookLayer look={look} layout={layout} clock={focused && !reduced ? clock : null} still={layer.still} /> : null}
            </div>
          );
        })}
        <div className={p.asks}>
          {current.prevStep !== null ? (
            <Bubble key={`a${current.prevStep}-out`} text={STEPS[current.prevStep].ask} leaving />
          ) : null}
          {current.step >= 0 ? (
            <Bubble key={`a${current.step}`} text={STEPS[current.step].ask} follows={current.prevStep !== null} />
          ) : null}
        </div>
      </div>
      <div className={p.controls}>
        <div className={p.steps} role="group" aria-label="Redesigns">
          {STEPS.map((step, i) => (
            <button
              key={step.look}
              type="button"
              className={p.seg}
              aria-label={step.ask}
              aria-current={i === current.step ? "true" : undefined}
              data-done={current.step >= 0 && i < current.step ? "1" : "0"}
              onClick={() => go(i)}
            >
              {i === current.step && !reduced ? <span ref={fillRef} className={p.fill} /> : null}
            </button>
          ))}
        </div>
        {reduced ? null : (
          <button type="button" className={p.pause} onClick={() => setHeld((h) => !h)} aria-pressed={held} aria-label={held ? "Play" : "Pause"}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              {held ? <path d="M5 3.5v9l7.5-4.5z" /> : <path d="M5 3.5v9M11 3.5v9" />}
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
