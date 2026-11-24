"use client";

import { useEffect, useLayoutEffect, useRef, type CSSProperties, type RefObject } from "react";
import {
  createStellaMark,
  type StellaCharacterState,
  type StellaMarkHandle,
} from "@stella/character/rig";
import { useLayerLive } from "./motion";

export type { StellaCharacterState, StellaMarkHandle };

type Props = {
  size: number | null;
  state?: StellaCharacterState;
  eyeColor?: string;
  glow?: boolean;
  ink?: "aurora" | "vivid";
  className?: string;
  style?: CSSProperties;
  handleRef?: RefObject<StellaMarkHandle | null>;
};

export function StellaCharacter({
  size,
  state = "idle",
  eyeColor = "var(--w-bg, #fff)",
  glow = false,
  ink = "aurora",
  className,
  style,
  handleRef,
}: Props) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const markRef = useRef<StellaMarkHandle | null>(null);
  const initialState = useRef(state);
  const layerLiveRef = useRef(true);
  const inViewRef = useRef(false);

  const syncPlay = () => {
    const mark = markRef.current;
    if (!mark) return;
    if (layerLiveRef.current && inViewRef.current && !document.hidden) mark.resume();
    else mark.pause();
  };

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const mark = createStellaMark(host, {
      size,
      state: initialState.current,
      shape: "star",
      ink,
      glow,
      eyeColor,
    });
    mark.pause();
    markRef.current = mark;
    if (handleRef) handleRef.current = mark;
    const io = new IntersectionObserver(
      ([entry]) => {
        inViewRef.current = entry?.isIntersecting ?? false;
        syncPlay();
      },
      { rootMargin: "120px 0px" },
    );
    io.observe(host);
    const onVisibility = () => syncPlay();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      inViewRef.current = false;
      markRef.current = null;
      if (handleRef) handleRef.current = null;
      mark.destroy();
    };
  }, [size, ink, glow, eyeColor, handleRef]);

  useEffect(() => {
    markRef.current?.setState(state);
  }, [state]);

  useLayerLive(hostRef, (live) => {
    layerLiveRef.current = live;
    syncPlay();
  });

  return (
    <span
      ref={hostRef}
      className={className}
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: size ?? undefined,
        height: size ?? undefined,
        flex: "0 0 auto",
        ...style,
      }}
    />
  );
}

export function useWanderingGaze(
  handleRef: RefObject<StellaMarkHandle | null>,
  hostRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    const host = hostRef.current;
    if (!host || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer = 0;
    let pointerAt = 0;
    let visible = true;
    const look = () => {
      timer = window.setTimeout(look, 900 + Math.random() * 1700);
      if (!visible || performance.now() - pointerAt < 2200) return;
      const r = host.getBoundingClientRect();
      if (!r.width) return;
      if (Math.random() < 0.22) {
        handleRef.current?.setGaze(null);
        return;
      }
      const a = Math.random() * Math.PI * 2;
      const reach = 0.45 + Math.random() * 0.5;
      handleRef.current?.setGaze({
        x: r.left + r.width / 2 + Math.cos(a) * reach * r.width,
        y: r.top + r.height / 2 + Math.sin(a) * reach * r.height * 0.8,
      });
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || !visible) return;
      pointerAt = performance.now();
      handleRef.current?.setGaze({ x: e.clientX, y: e.clientY });
    };
    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
    });
    io.observe(host);
    timer = window.setTimeout(look, 700);
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.clearTimeout(timer);
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
    };
  }, [handleRef, hostRef]);
}
