import React from "react";
import { CHAT, type SkinProps } from "./content";
import { F, STAR } from "./kit";

/**
 * "Make it look like a 70s synthesizer."
 * The STELLA SX-1: walnut end cheeks, a brushed-aluminium front panel with silkscreened
 * legends, machined knobs, bat-handle toggles, a VU meter, and a vacuum-fluorescent
 * readout that carries the conversation (your lines in amber, Stella's in phosphor green).
 * The patch bay shows the routes Stella actually took: RECEIPTS to SHEETS, REMINDER to CALENDAR.
 * The composer is the performance strip above the keybed.
 */

const INK = "#161514";
const ALU = "#c8c7c1";
const VFD = "#8bf5d9";
const VFD_DIM = "#1f4a43";
const AMBER = "#ffb44a";
const ORANGE = "#e8642c";

const cond = (weight = 650, stretch = 75): React.CSSProperties => ({ fontFamily: F.mona, fontWeight: weight, fontStretch: `${stretch}%`, textTransform: "uppercase" });

// ------------------------------------------------------------------ materials

const Defs: React.FC<{ id: string }> = ({ id }) => (
  <defs>
    {/* walnut: stretched noise, banded into figure, mapped to oiled browns */}
    <filter id={`${id}-wood`} x={0} y={0} width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.16 0.004" numOctaves={4} seed={7} result="n" />
      <feComponentTransfer in="n" result="b">
        <feFuncR type="table" tableValues="0 0.7 0.1 0.85 0.25 1 0.2 0.75 0.05 0.9 0.3" />
      </feComponentTransfer>
      <feColorMatrix
        in="b"
        type="matrix"
        values="0.3 0 0 0 0.16   0.17 0 0 0 0.085   0.09 0 0 0 0.045   0 0 0 0 1"
      />
    </filter>
    {/* brushed aluminium: long horizontal hairlines */}
    <filter id={`${id}-brush`} x={0} y={0} width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.0015 0.75" numOctaves={2} seed={3} />
      <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.9 0 0 0 -0.32" />
    </filter>
    <filter id={`${id}-brushDark`} x={0} y={0} width="100%" height="100%" colorInterpolationFilters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.002 0.9" numOctaves={2} seed={9} />
      <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.9 0 0 0 -0.34" />
    </filter>
    {/* VFD phosphor bloom: tight, the way a lit filament bleeds through smoked glass */}
    <filter id={`${id}-bloom`} x="-5%" y="-20%" width="110%" height="140%">
      <feGaussianBlur stdDeviation="2.2" result="b" />
      <feMerge>
        <feMergeNode in="b" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
    <pattern id={`${id}-mesh`} width={4} height={4} patternUnits="userSpaceOnUse">
      <rect width={4} height={4} fill="none" />
      <rect x={0} y={0} width={4} height={1} fill="#000" opacity={0.35} />
      <rect x={0} y={0} width={1} height={4} fill="#000" opacity={0.35} />
    </pattern>
    <linearGradient id={`${id}-sheen`} x1={0} y1={0} x2={1} y2={1}>
      <stop offset={0} stopColor="#fff" stopOpacity={0.22} />
      <stop offset={0.4} stopColor="#fff" stopOpacity={0} />
      <stop offset={0.7} stopColor="#000" stopOpacity={0.05} />
      <stop offset={1} stopColor="#000" stopOpacity={0.14} />
    </linearGradient>
  </defs>
);

const Walnut: React.FC<{ id: string; x: number; y: number; w: number; h: number; side: "l" | "r" }> = ({ id, x, y, w, h, side }) => (
  <svg width={w} height={h} style={{ position: "absolute", left: x, top: y }}>
    <rect width={w} height={h} filter={`url(#${id}-wood)`} />
    {/* oiled finish: a soft vertical highlight and darker edges */}
    <rect width={w} height={h} fill={`url(#${id}-cheek-${side})`} />
    <defs>
      <linearGradient id={`${id}-cheek-${side}`} x1={0} y1={0} x2={1} y2={0}>
        <stop offset={0} stopColor="#000" stopOpacity={side === "l" ? 0.45 : 0.1} />
        <stop offset={0.35} stopColor="#ffd9a8" stopOpacity={0.12} />
        <stop offset={0.55} stopColor="#ffd9a8" stopOpacity={0.04} />
        <stop offset={1} stopColor="#000" stopOpacity={side === "l" ? 0.2 : 0.5} />
      </linearGradient>
    </defs>
    <rect x={side === "l" ? w - 2 : 0} width={2} height={h} fill="#000" opacity={0.55} />
  </svg>
);

const Screw: React.FC<{ x: number; y: number; r?: number; a?: number }> = ({ x, y, r = 6, a = 20 }) => (
  <div
    style={{
      position: "absolute",
      left: x - r,
      top: y - r,
      width: r * 2,
      height: r * 2,
      borderRadius: "50%",
      background: "radial-gradient(circle at 35% 30%, #f4f4f0 0%, #b9b8b2 45%, #7c7b76 100%)",
      boxShadow: "0 1px 1px rgba(0,0,0,.45), inset 0 -1px 1px rgba(0,0,0,.25)",
    }}
  >
    <div style={{ position: "absolute", left: r * 0.2, top: r - 1, width: r * 1.6, height: 2, background: "#55544f", transform: `rotate(${a}deg)` }} />
    <div style={{ position: "absolute", left: r * 0.2, top: r - 1, width: r * 1.6, height: 2, background: "#55544f", transform: `rotate(${a + 90}deg)` }} />
  </div>
);

// ------------------------------------------------------------------ controls

