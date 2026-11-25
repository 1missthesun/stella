import { mix, sheet } from "../../theme";

export const usePill = sheet((c) => ({
  pillBtn: { family: "sans", py: 6, px: 13, align: "center", justify: "center", minH: 24, border: c.border, radius: 9999, color: c.textWeak, size: 11, weight: 500, em: 0, nowrap: true, motion: { dur: 0.15 }, hoverColor: c.textBase, hover: mix(c.foreground, 6, "transparent"), press: mix(c.foreground, 10, "transparent") },
  pillBtnDisabled: { opacity: 0.45, color: c.textWeak },
  pillBtnLg: { py: 6, px: 16, minH: 32, size: 12 },
  pillBtnActive: { fill: c.selectFill, border: c.selectBorder, color: c.selectText, hover: c.selectFill, hoverBorder: c.selectBorder, hoverColor: c.selectText },
  pillBtnPrimary: { fill: c.interactive, color: c.interactiveForeground, border: c.interactive, hover: mix(c.foreground, 10, c.interactive), hoverColor: c.interactiveForeground, hoverBorder: mix(c.foreground, 10, c.interactive), press: mix(c.foreground, 16, c.interactive), pressBorder: mix(c.foreground, 16, c.interactive) },
  pillBtnDanger: { hoverColor: c.destructive, hoverBorder: c.destructive, hover: mix(c.destructive, 8, "transparent") },
}));
