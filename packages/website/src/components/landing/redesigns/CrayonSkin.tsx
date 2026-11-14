import React from "react";
import { CHAT, type SkinProps } from "./content";
import { F, STAR, hash, ovalLines } from "./kit";

/**
 * A parent made Stella look like their six-year-old drew it: wax crayon on blue
 * construction paper, taped up. Wobbly boxes that don't quite close, bubbles coloured in
 * with scribbles that run over the lines, Stella as a purple star with rosy cheeks,
 * you as a waving stick figure, a sun in the corner. The lines "boil" at 8 fps,
 * the way hand-drawn animation does.
 */

const PAPER = "#86bde6";
const WAX = {
  dark: "#2a1f3d",
  purple: "#7a4fd0",
  purpleDk: "#4d2f9a",
  yellow: "#ffd23a",
  orange: "#ff8c2a",
  red: "#e8413a",
  green: "#3fae4a",
  white: "#fbfaf4",
  pink: "#ff8fb8",
  brown: "#8a5a3a",
};

type P = [number, number];
const jit = (i: number, seed: number, a: number) => (hash(i, seed) - 0.5) * 2 * a;

function smoothPath(pts: P[]) {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2,
      my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += `Q${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const l = pts[pts.length - 1];
  return d + `L${l[0].toFixed(1)} ${l[1].toFixed(1)}`;
}

/** A rounded box drawn in one go: it wobbles, overshoots where it should close. */
function wobblyBox(x: number, y: number, w: number, h: number, r: number, seed: number) {
  const pts: P[] = [];
  const per = 2 * (w + h);
  const n = Math.max(16, Math.round(per / 26));
  const at = (u: number): P => {
    let s = (u % 1) * per;
    const corner = (cx: number, cy: number, a0: number, k: number): P => [cx + Math.cos(a0 + k * (Math.PI / 2)) * r, cy + Math.sin(a0 + k * (Math.PI / 2)) * r];
    // walk the straight parts and round the corners loosely
    if (s < w) return s < r ? corner(x + r, y + r, Math.PI, 0.5 + (s / r) * 0.5) : s > w - r ? corner(x + w - r, y + r, -Math.PI / 2, ((s - (w - r)) / r) * 0.5) : [x + s, y];
    s -= w;
    if (s < h) return s < r ? corner(x + w - r, y + r, -Math.PI / 2, 0.5 + (s / r) * 0.5) : s > h - r ? corner(x + w - r, y + h - r, 0, ((s - (h - r)) / r) * 0.5) : [x + w, y + s];
    s -= h;
    if (s < w) return s < r ? corner(x + w - r, y + h - r, 0, 0.5 + (s / r) * 0.5) : s > w - r ? corner(x + r, y + h - r, Math.PI / 2, ((s - (w - r)) / r) * 0.5) : [x + w - s, y + h];
    s -= w;
    return s < r ? corner(x + r, y + h - r, Math.PI / 2, 0.5 + (s / r) * 0.5) : s > h - r ? corner(x + r, y + r, Math.PI, ((s - (h - r)) / r) * 0.5) : [x, y + h - s];
  };
  const start = 0.04 + hash(seed, 1) * 0.1;
  for (let i = 0; i <= n + 2; i++) {
    const u = start + i / n;
    const [px, py] = at(u);
    const drift = i > n - 1 ? (i - n + 1) * 5 : 0; // the overshoot drifts off the line
    pts.push([px + jit(i, seed, 3.2), py + jit(i, seed + 7, 3.2) + drift]);
  }
  return smoothPath(pts);
}

/** Back-and-forth colouring-in, a bit past the edges. */
function scribble(x: number, y: number, w: number, h: number, seed: number, step = 11) {
  const pts: P[] = [];
  const n = Math.ceil((w + h * 0.5) / step);
  for (let i = 0; i <= n; i++) {
    const top = i % 2 === 0;
    const px = x - h * 0.25 + i * step + jit(i, seed, 3);
    pts.push([px + (top ? h * 0.5 : 0), top ? y - 4 + jit(i, seed + 1, 4) : y + h + 4 + jit(i, seed + 2, 4)]);
  }
  return "M" + pts.map(([a, b]) => `${Math.min(x + w + 6, Math.max(x - 6, a)).toFixed(1)} ${b.toFixed(1)}`).join("L");
}

function wobblyCircle(cx: number, cy: number, r: number, seed: number, over = 0.12) {
  const pts: P[] = [];
  const n = 18;
  const a0 = hash(seed, 3) * Math.PI * 2;
  for (let i = 0; i <= n * (1 + over); i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    const rr = r * (1 + jit(i, seed, 0.06)) + (i > n ? (i - n) * 1.5 : 0);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return smoothPath(pts);
}

const Wax: React.FC<{ d: string; c: string; w?: number; o?: number }> = ({ d, c, w = 5, o = 1 }) => <path d={d} stroke={c} strokeWidth={w} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={o} />;

/** Kid-drawn Stella: a lumpy six-point star, coloured in, two eyes, rosy cheeks, shine lines. */
const KidStar: React.FC<{ cx: number; cy: number; s: number; seed: number; t: number }> = ({ cx, cy, s, seed, t }) => {
  const C = STAR.C;
  const ring = STAR.ring;
  const k = s / (2 * C);
  const pts: P[] = [];
  for (let i = 0; i < ring.length; i += 2) pts.push([cx + (ring[i][0] - C) * k + jit(i, seed, 3), cy + (ring[i][1] - C) * k + jit(i, seed + 3, 3)]);
  pts.push(pts[0], pts[1]);
  const outline = smoothPath(pts);
  const bob = Math.sin(Math.floor(t * 8) / 8 * 2.4) * 5;
  const cid = `cr-star-${Math.round(cx)}-${Math.round(cy)}`;
  return (
    <g transform={`translate(0 ${bob})`}>
      <clipPath id={cid}>
        <path d={outline} stroke="#000" strokeWidth={14} />
      </clipPath>
      <g clipPath={`url(#${cid})`}>
        <Wax d={scribble(cx - s * 0.5, cy - s * 0.5, s, s, seed + 11, s / 30)} c={WAX.purple} w={Math.max(4, s / 30)} o={0.95} />
        <Wax d={scribble(cx - s * 0.5, cy - s * 0.5, s, s, seed + 12, s / 22)} c="#9a72ea" w={Math.max(3, s / 40)} o={0.7} />
      </g>
      <Wax d={outline} c={WAX.purpleDk} w={7} />
      {/* eyes: two tall dots, pressed hard */}
      {[-1, 1].map((sd) => (
        <ellipse key={sd} cx={cx + sd * s * 0.11 + jit(sd + 2, seed, 1)} cy={cy - s * 0.02} rx={s * 0.035} ry={s * 0.065} fill={WAX.dark} />
      ))}
      {[-1, 1].map((sd) => (
        <Wax key={`c${sd}`} d={wobblyCircle(cx + sd * s * 0.2, cy + s * 0.1, s * 0.04, seed + sd + 30, 0.6)} c={WAX.pink} w={7} />
      ))}
      <Wax d={smoothPath([[cx - s * 0.07, cy + s * 0.1], [cx, cy + s * 0.15 + jit(1, seed, 1)], [cx + s * 0.07, cy + s * 0.1]])} c={WAX.dark} w={4} />
      {/* shine lines */}
      {[
        [-0.62, -0.42, -0.74, -0.52],
        [-0.66, -0.2, -0.82, -0.2],
        [0.6, -0.5, 0.72, -0.62],
        [0.66, 0.36, 0.8, 0.42],
      ].map(([a, b, c2, d2], i) => (
        <Wax key={`s${i}`} d={`M${cx + a * s} ${cy + b * s}L${cx + c2 * s + jit(i, seed + 40, 2)} ${cy + d2 * s + jit(i, seed + 41, 2)}`} c={WAX.yellow} w={6} />
      ))}
    </g>
  );
};

