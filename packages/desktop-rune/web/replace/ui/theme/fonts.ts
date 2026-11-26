import { engine } from "../../../../ui/kit/engine";
import { font } from "../../../../ui/theme/scale";

/** The faces come from desktop-ui's fonts.css, loaded by the page; only the families are named here. */
export const FONT_FILES: string[] = [];

let loaded = false;

export function loadFonts() {
  if (loaded) return;
  loaded = true;
  engine.fonts(FONT_FILES, font.sans, font.mono);
}
