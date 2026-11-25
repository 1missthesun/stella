import { useMemo } from "react";
import { BASE_POSITIONS, FALLBACK_BACKGROUND, buildGradientPalette, parseThemeColor, resolveThemeColors, type GradientColor, type Theme } from "@stella/theme";
import { hex } from "../../theme/color";

const ORB_BLOB_ALPHA = 0.92;
const ORB_BLOB_EXTENT = 0.62;
const ORB_GRADIENT_COLOR: GradientColor = "strong";

type OrbLayer = { center: [number, number]; radius: number; inner: string; outer: string };

function orbPaint(theme: Theme, isDark: boolean, size: number): { bg: string; layers: OrbLayer[] } {
  const { colors, flat } = resolveThemeColors(theme, isDark);
  const base = parseThemeColor(colors.background) ?? FALLBACK_BACKGROUND;
  const bg = hex(`rgb(${base.r}, ${base.g}, ${base.b})`);
  if (flat) return { bg, layers: [] };
  const palette = buildGradientPalette(colors, theme.forcedMode ? theme.forcedMode === "dark" : isDark, ORB_GRADIENT_COLOR);
  const layers = BASE_POSITIONS.map((pos, index) => {
    const { r, g, b } = palette[index % palette.length];
    const farthest = Math.hypot(Math.max(pos.x, 1 - pos.x) * size, Math.max(pos.y, 1 - pos.y) * size);
    return { center: [pos.x, pos.y] as [number, number], radius: farthest, inner: hex(`rgba(${r}, ${g}, ${b}, ${ORB_BLOB_ALPHA})`), outer: hex(`rgba(${r}, ${g}, ${b}, 0)`) };
  });
  return { bg, layers };
}

/** desktop-ui's theme swatch: the theme's background under its gradient blobs, as a circle inset 2px inside its button. */
export function ThemeOrb({ theme, isDark, size = 20, inset = 3 }: { theme: Theme; isDark: boolean; size?: number; inset?: number; className?: string }) {
  const paint = useMemo(() => orbPaint(theme, isDark, size), [theme, isDark, size]);
  return (
    <box absolute={{ left: inset, top: inset }} w={size} h={size} radius={size / 2} clip={size / 2} fill={paint.bg} inert>
      {paint.layers
        .slice()
        .reverse()
        .map((layer, i) => (
          <box key={i} absolute={{ left: 0, top: 0 }} w={size} h={size} radial={{ center: layer.center, radius: layer.radius, stops: [[0, layer.inner], [ORB_BLOB_EXTENT, layer.outer]] }} />
        ))}
    </box>
  );
}
