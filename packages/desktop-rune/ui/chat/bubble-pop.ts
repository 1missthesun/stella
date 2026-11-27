// desktop-ui's `bubble-pop` message entrance (app/chat/full-shell.chat.css), frame for frame:
// the bubble rises 14px and grows from 84% about its bottom corner over 360ms on the
// `--bubble-spring` linear() curve, while `bubble-pop-fade` fades it in over 120ms ease-out.
//
// Electron starts it when the row gets its `--just-arrived`/`--just-sent` class, which can be a
// render after the row first drew (ConversationEvents records arrivals in a layout effect). A
// Rune `enter` plays only when an element is inserted, so it is a one-shot keyframe `loop`
// instead: it starts whenever it first appears on the element, and is dropped once it has
// played, so remounting or reordering the row never plays it again.
import { useEffect, useState } from "react";
import type { Loop } from "../../host/rune-jsx/props";

export const BUBBLE_POP_MS = 360;
const FADE_MS = 120;
const RISE = 14;
const FROM_SCALE = 0.84;
/** `--bubble-spring`: CSS `linear()` stops, evenly spaced over the animation. */
const SPRING = [0, 0.069, 0.222, 0.403, 0.577, 0.725, 0.841, 0.924, 0.979, 1.012, 1.029, 1.034, 1.033, 1.028, 1.022, 1.016, 1.011, 1.006, 1];
/** Keyframes every this many ms (the spring's stops fall on every second one). */
const STEP_MS = 10;

const spring = (t: number) => {
  const x = Math.min(1, Math.max(0, t)) * (SPRING.length - 1);
  const i = Math.min(SPRING.length - 2, Math.floor(x));
  return SPRING[i]! + (SPRING[i + 1]! - SPRING[i]!) * (x - i);
};

/** CSS `ease-out`, cubic-bezier(0, 0, 0.58, 1). */
const easeOut = (t: number) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const bx = (u: number) => 3 * (1 - u) * u * u * 0.58 + u * u * u;
  const by = (u: number) => 3 * (1 - u) * (1 - u) * u + 3 * (1 - u) * u * u + u * u * u;
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 30; k += 1) {
    const mid = (lo + hi) / 2;
    if (bx(mid) < t) lo = mid;
    else hi = mid;
  }
  return by((lo + hi) / 2);
};

/** The entrance from `fromMs` into it (a row that mounts late picks it up where Electron's negative delay would). */
export function bubblePopLoop(fromMs: number, origin: [number, number]): Loop {
  const start = Math.min(BUBBLE_POP_MS - STEP_MS, Math.max(0, Math.round(fromMs / STEP_MS) * STEP_MS));
  const span = BUBBLE_POP_MS - start;
  const frames = [];
  for (let ms = start; ms <= BUBBLE_POP_MS; ms += STEP_MS) {
    const p = spring(ms / BUBBLE_POP_MS);
    frames.push({ at: (ms - start) / span, opacity: easeOut(ms / FADE_MS), y: RISE * (1 - p), scale: FROM_SCALE + (1 - FROM_SCALE) * p });
  }
  return { kind: "sequence", period: span / 1000, times: 1, ease: "linear", frames, origin };
}

/**
 * The bubble-pop loop for a row that arrived at `arrivedAt` (`performance.now()`), while it plays.
 * `fresh` stays true for a row that arrived within the entrance, as desktop-ui's `useEntrance`
 * reports a non-null delay.
 */
export function useBubblePop(arrivedAt: number | undefined, origin: [number, number]): { fresh: boolean; loop: Loop | undefined } {
  const [pop, setPop] = useState<{ arrivedAt: number; loop: Loop | undefined; endsAt: number } | null>(null);
  let current = pop;
  if (arrivedAt !== undefined && pop?.arrivedAt !== arrivedAt) {
    const elapsed = performance.now() - arrivedAt;
    current = { arrivedAt, loop: elapsed < BUBBLE_POP_MS - STEP_MS ? bubblePopLoop(elapsed, origin) : undefined, endsAt: arrivedAt + BUBBLE_POP_MS };
    setPop(current);
  }
  const playing = current?.loop !== undefined;
  const endsAt = current?.endsAt;
  useEffect(() => {
    if (!playing || endsAt === undefined) return;
    // Dropped a little after it ends; the loop already rests on its last frame by then.
    const timer = setTimeout(() => setPop((p) => (p && p.loop ? { ...p, loop: undefined } : p)), Math.max(0, endsAt - performance.now()) + 100);
    return () => clearTimeout(timer);
  }, [playing, endsAt]);
  const live = current && current.arrivedAt === arrivedAt ? current : null;
  return { fresh: Boolean(live?.loop), loop: live?.loop };
}
