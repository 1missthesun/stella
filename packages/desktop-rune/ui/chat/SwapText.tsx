import { useRef } from "react";
import { useMinimumVisibleValue } from "@/shared/hooks/use-minimum-visible-value";
import { TextShimmer } from "./TextShimmer";

type TextLook = { size: number; weight: number; lineHeight: number; tracking?: number; family?: string };

interface SwapTextProps {
  text: string;
  look: TextLook;
  active?: boolean;
  animateInitial?: boolean;
  minimumVisibleMs?: number;
  shimmerGroup?: string;
  shimmerPriority?: number;
}

const SWAP_S = 0.24;

/** desktop-ui's `SwapText`: the old label rises out while the new one rises in, both stacked in one cell. */
export function SwapText({ text, look, active = true, animateInitial = true, minimumVisibleMs = 0, shimmerGroup, shimmerPriority }: SwapTextProps) {
  const visibleText = useMinimumVisibleValue(text, minimumVisibleMs);
  const firstRef = useRef(visibleText);
  const initial = !animateInitial && visibleText === firstRef.current;
  return (
    <box grow={1} shrink minW={0}>
      <text {...look} nowrap truncate hidden>
        {visibleText}
      </text>
      <box
        key={`in:${visibleText}`}
        absolute={{ left: 0, top: 0, right: 0, bottom: 0 }}
        enter={initial ? undefined : { opacity: 0, y: 4, dur: SWAP_S }}
        exit={{ opacity: 0, y: -4, dur: SWAP_S }}
      >
        <TextShimmer text={visibleText} look={look} active={active} exclusiveGroup={shimmerGroup} exclusivePriority={shimmerPriority} />
      </box>
    </box>
  );
}
