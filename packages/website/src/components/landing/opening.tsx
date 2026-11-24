"use client";

import { useEffect, useRef } from "react";
import { DownloadButton } from "@/components/download-button";
import { AuroraField } from "./aurora-field";
import { prefersReducedMotion } from "./motion";
import { StellaCharacter, useWanderingGaze, type StellaMarkHandle } from "./stella-character";
import o from "./opening.module.css";

const HOP_MS = 6600;
const HOP_FRAMES: Keyframe[] = [
  { offset: 0, transform: "translateY(0) rotate(0deg) scale(1, 1)" },
  { offset: 0.05, transform: "translateY(0) rotate(0deg) scale(1.09, 0.88)", easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" },
  { offset: 0.11, transform: "translateY(-8%) rotate(-5deg) scale(0.94, 1.07)", easing: "cubic-bezier(0.3, 0, 0.6, 1)" },
  { offset: 0.17, transform: "translateY(-10%) rotate(-7deg) scale(1, 1)", easing: "cubic-bezier(0.5, 0, 0.9, 0.5)" },
  { offset: 0.23, transform: "translateY(0) rotate(0deg) scale(1.08, 0.9)", easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" },
  { offset: 0.28, transform: "translateY(0) rotate(0deg) scale(0.97, 1.03)" },
  { offset: 0.33, transform: "translateY(0) rotate(0deg) scale(1, 1)" },
  { offset: 0.38, transform: "translateY(0) rotate(0deg) scale(1.09, 0.88)", easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" },
  { offset: 0.44, transform: "translateY(-8%) rotate(5deg) scale(0.94, 1.07)", easing: "cubic-bezier(0.3, 0, 0.6, 1)" },
  { offset: 0.5, transform: "translateY(-10%) rotate(7deg) scale(1, 1)", easing: "cubic-bezier(0.5, 0, 0.9, 0.5)" },
  { offset: 0.56, transform: "translateY(0) rotate(0deg) scale(1.08, 0.9)", easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" },
  { offset: 0.61, transform: "translateY(0) rotate(0deg) scale(0.97, 1.03)" },
  { offset: 0.66, transform: "translateY(0) rotate(0deg) scale(1, 1)" },
  { offset: 0.71, transform: "translateY(0) rotate(0deg) scale(1.12, 0.84)", easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" },
  { offset: 0.77, transform: "translateY(-13%) rotate(140deg) scale(0.92, 1.08)", easing: "cubic-bezier(0.25, 0, 0.5, 1)" },
  { offset: 0.83, transform: "translateY(-15%) rotate(300deg) scale(1, 1)", easing: "cubic-bezier(0.5, 0, 0.9, 0.5)" },
  { offset: 0.89, transform: "translateY(0) rotate(360deg) scale(1.1, 0.88)", easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" },
  { offset: 0.94, transform: "translateY(0) rotate(360deg) scale(0.96, 1.04)" },
  { offset: 1, transform: "translateY(0) rotate(360deg) scale(1, 1)" },
];
const SPARKLE_AT = 0.83;

export function Opening() {
  const mascotRef = useRef<HTMLDivElement>(null);
  const mascotHandle = useRef<StellaMarkHandle | null>(null);
  const mascotMoveRef = useRef<HTMLDivElement>(null);

  useWanderingGaze(mascotHandle, mascotRef);

  useEffect(() => {
    const el = mascotMoveRef.current;
    if (!el || prefersReducedMotion()) return;
    const anim = el.animate(HOP_FRAMES, { duration: HOP_MS, iterations: Infinity, delay: 1400 });
    let timer = 0;
    let visible = false;
    const scheduleSparkle = () => {
      if (!visible) return;
      const t = Number(anim.currentTime ?? 0) - 1400;
      const target = SPARKLE_AT * HOP_MS;
      const wait =
        t < 0
          ? -t + target
          : (() => {
              const into = t % HOP_MS;
              return into < target ? target - into : HOP_MS - into + target;
            })();
      timer = window.setTimeout(() => {
        if (!visible) return;
        mascotHandle.current?.sparkle(16);
        timer = window.setTimeout(scheduleSparkle, 200);
      }, Math.max(16, wait));
    };
    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      window.clearTimeout(timer);
      if (visible) {
        anim.play();
        scheduleSparkle();
      } else {
        anim.pause();
      }
    });
    io.observe(el);
    return () => {
      visible = false;
      io.disconnect();
      window.clearTimeout(timer);
      anim.cancel();
    };
  }, []);

  return (
    <section className={o.hero} data-tone="light" data-tone-follow="" data-bg="#ffffff" aria-labelledby="hero-title">
      <div className={o.aurora}>
        <AuroraField className={o.auroraCanvas} followScene />
      </div>

      <div ref={mascotRef} className={o.mascot} aria-hidden="true">
        <div className={o.mascotIn}>
          <div ref={mascotMoveRef} className={o.mascotMove}>
            <StellaCharacter size={null} glow eyeColor="#ffffff" handleRef={mascotHandle} className={o.mascotMark} />
          </div>
        </div>
      </div>

      <div className={o.copy}>
        <h1 id="hero-title" className={o.title}>
          <span className={o.titleLine}>Stella, your</span>
          <span className={o.titleLine}>personal</span>
          <span className={o.titleLine}>assistant.</span>
        </h1>
        <p className={o.sub}>The easy way to use ChatGPT, Claude or Gemini on your computer.</p>
        <div className={o.cta}>
          <DownloadButton />
          <span className={o.free}>Free with the plan you already have.</span>
        </div>
      </div>
    </section>
  );
}