/** A machined knob: knurled black skirt with a printed index, a turned-aluminium cap, a scale 0–10. */
const Knob: React.FC<{ x: number; y: number; d: number; v: number; label: string; scale?: boolean; skirt?: string }> = ({ x, y, d, v, label, scale = true, skirt = "#1d1c1b" }) => {
  const ang = -150 + v * 300;
  const R = d / 2;
  const capR = R * 0.62;
  return (
    <div style={{ position: "absolute", left: x - R, top: y - R, width: d, height: d }}>
      {scale ? (
        <svg width={d * 1.9} height={d * 1.9} style={{ position: "absolute", left: -d * 0.45, top: -d * 0.45, overflow: "visible" }}>
          {Array.from({ length: 11 }, (_, i) => {
            const a = ((-150 + i * 30 - 90) * Math.PI) / 180;
            const cx = d * 0.95,
              cy = d * 0.95;
            const r0 = R * 1.18,
              r1 = R * (i % 5 === 0 ? 1.36 : 1.3);
            return (
              <g key={i}>
                <line x1={cx + Math.cos(a) * r0} y1={cy + Math.sin(a) * r0} x2={cx + Math.cos(a) * r1} y2={cy + Math.sin(a) * r1} stroke={INK} strokeWidth={i % 5 === 0 ? 1.8 : 1.2} />
                {i % 2 === 0 ? (
                  <text x={cx + Math.cos(a) * R * 1.58} y={cy + Math.sin(a) * R * 1.58 + 3.5} textAnchor="middle" fontSize={Math.max(9, d * 0.13)} fill={INK} style={{ ...cond(600, 75) }}>
                    {i}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      ) : null}
      {/* contact shadow */}
      <div style={{ position: "absolute", left: d * 0.06, top: d * 0.14, width: d, height: d, borderRadius: "50%", background: "rgba(0,0,0,.38)", filter: `blur(${d * 0.07}px)` }} />
      {/* skirt with knurling */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: `repeating-conic-gradient(from ${ang}deg, ${skirt} 0deg 4deg, #3a3936 4deg 6deg)`,
          boxShadow: "inset 0 2px 2px rgba(255,255,255,.18), inset 0 -3px 4px rgba(0,0,0,.6)",
        }}
      />
      <div style={{ position: "absolute", inset: R * 0.16, borderRadius: "50%", background: `radial-gradient(circle at 40% 30%, #4a4844, ${skirt} 70%)` }} />
      {/* index line on the skirt */}
      <div style={{ position: "absolute", left: R - 1.5, top: R * 0.04, width: 3, height: R * 0.42, background: "#f2efe6", transformOrigin: `1.5px ${R * 0.96}px`, transform: `rotate(${ang}deg)`, borderRadius: 1 }} />
      {/* turned aluminium cap */}
      <div
        style={{
          position: "absolute",
          left: R - capR,
          top: R - capR,
          width: capR * 2,
          height: capR * 2,
          borderRadius: "50%",
          background: "conic-gradient(from 20deg, #f2f2ee, #9a9994 18%, #e9e9e4 32%, #8a8984 52%, #f6f6f2 66%, #a3a29d 82%, #f2f2ee)",
          boxShadow: "0 1px 2px rgba(0,0,0,.5), inset 0 0 0 1px rgba(0,0,0,.18)",
        }}
      >
        <div style={{ position: "absolute", inset: capR * 0.18, borderRadius: "50%", background: "radial-gradient(circle at 50% 50%, rgba(255,255,255,.0) 55%, rgba(0,0,0,.12) 100%)" }} />
      </div>
      <div style={{ position: "absolute", left: -40, width: d + 80, top: d + (scale ? d * 0.5 : 10), textAlign: "center", fontSize: Math.max(11, d * 0.16), letterSpacing: 1.6, color: INK, ...cond(700, 75) }}>{label}</div>
    </div>
  );
};

/** A chrome bat-handle toggle seen from above, thrown up or down. */
const Toggle: React.FC<{ x: number; y: number; up: boolean; top: string; bottom: string; label?: string }> = ({ x, y, up, top, bottom, label }) => (
  <div style={{ position: "absolute", left: x - 30, top: y - 44, width: 60, height: 88 }}>
    <div style={{ position: "absolute", top: -12, width: 60, textAlign: "center", fontSize: 11, letterSpacing: 1.2, color: INK, ...cond(700) }}>{top}</div>
    <div style={{ position: "absolute", bottom: -12, width: 60, textAlign: "center", fontSize: 11, letterSpacing: 1.2, color: INK, ...cond(700) }}>{bottom}</div>
    {/* hex nut */}
    <div style={{ position: "absolute", left: 16, top: 30, width: 28, height: 28, clipPath: "polygon(25% 3%, 75% 3%, 100% 50%, 75% 97%, 25% 97%, 0 50%)", background: "linear-gradient(160deg, #f4f4f0, #8d8c87 60%, #c9c8c3)" }} />
    <div style={{ position: "absolute", left: 22, top: 36, width: 16, height: 16, borderRadius: "50%", background: "radial-gradient(circle at 40% 35%, #fafaf7, #7d7c77)" }} />
    {/* the lever, foreshortened */}
    <div
      style={{
        position: "absolute",
        left: 25,
        top: up ? 8 : 44,
        width: 10,
        height: 36,
        borderRadius: 5,
        background: "linear-gradient(90deg, #6f6e69, #fbfbf8 35%, #c4c3be 55%, #7a7974)",
        boxShadow: up ? "0 6px 6px rgba(0,0,0,.35)" : "0 8px 7px rgba(0,0,0,.35)",
      }}
    />
    {label ? <div style={{ position: "absolute", top: 92, left: -30, width: 120, textAlign: "center", fontSize: 12, letterSpacing: 1.6, color: INK, ...cond(750) }}>{label}</div> : null}
  </div>
);

/** A jeweled pilot lamp in a chrome bezel. */
const Lamp: React.FC<{ x: number; y: number; color: string; on: number; r?: number }> = ({ x, y, color, on, r = 9 }) => (
  <div
    style={{
      position: "absolute",
      left: x - r - 3,
      top: y - r - 3,
      width: (r + 3) * 2,
      height: (r + 3) * 2,
      borderRadius: "50%",
      background: "radial-gradient(circle at 40% 30%, #f6f6f2, #6d6c68 70%, #3c3b38)",
      boxShadow: "0 1px 2px rgba(0,0,0,.6)",
    }}
  >
    <div
      style={{
        position: "absolute",
        left: 3,
        top: 3,
        width: r * 2,
        height: r * 2,
        borderRadius: "50%",
        background: `repeating-conic-gradient(from 0deg, rgba(255,255,255,.18) 0deg 30deg, rgba(0,0,0,.12) 30deg 60deg), radial-gradient(circle at 45% 40%, #fff ${on * 12}%, ${color} ${30 + on * 10}%, #200 120%)`,
        filter: `brightness(${0.55 + on * 0.6})`,
      }}
    />
  </div>
);

const Jack: React.FC<{ x: number; y: number; label: string; below?: boolean }> = ({ x, y, label, below = false }) => (
  <>
    <div style={{ position: "absolute", left: x - 13, top: y - 13, width: 26, height: 26, borderRadius: "50%", background: "radial-gradient(circle at 40% 35%, #f7f7f3, #8e8d88 70%)", boxShadow: "0 1px 2px rgba(0,0,0,.5)" }}>
      <div style={{ position: "absolute", left: 6, top: 6, width: 14, height: 14, borderRadius: "50%", background: "radial-gradient(circle at 50% 60%, #000 50%, #2a2a28)" }} />
    </div>
    <div style={{ position: "absolute", left: x - 60, width: 120, top: below ? y + 18 : y - 32, textAlign: "center", fontSize: 11, letterSpacing: 1.4, color: INK, ...cond(700) }}>{label}</div>
  </>
);

/** A patch cable: a weighted catenary with a highlight, chrome plugs and coloured boots at each end. */
const Cable: React.FC<{ a: [number, number]; b: [number, number]; sag: number; color: string; dark: string; t: number; ph: number }> = ({ a, b, sag, color, dark, t, ph }) => {
  const sway = Math.sin(t * 1.9 + ph) * 6;
  const s = sag + Math.sin(t * 1.3 + ph) * 3;
  const d = `M${a[0]} ${a[1]} C ${a[0] + sway} ${a[1] + s}, ${b[0] + sway} ${b[1] + s}, ${b[0]} ${b[1]}`;
  const boot = (p: [number, number], k: number) => (
    <g key={k}>
      <rect x={p[0] - 7} y={p[1] - 4} width={14} height={20} rx={3} fill={dark} />
      <rect x={p[0] - 7} y={p[1] - 4} width={5} height={20} rx={2} fill="#fff" opacity={0.18} />
      <rect x={p[0] - 9} y={p[1] - 10} width={18} height={9} rx={2} fill="#d9d8d3" />
      <rect x={p[0] - 9} y={p[1] - 10} width={6} height={9} rx={2} fill="#fff" opacity={0.6} />
    </g>
  );
  return (
    <g>
      <path d={d} stroke="rgba(0,0,0,.28)" strokeWidth={9} fill="none" transform="translate(4 9)" strokeLinecap="round" />
      <path d={d} stroke={dark} strokeWidth={8} fill="none" strokeLinecap="round" />
      <path d={d} stroke={color} strokeWidth={5.5} fill="none" strokeLinecap="round" />
      <path d={d} stroke="#fff" strokeOpacity={0.45} strokeWidth={1.6} fill="none" transform="translate(-1 -1.6)" strokeLinecap="round" />
      {boot(a, 0)}
      {boot(b, 1)}
    </g>
  );
};

/** VU meter with a cream face; the needle rides Stella's activity. */
const VU: React.FC<{ x: number; y: number; w: number; t: number; id: string }> = ({ x, y, w, t, id }) => {
  const h = w * 0.62;
  const level = 0.42 + 0.16 * Math.sin(t * 7.1) + 0.1 * Math.sin(t * 13.3 + 1) + 0.08 * Math.sin(t * 3.1);
  const ang = -48 + level * 96;
  const cx = w / 2,
    cy = h * 1.02;
  const R = h * 0.78;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w + 16, height: h + 16, background: "#141312", borderRadius: 6, boxShadow: "0 2px 3px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.15)" }}>
      <svg width={w} height={h} style={{ position: "absolute", left: 8, top: 8, borderRadius: 3 }}>
        <defs>
          <linearGradient id={`${id}-face`} x1={0} y1={0} x2={0} y2={1}>
            <stop offset={0} stopColor="#f5e9c4" />
            <stop offset={1} stopColor="#e6d2a0" />
          </linearGradient>
          <clipPath id={`${id}-clip`}>
            <rect width={w} height={h} />
          </clipPath>
        </defs>
        <rect width={w} height={h} fill={`url(#${id}-face)`} />
        <path d={`M ${cx + R * Math.sin((-48 * Math.PI) / 180)} ${cy - R * Math.cos((-48 * Math.PI) / 180)} A ${R} ${R} 0 0 1 ${cx + R * Math.sin((22 * Math.PI) / 180)} ${cy - R * Math.cos((22 * Math.PI) / 180)}`} stroke={INK} strokeWidth={1.6} fill="none" />
        <path d={`M ${cx + R * Math.sin((22 * Math.PI) / 180)} ${cy - R * Math.cos((22 * Math.PI) / 180)} A ${R} ${R} 0 0 1 ${cx + R * Math.sin((48 * Math.PI) / 180)} ${cy - R * Math.cos((48 * Math.PI) / 180)}`} stroke="#c8321e" strokeWidth={5} fill="none" />
        {Array.from({ length: 13 }, (_, i) => {
          const a = ((-48 + i * 8) * Math.PI) / 180;
          const r1 = R * (i % 3 === 0 ? 1.1 : 1.06);
          return <line key={i} x1={cx + Math.sin(a) * R} y1={cy - Math.cos(a) * R} x2={cx + Math.sin(a) * r1} y2={cy - Math.cos(a) * r1} stroke={i > 8 ? "#c8321e" : INK} strokeWidth={1.4} />;
        })}
        {["20", "10", "5", "3", "0", "+3"].map((s, i) => {
          const a = ((-46 + [0, 18, 36, 52, 70, 92][i]) * Math.PI) / 180;
          return (
            <text key={s} x={cx + Math.sin(a) * R * 1.2} y={cy - Math.cos(a) * R * 1.2 + 3} textAnchor="middle" fontSize={10} fill={i === 5 ? "#c8321e" : INK} style={{ ...cond(650) }}>
              {s}
            </text>
          );
        })}
        <text x={cx} y={h * 0.7} textAnchor="middle" fontSize={15} fill={INK} style={{ ...cond(800, 100), letterSpacing: 2 }}>
          VU
        </text>
        <g clipPath={`url(#${id}-clip)`}>
          <line x1={cx} y1={cy} x2={cx + Math.sin((ang * Math.PI) / 180) * R * 1.12} y2={cy - Math.cos((ang * Math.PI) / 180) * R * 1.12} stroke="#1a1a1a" strokeWidth={1.6} />
        </g>
        <rect width={w} height={h} fill="url(#syn-sheen)" opacity={0.8} />
        <rect x={0} y={h - 12} width={w} height={12} fill="#141312" />
        <circle cx={cx} cy={h - 6} r={8} fill="#2a2927" />
      </svg>
    </div>
  );
};

// ------------------------------------------------------------------ the readout

const DOT = 3.2;
/** Stella's star as a dot-matrix glyph for the VFD, eyes left unlit; it blinks. */
const VFD_STAR = ["....#.#....", "...#####...", "#.#######.#", "###########", ".###.#.###.", "..##.#.##..", ".#########.", "###########", "#.#######.#", "...#####...", "....#.#...."];
const VfdStar: React.FC<{ x: number; y: number; t: number }> = ({ x, y, t }) => {
  const blink = (t + 0.7) % 3.1 > 2.95;
  const cells: React.ReactNode[] = [];
  VFD_STAR.forEach((row, j) =>
    row.split("").forEach((ch, i) => {
      let lit = ch === "#";
      if (blink && j === 4 && (i === 4 || i === 6)) lit = true;
      cells.push(<circle key={`${i}-${j}`} cx={x + i * 5 + 2.5} cy={y + j * 5 + 2.5} r={1.8} fill={lit ? VFD : VFD_DIM} opacity={lit ? 1 : 0.35} />);
    }),
  );
  return <g>{cells}</g>;
};
void DOT;

const Readout: React.FC<{ x: number; y: number; w: number; h: number; t: number; fs: number; id: string }> = ({ x, y, w, h, t, fs, id }) => {
  const pad = 22;
  const lh = fs * 1.32;
  const caret = Math.floor(t * 2.4) % 2 === 0;
  const row = (text: string, me: boolean) => (
    <div style={{ display: "flex", justifyContent: me ? "flex-end" : "flex-start", alignItems: "flex-start", gap: 12 }}>
      {!me ? <div style={{ width: 56, flex: "none" }} /> : null}
      <div
        style={{
          maxWidth: w * 0.72,
          fontFamily: F.doto,
          fontWeight: 800,
          fontSize: fs,
          lineHeight: `${lh}px`,
          color: me ? AMBER : VFD,
          textAlign: me ? "right" : "left",
          textShadow: me ? `0 0 6px rgba(255,170,60,.55)` : `0 0 6px rgba(120,255,220,.5)`,
          letterSpacing: 0.2,
        }}
      >
        {text}
      </div>
    </div>
  );
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h }}>
      {/* chrome bezel */}
      <div style={{ position: "absolute", inset: -10, borderRadius: 8, background: "linear-gradient(180deg, #3a3936, #121110 40%, #1d1c1a)", boxShadow: "0 2px 3px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.2)" }} />
      <div style={{ position: "absolute", inset: 0, borderRadius: 4, background: "#06100e", overflow: "hidden", boxShadow: "inset 0 3px 10px rgba(0,0,0,.9)" }}>
        {/* the conversation */}
        <div style={{ position: "absolute", left: pad, right: pad, bottom: pad - 4, display: "flex", flexDirection: "column", gap: fs * 0.62 }}>
          <div style={{ textAlign: "center", fontFamily: F.doto, fontWeight: 800, fontSize: fs * 0.72, color: VFD, opacity: 0.55, letterSpacing: 2, marginBottom: 2 }}>{CHAT.stamp.toUpperCase()}</div>
          {row(CHAT.me1, true)}
          {row(CHAT.her1, false)}
          {row(CHAT.me2, true)}
          {row(CHAT.her2, false)}
        </div>
        <svg width={w} height={h} style={{ position: "absolute", left: 0, top: 0 }}>
          {/* Stella's dot-matrix mark beside her lines, and a status annunciator row */}
          <g filter={`url(#${id}-bloom)`}>
            <VfdStar x={pad - 2} y={h - pad - 4 - 56} t={t} />
          </g>
          <g style={{ fontFamily: F.doto, fontWeight: 800 }} fontSize={13}>
            {[
              ["LISTEN", 0],
              ["THINK", 0],
              ["DONE", 1],
              ["MEM", 1],
            ].map(([s, on], i) => (
              <text key={i} x={pad + i * 92} y={24} fill={on ? VFD : VFD_DIM} opacity={on ? 0.85 : 0.6} letterSpacing={1.5}>
                {s}
              </text>
            ))}
            <text x={w - pad} y={24} textAnchor="end" fill={caret ? AMBER : VFD_DIM} opacity={0.9} letterSpacing={1.5}>
              ● LIVE
            </text>
          </g>
          {/* smoked glass: mesh and a cool reflection */}
          <rect width={w} height={h} fill={`url(#${id}-mesh)`} />
          <path d={`M0 0 H ${w * 0.55} L ${w * 0.38} ${h} H 0 Z`} fill="#fff" opacity={0.035} />
        </svg>
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ keybed

const Keybed: React.FC<{ x: number; y: number; w: number; h: number; keys: number; t: number }> = ({ x, y, w, h, keys }) => {
  const kw = w / keys;
  const blackAt = [1, 1, 0, 1, 1, 1, 0]; // after C, D, (E none), F, G, A, (B none)
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, background: "#0d0c0b", overflow: "hidden" }}>
      {Array.from({ length: keys }, (_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: i * kw + 1,
            top: 0,
            width: kw - 2,
            height: h - 2,
            borderRadius: "0 0 4px 4px",
            background: "linear-gradient(180deg, #d8d2c2 0%, #f3eee0 12%, #f1ebdc 84%, #d9d1bd 94%, #b8af98 100%)",
            boxShadow: "inset -1px 0 0 rgba(0,0,0,.12)",
          }}
        />
      ))}
      {Array.from({ length: keys - 1 }, (_, i) =>
        blackAt[i % 7] ? (
          <div
            key={`b${i}`}
            style={{
              position: "absolute",
              left: (i + 1) * kw - kw * 0.3,
              top: 0,
              width: kw * 0.6,
              height: h * 0.6,
              borderRadius: "0 0 3px 3px",
              background: "linear-gradient(90deg, #050505, #2c2b29 45%, #121110)",
              boxShadow: "0 3px 3px rgba(0,0,0,.5), inset 0 -6px 0 #252422",
            }}
          />
        ) : null,
      )}
      <div style={{ position: "absolute", left: 0, top: 0, width: w, height: 8, background: "linear-gradient(180deg, rgba(0,0,0,.6), rgba(0,0,0,0))" }} />
    </div>
  );
};

