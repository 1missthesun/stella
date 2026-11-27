import { mixOklch, sheet } from "../../theme";

export const useClaudeCliInstall = sheet((c) => ({
  claudeInstall: { gap: 6, shrink: true, minW: 0 },
  claudeInstallLabel: { size: 12, color: c.textStrong },
  claudeInstallBar: { clip: 999, h: 4, radius: 999, fill: mixOklch(c.foreground, 10, "transparent") },
  claudeInstallBar_span: { h: "full", fill: c.primary, motion: { dur: 0.24 } },
  claudeInstallBarIndeterminate_span: { w: "30%" },
  claudeInstallWhy: { size: 11, lh: 1.5, color: c.textWeaker },
  claudeInstallError: { size: 11, lh: 1.5, color: c.danger },
  claudeInstallLink: { pad: 0, color: c.textStrong, underline: true },
}));
