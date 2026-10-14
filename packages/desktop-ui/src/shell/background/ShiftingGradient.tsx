import { memo, useEffect, useRef } from "react";
import { useTheme } from "@/context/theme-context";
import { shouldUseLowPowerEffects } from "@/shared/lib/device-perf";
import {
  gradientBufferSize,
  planGradientFrame,
  renderGradientPixels,
  type Blob,
  type GradientColor,
  type GradientMode,
  type RGB,
} from "@stella/theme";
import { cn } from "@/shared/lib/utils";
import "./ShiftingGradient.css";

interface ShiftingGradientProps {
  className?: string;
  mode?: GradientMode;
  colorMode?: GradientColor;
  blurMultiplier?: number;
  scale?: number;
  lightweight?: boolean;
  contained?: boolean;
}

function renderGradient(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  bg: RGB,
  blobs: readonly Blob[],
) {
  const { w, h } = gradientBufferSize(width, height);
  if (w === 0 || h === 0) return;

  ctx.canvas.width = w;
  ctx.canvas.height = h;

  const imageData = ctx.createImageData(w, h);
  renderGradientPixels(imageData.data, w, h, bg, blobs);
  ctx.putImageData(imageData, 0, 0);
}

export const ShiftingGradient = memo(function ShiftingGradient({
  className,
  mode = "soft",
  colorMode = "relative",
  lightweight: lightweightProp = false,
  contained = false,
}: ShiftingGradientProps) {
  const lightweight = lightweightProp || shouldUseLowPowerEffects();
  const { resolvedColorMode, theme, colors, flat } = useTheme();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const frameRef = useRef<{ bg: RGB; blobs: Blob[] } | null>(null);
  const prevKeyRef = useRef("");
  const paintedRef = useRef(false);

  useEffect(() => {
    if (lightweight) {
      prevKeyRef.current = "";
      return;
    }

    const key = `${theme.id}-${resolvedColorMode}-${mode}-${colorMode}-${flat ? "flat" : ""}-${colors.background}-${colors.primary}-${colors.interactive}`;
    const settingsChanged = prevKeyRef.current !== key;

    if (!settingsChanged) {
      return;
    }

    prevKeyRef.current = key;

    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!ctxRef.current) {
      ctxRef.current = canvas.getContext("2d", { willReadFrequently: true });
    }
    const ctx = ctxRef.current;
    if (!ctx) return;

    const frame = planGradientFrame({
      colors,
      isDark: resolvedColorMode === "dark",
      mode,
      colorMode,
      flat,
      seedKey: theme.id,
    });
    frameRef.current = frame;

    const rect = canvas.parentElement?.getBoundingClientRect();
    const w = rect?.width ?? window.innerWidth;
    const h = rect?.height ?? window.innerHeight;

    renderGradient(ctx, w, h, frame.bg, frame.blobs);
    paintedRef.current = w > 0 && h > 0;
  }, [theme.id, resolvedColorMode, mode, colorMode, lightweight, colors, flat]);

  useEffect(() => {
    if (lightweight) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (paintedRef.current) return;

    const renderOnce = () => {
      const ctx = ctxRef.current;
      const frame = frameRef.current;
      if (!ctx || !frame || prevKeyRef.current === "") return false;
      const rect = canvas.parentElement?.getBoundingClientRect();
      const w = rect?.width ?? 0;
      const h = rect?.height ?? 0;
      if (w === 0 || h === 0) return false;
      renderGradient(ctx, w, h, frame.bg, frame.blobs);
      paintedRef.current = true;
      return true;
    };

    if (typeof ResizeObserver === "undefined") {
      renderOnce();
      return;
    }

    const ro = new ResizeObserver(() => {
      if (renderOnce()) ro.disconnect();
    });
    const target = contained ? rootRef.current : canvas.parentElement;
    if (target) ro.observe(target);
    return () => {
      ro.disconnect();
    };
  }, [lightweight, colors, contained]);

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className={cn(
        "shifting-gradient",
        contained && "shifting-gradient--contained",
        className,
      )}
    >
      {lightweight ? (
        <div
          className="gradient-base"
          style={{
            background: flat
              ? "var(--background)"
              : [
                  `radial-gradient(circle at 18% 20%, color-mix(in srgb, ${colors.primary} 12%, transparent) 0%, transparent 30%)`,
                  `radial-gradient(circle at 84% 18%, color-mix(in srgb, ${colors.interactive} 14%, transparent) 0%, transparent 32%)`,
                  `radial-gradient(circle at 50% 84%, color-mix(in srgb, ${colors.success} 10%, transparent) 0%, transparent 40%)`,
                  "var(--background)",
                ].join(", "),
          }}
        />
      ) : (
        <canvas
          ref={canvasRef}
          className="gradient-base"
          style={{
            imageRendering: "auto",
          }}
        />
      )}
    </div>
  );
});
