import { sheet } from "../../theme";

export const usePlanUsageDialog = sheet((c, t) => ({
  planUsageTabs: { align: "center", gap: 2 },
  planUsageTabsItem: { py: 6, px: 15, align: "center", border: "#00000000", radius: 9999, color: c.textWeak, size: 13, weight: 600, em: -0.005, nowrap: true, motion: { dur: 0.15 }, hoverColor: c.textStrong },
  planUsageTabsItemActive: { gradient: t.gradient.panel, border: c.panelSurfaceBorder, color: c.textStrong },
  planUsageDialogBody: { pb: 20, px: 20, grow: 1, shrink: true, minW: 0, minH: 0, scrollY: true },
}));
