import { sheet } from "../../theme";

export const useShellTopbarFull = sheet((c) => ({
  shellTopbarFull: { absolute: { left: 0, top: 0, right: 0 }, h: 38, raise: true, align: "center", gap: 8, color: c.textBase, motion: { dur: 0.25 } },
  shellTopbarFullLeft: { px: 12, clip: 0, shrink: true, minW: 0, h: "full", align: "center", gap: 8 },
  shellTopbarFullPlatformMac_shellTopbarFullLeft: { pl: 84 },
  shellTopbarFullRight: { pr: 12, h: "full", align: "center", justify: "end", gap: 4, shrink: true, minW: 0 },
  shellTopbarFullRight_shellTopbarAccount: { shrink: true, minW: 0 },
}));
