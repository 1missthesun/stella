"use client";

import { useEffect, useRef } from "react";
import { DesignPlayer } from "./design-player";
import { clamp, ease, prefersReducedMotion, seg, useInViewOnce } from "./motion";
import { StellaSkin } from "./skins";
import { mixWindowVars, resolveWindowTheme, ThemeGradient, type WindowThemeKey } from "./window-theme";
import w from "./showcase.module.css";

const JOURNEY: WindowThemeKey[] = [
  { id: "default", dark: false },
  { id: "sage", dark: false },
  { id: "gruvbox", dark: false },
  { id: "catppuccin", dark: false },
  { id: "dracula", dark: false },
  { id: "nightowl", dark: false },
  { id: "default", dark: false },
];

const JOURNEY_START = 0.03;
const JOURNEY_END = 0.86;

const JOURNEY_SCROLL_CSS = (() => {
  const stops = JOURNEY.map((theme) => resolveWindowTheme(theme).vars);
  const varNames = Object.keys(stops[0]);
  const pct = (i: number) =>
    `${((JOURNEY_START + (i / (JOURNEY.length - 1)) * (JOURNEY_END - JOURNEY_START)) * 100).toFixed(2)}%`;

  const props = varNames
    .map(
      (name) =>
        `@property ${name} { syntax: "<color>"; inherits: true; initial-value: ${stops[0][name]}; }`,
    )
    .join("\n");

  const themeFrames = stops
    .map((vars, i) => {
      const sel =
        i === 0 ? `0%, ${pct(0)}` : i === stops.length - 1 ? `${pct(i)}, 100%` : pct(i);
      const decls = varNames.map((n) => `${n}: ${vars[n]};`).join(" ");
      return `  ${sel} { ${decls} animation-timing-function: cubic-bezier(0.42, 0, 0.58, 1); }`;
    })
    .join("\n");

  const canvasFrames = JOURNEY.map((theme, j) => {
    if (theme.id === "default") return "";
    const prev = pct(j - 1);
    const peak = pct(j);
    const next = pct(j + 1);
    return [
      `@keyframes stella-journey-c${j} {`,
      `  0%, ${prev} { opacity: 0; animation-timing-function: cubic-bezier(0.42, 0, 0.58, 1); }`,
      `  ${peak} { opacity: 1; animation-timing-function: cubic-bezier(0.42, 0, 0.58, 1); }`,
      `  ${next}, 100% { opacity: 0; }`,
      `}`,
    ].join("\n");
  })
    .filter(Boolean)
    .join("\n");

  const canvasBindings = JOURNEY.map((theme, j) =>
    theme.id === "default"
      ? ""
      : `  [data-journey-frame] canvas.journey-${j} { animation: stella-journey-c${j} linear both; animation-timeline: --stella-journey; animation-range: cover 14% cover 50%; }`,
  )
    .filter(Boolean)
    .join("\n");

  const mobileCanvasBindings = JOURNEY.map((theme, j) =>
    theme.id === "default"
      ? ""
      : `    [data-journey-frame] canvas.journey-${j} { animation-range: cover 5% cover 50%; }`,
  )
    .filter(Boolean)
    .join("\n");

  return [
    props,
    `@keyframes stella-journey-theme {\n${themeFrames}\n}`,
    canvasFrames,
    `@supports (animation-timeline: view()) and (animation-range: cover 0% cover 50%) {`,
    `  @media (prefers-reduced-motion: no-preference) {`,
    `    [data-journey-window] > * { animation: stella-journey-theme linear both; animation-timeline: --stella-journey; animation-range: cover 14% cover 50%; }`,
    canvasBindings,
    `    @media (max-width: 700px) {`,
    `      [data-journey-window] > * { animation-range: cover 5% cover 50%; }`,
    mobileCanvasBindings,
    `    }`,
    `  }`,
    `}`,
  ].join("\n");
})();

function supportsCssScrollTimeline() {
  return (
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("animation-timeline", "view()") &&
    CSS.supports("animation-range", "cover 0% cover 50%")
  );
}

function JourneyBackdrop() {
  return (
    <>
      {JOURNEY.map((theme, i) =>
        theme.id === "default" ? null : (
          <ThemeGradient key={i} theme={theme} defer style={{ opacity: 0 }} className={`journey-${i}`} />
        ),
      )}
    </>
  );
}

function JourneyView() {
  const frameRef = useRef<HTMLDivElement>(null);
  const tintRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (supportsCssScrollTimeline()) return;
    const frame = frameRef.current;
    const win = tintRef.current?.firstElementChild as HTMLElement | null;
    if (!frame || !win || prefersReducedMotion()) return;
    const canvases = Array.from(win.querySelectorAll<HTMLCanvasElement>("canvas[class^='journey-']"));
    let raf = 0;
    let key = "";
    let lastP = "";
    let start = 0;
    let frameDocTop = 0;
    let frameHeight = 0;
    let inView = false;

    const measure = () => {
      const rect = frame.getBoundingClientRect();
      frameDocTop = rect.top + window.scrollY;
      frameHeight = rect.height;
      start = Math.min(window.innerHeight * 0.9, frameDocTop);
    };

    const apply = () => {
      raf = 0;
      const vh = window.innerHeight;
      const rectTop = frameDocTop - window.scrollY;
      const end = Math.max(0, (vh - frameHeight) / 2);
      const p = clamp((start - rectTop) / Math.max(1, start - end));
      const pStr = p.toFixed(3);
      if (pStr !== lastP) {
        lastP = pStr;
        frame.style.setProperty("--journey", pStr);
      }
      const span = (JOURNEY.length - 1) * seg(p, 0.03, 0.86);
      const i = Math.min(JOURNEY.length - 2, Math.floor(span));
      const k = ease.inOut(span - i);
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
      if (!inView) return;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onResize = () => {
      measure();
      if (inView) onScroll();
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        inView = entry?.isIntersecting ?? false;
        if (inView) {
          measure();
          onScroll();
        }
      },
      { rootMargin: "200px 0px" },
    );

    const ro = new ResizeObserver(onResize);
    ro.observe(document.body);

    measure();
    apply();
    io.observe(frame);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className={w.journey}>
      <style dangerouslySetInnerHTML={{ __html: JOURNEY_SCROLL_CSS }} />
      <div ref={frameRef} className={w.journeyFrame} data-journey-frame="" aria-hidden="true">
        <div className={w.journeyGlow} />
        <div ref={tintRef} className={w.skinBox} data-journey-window="" data-live="1">
          <StellaSkin backdrop={<JourneyBackdrop />} />
        </div>
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
      <DesignPlayer />
    </section>
  );
}
