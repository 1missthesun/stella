import { hex, sheet } from "../../theme";

export const useChatgptBrand = sheet((c) => ({
  chatgptContinue: { px: 14, align: "center", justify: "center", gap: 8, minH: 34, radius: 999, fill: hex("#000"), color: hex("#fff"), size: 13, weight: 500, nowrap: true, cursor: "pointer", hover: "#202123" },
  chatgptContinueDisabled: { opacity: 0.6 },
  chatgptManageUsage: { pad: 0, align: "center", gap: 4, size: 12, weight: 500, underline: true, cursor: "pointer" },
  chatgptPlanInUse: { py: 6, px: 10, align: "center", gap: 6, size: 12 },
  chatgptPlanInUseLabel: { grow: 1, shrink: true, minW: 0 },
}));
