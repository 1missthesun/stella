import { mixOklch, sheet } from "../../theme";

export const usePlanUsageDialog = sheet((c) => ({
  planUsageDialogHeader: { pt: 20, pr: 16, pb: 16 + 1, pl: 24, border: mixOklch(c.foreground, 7, "transparent"), borderSides: [0, 0, 1, 0] },
  planUsageTabs: { align: "center", gap: 24 },
  planUsageTabsItem: { pt: 2, pb: 0, vertical: true, align: "center", radius: 6, color: c.textWeak, size: 16, weight: 600, em: -0.02, lh: 1.2, nowrap: true, motion: { dur: 0.15 }, hoverColor: c.textBase },
  planUsageTabsItemActive: { color: c.textStrong, hoverColor: c.textStrong },
  planUsageTabsDot: { mt: 5, w: 5, h: 5, radius: 999, fill: c.primary, motion: { dur: 0.15 } },
  planUsageDialogBody: { pt: 0, pb: 28, px: 28, grow: 1, shrink: true, minW: 0, minH: 0, scrollY: true },
}));
