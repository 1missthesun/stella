"use client";

import { useEffect, useRef } from "react";
import { DesignPlayer } from "./design-player";
import { clamp, ease, prefersReducedMotion, seg, useInViewOnce } from "./motion";
import { StellaSkin } from "./skins";
import { mixWindowVars, ThemeGradient, type WindowThemeKey } from "./window-theme";
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
