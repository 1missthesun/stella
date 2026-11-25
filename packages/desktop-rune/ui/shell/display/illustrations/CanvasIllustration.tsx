import type { Loop } from "../../../../host/rune-jsx/props";

const W = 160;
const H = 120;
const K = W / 400;

const svg = (body: string, defs = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300"><defs>${defs}</defs>${body}</svg>`;

const SHADOW_SM = `<filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.1"/></filter>`;
const SHADOW_MD = `<filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="2" dy="4" stdDeviation="4" flood-opacity="0.15"/></filter>`;

const FLOAT_1 = svg(`<circle cx="70" cy="90" r="10" fill="#e2e8f0"/><rect x="310" y="200" width="16" height="16" rx="4" fill="#e2e8f0" transform="rotate(25 318 208)"/>`);
const FLOAT_2 = svg(`<polygon points="330,70 315,95 345,95" fill="#f1f5f9" transform="rotate(-15 330 85)"/><circle cx="90" cy="230" r="8" fill="#f1f5f9"/>`);
const WINDOW = svg(
  `<g filter="url(#s)"><rect x="80" y="60" width="240" height="160" rx="12" fill="#ffffff"/><path d="M 80 72 C 80 65.373 85.373 60 92 60 L 308 60 C 314.627 60 320 65.373 320 72 L 320 90 L 80 90 Z" fill="#f1f5f9"/><circle cx="100" cy="75" r="4" fill="#f43f5e"/><circle cx="115" cy="75" r="4" fill="#fbbf24"/><circle cx="130" cy="75" r="4" fill="#10b981"/><rect x="80" y="90" width="60" height="130" fill="#f8fafc"/><rect x="90" y="105" width="40" height="6" rx="3" fill="#e2e8f0"/><rect x="90" y="120" width="30" height="6" rx="3" fill="#e2e8f0"/><rect x="160" y="110" width="140" height="90" rx="8" fill="#f1f5f9" stroke="#e2e8f0" stroke-width="2" stroke-dasharray="4 4"/></g>`,
  SHADOW_MD,
);
const BLOCK = svg(`<g filter="url(#s)"><rect x="170" y="120" width="120" height="70" rx="6" fill="#c084fc"/><rect x="185" y="140" width="90" height="8" rx="4" fill="#ffffff" opacity="0.9"/><rect x="185" y="160" width="60" height="8" rx="4" fill="#ffffff" opacity="0.9"/></g>`, SHADOW_SM);
const SPARKLE = svg(`<path d="M220 110 C 220 125, 205 130, 205 130 C 205 130, 220 135, 220 150 C 220 135, 235 130, 235 130 C 235 130, 220 125, 220 110 Z" fill="#fbbf24"/>`);
const CURSOR = svg(`<g filter="url(#s)"><path d="M0,0 L0,24 L6,18 L11,29 L14,27 L9,16 L18,16 Z" fill="#0f172a" stroke="#ffffff" stroke-width="2" stroke-linejoin="round"/></g>`, SHADOW_MD);

const bob = (period: number, dy: number): Loop => ({ kind: "sequence", period, frames: [{ at: 0, y: 0 }, { at: 0.5, y: dy * K }, { at: 1, y: 0 }] });

const BLOCK_LOOP: Loop = {
  kind: "sequence",
  period: 6,
  origin: [0.5, 0.5],
  frames: [
    { at: 0, scale: 0, opacity: 0 },
    { at: 0.4, scale: 0, opacity: 0 },
    { at: 0.45, scale: 1, opacity: 1 },
    { at: 0.85, scale: 1, opacity: 1 },
    { at: 0.9, scale: 0, opacity: 0 },
    { at: 1, scale: 0, opacity: 0 },
  ],
};

const SPARKLE_LOOP: Loop = {
  kind: "sequence",
  period: 6,
  origin: [220 / 400, 130 / 300],
  frames: [
    { at: 0, scale: 0, rotate: 0, opacity: 0 },
    { at: 0.4, scale: 0, rotate: 0, opacity: 0 },
    { at: 0.45, scale: 1.2, rotate: 90, opacity: 1 },
    { at: 0.5, scale: 1, rotate: 180, opacity: 1 },
    { at: 0.8, scale: 1, rotate: 180, opacity: 1 },
    { at: 0.85, scale: 0, rotate: 270, opacity: 0 },
    { at: 1, scale: 0, rotate: 270, opacity: 0 },
  ],
};

const at = (x: number, y: number) => ({ x: x * K, y: y * K });
const CURSOR_LOOP: Loop = {
  kind: "sequence",
  period: 6,
  frames: [
    { at: 0, ...at(250, 250), opacity: 0 },
    { at: 0.15, ...at(250, 250), opacity: 0 },
    { at: 0.25, ...at(200, 150), opacity: 1 },
    { at: 0.35, ...at(200, 150), opacity: 1 },
    { at: 0.45, ...at(160, 120), opacity: 1 },
    { at: 0.65, ...at(160, 120), opacity: 1 },
    { at: 0.75, ...at(200, 150), opacity: 1 },
    { at: 0.85, ...at(200, 150), opacity: 1 },
    { at: 1, ...at(250, 250), opacity: 0 },
  ],
};

const Layer = ({ name, body, loop }: { name: string; body: string; loop?: Loop }) => (
  <vector id={`canvas-illustration-${name}`} absolute={{ left: 0, top: 0 }} w={W} h={H} svg={body} loop={loop} inert />
);

/** desktop-ui's `CanvasIllustration`: a canvas window with a block being placed, each group on its own loop. */
export function CanvasIllustration() {
  return (
    <box w={W} h={H} shrink={false} opacity={0.9} x={-6} y={-8} inert>
      <Layer name="float-1" body={FLOAT_1} loop={bob(6, -10)} />
      <Layer name="float-2" body={FLOAT_2} loop={bob(5, 12)} />
      <Layer name="window" body={WINDOW} loop={bob(8, -6)} />
      <Layer name="block" body={BLOCK} loop={BLOCK_LOOP} />
      <Layer name="sparkle" body={SPARKLE} loop={SPARKLE_LOOP} />
      <Layer name="cursor" body={CURSOR} loop={CURSOR_LOOP} />
    </box>
  );
}