const StickFigure: React.FC<{ x: number; y: number; s: number; seed: number; t: number }> = ({ x, y, s, seed, t }) => {
  const wave = Math.sin(Math.floor(t * 8) / 8 * 5) * 0.12;
  const hx = x,
    hy = y;
  const r = s * 0.13;
  const neck: P = [hx, hy + r];
  const hip: P = [hx + jit(1, seed, 3), hy + s * 0.55];
  const ang = -2.2 + wave;
  return (
    <g>
      <Wax d={scribble(hx - r, hy - r * 1.15, r * 2, r * 0.7, seed + 5, 8)} c={WAX.brown} w={7} />
      <Wax d={wobblyCircle(hx, hy, r, seed)} c={WAX.dark} w={5} />
      {[-1, 1].map((sd) => (
        <circle key={sd} cx={hx + sd * r * 0.38} cy={hy - r * 0.05} r={3.2} fill={WAX.dark} />
      ))}
      <Wax d={smoothPath([[hx - r * 0.45, hy + r * 0.32], [hx, hy + r * 0.62], [hx + r * 0.45, hy + r * 0.32]])} c={WAX.red} w={4} />
      {/* triangle dress / shirt scribbled in */}
      <Wax d={scribble(hx - s * 0.13, hy + r + 6, s * 0.26, s * 0.3, seed + 9, 9)} c={WAX.green} w={8} o={0.9} />
      <Wax d={smoothPath([neck, [neck[0] + jit(2, seed, 2), neck[1] + s * 0.2], hip])} c={WAX.dark} w={5} />
      <Wax d={smoothPath([[neck[0], neck[1] + s * 0.1], [neck[0] + Math.cos(ang) * s * 0.18, neck[1] + s * 0.1 + Math.sin(ang) * s * 0.18], [neck[0] + Math.cos(ang - 0.3) * s * 0.34, neck[1] + s * 0.1 + Math.sin(ang - 0.3) * s * 0.34]])} c={WAX.dark} w={5} />
      <Wax d={`M${neck[0]} ${neck[1] + s * 0.1}L${neck[0] + s * 0.24} ${neck[1] + s * 0.28}`} c={WAX.dark} w={5} />
      <Wax d={`M${hip[0]} ${hip[1]}L${hip[0] - s * 0.12} ${hip[1] + s * 0.34}M${hip[0]} ${hip[1]}L${hip[0] + s * 0.13} ${hip[1] + s * 0.33}`} c={WAX.dark} w={5} />
    </g>
  );
};