// ------------------------------------------------------------------ the instrument

export const SynthSkin: React.FC<SkinProps> = ({ t, w, h }) => {
  const tall = h > w;
  const id = "syn";
  const cheek = tall ? 46 : 62;
  const rail = 62;
  const px0 = cheek;
  const pw = w - cheek * 2;
  const keyH = tall ? 170 : 128;
  const stripH = tall ? 96 : 84;
  const panelBottom = h - keyH - stripH;

  // display + sections
  const disp = tall ? { x: px0 + 40, y: rail + 64, w: pw - 80, h: 430 } : { x: px0 + 330, y: rail + 66, w: pw - 330 - 300, h: 380 };
  const fs = tall ? 23 : 20;

  const ledOn = (i: number) => (Math.sin(t * (2.2 + i * 0.7) + i * 1.9) > 0.1 ? 1 : 0.15);

  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, overflow: "hidden", background: "#2a1a10" }}>
      <svg width={0} height={0} style={{ position: "absolute" }}>
        <Defs id={id} />
      </svg>

      {/* brushed aluminium panel */}
      <div style={{ position: "absolute", left: px0, top: rail, width: pw, height: panelBottom - rail, background: ALU }}>
        <svg width={pw} height={panelBottom - rail} style={{ position: "absolute", inset: 0 }}>
          <rect width={pw} height={panelBottom - rail} filter={`url(#${id}-brush)`} opacity={0.55} />
          <rect width={pw} height={panelBottom - rail} filter={`url(#${id}-brushDark)`} opacity={0.5} />
          <rect width={pw} height={panelBottom - rail} fill={`url(#${id}-sheen)`} />
        </svg>
      </div>

      {/* ---- top rail: black anodised, pilot lamps, the badge */}
      <div style={{ position: "absolute", left: 0, top: 0, width: w, height: rail, background: "linear-gradient(180deg, #2b2a28 0%, #121110 70%, #0a0a09 100%)", boxShadow: "0 2px 0 rgba(0,0,0,.4)" }}>
        <svg width={w} height={rail} style={{ position: "absolute", inset: 0, opacity: 0.6 }}>
          <rect width={w} height={rail} filter={`url(#${id}-brush)`} opacity={0.25} />
        </svg>
        {/* traffic lights as jeweled pilot lamps */}
        <Lamp x={30} y={rail / 2} color="#ff3b2f" on={0.9} r={7} />
        <Lamp x={58} y={rail / 2} color="#ffb21a" on={0.85} r={7} />
        <Lamp x={86} y={rail / 2} color="#3ee26a" on={0.85} r={7} />
        <div style={{ position: "absolute", left: 0, width: w, top: 0, height: rail, display: "flex", alignItems: "center", justifyContent: "center", gap: 14 }}>
          <svg width={30} height={30} viewBox={`0 0 ${STAR.C * 2} ${STAR.C * 2}`}>
            <path d={STAR.path} fill="none" stroke="#efeae0" strokeWidth={14} />
            <rect x={STAR.C - 30} y={STAR.C - 22} width={16} height={34} rx={8} fill="#efeae0" />
            <rect x={STAR.C + 12} y={STAR.C - 22} width={16} height={34} rx={8} fill="#efeae0" />
          </svg>
          <span style={{ fontFamily: F.mona, fontWeight: 800, fontStretch: "125%", fontSize: 26, letterSpacing: 3, color: "#efeae0", textTransform: "lowercase" }}>stella</span>
          <span style={{ ...cond(600, 100), fontSize: 13, letterSpacing: 3, color: ORANGE, border: `1.5px solid ${ORANGE}`, padding: "2px 7px 1px", borderRadius: 2 }}>SX-1</span>
          {tall ? null : <span style={{ ...cond(500, 100), fontSize: 11, letterSpacing: 3.5, color: "#a39f95" }}>ASSISTANT SYNTHESIZER</span>}
        </div>
        <div style={{ position: "absolute", right: 24, top: 0, height: rail, display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ ...cond(650, 85), fontSize: 13, letterSpacing: 2.5, color: "#efeae0" }}>ACCOUNT</span>
          {[0, 1].map((i) => (
            <div key={i} style={{ width: 30, height: 24, borderRadius: 3, background: "linear-gradient(180deg, #f2efe6, #c8c2b2)", boxShadow: "0 2px 0 #6d685c, 0 3px 3px rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {i === 0 ? (
                <svg width={14} height={14} viewBox="-8 -8 16 16">
                  {Array.from({ length: 6 }, (_, k) => (
                    <rect key={k} x={-1.6} y={-7.5} width={3.2} height={4} fill={INK} transform={`rotate(${k * 60})`} />
                  ))}
                  <circle r={4.6} fill="none" stroke={INK} strokeWidth={2.2} />
                </svg>
              ) : (
                <svg width={14} height={12} viewBox="0 0 14 12">
                  <rect x={1} y={1} width={12} height={10} fill="none" stroke={INK} strokeWidth={1.8} />
                  <line x1={8.5} y1={1} x2={8.5} y2={11} stroke={INK} strokeWidth={1.8} />
                </svg>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* screws */}
      {[
        [px0 + 16, rail + 16],
        [px0 + pw - 16, rail + 16],
        [px0 + 16, panelBottom - 16],
        [px0 + pw - 16, panelBottom - 16],
      ].map(([x, y], i) => (
        <Screw key={i} x={x} y={y} a={15 + i * 37} />
      ))}

      {tall ? <TallControls t={t} px0={px0} pw={pw} top={disp.y + disp.h + 30} bottom={panelBottom} ledOn={ledOn} /> : <WideControls t={t} px0={px0} pw={pw} rail={rail} disp={disp} bottom={panelBottom} ledOn={ledOn} />}

      <Readout x={disp.x} y={disp.y} w={disp.w} h={disp.h} t={t} fs={fs} id={id} />
      <div style={{ position: "absolute", left: disp.x, top: disp.y - 34, width: disp.w, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ ...cond(800, 75), fontSize: 13, letterSpacing: 2.4, color: ALU, background: INK, padding: "3px 9px 2px" }}>READOUT</span>
        <div style={{ flex: 1, height: 2, background: INK }} />
      </div>

      {/* ---- performance strip (the composer) */}
      <div style={{ position: "absolute", left: px0, top: panelBottom, width: pw, height: stripH, background: "linear-gradient(180deg, #2a2927, #151413)", boxShadow: "inset 0 1px 0 rgba(255,255,255,.12), inset 0 -2px 0 #000" }}>
        <svg width={pw} height={stripH} style={{ position: "absolute", inset: 0 }}>
          <rect width={pw} height={stripH} filter={`url(#${id}-brush)`} opacity={0.12} />
        </svg>
        <Composer t={t} tall={tall} />
      </div>

      <Keybed x={px0} y={panelBottom + stripH} w={pw} h={keyH} keys={tall ? 15 : 29} t={t} />

      {/* walnut cheeks over everything at the sides */}
      <Walnut id={id} x={0} y={rail} w={cheek} h={h - rail} side="l" />
      <Walnut id={id} x={w - cheek} y={rail} w={cheek} h={h - rail} side="r" />
    </div>
  );
};

const Composer: React.FC<{ t: number; tall: boolean }> = ({ t, tall }) => {
  const caret = Math.floor(t * 2.4) % 2 === 0;
  const btn = (label: string, glyph: React.ReactNode, color = "linear-gradient(180deg, #f2efe6, #cbc5b5)", fg = INK) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div style={{ width: 46, height: 36, borderRadius: 3, background: color, boxShadow: "0 3px 0 rgba(0,0,0,.55), 0 4px 4px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.6)", display: "flex", alignItems: "center", justifyContent: "center", color: fg }}>
        {glyph}
      </div>
      <span style={{ ...cond(650, 85), fontSize: 10, letterSpacing: 1.8, color: "#bdb8ac" }}>{label}</span>
    </div>
  );
  const pad = tall ? 22 : 30;
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", gap: tall ? 16 : 22, padding: `0 ${pad}px` }}>
      {btn(
        "ADD",
        <svg width={16} height={16}>
          <path d="M8 2 V14 M2 8 H14" stroke={INK} strokeWidth={2.6} />
        </svg>,
      )}
      <div style={{ flex: 1, height: 46, marginTop: -16, borderRadius: 4, background: "#06100e", boxShadow: "inset 0 2px 6px rgba(0,0,0,.9), 0 0 0 3px #0a0a09, 0 1px 0 3px rgba(255,255,255,.08)", display: "flex", alignItems: "center", padding: "0 16px", position: "relative", overflow: "hidden" }}>
        <span style={{ fontFamily: F.doto, fontWeight: 800, fontSize: 22, color: VFD, opacity: 0.5, letterSpacing: 0.5, textShadow: "0 0 6px rgba(120,255,220,.4)" }}>{CHAT.placeholder.toUpperCase()}</span>
        <span style={{ display: "inline-block", width: 12, height: 20, marginLeft: 8, background: caret ? VFD : "transparent", boxShadow: caret ? "0 0 6px rgba(120,255,220,.6)" : "none" }} />
        <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
          <rect width="100%" height="100%" fill="url(#syn-mesh)" />
        </svg>
      </div>
      {btn(
        "VOICE",
        <svg width={14} height={20} viewBox="0 0 14 20">
          <rect x={4} y={1} width={6} height={11} rx={3} fill={INK} />
          <path d="M1.5 9 Q1.5 15 7 15 Q12.5 15 12.5 9 M7 15 V19" stroke={INK} strokeWidth={1.8} fill="none" />
        </svg>,
      )}
      {btn(
        "SEND",
        <svg width={18} height={18}>
          <path d="M9 15 V3 M3.5 8.5 L9 3 L14.5 8.5" stroke="#fff" strokeWidth={2.8} fill="none" strokeLinejoin="round" />
        </svg>,
        `linear-gradient(180deg, #f58a4e, ${ORANGE} 60%, #b8461a)`,
        "#fff",
      )}
    </div>
  );
};

