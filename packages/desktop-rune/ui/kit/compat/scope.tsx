import { createContext, useContext, type ReactNode } from "react";
import { font, fontSize, lineHeight } from "../../theme";
import { systemFontFamily } from "../../theme/system-font";

export type TextBase = { size: number; weight: number; lh: number; em: number; family?: string };

/** `.app`'s text: Manrope 15, line-height 1.45, -0.01em. */
export const APP_TEXT: TextBase = { size: fontSize.lg, weight: font.sansWeight, lh: lineHeight.normal, em: font.sansTrackingEm };

/** `.app`'s letter-spacing as CSS computes it: a length, so text of any size under `.app` inherits it unchanged. */
export const APP_TRACKING = APP_TEXT.size * APP_TEXT.em;

/** `body`'s text, which Radix portals (dialogs, popovers) inherit: the system face at 16, line-height 1.5, no tracking. */
export const BODY_TEXT: TextBase = { size: 16, weight: 400, lh: 1.5, em: 0, family: systemFontFamily() };

const Base = createContext<TextBase>(APP_TEXT);
export const useTextBase = () => useContext(Base);

export function TextScope({ base, children }: { base: TextBase; children: ReactNode }) {
  return <Base.Provider value={base}>{children}</Base.Provider>;
}
