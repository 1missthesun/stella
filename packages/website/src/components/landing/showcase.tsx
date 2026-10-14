"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import { prefersReducedMotion, useInViewOnce } from "./motion";
import { BlocksSkin } from "./skin-blocks";
import { DevSkin } from "./skin-dev";
import { EditorSkin } from "./skin-editor";
import { OpsSkin } from "./skin-ops";
import { StellaSkin } from "./skins";
import w from "./showcase.module.css";

type Chapter = { line: string; Skin: ComponentType; bg: string };

const CHAPTERS: Chapter[] = [
  { line: "“Build it out of blocks.”", Skin: BlocksSkin, bg: "#07101c" },
  { line: "“Go full 90s anime.”", Skin: OpsSkin, bg: "#120609" },
  { line: "“I write code all day.”", Skin: DevSkin, bg: "#0a0a0d" },
  { line: "“I edit films.”", Skin: EditorSkin, bg: "#0b0a16" },
];

const ASK_MS = 520;
const SWAP_MS = 1150;

type Phase = "idle" | "ask" | "swap" | "done";

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
        if (prefersReducedMotion()) {
          setPhase("done");
          return;
        }
        setPhase("ask");
        timers.push(window.setTimeout(() => setPhase("swap"), ASK_MS));
        timers.push(window.setTimeout(() => setPhase("done"), ASK_MS + SWAP_MS));
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
        <i className={w.beam} />
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
