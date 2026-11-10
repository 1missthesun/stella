"use client";

import { useRef } from "react";
import o from "@/components/landing/opening.module.css";
import { StellaCharacter, useWanderingGaze, type StellaMarkHandle } from "@/components/landing/stella-character";
import h from "./how.module.css";

/**
 * The home hero's mascot, filling the empty right side of the first screen on
 * wide desktops. Calm on purpose: it only looks around, it doesn't hop. Hidden
 * below 1100px so it never pushes the download button down on phones.
 */
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
