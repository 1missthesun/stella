import { useMemo, useState } from "react";
import { useExclusiveAnimation } from "@/shared/hooks/use-exclusive-animation";
import { useTokens } from "../theme";
import type { Frame } from "../rune";

export const CHAT_ACTIVITY_SHIMMER_GROUP = "chat-activity";
const SHIMMER_WINDOW_FRACTION = 0.44;

type TextLook = { size: number; weight: number; lineHeight: number; tracking?: number; family?: string };

interface TextShimmerProps {
  text: string;
  look: TextLook;
  active?: boolean;
  durationMs?: number;
  exclusiveGroup?: string;
  exclusivePriority?: number;
  color?: string;
}

const easeInOut = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

/** desktop-ui's `TextShimmer`: a 44%-wide window of lighter text sweeping across, then resting; its edges fade over half the window each side (`.text-shimmer__sweep`'s mask). */
export function TextShimmer({ text, look, active = true, durationMs, exclusiveGroup, exclusivePriority = 0, color }: TextShimmerProps) {
  const t = useTokens();
  const [width, setWidth] = useState(0);
  const duration = useMemo(() => durationMs ?? Math.max(1400, Math.min(4000, text.length * 95)), [durationMs, text.length]);
  const shouldAnimate = useExclusiveAnimation(exclusiveGroup, active && width > 0, exclusivePriority);
  const base = color ?? t.c.textStrong;
  const feather = (width * SHIMMER_WINDOW_FRACTION) / 2;
  const loops = useMemo(() => {
    if (!width) return null;
    const sweep = Math.min(2200, Math.max(1400, duration * 0.85));
    const rest = Math.max(3000, duration * 1.5);
    const period = (sweep + rest) / 1000;
    const span = sweep / (sweep + rest);
    const win = width * SHIMMER_WINDOW_FRACTION;
    const steps = 16;
    const window: Frame[] = [];
    const inner: Frame[] = [];
    for (let i = 0; i <= steps; i++) {
      const p = easeInOut(i / steps);
      const x = -win + p * (width + win);
      window.push({ at: (i / steps) * span, x });
      inner.push({ at: (i / steps) * span, x: -x });
    }
    window.push({ at: 1, x: width });
    inner.push({ at: 1, x: -width });
    return { window: { kind: "sequence" as const, period, ease: "linear" as const, frames: window }, inner: { kind: "sequence" as const, period, ease: "linear" as const, frames: inner } };
  }, [duration, width]);
  return (
    <box onLayout={(r) => setWidth(Math.round(r.w))} maxW="full" clip={0}>
      <text {...look} color={base} nowrap truncate>
        {text}
      </text>
      {active && shouldAnimate && loops ? (
        <box absolute={{ left: 0, top: 0, bottom: 0 }} w={width * SHIMMER_WINDOW_FRACTION} clipFade={[feather, 0, feather, 0]} loop={loops.window} inert>
          <text {...look} color={t.c.textWeaker} nowrap w={width} loop={loops.inner}>
            {text}
          </text>
        </box>
      ) : null}
    </box>
  );
}
