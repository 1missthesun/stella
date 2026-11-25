import { sheet } from "../../theme";

export const useSubscriptionUpgradeDialog = sheet((c, t) => ({
  subscriptionUpgradeDialog: { pad: 1, maxW: 420, fill: c.glassTop, gradient: t.gradient.glass, border: c.borderWeak },
  subscriptionUpgradeDialog_dialogHeader: { pt: 20, pb: 17, px: 24, align: "start", border: c.borderWeak, borderSides: [0, 0, 1, 0] },
  subscriptionUpgradeDialog_dialogDescription: { family: "sans", pad: 0, mt: 8, size: 13, lh: 1.55, color: c.textBase, em: -0.01 },
  subscriptionUpgradeDialog_dialogBody: { pt: 16, pb: 20, px: 24 },
  subscriptionUpgradeDialogBody: { gap: 12 },
  subscriptionUpgradeActions: { justify: "end", gap: 8 },
}));
