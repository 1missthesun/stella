import { mixOklch, sheet } from "../../theme";

export const useDevicesStyles = sheet((c) => ({
  shortBlock: { align: "center", gap: 4 },
  shortCode: { mono: true, size: 30, weight: 600, tracking: 3, color: c.textStrong, textAlign: "center" },
  offlineBlock: { gap: 6 },
  quietLink: { selfAlign: "center", pad: 2, radius: 6, cursor: "pointer", focusRing: { width: 2, offset: 1, color: c.interactive } },
  quietLinkText: { size: 12, color: c.textWeak, underline: true },
  sectionLabel: { size: 12, weight: 600, color: c.textWeak },
  nearbyList: { gap: 2 },
  nearbyRow: { align: "center", gap: 12, py: 8, minW: 0 },
  nearbyName: { grow: 1, shrink: true, minW: 0, size: 14, color: c.textStrong, truncate: true, nowrap: true },
  nearbyEmpty: { size: 12, lh: 1.5, color: c.textWeak },
  digitsInput: { py: 12, px: 14, w: "full", radius: 10, border: c.borderWeak, fill: mixOklch(c.textStrong, 3, "transparent"), color: c.textStrong, mono: true, size: 24, tracking: 6, textAlign: "center", focusBorder: c.borderStrong },
  confirmDigits: { mono: true, size: 34, weight: 600, tracking: 4, color: c.textStrong, textAlign: "center" },
}));
