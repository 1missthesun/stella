import { derive, hex, mixOklch, type Tokens, useTokens } from "../../theme";
import type { KitFrame, KitLoop } from "../pending-props";
import { MOTIFS, type MotifLayer } from "./motifs.gen";

export type EmptyStateMotif = keyof typeof MOTIFS;

const DEG = Math.PI / 180;

type Paint = { fill?: string; stroke?: string; strokeWidth?: number; dash?: string };

/** The `.empty-state .es-*` rules of desktop-ui's empty-state.css, resolved for one theme. */
function classPaint(t: Tokens): Record<string, Paint> {
  const c = t.c;
  const weak = (pct: number) => mixOklch(c.textWeak, pct, "transparent");
  return {
    "es-card": { fill: c.card, stroke: c.border, strokeWidth: 1.25 },
    "es-card--ghost": { fill: mixOklch(c.card, 45, "transparent"), stroke: weak(45), dash: "4 3.5" },
    "es-card--inset": { fill: mixOklch(c.foreground, 7, c.card) },
    "es-card--rim": { fill: mixOklch(c.foreground, 4, c.card) },
    "es-line": { fill: weak(32) },
    "es-line--soft": { fill: weak(18) },
    "es-lens": { fill: mixOklch(c.card, 72, "transparent"), stroke: weak(55), strokeWidth: 3 },
    "es-ring": { stroke: c.border, strokeWidth: 1.25 },
    "es-tick": { fill: weak(32) },
    "es-tick--major": { fill: weak(55) },
  };
}

function svgColor(attr: "fill" | "stroke", css: string): string {
  const h = hex(css);
  if (h.length === 9) return `${attr}="${h.slice(0, 7)}" ${attr}-opacity="${+(parseInt(h.slice(7), 16) / 255).toFixed(3)}"`;
  return `${attr}="${h}"`;
}

function resolveClasses(body: string, paints: Record<string, Paint>): string {
  return body.replace(/<(\w+)([^>]*?) class="([^"]+)"([^>]*?)(\/?)>/g, (_m, tag: string, before: string, cls: string, after: string, close: string) => {
    const p: Paint = Object.assign({}, ...cls.split(/\s+/).map((k) => paints[k] ?? {}));
    let attrs = `${before}${after}`;
    const out: string[] = [];
    if (p.fill) {
      attrs = attrs.replace(/\sfill="[^"]*"/, "");
      out.push(svgColor("fill", p.fill));
    }
    if (p.stroke) {
      attrs = attrs.replace(/\sstroke="[^"]*"/, "");
      out.push(svgColor("stroke", p.stroke));
    }
    if (p.strokeWidth) out.push(`stroke-width="${p.strokeWidth}"`);
    if (p.dash) out.push(`stroke-dasharray="${p.dash}"`);
    return `<${tag}${attrs} ${out.join(" ")}${close}>`;
  });
}

/** A layer's body in a square view (the engine's icons are square), centred like the CSS box. */
function squareBody(l: MotifLayer, body: string) {
  const view = Math.max(l.vw, l.vh);
  const dx = (view - l.vw) / 2;
  const dy = (view - l.vh) / 2;
  return { view, body: dx || dy ? `<g transform="translate(${+dx.toFixed(3)} ${+dy.toFixed(3)})">${body}</g>` : body };
}

const wave = (t: number) => (1 - Math.cos(2 * Math.PI * t)) / 2;
const SAMPLES = 24;

function sampled(period: number, delay: number, frame: (p: number) => Omit<KitFrame, "at">): KitFrame[] {
  const phase = (((-delay / period) % 1) + 1) % 1;
  return Array.from({ length: SAMPLES + 1 }, (_, i) => ({ at: i / SAMPLES, ...frame(wave(i / SAMPLES + phase)) }));
}

function spin(period: number, dir: 1 | -1): KitLoop {
  return { kind: "sequence", period, frames: [0, 0.25, 0.5, 0.75, 1].map((at) => ({ at, rotate: dir * at * 2 * Math.PI })) };
}

/** desktop-ui's motif keyframes (es-float, es-sweep, es-spin, the orbit's counter-spin) for one layer of `px` points. */
function layerLoop(l: MotifLayer, px: { w: number; h: number }): KitLoop | undefined {
  const m = l.motion.split(/\s+/);
  if (m.includes("es-float")) {
    const period = m.includes("es-float--row") ? 8 : m.includes("es-float--badge") ? 5 : 7;
    return { kind: "sequence", period, frames: sampled(period, l.delay, (p) => ({ y: -3 * p, rotate: 1.5 * DEG * p })) };
  }
  if (m.includes("es-sweep")) return { kind: "sequence", period: 7, frames: sampled(7, 0, (p) => ({ x: px.w * (-0.04 + 0.08 * p), y: -px.h * 0.02 * p })) };
  if (m.includes("es-spin")) return spin(24, 1);
  if (m.includes("es-tile")) return spin(90, -1);
  return undefined;
}

function Layer({ id, layer, art, paints, live, name }: { id: string; layer: MotifLayer; art: number; paints: Record<string, Paint>; live: boolean; name: string }) {
  const w = (layer.w / 100) * art;
  const h = (layer.h / 100) * art;
  const side = Math.max(w, h);
  const sq = squareBody(layer, resolveClasses(layer.body, paints));
  return (
    <box
      id={id}
      absolute={{ left: (layer.x / 100) * art - (side - w) / 2, top: (layer.y / 100) * art - (side - h) / 2 }}
      w={side}
      h={side}
      rotate={layer.rotate * DEG}
      loop={live ? layerLoop(layer, { w, h }) : undefined}
    >
      <icon svg={sq.body} name={name} view={sq.view} size={side} />
    </box>
  );
}

/** desktop-ui's `EmptyStateMotifArt`: the motif's cards and badges around (back) or over (front) the mark, in the theme's colours. */
export function MotifArt({ id, motif, layer, art, live }: { id: string; motif: EmptyStateMotif; layer: "back" | "front"; art: number; live: boolean }) {
  const t = useTokens();
  const paints = derive(t, "es-paint", classPaint);
  const layers: readonly MotifLayer[] = MOTIFS[motif][layer];
  if (layers.length === 0) return null;
  const key = `${t.themeId}:${t.dark ? "d" : "l"}`;
  const plain = layers.map((l, i) => ({ l, i })).filter(({ l }) => !l.orbit);
  const orbit = layers.map((l, i) => ({ l, i })).filter(({ l }) => l.orbit);
  const draw = ({ l, i }: { l: MotifLayer; i: number }) => <Layer key={i} id={`${id}-${i}`} layer={l} art={art} paints={paints} live={live} name={`motif/${motif}/${layer}/${i}/${key}`} />;
  const orbitGroup = orbit.length ? (
    <box id={`${id}-orbit`} absolute={{ left: 0, top: 0 }} w={art} h={art} loop={live ? spin(90, 1) : undefined}>
      {orbit.map(draw)}
    </box>
  ) : null;
  const orbitFirst = orbit.length > 0 && (plain.length === 0 || orbit[0].i < plain[0].i);
  return (
    <box id={id} absolute={{ left: 0, top: 0 }} w={art} h={art} inert>
      {orbitFirst ? orbitGroup : null}
      {plain.map(draw)}
      {orbitFirst ? null : orbitGroup}
    </box>
  );
}