type Ctl = { t: number; px0: number; pw: number; bottom: number; ledOn: (i: number) => number };

const SectionLabel: React.FC<{ x: number; y: number; w: number; text: string }> = ({ x, y, w, text }) => (
  <div style={{ position: "absolute", left: x, top: y, width: w, display: "flex", alignItems: "center", gap: 10 }}>
    <span style={{ ...cond(800, 75), fontSize: 13, letterSpacing: 2.4, color: ALU, background: INK, padding: "3px 9px 2px" }}>{text}</span>
    <div style={{ flex: 1, height: 2, background: INK }} />
  </div>
);

const Led: React.FC<{ x: number; y: number; on: number; label?: string; color?: string }> = ({ x, y, on, label, color = "#ff3a22" }) => (
  <>
    <div style={{ position: "absolute", left: x - 7, top: y - 7, width: 14, height: 14, borderRadius: "50%", background: "radial-gradient(circle at 40% 35%, #f1f1ec, #6d6c67)", boxShadow: "0 1px 1px rgba(0,0,0,.5)" }}>
      <div style={{ position: "absolute", left: 3, top: 3, width: 8, height: 8, borderRadius: "50%", background: on > 0.5 ? `radial-gradient(circle at 40% 35%, #fff 0%, ${color} 45%, #5a0a00 100%)` : "radial-gradient(circle at 40% 35%, #9a5a50, #3a0e08)", boxShadow: on > 0.5 ? `0 0 5px ${color}` : "none" }} />
    </div>
    {label ? <div style={{ position: "absolute", left: x - 40, width: 80, top: y + 11, textAlign: "center", fontSize: 10, letterSpacing: 1.4, color: INK, ...cond(700) }}>{label}</div> : null}
  </>
);

