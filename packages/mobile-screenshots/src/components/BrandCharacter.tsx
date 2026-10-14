"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createStellaMark } from "../../../desktop-ui/src/ui/stella-character/rig";

export type BrandCharacterShape = "blob" | "cursor";

export interface BrandCharacterProps {
  shape?: BrandCharacterShape;
  className?: string;
  eyeColor?: string;
}

export function BrandCharacter({
  shape = "blob",
  className,
  eyeColor = "var(--stella-mark-bg, #f0ede6)",
}: BrandCharacterProps) {
  const host = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    if (shape === "cursor") {
      const image = host.current?.querySelector("img");
      setReady(Boolean(image?.complete && image.naturalWidth));
      return;
    }
    setReady(false);
    if (!host.current) return;
    const mark = createStellaMark(host.current, {
      size: null,
      shape: "star",
      state: "idle",
      ink: "aurora",
      eyeColor,
      glow: false,
      paused: true,
      interactive: false,
      followPointer: false,
      visibilityGate: false,
    });
    const frame = requestAnimationFrame(() => setReady(true));
    return () => {
      cancelAnimationFrame(frame);
      mark.destroy();
    };
  }, [shape, eyeColor]);

  return (
    <span
      ref={host}
      className={className}
      data-brand-shape={shape}
      data-brand-ready={ready ? "true" : "false"}
      aria-hidden="true"
      style={{ display: "block" }}
    >
      {shape === "cursor" && (
        <img
          src="/brand/agent-cursor.png"
          width={46}
          height={48}
          alt=""
          draggable={false}
          style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }}
        />
      )}
    </span>
  );
}
