import { mixOklch, sheet } from "../../theme";

export const useRemoteExecutionConsent = sheet((c) => ({
  remoteExecutionConsent: { maxW: 420 },
  remoteExecutionConsentBody: { pt: 4, pb: 24, px: 24, gap: 16, align: "stretch" },
  remoteExecutionConsentBody_remoteExecutionConsentText: { pad: 0, pl: 0, pr: 0, pb: 0, mt: 0 },
  remoteExecutionConsentText: { color: c.textBase, size: 14, lh: 1.5 },
  remoteExecutionConsentNote: { color: c.mutedForeground, size: 12, lh: 1.5 },
  remoteExecutionConsentError: { py: 10, px: 14, size: 12, color: c.destructive, fill: mixOklch(c.destructive, 10, "transparent"), radius: 8 },
  remoteExecutionConsentActions: { justify: "end", gap: 10 },
}));
