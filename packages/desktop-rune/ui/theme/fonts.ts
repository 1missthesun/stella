import { fileURLToPath } from "node:url";
import manrope from "./fonts/manrope.ttf";
import monaSans from "./fonts/mona-sans.ttf";
import plexMono from "./fonts/ibm-plex-mono.ttf";
import plexMonoMedium from "./fonts/ibm-plex-mono-medium.ttf";
import plexMonoBold from "./fonts/ibm-plex-mono-bold.ttf";
import { engine } from "../kit/engine";
import { font } from "./scale";

/** Stella's bundled faces (desktop-ui's fonts.css), as files the engine can read. */
export const FONT_FILES = [manrope, monaSans, plexMono, plexMonoMedium, plexMonoBold].map((u) => (u.startsWith("file:") ? fileURLToPath(u) : u));

let loaded = false;

export function loadFonts() {
  if (loaded) return;
  loaded = engine.fonts(FONT_FILES, font.sans, font.mono);
}
