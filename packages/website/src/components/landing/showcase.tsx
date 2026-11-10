"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ComponentType } from "react";
import { clamp, ease, prefersReducedMotion, seg, useInViewOnce } from "./motion";
import { BlocksSkin } from "./skin-blocks";
import { DevSkin } from "./skin-dev";
import { EditorSkin } from "./skin-editor";
import { OpsSkin } from "./skin-ops";
import { StellaSkin } from "./skins";
import { mixWindowVars, ThemeGradient, type WindowThemeKey } from "./window-theme";
import w from "./showcase.module.css";

type Chapter = { line: string; Skin: ComponentType; bg: string };

const CHAPTERS: Chapter[] = [
  { line: "“Build it out of blocks.”", Skin: BlocksSkin, bg: "#07101c" },
  { line: "“Go full 90s anime.”", Skin: OpsSkin, bg: "#120609" },
  { line: "“I write code all day.”", Skin: DevSkin, bg: "#0a0a0d" },
  { line: "“I edit films.”", Skin: EditorSkin, bg: "#0b0a16" },
];

const SWAP_MS = 1100;
const HOLD_MS = 3800;

const JOURNEY: WindowThemeKey[] = [
  { id: "default", dark: false },
  { id: "sage", dark: false },
  { id: "gruvbox", dark: false },
  { id: "catppuccin", dark: false },
  { id: "dracula", dark: false },
  { id: "nightowl", dark: false },
  { id: "default", dark: false },
];

function JourneyBackdrop() {
  return (
    <>
      {JOURNEY.map((theme, i) =>
        theme.id === "default" ? null : (
          <ThemeGradient key={i} theme={theme} style={{ opacity: 0 }} className={`journey-${i}`} />
        ),
      )}
    </>
  );
}

function JourneyView() {
  const frameRef = useRef<HTMLDivElement>(null);
  const tintRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const frame = frameRef.current;
    const win = tintRef.current?.firstElementChild as HTMLElement | null;
    if (!frame || !win || prefersReducedMotion()) return;
    const canvases = Array.from(win.querySelectorAll<HTMLCanvasElement>("canvas[class^='journey-']"));
    let raf = 0;
    let key = "";
    let start = 0;

    const measure = () => {
      const rect = frame.getBoundingClientRect();
      start = Math.min(window.innerHeight * 0.9, rect.top + window.scrollY);
    };

    const apply = () => {
      raf = 0;
      const vh = window.innerHeight;
      const rect = frame.getBoundingClientRect();
      const end = Math.max(0, (vh - rect.height) / 2);
      const p = clamp((start - rect.top) / Math.max(1, start - end));
      const span = (JOURNEY.length - 1) * seg(p, 0.03, 0.86);
      const i = Math.min(JOURNEY.length - 2, Math.floor(span));
      const k = ease.inOut(span - i);
      frame.style.setProperty("--journey", p.toFixed(4));
      const next = `${i}:${k.toFixed(3)}`;
      if (next === key) return;
      key = next;
      const vars = mixWindowVars(JOURNEY[i], JOURNEY[i + 1], k);
      for (const [name, v] of Object.entries(vars)) win.style.setProperty(name, v);
      for (const c of canvases) {
        const j = Number(c.className.slice(8));
        c.style.opacity = (j === i ? 1 - k : j === i + 1 ? k : 0).toFixed(3);
      }
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onResize = () => {
      measure();
      onScroll();
    };

    measure();
    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className={w.journey}>
      <div ref={frameRef} className={w.journeyFrame} aria-hidden="true">
        <div className={w.journeyGlow} />
        <div ref={tintRef} className={w.skinBox} data-live="1">
          <StellaSkin backdrop={<JourneyBackdrop />} />
        </div>
      </div>
    </div>
  );
}

function Words({ text }: { text: string }) {
  return (
    <>
      {text.split(" ").map((word, i) => (
        <span key={i} className={w.word} style={{ ["--i" as string]: i }}>
          {word}
        </span>
      ))}
    </>
  );
}

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function useReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
}

