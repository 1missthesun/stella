import { sheet } from "../../theme";

export const useAntigravity = sheet((c) => ({
  antigravityPickerSignIn: { pt: 6, pb: 10, px: 10, align: "center", justify: "between", gap: 12 },
  antigravityPickerSignInHint: { shrink: true, minW: 0, size: 11, lh: 1.4, color: c.textWeak },
  antigravityPickerPrompt: { pb: 4, px: 10 },
}));
