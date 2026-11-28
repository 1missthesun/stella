import type { IconData } from "../../../desktop-rune/ui/kit";
import type { PhoneTab } from "./nav";

// The phone's glyphs. packages/mobile draws SF Symbols on iOS (its Icon.tsx maps names to them);
// these are drawn to match those symbols' shapes and weights.

const g = (inner: string, width = 1.6) => `<g fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;
const fill = (on: boolean) => (on ? "currentColor" : "none");

// The bottom bar's glyphs (BottomBarIcon), outlined at rest and filled when selected.
function tabBody(tab: PhoneTab, on: boolean): string {
  switch (tab) {
    case "chat":
      return g(`<path fill="${fill(on)}" d="M6 4h12a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-6.2l-4.1 3.6a.7.7 0 0 1-1.2-.5V17H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z"/>`);
    case "schedule": {
      const r = on ? 1.35 : 1.05;
      const dots = [12.3, 16.3].flatMap((cy) => [7.5, 12, 16.5].map((cx) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" stroke="none"/>`)).join("");
      return g(`<rect x="3" y="4" width="18" height="16.5" rx="3"/><path d="M3 9V7a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v2Z" fill="currentColor"/>${dots}`);
    }
    case "apps":
      return g([3.5, 13.5].flatMap((y) => [3.5, 13.5].map((x) => `<rect x="${x}" y="${y}" width="7" height="7" rx="1.6" fill="${fill(on)}"/>`)).join(""));
    case "files":
      return g(`<path fill="${fill(on)}" d="M3 7a2.5 2.5 0 0 1 2.5-2.5h3.6c.6 0 1.1.2 1.5.6l1.1 1.1c.3.3.7.4 1.1.4h5.7A2.5 2.5 0 0 1 21 9.1v8.4a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5Z"/>`);
  }
}

export type GlyphName =
  | "person-circle"
  | "gear"
  | "chevron-left"
  | "chevron-right"
  | "chevrons-up-down"
  | "arrow-up-right"
  | "bell"
  | "checklist"
  | "clock"
  | "eye"
  | "waveform"
  | "mail"
  | "apps"
  | "chat"
  | "cloud"
  | "desktop"
  | "phone"
  | "plus"
  | "grid"
  | "list"
  | "search"
  | "xmark"
  | "filter"
  | "play"
  | "check"
  | "arrow-clockwise"
  | "arrow-counterclockwise"
  | "checkmark-circle"
  | "reply"
  | "chevron-down"
  | "activity"
  | "laptop"
  | "alert-circle";

