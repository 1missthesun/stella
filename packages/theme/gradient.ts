import type { ThemeColors } from "./types";
import { generateGradientTokens, parseColor } from "./color";

export type RGB = { r: number; g: number; b: number };

export type GradientMode = "soft" | "flat";
export type GradientColor = "relative" | "strong";

export const BASE_POSITIONS = [
  { x: 0.16, y: 0.14 },
  { x: 0.86, y: 0.16 },
  { x: 0.18, y: 0.88 },
  { x: 0.88, y: 0.88 },
  { x: 0.52, y: 0.54 },
] as const;

export const FALLBACK_BACKGROUND: RGB = { r: 248, g: 247, b: 247 };

const FALLBACK_BLOB: RGB = { r: 120, g: 120, b: 120 };

export const RENDER_SCALE = 0.6;

export const OVERLAY_ALPHA = 0.25;

export function parseThemeColor(color: string): RGB | null {
  const parsed = parseColor(color);
  if (!parsed || parsed.a === 0) return null;
  return {
    r: Math.round(parsed.r),
    g: Math.round(parsed.g),
    b: Math.round(parsed.b),
  };
}

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return {
    r: Math.round(a.r * (1 - t) + b.r * t),
    g: Math.round(a.g * (1 - t) + b.g * t),
    b: Math.round(a.b * (1 - t) + b.b * t),
  };
}

export const rgbToCss = ({ r, g, b }: RGB) => `rgb(${r}, ${g}, ${b})`;

export function buildGradientPalette(
  colors: ThemeColors,
  isDark: boolean,
  colorMode: GradientColor,
): RGB[] {
  const tokens = generateGradientTokens(
    {
      primary: colors.primary,
      success: colors.success,
      warning: colors.warning,
      info: colors.info,
      interactive: colors.interactive,
    },
    isDark,
  );

  const bg = parseThemeColor(colors.background) ?? FALLBACK_BACKGROUND;

  if (colorMode === "relative") {
    const tokenColors = [
      tokens.textInteractive,
      tokens.surfaceInfoStrong,
      tokens.surfaceSuccessStrong,
      tokens.surfaceWarningStrong,
      tokens.surfaceBrandBase,
    ];
    const strength = isDark ? 0.32 : 0.5;
    return tokenColors.map((token) =>
      mixRgb(bg, parseThemeColor(token) ?? FALLBACK_BLOB, strength),
    );
  }

  const brandColor =
    parseThemeColor(tokens.surfaceBrandBase) ??
    parseThemeColor(colors.primary) ??
    FALLBACK_BLOB;
  const accentColor =
    parseThemeColor(tokens.textInteractive) ??
    parseThemeColor(colors.interactive) ??
    brandColor;
  const strength = isDark ? 0.55 : 0.85;

  return [
    mixRgb(bg, brandColor, strength),
    mixRgb(bg, accentColor, strength),
    mixRgb(bg, brandColor, strength * 0.85),
    mixRgb(bg, accentColor, strength * 0.88),
    mixRgb(bg, brandColor, strength * 0.9),
  ];
}

export interface Blob {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  color: RGB;
}

function hashSeed(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateBlobs(
  colors: RGB[],
  mode: GradientMode,
  seedKey: string,
): Blob[] {
  if (mode === "flat") {
    return [{ x: 0.5, y: 0.5, radius: 3, alpha: 0.5, color: colors[0] }];
  }

  const rand = seededRandom(hashSeed(seedKey));
  const range = (min: number, max: number) => min + rand() * (max - min);

  return BASE_POSITIONS.map((base, index) => ({
    x: range(base.x - 0.04, base.x + 0.04),
    y: range(base.y - 0.04, base.y + 0.04),
    radius: range(0.7, 0.95) * 0.65,
    alpha: range(0.25, 0.4),
    color: colors[index % colors.length],
  }));
}

const NOISE_SIZE = 64;

function generateBlueNoise(size: number): Float32Array {
  const data = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      data[y * size + x] =
        (52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1)) % 1;
    }
  }
  return data;
}

const blueNoise = generateBlueNoise(NOISE_SIZE);

export function gradientBufferSize(
  width: number,
  height: number,
  scale: number = RENDER_SCALE,
): { w: number; h: number } {
  return { w: Math.round(width * scale), h: Math.round(height * scale) };
}

export function renderGradientPixels(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  bg: RGB,
  blobs: readonly Blob[],
  overlayAlpha: number = OVERLAY_ALPHA,
): void {
  if (w === 0 || h === 0) return;
  const maxDim = Math.max(w, h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = bg.r;
      let g = bg.g;
      let b = bg.b;

      for (let i = 0; i < blobs.length; i++) {
        const blob = blobs[i];
        const dx = x / w - blob.x;
        const dy = y / h - blob.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const radius = blob.radius * (maxDim / w);

        if (dist >= radius) continue;

        const t = dist / radius;
        const falloff = 1 - t * t * t * (t * (t * 6 - 15) + 10);
        const strength = falloff * blob.alpha;

        r = r + (blob.color.r - r) * strength;
        g = g + (blob.color.g - g) * strength;
        b = b + (blob.color.b - b) * strength;
      }

      r = r + (bg.r - r) * overlayAlpha;
      g = g + (bg.g - g) * overlayAlpha;
      b = b + (bg.b - b) * overlayAlpha;

      const noise = blueNoise[(y % NOISE_SIZE) * NOISE_SIZE + (x % NOISE_SIZE)];
      const dither = (noise - 0.5) * (1.5 / 255);

      const idx = (y * w + x) * 4;
      pixels[idx] = Math.max(0, Math.min(255, Math.round(r + dither * 255)));
      pixels[idx + 1] = Math.max(
        0,
        Math.min(255, Math.round(g + dither * 255)),
      );
      pixels[idx + 2] = Math.max(
        0,
        Math.min(255, Math.round(b + dither * 255)),
      );
      pixels[idx + 3] = 255;
    }
  }
}

export interface GradientFrameInput {
  colors: ThemeColors;
  isDark: boolean;
  mode: GradientMode;
  colorMode: GradientColor;
  flat: boolean;
  seedKey: string;
}

export function planGradientFrame(input: GradientFrameInput): {
  bg: RGB;
  blobs: Blob[];
} {
  const bg = parseThemeColor(input.colors.background) ?? FALLBACK_BACKGROUND;
  if (input.flat) return { bg, blobs: [] };
  const palette = buildGradientPalette(
    input.colors,
    input.isDark,
    input.colorMode,
  );
  return { bg, blobs: generateBlobs(palette, input.mode, input.seedKey) };
}
