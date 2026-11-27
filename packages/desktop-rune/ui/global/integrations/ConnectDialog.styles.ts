import { mixOklch, sheet } from "../../theme";

export const useConnectDialog = sheet((c, t) => ({
  connectDialog_dialogBody: { pt: 2, pb: 24, px: 24, grow: 1, shrink: true, minW: 0, minH: 0, gap: 22 },
  connectSection: { gap: 10 },
  connectSectionTitle: { family: "sans", size: 12, weight: 600, em: -0.005, color: c.textWeak },
  connectPanel: { pad: 21, justify: "center", radius: 12, fill: c.surfaceInset, border: c.borderWeak },
  connectSection_button: { selfAlign: "start" },
  connectList: { pad: 1, clip: 12, radius: 12, fill: c.surfaceInset, border: c.borderWeak },
  connectListLoading: { h: 58 },
  connectDevice: { py: 10, pr: 14, pl: 16, align: "center", gap: 12, minH: 58 },
  connectDeviceDot: { w: 8, h: 8, radius: 9999, fill: c.textWeaker },
  connectDeviceDotDevicePresenceOnline: { fill: c.success },
  connectDeviceText: { grow: 1, shrink: true, minW: 0, gap: 2 },
  connectDeviceName: { align: "center", gap: 8, shrink: true, minW: 0 },
  connectDeviceLabel: { family: "sans", truncate: true, nowrap: true, size: 14, weight: 500, em: -0.01, color: c.textStrong },
  connectDeviceTag: { family: "sans", py: 1, px: 7, radius: 9999, fill: mixOklch(c.foreground, 7, "transparent"), size: 11, weight: 500, color: c.textWeak },
  connectDeviceMeta: { family: "sans", size: 12, color: c.textWeak },
  connectDeviceSwitch_switchControlStateUnchecked: { border: c.borderStrong, fill: mixOklch(c.foreground, 14, "transparent") },
  connectNote: { family: "sans", size: 12, color: c.textWeak },
  connectNoteError: { color: t.vars["--text-error"] },
}));
