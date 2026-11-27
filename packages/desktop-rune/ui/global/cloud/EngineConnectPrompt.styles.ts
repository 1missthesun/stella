import { mixOklch, sheet } from "../../theme";

export const useEngineConnectPrompt = sheet((c) => ({
  engineConnectPrompt: { py: 10, gap: 8 },
  engineConnectPromptInput: { py: 7, px: 11, w: "full", border: c.borderWeak, radius: 8, mono: true, size: 12 },
  engineConnectPromptHint: { size: 12, lh: 1.45, color: mixOklch(c.textBase, 70, c.textWeak) },
  engineConnectPromptError: { size: 12, color: c.danger },
  engineConnectPromptActions: { justify: "end", gap: 6 },
  engineConnectPromptLink: { pad: 0, color: c.textBase, underline: true, cursor: "pointer" },
}));