const WideControls: React.FC<Ctl & { rail: number; disp: { x: number; y: number; w: number; h: number } }> = ({ t, px0, pw, rail, disp, bottom, ledOn }) => {
  const lx = px0 + 40;
  const lw = disp.x - lx - 50;
  const rx = disp.x + disp.w + 50;
  const rw = px0 + pw - 40 - rx;
  const bayY = disp.y + disp.h + 34;
  const jacksL = [
    ["RECEIPTS", lx + 40],
    ["MAIL", lx + 130],
    ["FILES", lx + 220],
  ] as const;
  const jacksR = [
    ["SHEETS", rx + 30],
    ["CALENDAR", rx + 120],
    ["NOTES", rx + 210],
  ] as const;
  const jy = bayY + 62;
  return (
    <>
      <SectionLabel x={lx} y={rail + 32} w={lw} text="VOICE" />
      <Knob x={lx + 62} y={rail + 132} d={70} v={0.62} label="TONE" />
      <Knob x={lx + 196} y={rail + 132} d={70} v={0.38} label="WARMTH" />
      <Knob x={lx + 62} y={rail + 290} d={54} v={0.8} label="BREVITY" />
      <Knob x={lx + 196} y={rail + 290} d={54} v={0.5} label="PACE" skirt="#2c1d14" />
      <Toggle x={lx + 62} y={rail + 420} up top="TALK" bottom="TYPE" />
      <Toggle x={lx + 150} y={rail + 420} up={false} top="AUTO" bottom="ASK" />
      <Led x={lx + 228} y={rail + 404} on={ledOn(1)} label="BUSY" />
      <Led x={lx + 228} y={rail + 446} on={1} label="READY" color="#36e070" />

      <SectionLabel x={rx} y={rail + 32} w={rw} text="MEMORY" />
      <VU x={rx + 8} y={rail + 66} w={rw - 32} t={t} id="syn-vu" />
      <div style={{ position: "absolute", left: rx, width: rw, top: rail + 66 + (rw - 32) * 0.62 + 22, textAlign: "center", fontSize: 11, letterSpacing: 2, color: INK, ...cond(750) }}>ACTIVITY</div>
      <Knob x={rx + 50} y={rail + 330} d={56} v={0.72} label="RECALL" />
      <Knob x={rx + rw - 50} y={rail + 330} d={56} v={0.3} label="FOCUS" />
      {[0, 1, 2, 3, 4].map((i) => (
        <Led key={i} x={rx + 30 + i * ((rw - 60) / 4)} y={rail + 430} on={ledOn(i + 3)} color={i === 4 ? "#ffb21a" : "#ff3a22"} />
      ))}
      <div style={{ position: "absolute", left: rx, width: rw, top: rail + 446, textAlign: "center", fontSize: 10, letterSpacing: 2, color: INK, ...cond(700) }}>TASK SEQUENCE · 1–5</div>

      {/* ---- patch bay across the bottom of the panel */}
      <SectionLabel x={lx} y={bayY} w={pw - 80} text="ROUTING" />
      {jacksL.map(([l, x]) => (
        <Jack key={l} x={x} y={jy} label={l} />
      ))}
      {jacksR.map(([l, x]) => (
        <Jack key={l} x={x} y={jy} label={l} />
      ))}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Jack key={`m${i}`} x={disp.x + 60 + i * ((disp.w - 120) / 5)} y={jy} label={["IN", "MIX", "LFO", "ENV", "OUT", "AUX"][i]} />
      ))}
      <svg width={px0 + pw} height={bottom + 40} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }}>
        <Cable a={[jacksL[0][1], jy]} b={[jacksR[0][1], jy]} sag={70} color="#e8642c" dark="#8a2e0e" t={t} ph={0} />
        <Cable a={[disp.x + 60 + 4 * ((disp.w - 120) / 5), jy]} b={[jacksR[1][1], jy]} sag={46} color="#2f7fd8" dark="#173f78" t={t} ph={1.7} />
        <Cable a={[jacksL[2][1], jy]} b={[disp.x + 60, jy]} sag={34} color="#e9c43a" dark="#7d6210" t={t} ph={3.1} />
      </svg>
    </>
  );
};

