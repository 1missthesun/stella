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

// The window recolours over this part of its travel, from where it starts rising (p = 0)
// to the middle of the screen (p = 1). The script path below uses the same 0.03 and 0.86.
const JOURNEY_START = 0.03;
const JOURNEY_END = 0.86;

// Where the travel starts, as the distance the window's top has risen past the bottom of
// the screen. Same rule as the script path: it starts at 90% of the screen height, or where
// the window already sits when the page opens, whichever is higher.
function journeyRiseStart(frame: HTMLElement) {
  const vh = window.innerHeight;
  const docTop = frame.getBoundingClientRect().top + window.scrollY;
  return Math.round(vh - Math.min(vh * 0.9, docTop));
}

// `ease.inOut` (cubic) as a CSS easing, so the recolour follows the same curve in both paths.
const EASE_IN_OUT = `linear(${Array.from({ length: 41 }, (_, i) => Number(ease.inOut(i / 40).toFixed(5))).join(", ")})`;

// Browsers with scroll-driven animations recolour the window in CSS, off the scroll handler.
// The registered properties are private (--jw-*): registering the shared --w-* names would give
// every window and mock on the page a default-theme colour wherever it relies on a fallback.
const SCROLL_TIMELINE_SUPPORTS =
  "(animation-timeline: view()) and (animation-range: cover 0% cover 50%) and (animation-timing-function: linear(0, 1))";

const JOURNEY_SCROLL_CSS = (() => {
  const stops = JOURNEY.map((theme) => resolveWindowTheme(theme).vars);
  const varNames = Object.keys(stops[0]);
  const priv = (name: string) => name.replace(/^--w-/, "--jw-");
  const pct = (i: number) =>
    `${((JOURNEY_START + (i / (JOURNEY.length - 1)) * (JOURNEY_END - JOURNEY_START)) * 100).toFixed(3)}%`;
  const timeline = "animation-timeline: --stella-journey; animation-range: var(--journey-range);";

  const props = varNames
    .map((name) => `@property ${priv(name)} { syntax: "<color>"; inherits: false; initial-value: ${stops[0][name]}; }`)
    .join("\n");

  const themeFrames = stops
    .map((vars, i) => {
      const sel = i === 0 ? `0%, ${pct(0)}` : i === stops.length - 1 ? `${pct(i)}, 100%` : pct(i);
      const decls = varNames.map((n) => `${priv(n)}: ${vars[n]};`).join(" ");
      return `  ${sel} { ${decls} animation-timing-function: ${EASE_IN_OUT}; }`;
    })
    .join("\n");

  const canvasFrames = JOURNEY.map((theme, j) =>
    theme.id === "default"
      ? ""
      : [
          `@keyframes stella-journey-c${j} {`,
          `  0%, ${pct(j - 1)} { opacity: 0; animation-timing-function: ${EASE_IN_OUT}; }`,
          `  ${pct(j)} { opacity: 1; animation-timing-function: ${EASE_IN_OUT}; }`,
          `  ${pct(j + 1)}, 100% { opacity: 0; }`,
          `}`,
          `@supports ${SCROLL_TIMELINE_SUPPORTS} { @media (prefers-reduced-motion: no-preference) {`,
          `  [data-journey-window] canvas.journey-${j} { animation: stella-journey-c${j} linear both; ${timeline} }`,
          `} }`,
        ].join("\n"),
  )
    .filter(Boolean)
    .join("\n");

  const uses = varNames.map((n) => `${n}: var(${priv(n)}) !important;`).join(" ");

  return [
    props,
    `@keyframes stella-journey-theme {\n${themeFrames}\n}`,
    canvasFrames,
    `@supports ${SCROLL_TIMELINE_SUPPORTS} { @media (prefers-reduced-motion: no-preference) {`,
    `  [data-journey-window] > * { ${uses} animation: stella-journey-theme linear both; ${timeline} }`,
    `} }`,
  ].join("\n");
})();

function supportsCssScrollTimeline() {
  return typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports(SCROLL_TIMELINE_SUPPORTS);
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
    const frame = frameRef.current;
    const win = tintRef.current?.firstElementChild as HTMLElement | null;
    if (!frame || !win || prefersReducedMotion()) return;
    if (supportsCssScrollTimeline()) {
      // CSS runs the recolour; it only needs to know where the travel starts.
      const place = () => frame.style.setProperty("--journey-range", `cover ${journeyRiseStart(frame)}px cover 50%`);
      place();
      const ro = new ResizeObserver(place);
      ro.observe(document.body);
      window.addEventListener("resize", place, { passive: true });
      return () => {
        ro.disconnect();
        window.removeEventListener("resize", place);
      };
    }
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
