"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
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

const ASK_MS = 520;
const SWAP_MS = 640;

type Phase = "idle" | "ask" | "swap" | "done";

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

function ChapterView({ index }: { index: number }) {
  const { line, Skin, bg } = CHAPTERS[index];
  const From = index === 0 ? StellaSkin : CHAPTERS[index - 1].Skin;
  const rootRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setMounted(true);
        io.disconnect();
      },
      { rootMargin: "120% 0px 120% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const el = frameRef.current;
    if (!el || !mounted) return;
    const timers: number[] = [];
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        const askMs = prefersReducedMotion() ? 0 : ASK_MS;
        setPhase(askMs ? "ask" : "swap");
        if (askMs) timers.push(window.setTimeout(() => setPhase("swap"), askMs));
        timers.push(window.setTimeout(() => setPhase("done"), askMs + SWAP_MS));
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [mounted]);

  const live = visible && (phase === "swap" || phase === "done");

  return (
    <article ref={rootRef} className={w.chapter} data-bg={bg} data-tone="dark" data-phase={phase}>
      <h3 className={w.quote}>
        <Words text={line} />
      </h3>
      <div ref={frameRef} className={w.frame} aria-hidden="true">
        <div className={w.glow} />
        <div className={w.skinBox} data-live={live ? "1" : "0"}>
          {mounted ? <Skin /> : null}
        </div>
        {phase !== "done" ? (
          <div className={w.from} data-live="0">
            {mounted ? <From /> : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function Showcase() {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const codaRef = useRef<HTMLParagraphElement>(null);
  useInViewOnce(titleRef, 0.4);
  useInViewOnce(codaRef, 0.6);
  return (
    <section className={w.show} data-tone="dark" data-bg="#060609" aria-labelledby="rewrite-title">
      <JourneyView />
      <h2 ref={titleRef} id="rewrite-title" className={w.title}>
        <span>Design</span> <span>your Stella.</span>
      </h2>
      {CHAPTERS.map((_, i) => (
        <ChapterView key={i} index={i} />
      ))}
      <p ref={codaRef} className={w.coda}>
        <Words text="Anything you ask." />
      </p>
    </section>
  );
}
