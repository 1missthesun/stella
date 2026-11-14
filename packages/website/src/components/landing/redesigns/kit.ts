import { EYE_POSES } from "@stella/character/eyes";
import { C as STAR_C, SHAPES } from "@stella/character/shapes";

const FONT_DIR = "/landing/redesign-fonts/";

const FACES = {
  dela: [["RK Dela Gothic", "DelaGothicOne", "400"]],
  comic: [
    ["RK Comic", "ComicNeueBold", "700"],
    ["RK Comic Italic", "ComicNeueBoldItalic", "700"],
  ],
  press: [["RK Press Start", "PressStart2P", "400"]],
  bangers: [["RK Bangers", "Bangers", "400"]],
  kid: [["RK Schoolbell", "Schoolbell", "400"]],
  barlow: [
    ["RK Barlow", "BarlowSC500", "500"],
    ["RK Barlow", "BarlowSC600", "600"],
    ["RK Barlow", "BarlowSC700", "700"],
    ["RK Barlow Italic", "BarlowSCItalic", "500"],
  ],
  manrope: [["RK Manrope", "Manrope", "200 800"]],
} as const;

export type FontSet = keyof typeof FACES | "serif";

/** The page's own serif (next/font, not preloaded), fetched before a look that uses it. */
function loadPageSerif() {
  const root = document.querySelector<HTMLElement>("[data-landing-root]") ?? document.documentElement;
  const family = getComputedStyle(root).getPropertyValue("--l-serif").trim();
  if (!family) return Promise.resolve();
  return Promise.all([document.fonts.load(`400 20px ${family}`), document.fonts.load(`italic 400 20px ${family}`)]).catch(() => undefined);
}

const requested = new Map<FontSet, Promise<unknown>>();

/** Registers and fetches a skin's faces; resolves once they can render (or failed). */
export function loadFonts(sets: readonly FontSet[]): Promise<unknown> {
  if (typeof document === "undefined") return Promise.resolve();
  return Promise.all(
    sets.map((set) => {
      const hit = requested.get(set);
      if (hit) return hit;
      if (set === "serif") {
        const serif = loadPageSerif();
        requested.set(set, serif);
        return serif;
      }
      const loads = FACES[set].map(([family, file, weight]) => {
        const face = new FontFace(family, `url(${FONT_DIR}${file}.woff2) format("woff2")`, { weight, display: "block" });
        document.fonts.add(face);
        return face.load().catch(() => undefined);
      });
      const all = Promise.all(loads);
      requested.set(set, all);
      return all;
    }),
  );
}

export const F = {
  dela: '"RK Dela Gothic", "Hiragino Sans", sans-serif',
  comic: '"RK Comic", "Comic Sans MS", sans-serif',
  comicI: '"RK Comic Italic", "RK Comic", sans-serif',
  press: '"RK Press Start", monospace',
  bangers: '"RK Bangers", Impact, sans-serif',
  kid: '"RK Schoolbell", "Comic Sans MS", cursive',
  barlow: '"RK Barlow", "Arial Narrow", sans-serif',
  barlowI: '"RK Barlow Italic", "RK Barlow", sans-serif',
  manrope: '"RK Manrope", system-ui, sans-serif',
  pixel: "var(--l-pixel), monospace",
  doto: "var(--l-doto), monospace",
  mona: "var(--l-sans), system-ui, sans-serif",
  mono: "var(--l-mono), ui-monospace, monospace",
};

/** Deterministic hash -> [0,1). */
export function hash(n: number, seed = 0): number {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(seed + 0x27d4eb2f, 0xc2b2ae35);
  x ^= x >>> 15;
  x = Math.imul(x, 0x2c1b3c6d);
  x ^= x >>> 12;
  x = Math.imul(x, 0x297a2d39);
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** The mascot's star silhouette as an SVG path in a 0..2C box, its centre C, and the face metrics. */
export const STAR = {
  C: STAR_C,
  path: SHAPES.star.path,
  ring: SHAPES.star.ring,
  face: SHAPES.star.face,
};

/** Eye outline as a path centred at cx,cy with half-sizes ew, eh. */
export function eyePath(cx: number, cy: number, ew: number, eh: number, pose: keyof typeof EYE_POSES = "neutral") {
  const pts = EYE_POSES[pose];
  return "M" + pts.map(([x, y]) => `${(cx + x * ew).toFixed(2)} ${(cy + y * eh).toFixed(2)}`).join("L") + "Z";
}

/** Eye centres of the star mascot in the 0..2C box. */
export function starEyes() {
  const f = STAR.face;
  const sx = STAR.C + f.dx;
  const sy = STAR.C + f.dy - f.ry * 0.05;
  const half = f.rx * 0.42;
  return { l: [sx - half, sy] as [number, number], r: [sx + half, sy] as [number, number], ew: f.rx * 0.78, eh: f.ry * 0.62 };
}

/**
 * Breaks text into `n` lines whose widths follow an oval (short / long / short),
 * the way a letterer fills a speech balloon. Widths approximated by char count.
 */
export function ovalLines(text: string, n: number): string[] {
  const words = text.split(/\s+/);
  if (n <= 1 || words.length < n) return [text];
  const len = (a: number, b: number) => words.slice(a, b).join(" ").length;
  const total = text.length;
  const prof = Array.from({ length: n }, (_, i) => {
    const y = (i + 0.5) / n - 0.5;
    return Math.sqrt(Math.max(0.05, 1 - (2 * y) ** 2 * 0.75));
  });
  const ps = prof.reduce((s, v) => s + v, 0);
  const target = prof.map((p) => (p / ps) * total);
  let best: number[] = [];
  let bestCost = Infinity;
  const rec = (start: number, line: number, cuts: number[]) => {
    if (line === n - 1) {
      const all = [...cuts, words.length];
      let cost = 0;
      for (let i = 0; i < all.length; i++) {
        const a = i === 0 ? 0 : all[i - 1];
        cost += (len(a, all[i]) - target[i]) ** 2;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = all;
      }
      return;
    }
    for (let c = start + 1; c <= words.length - (n - 1 - line); c++) rec(c, line + 1, [...cuts, c]);
  };
  rec(0, 0, []);
  const out: string[] = [];
  let a = 0;
  for (const b of best) {
    out.push(words.slice(a, b).join(" "));
    a = b;
  }
  return out;
}
