import { mixOklch, sheet } from "../theme";

export const useEngineScopedModelList = sheet((c, t) => ({
  engineScopedModelList: { pt: 14, pb: 4, px: 14, minH: 0 },
  engineScopedModelListHead: { pb: 8, px: 8, align: "center", justify: "between", color: c.textWeak, size: 10, weight: 600, em: 0.08, textCase: "upper" },
  engineScopedModelListRows: { grow: 1, shrink: true, minW: 0, minH: 0, gap: 1 },
  engineScopedModelListRowSlot: { pb: 18, pr: 12, mr: -14, scrollY: true },
  engineScopedModelListRowSlot_button: { py: 6, px: 11, align: "center", justify: "between", gap: 10, w: "full", minH: 34, border: "#00000000", radius: 6, color: c.textBase, size: 13, textAlign: "start", hover: mixOklch(c.textStrong, 7, "transparent"), hoverColor: c.textStrong, focusFill: mixOklch(c.textStrong, 7, "transparent") },
  engineScopedModelListRowSlot_buttonSelected: { gradient: t.gradient.panel, border: c.panelSurfaceBorder, color: c.textStrong },
  engineScopedModelListRowSlot_buttonDisabled: { opacity: 0.5 },
  engineScopedModelListText: { shrink: true, minW: 0, gap: 2 },
  engineScopedModelListName: { truncate: true, nowrap: true, weight: 500 },
  engineScopedModelListDescription: { truncate: true, nowrap: true, color: c.textWeak, size: 11 },
  engineScopedModelListRows_p: { py: 18, px: 10, color: c.textWeak, size: 11, textAlign: "center" },
  engineScopedModelListCheck: { color: c.textStrong },
}));
