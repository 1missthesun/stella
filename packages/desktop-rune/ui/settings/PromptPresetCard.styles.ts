import { hex, sheet } from "../theme";

export const usePromptPresetCard = sheet((c) => ({
  promptPresetEditor: { mt: 12, gap: 10 },
  promptPresetNameInput: { py: 9, px: 11, w: "full", border: hex("rgba(255, 255, 255, 0.12)"), radius: 10, fill: c.surfaceInset },
  promptPresetTextarea: { py: 9, px: 11, w: "full", border: hex("rgba(255, 255, 255, 0.12)"), radius: 10, fill: c.surfaceInset, minH: 260, mono: true, size: 12, lh: 1.5, scrollX: true },
  promptPresetActions: { wrap: true, gap: 8, align: "center" },
  promptPresetActionsSpacer: { grow: 1, shrink: true, minW: 0 },
  promptPresetStatus: { size: 12, opacity: 0.75 },
  promptPresetStatusError: { color: c.danger, opacity: 1 },
}));
