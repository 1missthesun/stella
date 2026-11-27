import { createElement, useEffect, useRef } from "react";
import { gradientBufferSize, planGradientFrame, renderGradientPixels, type GradientColor, type GradientMode } from "@stella/theme";
import { shouldUseLowPowerEffects } from "@/shared/lib/device-perf";
import { useTokens } from "../../../../ui/theme/ThemeProvider";

const fill = { position: "absolute", inset: 0, width: "100%", height: "100%" } as const;

/**
 * The shifting-gradient backdrop as the web build draws it today (desktop-ui's ShiftingGradient):
 * the theme's blobs painted once per theme into a canvas the compositor stretches over the page,
 * or CSS radial gradients on low-power devices, instead of a PNG the page encodes and decodes.
 */
export function ThemeBackdrop({ id = "theme-backdrop", mode = "soft", colorMode = "relative" }: { id?: string; mode?: GradientMode; colorMode?: GradientColor }) {
  const t = useTokens();
  const canvas = useRef<HTMLCanvasElement>(null);
  const lightweight = shouldUseLowPowerEffects();
  const flat = t.flat;

  useEffect(() => {
    const el = canvas.current;
    if (flat || lightweight || !el) return;
    const frame = planGradientFrame({ colors: t.colors, isDark: t.dark, mode, colorMode, flat, seedKey: t.themeId });
    const paint = () => {
      const rect = el.parentElement?.getBoundingClientRect();
      const { w, h } = gradientBufferSize(rect?.width ?? 0, rect?.height ?? 0);
      if (w === 0 || h === 0) return false;
      const ctx = el.getContext("2d");
      if (!ctx) return true;
      el.width = w;
      el.height = h;
      const image = ctx.createImageData(w, h);
      renderGradientPixels(image.data, w, h, frame.bg, frame.blobs);
      ctx.putImageData(image, 0, 0);
      return true;
    };
    if (paint() || !el.parentElement) return;
    const ro = new ResizeObserver(() => {
      if (paint()) ro.disconnect();
    });
    ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, [t, mode, colorMode, flat, lightweight]);

  const c = t.colors;
  const art = flat
    ? null
    : lightweight
      ? createElement("div", {
          style: {
            ...fill,
            background: [
              `radial-gradient(circle at 18% 20%, color-mix(in srgb, ${c.primary} 12%, transparent) 0%, transparent 30%)`,
              `radial-gradient(circle at 84% 18%, color-mix(in srgb, ${c.interactive} 14%, transparent) 0%, transparent 32%)`,
              `radial-gradient(circle at 50% 84%, color-mix(in srgb, ${c.success} 10%, transparent) 0%, transparent 40%)`,
              t.c.background,
            ].join(", "),
          },
        })
      : createElement("canvas", { ref: canvas, "aria-hidden": true, style: { ...fill, imageRendering: "auto" } });

  return (
    <box id={id} absolute={{ left: 0, top: 0, right: 0, bottom: 0 }} fill={t.c.background}>
      {art}
    </box>
  );
}
