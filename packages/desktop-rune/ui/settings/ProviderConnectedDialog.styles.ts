import { mixOklch, font, sheet } from "../theme";

export const useProviderConnectedDialog = sheet((c, t) => ({
  providerConnectedDialog: { pad: 1, maxW: 440, fill: c.overlayTop, gradient: t.gradient.overlay, border: c.borderWeak },
  providerConnectedDialog_dialogHeader: { pt: 20, pr: 24, pb: 15, pl: 24, align: "start", border: c.borderWeak, borderSides: [0, 0, 1, 0] },
  providerConnectedDialog_dialogTitle: { family: font.display, size: 19.2, weight: 600, em: -0.03, lh: 1.2, color: c.textStrong },
  providerConnectedDialog_dialogDescription: { family: "sans", pad: 0, pl: 0, pr: 0, pb: 0, mt: 6, size: 13, lh: 1.55, color: c.textBase, em: -0.01 },
  providerConnectedDialog_dialogBody: { pt: 14, pb: 20, px: 24 },
  providerConnectedDialogBody: { gap: 10 },
  providerConnectedRow: { py: 13, px: 15, align: "start", gap: 12, radius: 8, border: c.borderWeak, fill: c.card, motion: { dur: 0.12 }, hover: c.surfaceRaisedHover, hoverBorder: c.borderBase },
  providerConnectedRow_input: { mt: 3 },
  providerConnectedRow_span: { gap: 2, shrink: true, minW: 0 },
  providerConnectedRowLabel: { family: "sans", size: 13, weight: 500, em: -0.01, color: c.textStrong },
  providerConnectedRowDesc: { family: "sans", size: 12, lh: 1.5, em: -0.005, color: c.textWeak },
  providerConnectedError: { family: "sans", py: 8, px: 12, radius: 8, size: 12, color: c.destructive, fill: mixOklch(c.destructive, 10, "transparent") },
  providerConnectedActions: { mt: 6, align: "center", justify: "end", gap: 10 },
}));