const Sun: React.FC<{ cx: number; cy: number; r: number; seed: number }> = ({ cx, cy, r, seed }) => (
  <g>
    <Wax d={scribble(cx - r * 0.8, cy - r * 0.8, r * 1.6, r * 1.6, seed, 9)} c={WAX.yellow} w={9} />
    <Wax d={wobblyCircle(cx, cy, r, seed)} c={WAX.orange} w={6} />
    {Array.from({ length: 10 }, (_, i) => {
      const a = (i / 10) * Math.PI * 2 + 0.2;
      return <Wax key={i} d={`M${cx + Math.cos(a) * r * 1.3} ${cy + Math.sin(a) * r * 1.3}L${cx + Math.cos(a) * r * (1.8 + jit(i, seed, 0.2))} ${cy + Math.sin(a) * r * (1.8 + jit(i, seed, 0.2))}`} c={WAX.orange} w={6} />;
    })}
  </g>
);

export const CrayonSkin: React.FC<SkinProps> = ({ t, w, h }) => {
  const tall = h > w;
  const boil = Math.floor(t * 8) % 3;
  const sd = (n: number) => n + boil * 101; // hand-redrawn every 1/8 s
  const fs = tall ? 36 : 31;
  const lh = fs * 1.12;
  const colX = tall ? 45 : 350;
  const colW = tall ? w - 90 : 780;
  const barH = 92;
  const comp = { x: colX, y: h - (tall ? 140 : 120), w: colW, h: 82 };

  // bubbles bottom-up
  const msgs: [boolean, string, number][] = [
    [true, CHAT.me1, 2],
    [false, CHAT.her1, 2],
    [true, CHAT.me2, 1],
    [false, CHAT.her2, 1],
  ];
  const cw = fs * 0.46;
  let y = comp.y - 40;
  const bubbles: { me: boolean; lines: string[]; x: number; y: number; bw: number; bh: number }[] = [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const [me, text, n] = msgs[i];
    const lines = tall ? ovalLines(text, Math.ceil((text.length * cw) / (colW - 120))) : ovalLines(text, n);
    const tw = Math.max(...lines.map((s) => s.length)) * cw;
    const bw = Math.min(colW, tw + 64);
    const bh = lines.length * lh + 36;
    y -= bh;
    bubbles.unshift({ me, lines, x: me ? colX + colW - bw : colX, y, bw, bh });
    y -= tall ? 26 : 20;
  }
  const stampY = y - 30;

  const star = tall ? { cx: 190, cy: 300, s: 280 } : { cx: 190, cy: 430, s: 300 };
  const person = tall ? { x: w - 170, y: 250, s: 300 } : { x: w - 175, y: 380, s: 320 };
  const caret = Math.floor(t * 2.4) % 2 === 0;

  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, overflow: "hidden", background: PAPER }}>
      <svg width={w} height={h} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id="cr-paper" x={0} y={0} width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves={3} seed={4} result="m" />
            <feColorMatrix in="m" values="0 0 0 0 0.2  0 0 0 0 0.35  0 0 0 0 0.5  0 0 0 0.35 -0.08" />
          </filter>
          <filter id="cr-fiber" x={0} y={0} width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.7 0.12" numOctaves={2} seed={12} />
            <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1.6 -1.05" />
          </filter>
          {/* wax: wobble the line (re-seeded on 8s), then let the paper's tooth show through */}
          <filter id="cr-wax" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves={2} seed={boil + 1} result="wob" />
            <feDisplacementMap in="SourceGraphic" in2="wob" scale={4} xChannelSelector="R" yChannelSelector="G" result="d" />
            <feTurbulence type="fractalNoise" baseFrequency="0.85 0.45" numOctaves={2} seed={3} result="grain" />
            <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -2.2 0 0 0 1.95" result="mask" />
            <feComposite in="d" in2="mask" operator="in" />
          </filter>
          <filter id="cr-waxText" x="-2%" y="-10%" width="104%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9 0.5" numOctaves={2} seed={3} result="grain" />
            <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -1.8 0 0 0 1.85" result="mask" />
            <feComposite in="SourceGraphic" in2="mask" operator="in" />
          </filter>
        </defs>
        <rect width={w} height={h} filter="url(#cr-paper)" />
        <rect width={w} height={h} filter="url(#cr-fiber)" opacity={0.18} />

        <g filter="url(#cr-wax)">
          {/* top bar: three dots, the name, account */}
          {[WAX.red, WAX.yellow, WAX.green].map((c, i) => (
            <g key={i}>
              <Wax d={scribble(30 + i * 40, 30, 22, 22, sd(60 + i), 6)} c={c} w={7} />
              <Wax d={wobblyCircle(41 + i * 40, 41, 13, sd(70 + i))} c={WAX.dark} w={3.5} />
            </g>
          ))}
          <Wax d={smoothPath([[24, barH - 6], [w * 0.3, barH - 2 + jit(1, sd(80), 3)], [w * 0.6, barH - 8], [w - 24, barH - 3]])} c={WAX.white} w={5} o={0.9} />

          {!tall ? <Sun cx={w - 200} cy={170} r={34} seed={sd(90)} /> : <Sun cx={w / 2} cy={190} r={36} seed={sd(90)} />}

          {/* the two of you */}
          <KidStar cx={star.cx} cy={star.cy} s={star.s} seed={sd(100)} t={t} />
          <StickFigure x={person.x} y={person.y} s={person.s} seed={sd(120)} t={t} />
          {/* grass */}
          {Array.from({ length: Math.floor(w / 14) }, (_, i) => {
            const gx = i * 14 + jit(i, 5, 3);
            const gh = 14 + hash(i, 6) * 16;
            return <Wax key={i} d={`M${gx} ${h + 4}L${gx + 5 + jit(i, sd(7), 3)} ${h - gh}`} c={WAX.green} w={5} />;
          })}

          {/* bubbles */}
          {bubbles.map((b, i) => (
            <g key={i}>
              <clipPath id={`cr-bc${i}`}>
                <rect x={b.x - 3} y={b.y - 3} width={b.bw + 6} height={b.bh + 6} rx={30} />
              </clipPath>
              <g clipPath={`url(#cr-bc${i})`}>
                <Wax d={scribble(b.x, b.y, b.bw, b.bh, sd(200 + i), 11)} c={b.me ? WAX.yellow : WAX.white} w={12} o={0.85} />
              </g>
              <Wax d={wobblyBox(b.x, b.y, b.bw, b.bh, 26, sd(210 + i))} c={b.me ? WAX.orange : WAX.purpleDk} w={5} />
              {/* a pointy tail toward the speaker */}
              <Wax
                d={b.me ? `M${b.x + b.bw - 50} ${b.y + b.bh - 2}L${b.x + b.bw - 8 + jit(i, sd(220), 3)} ${b.y + b.bh + 24}L${b.x + b.bw - 26} ${b.y + b.bh - 4}` : `M${b.x + 50} ${b.y + b.bh - 2}L${b.x + 6 + jit(i, sd(221), 3)} ${b.y + b.bh + 24}L${b.x + 26} ${b.y + b.bh - 4}`}
                c={b.me ? WAX.orange : WAX.purpleDk}
                w={5}
              />
            </g>
          ))}

          {/* composer */}
          <clipPath id="cr-cc">
            <rect x={comp.x - 3} y={comp.y - 3} width={comp.w + 6} height={comp.h + 6} rx={40} />
          </clipPath>
          <g clipPath="url(#cr-cc)">
            <Wax d={scribble(comp.x, comp.y, comp.w, comp.h, sd(300), 14)} c={WAX.white} w={10} o={0.6} />
          </g>
          <Wax d={wobblyBox(comp.x, comp.y, comp.w, comp.h, 36, sd(301))} c={WAX.dark} w={5} />
          <Wax d={wobblyCircle(comp.x + 42, comp.y + comp.h / 2, 20, sd(302))} c={WAX.dark} w={4} />
          <Wax d={`M${comp.x + 32} ${comp.y + comp.h / 2}H${comp.x + 52}M${comp.x + 42} ${comp.y + comp.h / 2 - 10}V${comp.y + comp.h / 2 + 10}`} c={WAX.dark} w={4} />
          {/* mic doodle */}
          <Wax d={wobblyBox(comp.x + comp.w - 112, comp.y + 20, 16, 28, 8, sd(303))} c={WAX.dark} w={4} />
          <Wax d={`M${comp.x + comp.w - 120} ${comp.y + 40}Q${comp.x + comp.w - 104} ${comp.y + 66} ${comp.x + comp.w - 88} ${comp.y + 40}M${comp.x + comp.w - 104} ${comp.y + 56}V${comp.y + 66}`} c={WAX.dark} w={4} />
          {/* send: a red arrow in a red circle, coloured in */}
          <Wax d={scribble(comp.x + comp.w - 64, comp.y + 18, 46, 46, sd(304), 7)} c={WAX.red} w={8} />
          <Wax d={wobblyCircle(comp.x + comp.w - 41, comp.y + comp.h / 2, 25, sd(305))} c={WAX.red} w={4} />
          <Wax d={`M${comp.x + comp.w - 41} ${comp.y + comp.h / 2 + 14}V${comp.y + comp.h / 2 - 14}M${comp.x + comp.w - 52} ${comp.y + comp.h / 2 - 3}L${comp.x + comp.w - 41} ${comp.y + comp.h / 2 - 15}L${comp.x + comp.w - 30} ${comp.y + comp.h / 2 - 3}`} c={WAX.white} w={5} />
          {/* tape */}
        </g>

        {/* lettering in crayon */}
        <g filter="url(#cr-waxText)" style={{ fontFamily: F.kid, paintOrder: "stroke" }} strokeWidth={1.6} strokeLinejoin="round">
          <text x={w / 2 + 26} y={60} textAnchor="middle" fontSize={44} fill={WAX.white} stroke={WAX.white} style={{ letterSpacing: 2 }}>
            Stella
          </text>
          <text x={w - 34} y={56} textAnchor="end" fontSize={28} fill={WAX.dark} stroke={WAX.dark}>
            Account
          </text>
          <text x={colX + colW / 2} y={stampY + 6} textAnchor="middle" fontSize={26} fill={WAX.white} stroke={WAX.white}>
            {CHAT.stamp}
          </text>
          {bubbles.map((b, i) =>
            b.lines.map((ln, k) => (
              <text key={`${i}-${k}`} x={b.x + b.bw / 2} y={b.y + 18 + fs * 0.92 + k * lh} textAnchor="middle" fontSize={fs} fill={WAX.dark} stroke={WAX.dark}>
                {ln}
              </text>
            )),
          )}
          <text x={comp.x + 82} y={comp.y + comp.h / 2 + 10} fontSize={fs} fill="#5d6a86">
            {CHAT.placeholder}...{caret ? "|" : ""}
          </text>
        </g>
        {/* tiny star next to the name */}
        <g filter="url(#cr-wax)">
          <KidStar cx={w / 2 - 74} cy={44} s={46} seed={sd(400)} t={0} />
        </g>
      </svg>
      {/* tape holding the drawing up */}
      {[
        [w * 0.18, -10, -8],
        [w * 0.8, -12, 7],
      ].map(([x, yy, a], i) => (
        <div key={i} style={{ position: "absolute", left: x - 60, top: yy, width: 120, height: 34, transform: `rotate(${a}deg)`, background: "rgba(255,255,240,.42)", boxShadow: "0 1px 2px rgba(0,0,0,.08)", clipPath: "polygon(0 8%, 4% 0, 8% 10%, 12% 0, 100% 4%, 96% 14%, 100% 30%, 97% 52%, 100% 74%, 96% 90%, 100% 100%, 0 96%, 4% 80%, 0 60%, 3% 40%, 0 22%)" }} />
      ))}
    </div>
  );
};
