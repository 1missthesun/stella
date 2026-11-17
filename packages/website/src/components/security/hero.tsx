"use client";

import { useEffect, useRef } from "react";
import { getWebGLTier } from "@/lib/device-perf";
import { SECURITY_PRICE_LINE } from "@/lib/security";
import { prefersReducedMotion } from "@/components/landing/motion";
import { SecurityDownload } from "./security-download";
import { createWallScene, type WallLayout } from "./wall-scene";
import s from "./security.module.css";

/** Where the scene's clock starts: one shot already on its way in. */
const START_AT = 1.0;
/** The reduced-motion still: a shot just broken against the wall. */
const STILL_AT = 7.68;

/** The laptop's screen: the app's own safe state, drawn once in the page's font. */
function drawScreen(font: string) {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 656;
  const g = c.getContext("2d");
  if (!g) return c;
  g.fillStyle = "#fbfbfc";
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#ffffff";
  g.fillRect(250, 70, 524, 516);
  g.strokeStyle = "#e6e6e9";
  g.lineWidth = 2;
  g.strokeRect(250, 70, 524, 516);
  g.fillStyle = "#2871c9";
  g.beginPath();
  g.arc(298, 148, 9, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#0a0a0b";
  g.font = `600 56px ${font}`;
  g.fillText("You’re safe.", 284, 230);
  g.fillStyle = "#6e6e73";
  g.font = `500 24px ${font}`;
  g.fillText("Checked 12 minutes ago", 286, 272);
  const rows = ["Chrome updated to 142", "3 new downloads checked", "Fake PayPal email moved to spam"];
  rows.forEach((row, i) => {
    const y = 350 + i * 62;
    g.fillStyle = "#ececee";
    g.fillRect(286, y - 40, 452, 2);
    g.fillStyle = "#3a3a3f";
    g.font = `500 23px ${font}`;
    g.fillText(row, 286, y);
  });
  return c;
}

export function SecurityHero() {
  const heroRef = useRef<HTMLElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const hero = heroRef.current;
    const canvas = canvasRef.current;
    const copy = copyRef.current;
    if (!hero || !canvas || !copy) return;
    const tier = getWebGLTier();
    if (tier === "none") return;
    const scene = createWallScene(canvas);
    if (!scene) return;

    // Software GL can draw the scene but not animate it smoothly.
    const still = prefersReducedMotion() || tier === "software";
    let t = still ? STILL_AT : START_AT;
    let raf = 0;
    let last = 0;
    let visible = false;
    let quality = 1;
    let slowFrames = 0;
    let size = { w: 0, h: 0 };

    const layout = (): WallLayout => {
      const w = hero.clientWidth;
      const h = hero.clientHeight;
      if (w <= 760) {
        // Phones: the copy sits on top, the scene fills what's under it.
        const top = copy.offsetTop + copy.offsetHeight + 8;
        const region = Math.max(160, h - top);
        const mid = top + region * 0.5;
        return { centerX: 0.02, centerY: 1 - (2 * mid) / h, wallHeight: (region * 0.7) / h, maxWidth: 1.32 };
      }
      return { centerX: 0.36, centerY: -0.08, wallHeight: 0.56, maxWidth: 0.62 };
    };

    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      size = { w, h };
      const maxPixels = 2_400_000;
      let dpr = Math.min(window.devicePixelRatio || 1, 2) * quality;
      if (w * h * dpr * dpr > maxPixels) dpr = Math.sqrt(maxPixels / (w * h));
      scene.resize(w, h, dpr, layout());
      scene.render(t);
      canvas.dataset.ready = "1";
    };

    const frame = (now: number) => {
      raf = 0;
      if (!visible || document.hidden) {
        last = 0;
        return;
      }
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      t += dt;
      // Step the resolution down if this computer can't keep up.
      if (dt > 0.028) slowFrames++;
      else slowFrames = Math.max(0, slowFrames - 1);
      if (slowFrames > 24 && quality > 0.55) {
        quality *= 0.8;
        slowFrames = 0;
        resize();
      }
      scene.render(t);
      raf = requestAnimationFrame(frame);
    };
    const play = () => {
      if (still) return;
      if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame);
    };

    const ro = new ResizeObserver(() => {
      if (canvas.clientWidth !== size.w || canvas.clientHeight !== size.h) resize();
    });
    ro.observe(canvas);
    resize();

    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      play();
    });
    io.observe(hero);
    const onVisibility = () => play();
    document.addEventListener("visibilitychange", onVisibility);

    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (cancelled) return;
      const family = getComputedStyle(hero).fontFamily || "system-ui, sans-serif";
      scene.setScreen(drawScreen(family));
      scene.render(t);
    });

    return () => {
      cancelled = true;
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAnimationFrame(raf);
      scene.dispose();
    };
  }, []);

  return (
    <section ref={heroRef} className={s.hero} data-tone="light" data-bg="#ffffff" aria-labelledby="security-title">
      <canvas ref={canvasRef} className={s.heroCanvas} aria-hidden="true" />
      <div ref={copyRef} className={s.heroCopy}>
        <h1 id="security-title" className={s.heroTitle}>
          <span>Safe online,</span>
          <span>without</span>
          <span>the worry.</span>
        </h1>
        <p className={s.heroSub}>
          Stella Security checks your computer, your accounts and today&rsquo;s news, and fixes what&rsquo;s wrong.
        </p>
        <div className={s.heroCta}>
          <SecurityDownload />
          <span className={s.price}>{SECURITY_PRICE_LINE}</span>
        </div>
      </div>
    </section>
  );
}
