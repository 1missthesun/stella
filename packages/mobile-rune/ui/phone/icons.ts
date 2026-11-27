import type { IconData } from "../../../desktop-rune/ui/kit";
import type { PhoneTab } from "./nav";

// The phone's bottom-bar glyphs (packages/mobile BottomBarIcon), outlined at rest and filled when selected.
const g = (inner: string) => `<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;
const fill = (on: boolean) => (on ? "currentColor" : "none");

function body(tab: PhoneTab, on: boolean): string {
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

const cache = new Map<string, IconData>();

export function tabIcon(tab: PhoneTab, on: boolean): IconData {
  const key = `${tab}:${on}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = { name: `phone/${key}`, view: 24, body: body(tab, on) } as IconData;
    cache.set(key, hit);
  }
  return hit;
}
