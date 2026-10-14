"use client";

import type Lenis from "lenis";
import { useEffect } from "react";

export function SmoothScroll() {
  useEffect(() => {
    if (document.documentElement.dataset.embedded === "true") return;
    if (document.querySelector("[data-native-scroll]")) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let LenisClass: typeof Lenis | null = null;
    let loading = false;
    let disposed = false;
    let lenis: Lenis | null = null;
    let frame = 0;

    const start = () => {
      if (lenis || disposed) return;
      if (!LenisClass) {
        if (loading) return;
        loading = true;
        void import("lenis").then((mod) => {
          LenisClass = mod.default;
          if (!reduceMotion.matches) start();
        });
        return;
      }
      lenis = new LenisClass({
        autoRaf: false,
        lerp: 0.1,
        wheelMultiplier: 1,
        touchMultiplier: 1,
        anchors: { offset: -8 },
        prevent: (node) =>
          node.hasAttribute("data-lenis-prevent") ||
          node.closest("[data-lenis-prevent]") !== null,
      });
      const loop = (time: number) => {
        lenis?.raf(time);
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
    };

    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      lenis?.destroy();
      lenis = null;
    };

    const sync = () => (reduceMotion.matches ? stop() : start());
    sync();
    reduceMotion.addEventListener("change", sync);

    return () => {
      disposed = true;
      reduceMotion.removeEventListener("change", sync);
      stop();
    };
  }, []);

  return null;
}
