import { mixOklch, sheet } from "../../theme";

export const useLegalDialog = sheet((c, t) => ({
  legalDialogContent: { pad: 1, clip: 0, fill: c.glassTop, gradient: t.gradient.glass, border: c.borderWeak },
  legalDialogClose: { absolute: { top: 16, right: 16 }, raise: true },
  legalDialogBody: { pt: 32, pb: 24, px: 32, gap: 16, align: "stretch" },
  legalDialogHeader: { px: 24, gap: 6, textAlign: "center" },
  legalDialogTitle: { color: c.textStrong },
  legalDialogSub: { family: "sans", color: c.mutedForeground, size: 13, weight: 500, lh: 1.5, em: -0.01 },
  legalDialogScroll: { pt: 13, pb: 4, px: 4, grow: 1, shrink: true, minW: 0, minH: 0, scrollY: true },
  legalDialogText: { family: "sans", pt: 8, pb: 16, px: 24, size: 13, lh: 1.7, em: -0.005, color: mixOklch(c.foreground, 82, "transparent") },
}));
