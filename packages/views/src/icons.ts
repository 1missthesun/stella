// Icon names in views: Lucide's kebab-case names (aliases included), plus a few everyday words
// agents reach for. The renderer, the agent tool's lint and every host resolve names here.
import { VIEW_ICONS } from "./icons.gen";

export { VIEW_ICONS };

/** Everyday words for icons Lucide names differently. */
export const ICON_ALIASES: Readonly<Record<string, string>> = {"warning": "triangle-alert", "error": "circle-alert", "alert-circle": "circle-alert", "success": "circle-check", "check-circle-2": "circle-check", "more": "ellipsis", "more-horizontal": "ellipsis", "more-vertical": "ellipsis-vertical", "magic": "wand-sparkles", "close": "x", "add": "plus", "remove": "minus", "gear": "settings", "edit": "pencil", "time": "clock", "person": "user", "favorite": "star", "refresh": "refresh-cw", "up": "arrow-up", "back": "arrow-left", "next": "chevron-right", "previous": "chevron-left", "done": "check", "web": "globe", "world": "globe", "sound": "volume-2", "stop": "square", "photo": "image", "chat": "message-square", "message": "message-square", "notification": "bell", "idea": "lightbulb", "external": "external-link", "home": "house"};

const kebab = (name: string) =>
  name
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .replace(/([A-Za-z])(\d)/gu, "$1-$2")
    .replace(/[\s_]+/gu, "-")
    .toLowerCase();

/** The catalog key a view's icon name draws, or null when no icon has that name. */
export function viewIconName(name: string): string | null {
  const key = kebab(name);
  for (const candidate of [key, ICON_ALIASES[key], key.replace(/-?icon$/u, "")]) {
    if (candidate && Object.prototype.hasOwnProperty.call(VIEW_ICONS, candidate)) return candidate;
  }
  return null;
}

/** Up to five icon names close to `name`, for a problem message. */
export function nearIconNames(name: string): string[] {
  const words = kebab(name).split("-").filter((w) => w.length > 2);
  const scored: Array<[string, number]> = [];
  for (const candidate of Object.keys(VIEW_ICONS)) {
    const parts = candidate.split("-").filter((part) => part.length > 2);
    const score = words.reduce((n, w) => n + (candidate.includes(w) ? w.length : 0), 0) + parts.reduce((n, part) => n + (words.some((w) => w.includes(part)) ? part.length : 0), 0);
    if (score > 0) scored.push([candidate, score * 100 - candidate.length]);
  }
  return scored.sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => n);
}

const ICON_USE_RE = /(?:<Icon\b[^>]*?\bname|\bicon(?:Right)?)\s*(?:=\s*\{?\s*|:\s*)["'`]([^"'`$]+)["'`]/gu;

/** Icon names written as literals in a view's source that no icon has, with close names to use. */
export function iconProblems(source: string): Array<{ message: string; line: number }> {
  const problems: Array<{ message: string; line: number }> = [];
  for (const match of source.matchAll(ICON_USE_RE)) {
    const name = match[1]!;
    if (viewIconName(name)) continue;
    const near = nearIconNames(name);
    const line = source.slice(0, match.index ?? 0).split("\n").length;
    problems.push({ message: `No icon is named "${name}"${near.length ? `; close names: ${near.join(", ")}` : ""}. Icons use Lucide's kebab-case names.`, line });
  }
  return problems;
}
