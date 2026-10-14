"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

class SceneCancel extends Error {}

export type Scene = {
  sleep: (ms: number) => Promise<void>;
  frame: () => Promise<number>;
  type: (
    text: string,
    onChar: (typed: string) => void,
    ms?: number,
  ) => Promise<void>;
};

export function useSceneLoop(
  ref: RefObject<HTMLElement | null>,
  script: (scene: Scene) => Promise<void>,
  reset: () => void,
  {
    threshold = 0.3,
    restartDelayMs = 900,
  }: { threshold?: number; restartDelayMs?: number } = {},
) {
  const [running, setRunning] = useState(false);
  const [reduced, setReduced] = useState(false);
  const scriptRef = useRef(script);
  const resetRef = useRef(reset);

  useEffect(() => {
    scriptRef.current = script;
    resetRef.current = reset;
  }, [script, reset]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const raf = requestAnimationFrame(() => setReduced(true));
      return () => cancelAnimationFrame(raf);
    }
    const io = new IntersectionObserver(
      ([entry]) => setRunning(entry.isIntersecting),
      { threshold },
    );
    // Embedded browsers can defer the observer's initial record until the
    // page scrolls. Seed the same visibility decision for an on-screen scene.
    const seedTimer = window.setTimeout(() => {
      const rect = el.getBoundingClientRect();
      const visibleHeight = Math.max(
        0,
        Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0),
      );
      if (rect.height > 0 && visibleHeight / rect.height >= threshold) {
        setRunning(true);
      }
    }, 0);
    io.observe(el);
    return () => {
      window.clearTimeout(seedTimer);
      io.disconnect();
    };
  }, [ref, threshold]);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const pendingTimers = new Map<number, () => void>();
    const pendingFrames = new Map<number, () => void>();

    const sleep = (ms: number) =>
      new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pendingTimers.delete(timer);
          if (cancelled) reject(new SceneCancel());
          else resolve();
        }, ms);
        pendingTimers.set(timer, () => reject(new SceneCancel()));
      });

    const frame = () =>
      new Promise<number>((resolve, reject) => {
        const id = window.requestAnimationFrame((time) => {
          pendingFrames.delete(id);
          if (cancelled) reject(new SceneCancel());
          else resolve(time);
        });
        pendingFrames.set(id, () => reject(new SceneCancel()));
      });

    const type = async (
      text: string,
      onChar: (typed: string) => void,
      ms = 26,
    ) => {
      const startedAt = performance.now();
      let visibleLength = 0;
      while (visibleLength < text.length) {
        const now = await frame();
        const nextLength = Math.min(
          text.length,
          Math.max(1, Math.floor((now - startedAt) / ms) + 1),
        );
        if (nextLength === visibleLength) continue;
        visibleLength = nextLength;
        onChar(text.slice(0, visibleLength));
      }
    };

    (async () => {
      await sleep(450);
      while (!cancelled) {
        await scriptRef.current({ sleep, frame, type });
        await sleep(restartDelayMs);
        resetRef.current();
        await sleep(700);
      }
    })().catch((error) => {
      if (!(error instanceof SceneCancel)) throw error;
    });

    return () => {
      cancelled = true;
      for (const [timer, cancel] of pendingTimers) {
        window.clearTimeout(timer);
        cancel();
      }
      pendingTimers.clear();
      for (const [frameId, cancel] of pendingFrames) {
        window.cancelAnimationFrame(frameId);
        cancel();
      }
      pendingFrames.clear();
      resetRef.current();
    };
  }, [running, restartDelayMs]);

  return { reduced };
}
