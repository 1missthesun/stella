import { mixOklch, sheet } from "../theme";

export const useProviderOnlyPicker = sheet((c) => ({
  providerOnlyPicker: { gap: 4 },
  providerOnlyRow: { pad: 1, radius: 10, border: mixOklch(c.border, 50, "transparent"), motion: { dur: 0.12 } },
  providerOnlyRowSelected: { border: c.border },
  providerOnlyRowExpanded: { border: c.border },
  providerOnlyRowMain: { py: 10, px: 12, align: "center", justify: "between", gap: 12, textAlign: "start", color: c.textStrong, radius: 10, hover: mixOklch(c.textStrong, 5, "transparent") },
  providerOnlyRowIcon: { align: "center", justify: "center", w: 18, color: c.textWeak },
  providerOnlyRowIcon_svg: { opacity: 0.58, motion: { dur: 0.12 } },
  providerOnlyRowSelected_providerOnlyRowIcon: { color: c.textStrong },
  providerOnlyRowSelected_providerOnlyRowIcon_svg: { opacity: 1 },
  providerOnlyRowText: { grow: 1, shrink: true, minW: 0, gap: 2 },
  providerOnlyRowName: { size: 13, weight: 500, color: c.textStrong },
  providerOnlyRowDesc: { size: 11, color: c.textWeak },
  providerOnlyRowMeta: { align: "center", gap: 8 },
  providerOnlyRowStatus: { py: 3, px: 9, size: 11, weight: 500, color: c.textWeak, radius: 9999, border: mixOklch(c.border, 60, "transparent") },
  providerOnlyRowStatusOn: { color: c.textStrong, border: mixOklch(c.textStrong, 25, "transparent") },
  providerOnlyRowCheck: { color: c.textStrong },
  providerOnlyRowAuth: { pt: 4, pb: 12, px: 12, gap: 8 },
  providerOnlyRowAuthLine: { align: "center", gap: 8 },
  providerOnlyRowAuthLine_textField: { grow: 1, shrink: true, minW: 0 },
  providerOnlyRowAuthError: { size: 11, color: c.destructive },
}));
