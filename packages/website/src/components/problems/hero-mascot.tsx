"use client";

import { useRef } from "react";
import o from "@/components/landing/opening.module.css";
import { StellaCharacter, useWanderingGaze, type StellaMarkHandle } from "@/components/landing/stella-character";
import h from "./how.module.css";

export function HeroMascot() {
  const ref = useRef<HTMLDivElement>(null);
  const handle = useRef<StellaMarkHandle | null>(null);
  useWanderingGaze(handle, ref);
  return (
    <div ref={ref} className={h.heroMascot} aria-hidden="true">
      <div className={o.mascotIn}>
        <StellaCharacter size={null} glow eyeColor="#ffffff" handleRef={handle} className={o.mascotMark} />
      </div>
    </div>
  );
}
