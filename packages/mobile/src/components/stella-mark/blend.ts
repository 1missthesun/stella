import { STELLA_STAR_PATH } from "@stella/contracts/stella-mark";
import { STELLA_ORB_PATH } from "./geometry";

export function blendStarToOrb(t: number): string {
  const orb = STELLA_ORB_PATH.match(/-?\d*\.?\d+/g) ?? [];
  let index = 0;
  return STELLA_STAR_PATH.replace(/-?\d*\.?\d+/g, (value) => {
    const from = Number(value);
    const to = Number(orb[index++] ?? value);
    return (from + (to - from) * t).toFixed(2);
  });
}

export const STELLA_SOFT_PATH = blendStarToOrb(0.5);
