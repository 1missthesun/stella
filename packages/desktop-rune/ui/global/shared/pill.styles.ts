import { createContext, useContext } from "react";
import { mix, mixOklch, sheet } from "../../theme";

const usePillBase = sheet((c) => ({
  pillBtn: { family: "sans", py: 6, px: 13, align: "center", justify: "center", minH: 24, border: c.border, radius: 9999, color: c.textWeak, size: 11, weight: 500, em: 0, nowrap: true, motion: { dur: 0.15 }, hoverColor: c.textBase, hover: mix(c.foreground, 6, "transparent"), press: mix(c.foreground, 10, "transparent") },
  pillBtnDisabled: { opacity: 0.45, color: c.textWeak },
  pillBtnLg: { py: 6, px: 16, minH: 32, size: 12 },
  pillBtnActive: { fill: c.selectFill, border: c.selectBorder, color: c.selectText, hover: c.selectFill, hoverBorder: c.selectBorder, hoverColor: c.selectText },
  pillBtnPrimary: { fill: c.interactive, color: c.interactiveForeground, border: c.interactive, hover: mix(c.foreground, 10, c.interactive), hoverColor: c.interactiveForeground, hoverBorder: mix(c.foreground, 10, c.interactive), press: mix(c.foreground, 16, c.interactive), pressBorder: mix(c.foreground, 16, c.interactive) },
  pillBtnDanger: { hoverColor: c.destructive, hoverBorder: c.destructive, hover: mix(c.destructive, 8, "transparent") },
  pillBtnAfterPill: { ml: 0 },
}));

const usePillInSettings = sheet((c) => ({
  pillBtn: { family: "sans", py: 5, px: 9, mx: -9, my: -5, align: "center", justify: "center", minH: 28, border: "#00000000", radius: 7, color: c.interactive, size: 14.5, weight: 600, em: -0.012, nowrap: true, motion: { dur: 0.15 }, hoverColor: c.interactive, hover: mixOklch(c.foreground, 6, "transparent"), press: mix(c.foreground, 10, "transparent") },
  pillBtnDisabled: { opacity: 0.45 },
  pillBtnLg: {},
  pillBtnActive: { fill: c.selectFill, color: c.selectText, hover: c.selectFill, hoverColor: c.selectText },
  pillBtnPrimary: { mx: 0, my: 0, py: 6, px: 14, radius: 999, fill: c.interactive, color: c.interactiveForeground, hover: mix(c.foreground, 10, c.interactive), hoverColor: c.interactiveForeground, press: mix(c.foreground, 16, c.interactive) },
  pillBtnDanger: { color: c.destructive, hoverColor: c.destructive, hover: mixOklch(c.destructive, 9, "transparent") },
  pillBtnAfterPill: { ml: 4 },
}));

/** Inside `.settings-screen` (not its dialogs and popovers): pills are the airy unboxed text actions. */
export const SettingsScreenScope = createContext(false);

export const usePill = () => {
  const base = usePillBase();
  const airy = usePillInSettings();
  return useContext(SettingsScreenScope) ? airy : base;
};