const TallControls: React.FC<Ctl & { top: number }> = ({ t, px0, pw, top, bottom, ledOn }) => {
  const lx = px0 + 40;
  const iw = pw - 80;
  const row1 = top + 34;
  const kd = 66;
  const bayY = row1 + 350;
  const jy = bayY + 68;
  const jx = (i: number) => lx + 46 + i * ((iw - 92) / 4);
  const labels = ["RECEIPTS", "SHEETS", "MIX", "REMINDER", "CALENDAR"];
  void bottom;
  return (
    <>
      <SectionLabel x={lx} y={top} w={iw * 0.56} text="VOICE" />
      <SectionLabel x={lx + iw * 0.62} y={top} w={iw * 0.38} text="MEMORY" />
      <Knob x={lx + 52} y={row1 + 76} d={kd} v={0.62} label="TONE" />
      <Knob x={lx + 172} y={row1 + 76} d={kd} v={0.38} label="WARMTH" />
      <Knob x={lx + 292} y={row1 + 76} d={kd} v={0.8} label="BREVITY" skirt="#2c1d14" />
      <VU x={lx + iw * 0.62 + 4} y={row1 + 18} w={iw * 0.38 - 24} t={t} id="syn-vu" />
      <div style={{ position: "absolute", left: lx + iw * 0.62, width: iw * 0.38, top: row1 + 18 + (iw * 0.38 - 24) * 0.62 + 22, textAlign: "center", fontSize: 11, letterSpacing: 2, color: INK, ...cond(750) }}>ACTIVITY</div>
      <Toggle x={lx + 52} y={row1 + 262} up top="TALK" bottom="TYPE" />
      <Toggle x={lx + 152} y={row1 + 262} up={false} top="AUTO" bottom="ASK" />
      <Led x={lx + 240} y={row1 + 250} on={ledOn(1)} label="BUSY" />
      <Led x={lx + 310} y={row1 + 250} on={1} label="READY" color="#36e070" />
      {[0, 1, 2, 3, 4].map((i) => (
        <Led key={i} x={lx + iw * 0.62 + 24 + i * ((iw * 0.38 - 48) / 4)} y={row1 + 250} on={ledOn(i + 3)} color={i === 4 ? "#ffb21a" : "#ff3a22"} />
      ))}
      <div style={{ position: "absolute", left: lx + iw * 0.62, width: iw * 0.38, top: row1 + 266, textAlign: "center", fontSize: 10, letterSpacing: 2, color: INK, ...cond(700) }}>TASK SEQUENCE</div>

      <SectionLabel x={lx} y={bayY} w={iw} text="ROUTING" />
      {labels.map((l, i) => (
        <Jack key={l} x={jx(i)} y={jy} label={l} />
      ))}
      <svg width={px0 + pw} height={jy + 200} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }}>
        <Cable a={[jx(0), jy]} b={[jx(1), jy]} sag={44} color="#e8642c" dark="#8a2e0e" t={t} ph={0} />
        <Cable a={[jx(3), jy]} b={[jx(4), jy]} sag={40} color="#2f7fd8" dark="#173f78" t={t} ph={1.7} />
        <Cable a={[jx(1), jy]} b={[jx(3), jy]} sag={58} color="#e9c43a" dark="#7d6210" t={t} ph={3.1} />
      </svg>
      <div style={{ position: "absolute", left: lx, width: iw, top: jy + 30, display: "none" }} />
    </>
  );
};