const GLYPHS: Record<GlyphName, string> = {
  // person.crop.circle
  "person-circle": g(`<circle cx="12" cy="12" r="9.2"/><circle cx="12" cy="9.7" r="3.1"/><path d="M6.4 18.3c1.3-2.2 3.3-3.3 5.6-3.3s4.3 1.1 5.6 3.3"/>`, 1.7),
  // gearshape
  gear: g(
    `<path d="M10.3 3.2h3.4l.5 2.3c.6.2 1.2.5 1.7.9l2.2-.8 1.7 2.9-1.8 1.6c.1.6.1 1.2 0 1.8l1.8 1.6-1.7 2.9-2.2-.8c-.5.4-1.1.7-1.7.9l-.5 2.3h-3.4l-.5-2.3c-.6-.2-1.2-.5-1.7-.9l-2.2.8-1.7-2.9 1.8-1.6c-.1-.6-.1-1.2 0-1.8L4.2 8.5l1.7-2.9 2.2.8c.5-.4 1.1-.7 1.7-.9Z"/><circle cx="12" cy="12" r="2.9"/>`,
    1.6,
  ),
  "chevron-left": g(`<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>`, 2.1),
  "chevron-right": g(`<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>`, 2.1),
  "chevrons-up-down": g(`<path d="m7.5 9 4.5-4.5L16.5 9M7.5 15l4.5 4.5 4.5-4.5"/>`, 2.1),
  "arrow-up-right": g(`<path d="M7.5 16.5 16.5 7.5M8.5 7.5h8v8"/>`, 1.9),
  bell: g(`<path d="M6.2 16.6c.6-.9.9-1.9.9-3V10.4a4.9 4.9 0 0 1 9.8 0v3.2c0 1.1.3 2.1.9 3l.5.7H5.7Z"/><path d="M10.1 19.8a2.1 2.1 0 0 0 3.8 0"/>`),
  checklist: g(`<path d="m3.8 6.5 1.4 1.4 2.6-2.8M3.8 13.5l1.4 1.4 2.6-2.8M11 6.6h9.2M11 13.6h9.2M4.6 19.3h.01M11 19.3h9.2"/>`),
  clock: g(`<circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.2 2"/>`),
  eye: g(`<path d="M2.8 12S6.2 5.9 12 5.9 21.2 12 21.2 12 17.8 18.1 12 18.1 2.8 12 2.8 12Z"/><circle cx="12" cy="12" r="2.9"/>`),
  waveform: g(`<path d="M4 10.5v3M7.6 8v8M11.2 4.5v15M14.8 7.5v9M18.4 10v4"/>`),
  mail: g(`<rect x="3" y="5.5" width="18" height="13" rx="2.6"/><path d="m3.9 7 8.1 6 8.1-6"/>`, 1.5),
  apps: g(`<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>`),
  chat: g(`<path d="M6 4.5h12a2.8 2.8 0 0 1 2.8 2.8v6.6a2.8 2.8 0 0 1-2.8 2.8h-5.9l-3.9 3.3c-.4.3-1 0-1-.5v-2.8H6a2.8 2.8 0 0 1-2.8-2.8V7.3A2.8 2.8 0 0 1 6 4.5Z"/>`, 1.7),
  cloud: g(`<path d="M7.2 18.5h9.9a3.9 3.9 0 0 0 .6-7.7 5.4 5.4 0 0 0-10.4-1 4.4 4.4 0 0 0-.1 8.7Z"/>`),
  desktop: g(`<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.8 20h6.4M12 16.5V20"/>`),
  phone: g(`<rect x="6.5" y="2.8" width="11" height="18.4" rx="3"/><path d="M10.6 18.2h2.8"/>`),
  plus: g(`<path d="M12 5v14M5 12h14"/>`, 2),
  // square.grid.2x2
  grid: g(`<rect x="4" y="4" width="6.6" height="6.6" rx="1.5"/><rect x="13.4" y="4" width="6.6" height="6.6" rx="1.5"/><rect x="4" y="13.4" width="6.6" height="6.6" rx="1.5"/><rect x="13.4" y="13.4" width="6.6" height="6.6" rx="1.5"/>`, 1.7),
  // list.bullet
  list: g(`<path d="M9.5 6.5h10.5M9.5 12h10.5M9.5 17.5h10.5"/><circle cx="4.9" cy="6.5" r="1.25" fill="currentColor" stroke="none"/><circle cx="4.9" cy="12" r="1.25" fill="currentColor" stroke="none"/><circle cx="4.9" cy="17.5" r="1.25" fill="currentColor" stroke="none"/>`, 1.8),
  // magnifyingglass
  search: g(`<circle cx="10.6" cy="10.6" r="6.4"/><path d="m15.3 15.3 4.7 4.7"/>`, 2),
  // xmark
  xmark: g(`<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>`, 2.1),
  // line.3.horizontal.decrease
  filter: g(`<path d="M4 7h16M7 12h10M10 17h4"/>`, 2),
  // play.fill
  play: `<path d="M8 5.2v13.6c0 .8.9 1.3 1.6.9l10.6-6.8c.6-.4.6-1.3 0-1.7L9.6 4.3C8.9 3.9 8 4.4 8 5.2Z" fill="currentColor"/>`,
  // checkmark
  check: g(`<path d="m5 12.5 4.5 4.5L19 7.5"/>`, 2.2),
  // arrow.clockwise
  "arrow-clockwise": g(`<path d="M19.2 12.6a7.2 7.2 0 1 1-2.1-5.4"/><path d="M18.4 3.6v4.3h-4.3"/>`, 1.9),
  // arrow.counterclockwise
  "arrow-counterclockwise": g(`<path d="M4.8 12.6a7.2 7.2 0 1 0 2.1-5.4"/><path d="M5.6 3.6v4.3h4.3"/>`, 1.9),
  // checkmark.circle
  "checkmark-circle": g(`<circle cx="12" cy="12" r="9"/><path d="m8.2 12.3 2.6 2.6 5-5.4"/>`, 1.7),
  // arrowshape.turn.up.left
  reply: g(`<path d="M9.6 5.2 3.8 10.6l5.8 5.4v-3.3c4.4-.2 7.6 1.1 10.6 5.1-.7-5.4-3.8-9.1-10.6-9.6Z"/>`, 1.7),
  "chevron-down": g(`<path d="m5.5 9.5 6.5 6.5 6.5-6.5"/>`, 2.1),
  // UIActivityIndicatorView's spokes
  activity: g(`<path d="M12.00 7.20L12.00 2.60" opacity="1"/><path d="M8.61 8.61L5.35 5.35" opacity="0.88"/><path d="M7.20 12.00L2.60 12.00" opacity="0.76"/><path d="M8.61 15.39L5.35 18.65" opacity="0.64"/><path d="M12.00 16.80L12.00 21.40" opacity="0.52"/><path d="M15.39 15.39L18.65 18.65" opacity="0.4"/><path d="M16.80 12.00L21.40 12.00" opacity="0.3"/><path d="M15.39 8.61L18.65 5.35" opacity="0.22"/>`, 2.2),
  // laptopcomputer
  laptop: g(`<rect x="4.6" y="5" width="14.8" height="10.4" rx="1.6"/><path d="M2.2 18.6h19.6"/>`, 1.7),
  // exclamationmark.circle
  "alert-circle": g(`<circle cx="12" cy="12" r="9"/><path d="M12 7.4v5.6"/><circle cx="12" cy="16.4" r="1.05" fill="currentColor" stroke="none"/>`, 1.7),
};

const cache = new Map<string, IconData>();

function cached(key: string, body: () => string): IconData {
  let hit = cache.get(key);
  if (!hit) {
    hit = { name: `phone/${key}`, view: 24, body: body() } as IconData;
    cache.set(key, hit);
  }
  return hit;
}

export const tabIcon = (tab: PhoneTab, on: boolean): IconData => cached(`tab-${tab}:${on}`, () => tabBody(tab, on));
export const glyph = (name: GlyphName): IconData => cached(name, () => GLYPHS[name]);
