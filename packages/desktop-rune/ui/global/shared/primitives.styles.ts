import { sheet } from "../../theme";

export const usePrimitives = sheet((c) => ({
  floatingSelectionChip: { family: "sans", px: 12, align: "center", gap: 7, h: 28, radius: 999, size: 12, weight: 600, lh: 1, nowrap: true, motion: { dur: 0.12 } },
  floatingSelectionChipLogo: { w: 14, h: 14 },
  floatingSelectionChipLabel: { nowrap: true },
  stellaLoaderCircle: { color: c.textWeak },
}));
