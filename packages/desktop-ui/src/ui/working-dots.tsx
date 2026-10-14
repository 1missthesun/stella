import { useLayoutEffect, useRef } from "react";
import {
  WORKING_DOTS_CYCLE_MS,
  WORKING_DOTS_STAGGER,
  sampleWorkingDots,
  workingDotsReducedOpacity,
} from "@stella/contracts/working-dots-bounce";

const REDUCED_SAMPLES = 24;

let bounceFrames: Keyframe[] | null = null;
let reducedFrames: Keyframe[] | null = null;

function keyframes(reduced: boolean): Keyframe[] {
  if (reduced) {
    reducedFrames ??= Array.from({ length: REDUCED_SAMPLES + 1 }, (_, i) => ({
      offset: i / REDUCED_SAMPLES,
      opacity: workingDotsReducedOpacity(i / REDUCED_SAMPLES),
    }));
    return reducedFrames;
  }
  if (!bounceFrames) {
    const samples = sampleWorkingDots();
    bounceFrames = samples.map((f, i) => ({
      offset: i / (samples.length - 1),
      transform:
        `translateY(${(-f.lift * 100).toFixed(3)}%) ` +
        `scale(${f.scaleX.toFixed(4)}, ${f.scaleY.toFixed(4)})`,
    }));
  }
  return bounceFrames;
}

export function WorkingDots({
  className,
  label,
}: {
  className?: string;
  label?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);

  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) return;
    const reduced =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frames = keyframes(reduced);
    const animations = Array.from(host.children).map((dot, slot) => {
      (dot as HTMLElement).style.transformOrigin = "50% 100%";
      return dot.animate(frames, {
        duration: WORKING_DOTS_CYCLE_MS,
        delay: slot * WORKING_DOTS_STAGGER * WORKING_DOTS_CYCLE_MS,
        iterations: Infinity,
        easing: "linear",
        fill: "backwards",
      });
    });
    return () => {
      for (const animation of animations) animation.cancel();
    };
  }, []);

  return (
    <span ref={ref} className={className} aria-label={label}>
      <i />
      <i />
      <i />
    </span>
  );
}
