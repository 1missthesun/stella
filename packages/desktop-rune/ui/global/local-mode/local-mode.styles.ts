import { mix, sheet } from "../../theme";

export const useLocalMode = sheet((c, t) => ({
  localModeBanner: { py: 6, pr: 8, pl: 14, absolute: { top: 6 }, raise: true, align: "center", gap: 10, w: "fit", radius: 16, fill: c.overlayTop, gradient: t.gradient.overlay, shadows: t.shadow.overlay, color: c.mutedForeground, size: 12, lh: 1.35 },
  localModeBannerText: { shrink: true, minW: 0 },
  localModeBannerAction: { py: 3, px: 10, radius: 999, fill: c.primary, color: c.primaryForeground, cursor: "pointer" },
  localModeBannerClose: { pad: 4, radius: 999, cursor: "pointer", hoverColor: c.textBase },
  localModeChoiceActions: { justify: "end", gap: 10 },
  localModeBannerLead: { color: c.textBase, weight: 600 },
  waitingMessages: { mt: 10, mb: 4, align: "end", gap: 6 },
  waitingMessage: { py: 10, px: 14, maxW: "78%", border: mix(c.primary, 55, "transparent"), borderDash: 4, radius: 18, color: c.textBase, size: 14, lh: 1.45 },
  waitingMessagesNote: { align: "center", gap: 10, color: c.mutedForeground, size: 12 },
  waitingMessagesRemove: { pad: 0, underline: true, cursor: "pointer" },
  signOutChoice: { maxW: 420 },
  signOutChoiceBody: { pt: 4, pb: 24, px: 24, gap: 16, align: "stretch" },
  signOutChoice_signOutChoiceText: { pad: 0, pl: 0, pr: 0, pb: 0, mt: 0, color: c.textBase, size: 14, lh: 1.5 },
  signOutChoiceCheck: { py: 12, px: 13, gap: 10, align: "start", border: c.border, radius: 8, color: c.textBase, size: 13, lh: 1.45, cursor: "pointer" },
  signOutChoiceCheck_input: { mt: 2 },
  signOutChoiceCheck_small: { mt: 2, color: c.mutedForeground, size: 12 },
}));
