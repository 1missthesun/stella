export const radius = { xs: 4, sm: 6, md: 8, lg: 10, xl: 12, "2xl": 14, "3xl": 18, "4xl": 24, full: 9999 } as const;

export const fontSize = { "2xs": 10, xs: 11, sm: 12, base: 13, md: 14, lg: 15, xl: 17, "2xl": 20, "3xl": 24, "4xl": 32 } as const;

export const space = { 1: 4, 1.5: 6, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24 } as const;

export const weight = { light: 300, regular: 400, medium: 500, semibold: 600, bold: 700 } as const;

/** `--lh-tight` / `--lh-normal`; `normal` is what desktop-ui text without its own line-height inherits from `.app`. */
export const lineHeight = { tight: 1.2, normal: 1.45 } as const;

export const font = {
  sans: "Manrope",
  mono: "IBM Plex Mono",
  display: "Mona Sans",
  sansTrackingEm: -0.01,
  sansWeight: 400,
  emphasisWeight: 600,
} as const;

export const layer = { dialog: 50, lightbox: 60, toast: 1000, selectionChip: 1300, preview: 9000, popover: 9999, menu: 10000 } as const;

export type TextLook = { size: number; weight: number; lineHeight: number; tracking: number; family?: string };

/** A text look in engine units: CSS `line-height` multiples and `em` letter-spacing turned into points. */
export function look(size: number, weightValue: number, opts: { lh?: number; em?: number; family?: string } = {}): TextLook {
  const em = opts.em ?? font.sansTrackingEm;
  return {
    size,
    weight: weightValue,
    lineHeight: Math.round(size * (opts.lh ?? lineHeight.normal) * 100) / 100,
    tracking: Math.round(size * em * 1000) / 1000,
    ...(opts.family ? { family: opts.family } : {}),
  };
}