const CHAPTER_LABELS = ["Blocks", "90s anime", "Code", "Film editing"];

/**
 * The examples play through on their own inside one section: each one swaps
 * in with the desktop's reload blur, holds, then the next takes over. The
 * active dot's fill is the clock (its animationend advances), so pausing it
 * pauses the whole player exactly where it is.
 */
function Player() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [started, setStarted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const [from, setFrom] = useState<number | null>(-1);
  const [swapKey, setSwapKey] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [held, setHeld] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const near = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setMounted(true);
        near.disconnect();
      },
      { rootMargin: "120% 0px 120% 0px" },
    );
    const view = new IntersectionObserver(
      ([entry]) => {
        const on = entry?.isIntersecting ?? false;
        setVisible(on);
        if (on) setStarted(true);
      },
      { threshold: 0.45 },
    );
    near.observe(el);
    view.observe(el);
    return () => {
      near.disconnect();
      view.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!started || from === null) return;
    const t = window.setTimeout(() => setFrom(null), SWAP_MS);
    return () => window.clearTimeout(t);
  }, [started, from, swapKey]);

  const go = (next: number) => {
    const target = (next + CHAPTERS.length) % CHAPTERS.length;
    if (target === index) return;
    setFrom(index);
    setIndex(target);
    setSwapKey((k) => k + 1);
  };

  const paused = held || hovered || !visible;
  const autoplay = started && !reduced;
  const { Skin } = CHAPTERS[index];
  const From = from === null ? null : from < 0 ? StellaSkin : CHAPTERS[from].Skin;
  const phase = !started ? "idle" : From ? "swap" : "done";

  return (
    <div
      ref={rootRef}
      className={w.player}
      data-phase={phase}
      data-paused={paused ? "1" : "0"}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHovered(false)}
    >
      <h3 key={`q${swapKey}`} className={w.quote} aria-live="polite">
        <Words text={CHAPTERS[index].line} />
      </h3>
      <div
        className={w.frame}
        aria-hidden="true"
        onClick={() => {
          if (!reduced) setHeld((h) => !h);
        }}
      >
        <div className={w.glow} />
        <div key={`s${swapKey}`} className={w.skinBox} data-live={visible && started ? "1" : "0"}>
          {mounted ? <Skin /> : null}
        </div>
        {From && started ? (
          <div key={`f${swapKey}`} className={w.from} data-live="0">
            {mounted ? <From /> : null}
          </div>
        ) : null}
      </div>
      <div className={w.controls}>
        <div className={w.dots} role="group" aria-label="Examples">
          {CHAPTERS.map((_, i) => (
            <button
              key={i}
              type="button"
              className={w.dot}
              aria-label={`Show: ${CHAPTER_LABELS[i]}`}
              aria-current={i === index ? "true" : undefined}
              onClick={() => go(i)}
            >
              {i === index && autoplay ? (
                <span
                  key={`p${swapKey}`}
                  className={w.fill}
                  style={{ animationDuration: `${SWAP_MS + HOLD_MS}ms` }}
                  onAnimationEnd={() => go(index + 1)}
                />
              ) : null}
            </button>
          ))}
        </div>
        {reduced ? null : (
          <button type="button" className={w.pause} onClick={() => setHeld((h) => !h)} aria-pressed={held}>
            {held ? "Play" : "Pause"}
          </button>
        )}
      </div>
    </div>
  );
}

export function Showcase() {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useInViewOnce(titleRef, 0.4);
  return (
    <section className={w.show} data-tone="dark" data-bg="#060609" aria-labelledby="rewrite-title">
      <JourneyView />
      <h2 ref={titleRef} id="rewrite-title" className={w.title}>
        <span>Design</span> <span>your Stella.</span>
      </h2>
      <p className={w.claim}>Ask, and Stella changes its own code. Any line of it, not a plug-in.</p>
      <Player />
    </section>
  );
}
