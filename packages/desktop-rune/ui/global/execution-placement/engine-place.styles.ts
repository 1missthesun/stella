import { sheet } from "../../theme";

export const useEnginePlace = sheet((c) => ({
  enginePlaceNote: { pt: 6, pb: 10, px: 10, align: "center", justify: "between", gap: 12 },
  enginePlaceNote_p: { shrink: true, minW: 0, size: 11, lh: 1.4, color: c.textWeak },
  enginePlaceLine: { pt: 2, pb: 8, px: 10, shrink: true, minW: 0, size: 11, lh: 1.4, color: c.textWeak },
}));
