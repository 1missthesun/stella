"use client";

import { useRef, type CSSProperties, type ReactNode } from "react";
import { useInViewOnce } from "./motion";

export function InView({
  children,
  className,
  style,
  threshold = 0.2,
  ariaHidden,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  threshold?: number;
  ariaHidden?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useInViewOnce(ref, threshold);
  return (
    <div ref={ref} className={className} style={style} aria-hidden={ariaHidden || undefined}>
      {children}
    </div>
  );
}
