import React from "react";
import { CHAT, type SkinProps } from "./content";
import { F, STAR, hash, ovalLines, starEyes } from "./kit";

/**
 * "Make it feel like a 90s anime."
 * A painted late-summer afternoon background (gouache sky, cel-shaded cumulonimbus,
 * a telephone pole and its wires), Stella as an inked, cel-painted character,
 * the conversation lettered into manga balloons, an episode title card, and
 * character animation held on twos/threes (12 fps) over a smoothly panning background.
 */

const INK = "#1c1a2b";
const PAPER = "#f7f1e2";
const SKY_TOP = "#2a63bd";
const SKY_MID = "#5a9fe2";
const SKY_LOW = "#cfe6f1";
const CL_LIGHT = "#fffcf3";
const CL_MID = "#e6e1ef";
const CL_SHADE = "#b4aed4";
const CL_DEEP = "#8f8ac0";
const ST_BASE = "#5f73e8";
const ST_SHADE = "#3a3fa6";
const ST_LIGHT = "#a3c0ff";
const ST_RIM = "#ff9bd2";
const YELLOW = "#ffd23c";
const RED = "#e2403a";

/** Character animation is held on 12 fps like hand-drawn cels; backgrounds pan smoothly. */
const onTwos = (t: number) => Math.floor(t * 12) / 12;

// ---------------------------------------------------------------- clouds

type Puff = { x: number; y: number; r: number };

function cumulus(seed: number, w: number, hgt: number): Puff[] {
  // A towering cumulonimbus: a flat-ish base, a column of big puffs, a crown.
  const out: Puff[] = [];
  const n = 26;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const lvl = Math.pow(u, 0.9);
    const spread = w * (0.5 - 0.3 * lvl) * (0.6 + 0.4 * hash(i, seed));
    const x = (hash(i, seed + 1) - 0.5) * 2 * spread;
    const y = -lvl * hgt + (hash(i, seed + 2) - 0.5) * hgt * 0.08;
    const r = (w * 0.16) * (1 - 0.45 * lvl) * (0.7 + 0.6 * hash(i, seed + 3));
    out.push({ x, y, r });
  }
  // cauliflower edges: smaller puffs budding off the upper rim of each big one
  const buds: Puff[] = [];
  out.forEach((p, i) => {
    for (let k = 0; k < 3; k++) {
      const a = -Math.PI / 2 + (hash(i * 3 + k, seed + 5) - 0.5) * 2.6;
      const rr = p.r * (0.32 + 0.22 * hash(i * 3 + k, seed + 6));
      buds.push({ x: p.x + Math.cos(a) * p.r * 0.86, y: p.y + Math.sin(a) * p.r * 0.86, r: rr });
    }
  });
  out.push(...buds);
  // the long flat base
  for (let i = 0; i < 9; i++) {
    const x = (i / 8 - 0.5) * w * 1.15;
    out.push({ x, y: hgt * 0.02 + hash(i, seed + 9) * 6, r: w * 0.085 * (0.8 + 0.5 * hash(i, seed + 7)) });
  }
  return out;
}

function smallCloud(seed: number, w: number): Puff[] {
  const out: Puff[] = [];
  for (let i = 0; i < 9; i++) {
    const u = i / 8;
    const x = (u - 0.5) * w;
    const bump = Math.sin(u * Math.PI);
    out.push({ x, y: -bump * w * 0.12 * (0.6 + 0.6 * hash(i, seed)), r: w * (0.07 + 0.09 * bump) * (0.8 + 0.4 * hash(i, seed + 1)) });
  }
  return out;
}

const circles = (p: Puff[], dx = 0, dy = 0, k = 1) =>
  p.map((c, i) => <circle key={i} cx={c.x + dx * c.r} cy={c.y + dy * c.r} r={c.r * k} />);

/** Cel-painted cloud: flat shadow body, a mid tone, a hard-edged lit top-left, a flat cut base. */
const Cloud: React.FC<{ id: string; puffs: Puff[]; x: number; y: number; s?: number; baseY?: number }> = ({ id, puffs, x, y, s = 1, baseY = 30 }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <defs>
      <clipPath id={`${id}-c`}>
        <rect x={-5000} y={-5000} width={10000} height={5000 + baseY} />
      </clipPath>
      <clipPath id={`${id}-s`} clipPath={`url(#${id}-c)`}>{circles(puffs)}</clipPath>
    </defs>
    <g clipPath={`url(#${id}-c)`}>
      <g fill={CL_DEEP}>{circles(puffs)}</g>
    </g>
    <g clipPath={`url(#${id}-s)`}>
      <g fill={CL_SHADE}>{circles(puffs, -0.06, -0.12, 0.98)}</g>
      <g fill={CL_MID}>{circles(puffs, -0.16, -0.26, 0.9)}</g>
      <g fill={CL_LIGHT}>{circles(puffs, -0.26, -0.38, 0.8)}</g>
    </g>
  </g>
);

// ---------------------------------------------------------------- the character

const Sparkle: React.FC<{ x: number; y: number; s: number; on: number; color?: string }> = ({ x, y, s, on, color = "#fff" }) => {
  if (on <= 0.02) return null;
  const k = s * on;
  const d = `M0 ${-k} C${k * 0.12} ${-k * 0.12} ${k * 0.12} ${-k * 0.12} ${k} 0 C${k * 0.12} ${k * 0.12} ${k * 0.12} ${k * 0.12} 0 ${k} C${-k * 0.12} ${k * 0.12} ${-k * 0.12} ${k * 0.12} ${-k} 0 C${-k * 0.12} ${-k * 0.12} ${-k * 0.12} ${-k * 0.12} 0 ${-k}Z`;
  return <path d={d} transform={`translate(${x} ${y})`} fill={color} stroke={INK} strokeWidth={Math.max(1.4, s * 0.07)} strokeLinejoin="round" />;
};

/** Stella, inked and cel-painted: a lit rim upper-left, a hard shadow crescent lower-right, a painted shine, anime eyes. */
const CelStella: React.FC<{ t: number; size: number; id: string; line?: number; simple?: boolean }> = ({ t, size, id, line = 3.4, simple }) => {
  const tq = onTwos(t + 0.4);
  const bob = Math.sin(tq * 2.6) * 0.035;
  const tilt = Math.sin(tq * 1.7) * 3;
  const C = STAR.C;
  const sw = (line / size) * 2 * C * 1.12;
  const { l, r, ew, eh } = starEyes();
  const ex = ew * 0.3 * 1.18;
  const ey = eh * 0.5 * 1.16;
  const blinkCycle = (t + 0.4) % 3.2;
  const blink = blinkCycle > 2.92 && blinkCycle < 3.06;
  const sh = C * 0.16; // shadow crescent depth
  const li = C * 0.07; // lit rim depth
  return (
    <svg width={size} height={size} viewBox={`${-C * 0.1} ${-C * 0.1} ${C * 2.2} ${C * 2.2}`} style={{ overflow: "visible", position: "absolute", left: 0, top: 0, transform: `translateY(${bob * size}px) rotate(${tilt}deg)` }}>
      <defs>
        <clipPath id={`${id}-b`}>
          <path d={STAR.path} />
        </clipPath>
        <mask id={`${id}-sh`} maskUnits="userSpaceOnUse" x={-C} y={-C} width={C * 4} height={C * 4}>
          <path d={STAR.path} fill="#fff" />
          <path d={STAR.path} fill="#000" transform={`translate(${-sh * 0.8} ${-sh})`} />
        </mask>
        <mask id={`${id}-li`} maskUnits="userSpaceOnUse" x={-C} y={-C} width={C * 4} height={C * 4}>
          <path d={STAR.path} fill="#fff" />
          <path d={STAR.path} fill="#000" transform={`translate(${li} ${li * 1.2})`} />
        </mask>
        <clipPath id={`${id}-eyes`}>
          {[l, r].map(([cx, cy], i) => (
            <ellipse key={i} cx={cx} cy={cy} rx={ex} ry={ey} />
          ))}
        </clipPath>
      </defs>
      <path d={STAR.path} fill={ST_BASE} />
      <path d={STAR.path} fill={ST_LIGHT} mask={`url(#${id}-li)`} />
      <path d={STAR.path} fill={ST_SHADE} mask={`url(#${id}-sh)`} />
      {simple ? null : (
        <g clipPath={`url(#${id}-b)`}>
          {/* warm bounce light in the shadow, the aurora's pink end */}
          <path d={STAR.path} fill="none" stroke={ST_RIM} strokeWidth={C * 0.05} transform={`translate(${-sh * 0.8 + C * 0.035} ${-sh + C * 0.035})`} opacity={0.9} clipPath={undefined} mask={`url(#${id}-sh)`} />
          {/* painted shine on the upper-left arm */}
          <path d={`M${C * 0.42} ${C * 0.62} Q ${C * 0.5} ${C * 0.5} ${C * 0.66} ${C * 0.47}`} stroke="#fff" strokeWidth={C * 0.06} strokeLinecap="round" fill="none" />
          <circle cx={C * 0.78} cy={C * 0.46} r={C * 0.03} fill="#fff" />
        </g>
      )}
      <path d={STAR.path} fill="none" stroke={INK} strokeWidth={sw} strokeLinejoin="round" />
      {blink ? (
        [l, r].map(([cx, cy], i) => (
          <path key={i} d={`M${cx - ex * 1.1} ${cy + ey * 0.1} Q ${cx} ${cy + ey * 0.55} ${cx + ex * 1.1} ${cy + ey * 0.1}`} stroke={INK} strokeWidth={sw * 1.3} fill="none" strokeLinecap="round" />
        ))
      ) : (
        <g>
          {[l, r].map(([cx, cy], i) => (
            <ellipse key={i} cx={cx} cy={cy} rx={ex} ry={ey} fill="#1e1b3d" />
          ))}
          {simple ? null : (
            <g clipPath={`url(#${id}-eyes)`}>
              {[l, r].map(([cx, cy], i) => (
                <ellipse key={i} cx={cx} cy={cy + ey * 0.95} rx={ex * 1.05} ry={ey * 0.85} fill="#4a63d6" />
              ))}
              {[l, r].map(([cx, cy], i) => (
                <ellipse key={`h${i}`} cx={cx} cy={cy + ey * 1.25} rx={ex * 0.8} ry={ey * 0.6} fill="#8fd0ff" />
              ))}
            </g>
          )}
          {[l, r].map(([cx, cy], i) => (
            <g key={`c${i}`} fill="#fff">
              <ellipse cx={cx - ex * 0.28} cy={cy - ey * 0.4} rx={ex * 0.42} ry={ey * 0.3} transform={`rotate(-20 ${cx - ex * 0.28} ${cy - ey * 0.4})`} />
              {simple ? null : <circle cx={cx + ex * 0.38} cy={cy + ey * 0.36} r={ex * 0.16} />}
            </g>
          ))}
        </g>
      )}
      {simple
        ? null
        : [l, r].map(([cx, cy], i) => (
            <g key={`b${i}`} stroke="#ff6f9f" strokeWidth={sw * 0.7} strokeLinecap="round">
              {[0, 1, 2].map((j) => {
                const bx = cx + (i ? ex * 0.9 : -ex * 0.9) + (j - 1) * ex * 0.5;
                const by = cy + ey * 1.32;
                return <line key={j} x1={bx + ex * 0.12} y1={by - ey * 0.12} x2={bx - ex * 0.12} y2={by + ey * 0.14} />;
              })}
            </g>
          ))}
    </svg>
  );
};

// ---------------------------------------------------------------- balloons

type BalloonSpec = { text: string; lines: number; me: boolean; cx: number; cy: number; fs: number; tail: [number, number]; tilt?: number };

/** A lettered speech balloon: inked oval with a brush-weighted line (heavier lower right), a pointed tail. */
const Balloon: React.FC<{ b: BalloonSpec; id: string; tone?: boolean }> = ({ b, id, tone }) => {
  const lines = ovalLines(b.text.toUpperCase(), b.lines);
  const cw = b.fs * 0.6;
  const lh = b.fs * 1.18;
  const tw = Math.max(...lines.map((s) => s.length)) * cw;
  const th = lines.length * lh;
  const rx = tw / 2 / 0.86 + b.fs * 0.9;
  const ry = th / 2 / 0.78 + b.fs * 0.55;
  const [tx, ty] = b.tail;
  // tail base on the oval rim, aimed at the speaker
  const ang = Math.atan2((ty - b.cy) / ry, (tx - b.cx) / rx);
  const spread = 0.2;
  const p1 = [b.cx + Math.cos(ang - spread) * rx * 0.92, b.cy + Math.sin(ang - spread) * ry * 0.92];
  const p2 = [b.cx + Math.cos(ang + spread) * rx * 0.92, b.cy + Math.sin(ang + spread) * ry * 0.92];
  const mid = [(p1[0] + tx) / 2, (p1[1] + ty) / 2];
  const bend = b.me ? 14 : -14;
  const tail = `M${p1[0]} ${p1[1]} Q ${mid[0] + bend} ${mid[1] - bend * 0.3} ${tx} ${ty} Q ${(p2[0] + tx) / 2} ${(p2[1] + ty) / 2} ${p2[0]} ${p2[1]} Z`;
  const shape = (o: number) => (
    <>
      <ellipse cx={b.cx} cy={b.cy} rx={rx + o} ry={ry + o} />
      <path d={tail} transform={o ? `translate(${(tx - b.cx) * 0} 0)` : undefined} />
    </>
  );
  return (
    <g transform={b.tilt ? `rotate(${b.tilt} ${b.cx} ${b.cy})` : undefined}>
      {/* ink: the shape grown, and nudged down-right so the line swells like a brush */}
      <g fill={INK} transform="translate(1.4 1.8)">{shape(3.2)}</g>
      <g fill={INK}>{shape(2.4)}</g>
      <g fill="#fffefa">{shape(0)}</g>
      {tone ? (
        <>
          <defs>
            <clipPath id={`${id}-clip`}>
              <ellipse cx={b.cx} cy={b.cy} rx={rx} ry={ry} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${id}-clip)`}>
            <ellipse cx={b.cx - rx * 0.05} cy={b.cy - ry * 0.18} rx={rx * 1.02} ry={ry * 1.08} fill="none" stroke="url(#an-tone)" strokeWidth={ry * 0.32} />
          </g>
        </>
      ) : null}
      <foreignObject x={b.cx - rx} y={b.cy - th / 2 - 2} width={rx * 2} height={th + 8}>
        <div
          style={{
            fontFamily: F.comicI,
            fontSize: b.fs,
            lineHeight: `${lh}px`,
            color: INK,
            textAlign: "center",
            letterSpacing: 0.3,
            whiteSpace: "nowrap",
          }}
        >
          {lines.map((s, i) => (
            <div key={i}>{s}</div>
          ))}
        </div>
      </foreignObject>
    </g>
  );
};

// ---------------------------------------------------------------- top bar & composer

const InkIcon: React.FC<{ kind: "gear" | "panel"; x: number; y: number }> = ({ kind, x, y }) => (
  <g transform={`translate(${x} ${y})`} stroke={INK} strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round">
    {kind === "gear" ? (
      <>
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return <line key={i} x1={Math.cos(a) * 6.5} y1={Math.sin(a) * 6.5} x2={Math.cos(a) * 9.5} y2={Math.sin(a) * 9.5} strokeWidth={3.2} />;
        })}
        <circle r={6.6} fill={PAPER} />
        <circle r={2.6} />
      </>
    ) : (
      <>
        <rect x={-9} y={-8} width={18} height={16} rx={3} fill={PAPER} />
        <line x1={2.5} y1={-8} x2={2.5} y2={8} />
      </>
    )}
  </g>
);

const TopBar: React.FC<{ t: number; w: number; hBar: number }> = ({ t, w, hBar }) => (
  <div style={{ position: "absolute", left: 0, top: 0, width: w, height: hBar, background: PAPER, borderBottom: `3px solid ${INK}` }}>
    <svg width={w} height={hBar} style={{ position: "absolute", left: 0, top: 0 }}>
      {["#ff5f57", "#ffc42e", "#36c75a"].map((c, i) => (
        <g key={i} transform={`translate(${26 + i * 26} ${hBar / 2})`}>
          <circle r={8} fill={c} stroke={INK} strokeWidth={2.2} />
          <path d="M-4 -2.5 Q -3 -5 0 -5.2" stroke="#fff" strokeWidth={2} fill="none" strokeLinecap="round" />
        </g>
      ))}
      <InkIcon kind="gear" x={w - 72} y={hBar / 2} />
      <InkIcon kind="panel" x={w - 36} y={hBar / 2} />
    </svg>
    <div style={{ position: "absolute", left: w / 2 - 80, width: 160, top: 0, height: hBar, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
      <div style={{ position: "relative", width: 34, height: 34 }}>
        <CelStella t={t} size={34} id="an-bar" line={1.5} simple />
      </div>
      <span style={{ fontFamily: F.dela, fontSize: 19, color: INK, letterSpacing: 1, transform: "translateY(1px)" }}>ステラ</span>
    </div>
    <div style={{ position: "absolute", right: 96, top: 0, height: hBar, display: "flex", alignItems: "center", gap: 7, fontFamily: F.comic, fontSize: 17, color: INK }}>
      Account
      <span style={{ fontFamily: F.bangers, fontSize: 14, letterSpacing: 1, color: "#fff", background: RED, padding: "1px 6px 0", border: `2px solid ${INK}`, transform: "rotate(-4deg)" }}>PRO</span>
    </div>
  </div>
);

const Composer: React.FC<{ t: number; x: number; y: number; w: number; h: number }> = ({ t, x, y, w, h }) => {
  const caret = Math.floor(t * 2.2 + 0.3) % 2 === 0;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h }}>
      {/* flat cel shadow, no blur */}
      <div style={{ position: "absolute", left: 7, top: 8, width: w, height: h, borderRadius: 14, background: INK }} />
      <div style={{ position: "absolute", inset: 0, borderRadius: 14, background: "#fffefa", border: `3px solid ${INK}`, overflow: "hidden" }}>
        <svg width={w} height={h} style={{ position: "absolute", left: -3, top: -3 }}>
          <rect x={0} y={h * 0.62} width={w} height={h} fill="url(#an-tone-grey)" />
        </svg>
      </div>
      <svg width={w} height={h} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
        <g transform={`translate(${h / 2} ${h / 2})`}>
          <circle r={h * 0.3} fill={PAPER} stroke={INK} strokeWidth={2.6} />
          <path d={`M${-h * 0.12} 0 H ${h * 0.12} M 0 ${-h * 0.12} V ${h * 0.12}`} stroke={INK} strokeWidth={3} strokeLinecap="round" />
        </g>
        <g transform={`translate(${w - h * 1.25} ${h / 2})`} stroke={INK} strokeWidth={2.6} fill="none" strokeLinecap="round">
          <rect x={-5.5} y={-12} width={11} height={17} rx={5.5} fill={PAPER} />
          <path d="M-10 -1 Q -10 10 0 10 Q 10 10 10 -1 M 0 10 V 14" />
        </g>
        {/* send: a red disc with an inked arrow and three speed lines */}
        <g transform={`translate(${w - h / 2} ${h / 2})`}>
          <circle r={h * 0.33} fill={RED} stroke={INK} strokeWidth={2.8} />
          <path d={`M0 ${h * 0.15} V ${-h * 0.14} M ${-h * 0.12} ${-h * 0.02} L 0 ${-h * 0.15} L ${h * 0.12} ${-h * 0.02}`} stroke="#fff" strokeWidth={3.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
      <div style={{ position: "absolute", left: h * 0.95, top: 0, height: h, display: "flex", alignItems: "center", fontFamily: F.comicI, fontSize: Math.round(h * 0.34), color: "#77738c", letterSpacing: 0.4 }}>
        {CHAT.placeholder.toUpperCase()}…
        <span style={{ display: "inline-block", width: 3, height: h * 0.38, background: caret ? INK : "transparent", marginLeft: 6 }} />
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- scene

export const AnimeSkin: React.FC<SkinProps> = ({ t, w, h }) => {
  const tall = h > w;
  const hBar = 58;
  const pan = t * 9; // background pan, px/s
  const tq = onTwos(t);

  // ---- layout
  const L = tall
    ? {
        mascot: { x: 70, y: 330, s: 320 },
        title: { x: 44, y: 104, s: 1 },
        chatX: 40,
        chatW: w - 80,
        comp: { x: 36, y: h - 34 - 84, w: w - 80, h: 84 },
        fs: 23,
        horizon: h * 0.8,
      }
    : {
        mascot: { x: 120, y: 330, s: 320 },
        title: { x: 54, y: 96, s: 1 },
        chatX: 560,
        chatW: w - 560 - 60,
        comp: { x: 560, y: h - 28 - 72, w: w - 560 - 66, h: 72 },
        fs: 20,
        horizon: h * 0.8,
      };

  // balloon stack (from the bottom up above the composer)
  const gap = tall ? 12 : 10;
  const specs: Omit<BalloonSpec, "cx" | "cy" | "tail">[] = [
    { text: CHAT.me1, lines: 3, me: true, fs: L.fs },
    { text: CHAT.her1, lines: 3, me: false, fs: L.fs },
    { text: CHAT.me2, lines: 2, me: true, fs: L.fs },
    { text: CHAT.her2, lines: 2, me: false, fs: L.fs },
  ];
  const sizeOf = (s: (typeof specs)[number]) => {
    const lines = ovalLines(s.text.toUpperCase(), s.lines);
    const tw = Math.max(...lines.map((x) => x.length)) * s.fs * 0.6;
    const th = lines.length * s.fs * 1.18;
    return { rx: tw / 2 / 0.86 + s.fs * 0.9, ry: th / 2 / 0.78 + s.fs * 0.55 };
  };
  const balloons: BalloonSpec[] = [];
  let yCursor = L.comp.y - (tall ? 30 : 22);
  const mascotC = { x: L.mascot.x + L.mascot.s / 2, y: L.mascot.y + L.mascot.s / 2 };
  for (let i = specs.length - 1; i >= 0; i--) {
    const s = specs[i];
    const { rx, ry } = sizeOf(s);
    const cy = yCursor - ry;
    const cx = s.me ? L.chatX + L.chatW - rx - 30 : L.chatX + rx + (tall ? 8 : 4);
    let tail: [number, number];
    if (s.me) tail = [cx + rx + 34, cy + ry * 0.5];
    else {
      const a = Math.atan2(mascotC.y - cy, mascotC.x - cx);
      const reach = Math.hypot(Math.cos(a) * rx, Math.sin(a) * ry) + 40;
      tail = [cx + Math.cos(a) * reach, cy + Math.sin(a) * reach];
    }
    balloons.unshift({ ...s, cx, cy, tail, tilt: s.me ? -1.2 : 1 });
    yCursor = cy - ry - gap;
  }
  const stampY = yCursor - 8;
  const herTail = !tall;

  // ---- telephone pole + wires
  const poleX = tall ? w - 70 : w - 64;
  const wireY0 = tall ? 300 : 150;

  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, overflow: "hidden", background: SKY_MID }}>
      <svg width={w} height={h} style={{ position: "absolute", left: 0, top: 0 }}>
        <defs>
          <linearGradient id="an-sky" x1={0} y1={0} x2={0} y2={1}>
            <stop offset={0} stopColor={SKY_TOP} />
            <stop offset={0.45} stopColor={SKY_MID} />
            <stop offset={0.86} stopColor={SKY_LOW} />
            <stop offset={1} stopColor="#eef4ec" />
          </linearGradient>
          <pattern id="an-tone" width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <circle cx={3} cy={3} r={1.25} fill="#7f8fe6" />
          </pattern>
          <pattern id="an-tone-grey" width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <circle cx={3} cy={3} r={1.1} fill="#c9c4d9" />
          </pattern>
          <filter id="an-grain" x={0} y={0} width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency={0.9} numOctaves={2} seed={Math.floor(t * 12) % 7} />
            <feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.9 0" />
          </filter>
          <filter id="an-brush" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.012 0.08" numOctaves={2} seed={4} />
            <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.16 0" />
          </filter>
        </defs>
        <rect width={w} height={h} fill="url(#an-sky)" />
        {/* gouache drag: faint horizontal brush texture in the sky */}
        <rect width={w} height={h * 0.8} filter="url(#an-brush)" opacity={0.7} />

        {/* far cirrus streaks */}
        {[0, 1, 2, 3].map((i) => {
          const y = (tall ? 170 : 92) + i * 22 + hash(i, 3) * 20;
          const x = ((hash(i, 4) * w * 1.4 - pan * 0.4) % (w * 1.4)) - w * 0.2;
          return <rect key={i} x={x} y={y} width={180 + hash(i, 5) * 220} height={3 + hash(i, 6) * 3} rx={3} fill="#e8f2fb" opacity={0.55} />;
        })}

        {/* the cumulonimbus tower, slow pan */}
        <Cloud id="an-cb" puffs={cumulus(11, tall ? 620 : 640, tall ? 560 : 520)} x={(tall ? w * 0.52 : w * 0.7) - pan * 0.35} y={L.horizon - (tall ? 60 : 50)} baseY={40} />
        <Cloud id="an-c2" puffs={smallCloud(5, 300)} x={(tall ? 560 : 420) - pan * 0.7} y={tall ? 330 : 250} s={1} baseY={18} />
        <Cloud id="an-c3" puffs={smallCloud(9, 220)} x={(tall ? 160 : 1010) - pan * 0.8} y={tall ? 760 : 140} s={1} baseY={14} />

        {/* distant town on the horizon, hazed */}
        <g fill="#93b5d2">
          {Array.from({ length: 40 }, (_, i) => {
            const bw = 26 + hash(i, 21) * 54;
            const bh = 10 + hash(i, 22) * 40 + (hash(i, 23) > 0.85 ? 40 : 0);
            const x = i * (w / 34) - 20 - pan * 0.15;
            return <rect key={i} x={x} y={L.horizon - bh} width={bw} height={bh + 30} />;
          })}
        </g>
        <g fill="#7799bd">
          {Array.from({ length: 26 }, (_, i) => {
            const bw = 44 + hash(i, 31) * 80;
            const bh = 6 + hash(i, 32) * 26;
            const x = i * (w / 22) - 40 - pan * 0.25;
            return <rect key={i} x={x} y={L.horizon + 14 - bh} width={bw} height={bh + 30} />;
          })}
        </g>
        {/* river, with glints that slide */}
        <rect x={0} y={L.horizon + 14} width={w} height={h} fill="#86b7da" />
        <rect x={0} y={L.horizon + 14} width={w} height={3} fill="#d9ecf6" />
        {Array.from({ length: 22 }, (_, i) => {
          const y = L.horizon + 22 + hash(i, 51) * 46;
          const len = 16 + hash(i, 52) * 60;
          const x = ((hash(i, 53) * (w + 200) - pan * 1.6 * (0.5 + hash(i, 54))) % (w + 200) + w + 200) % (w + 200) - 100;
          return <rect key={i} x={x} y={y} width={len} height={2.5} rx={1.2} fill="#eef7fc" opacity={0.85} />;
        })}
        {/* the grass embankment in the foreground: flat cel greens, a hard shade, tufts */}
        {(() => {
          const y0 = L.horizon + (tall ? 92 : 66);
          const d = `M -10 ${y0 + 22} C ${w * 0.25} ${y0 - 4}, ${w * 0.55} ${y0 + 10}, ${w + 10} ${y0 - 8} L ${w + 10} ${h + 10} L -10 ${h + 10} Z`;
          return (
            <g>
              <path d={d} fill="#5f9e45" />
              <path d={d} fill="#3f7a3a" transform="translate(0 26)" />
              <path d={d} fill="#2f5f33" transform="translate(0 80)" />
              <path d={`M -10 ${y0 + 22} C ${w * 0.25} ${y0 - 4}, ${w * 0.55} ${y0 + 10}, ${w + 10} ${y0 - 8}`} stroke="#8ccf5c" strokeWidth={4} fill="none" />
              {Array.from({ length: 46 }, (_, i) => {
                const x = (i / 45) * w + (hash(i, 61) - 0.5) * 20;
                const u = x / w;
                const yy = y0 + 22 * Math.pow(1 - u, 3) + (-4) * 3 * Math.pow(1 - u, 2) * u + 10 * 3 * (1 - u) * u * u - 8 * u * u * u;
                const hh = 8 + hash(i, 62) * 14;
                const sway = Math.sin(onTwos(t) * 3 + i) * 2;
                return <path key={i} d={`M${x - 5} ${yy + 3} L ${x + sway} ${yy - hh} L ${x + 4} ${yy + 3} Z`} fill={hash(i, 63) > 0.5 ? "#4f8e3e" : "#7bbd52"} />;
              })}
            </g>
          );
        })()}

        {/* telephone pole and wires: a silhouette against the sky */}
        <g>
          {[0, 1, 2, 3].map((i) => {
            const y0 = wireY0 + i * 10 + (i > 1 ? 34 : 0);
            const ex = poleX - (tall ? 420 : 820) - i * 30;
            return <path key={i} d={`M${poleX} ${y0} Q ${(poleX + ex) / 2} ${y0 + 34 + i * 6} ${ex} ${-10}`} stroke="#2b3046" strokeWidth={1.7} fill="none" />;
          })}
          {[0, 1, 2, 3].map((i) => {
            const y0 = wireY0 + i * 10 + (i > 1 ? 34 : 0);
            return <path key={`r${i}`} d={`M${poleX} ${y0} Q ${(poleX + w) / 2 + 20} ${y0 + 22} ${w + 40} ${y0 + 6 + i * 6}`} stroke="#2b3046" strokeWidth={1.7} fill="none" />;
          })}
          <rect x={poleX - 7} y={wireY0 - 40} width={14} height={h} fill="#2b3046" />
          <rect x={poleX - 46} y={wireY0 - 6} width={92} height={7} fill="#2b3046" />
          <rect x={poleX - 34} y={wireY0 + 37} width={68} height={6} fill="#2b3046" />
          {[-38, -14, 14, 38].map((dx) => (
            <rect key={dx} x={poleX + dx - 3} y={wireY0 - 12} width={6} height={8} rx={2} fill="#2b3046" />
          ))}
          <rect x={poleX - 22} y={wireY0 + 90} width={16} height={26} fill="#2b3046" />
          {Array.from({ length: 8 }, (_, i) => (
            <rect key={i} x={poleX - (i % 2 ? 13 : -3)} y={wireY0 + 150 + i * 28} width={10} height={4} fill="#2b3046" />
          ))}
          <rect x={poleX - 5} y={wireY0 - 40} width={3} height={h} fill="#555c80" />
        </g>

        {/* speed lines behind the character: she is in motion, drawn on twos */}
        <g opacity={0.9}>
          {Array.from({ length: 16 }, (_, i) => {
            const seed = i + Math.floor(tq * 12) * 31;
            const y = mascotC.y - L.mascot.s * 0.55 + hash(i, 41) * L.mascot.s * 1.1;
            const len = 60 + hash(seed, 42) * 160;
            const x = mascotC.x - L.mascot.s * 0.25 - len - hash(seed, 43) * 140 + (tall ? 0 : 20);
            const th = 1.4 + hash(i, 44) * 2.6;
            return <path key={i} d={`M${x} ${y} L ${x + len} ${y - th / 2} L ${x + len} ${y + th / 2} Z`} fill="#fff" opacity={0.6 + 0.4 * hash(seed, 45)} />;
          })}
        </g>
      </svg>

      {/* the character */}
      <div style={{ position: "absolute", left: L.mascot.x, top: L.mascot.y, width: L.mascot.s, height: L.mascot.s }}>
        <CelStella t={t} size={L.mascot.s} id="an-hero" />
      </div>

      {/* sparkles and the kira sound effect */}
      <svg width={w} height={h} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
        {[
          [-0.08, -0.02, 26, 0],
          [1.02, 0.12, 18, 0.6],
          [0.92, 0.95, 22, 1.1],
          [0.0, 0.86, 14, 1.7],
          [0.6, -0.12, 12, 0.9],
        ].map(([fx, fy, s, ph], i) => {
          const c = ((onTwos(t) + (ph as number)) % 2.2) / 2.2;
          const on = Math.max(0, Math.sin(c * Math.PI));
          return <Sparkle key={i} x={L.mascot.x + L.mascot.s * (fx as number)} y={L.mascot.y + L.mascot.s * (fy as number)} s={s as number} on={0.35 + 0.65 * on} />;
        })}
      </svg>
      <div
        style={{
          position: "absolute",
          left: L.mascot.x + L.mascot.s * (tall ? 0.98 : 0.86),
          top: L.mascot.y + L.mascot.s * (tall ? 0.02 : -0.1),
          fontFamily: F.dela,
          fontSize: 34,
          color: "#fff",
          WebkitTextStroke: `7px ${INK}`,
          paintOrder: "stroke fill",
          transform: `rotate(${tall ? 12 : 12}deg) scale(${1 + 0.04 * Math.sin(onTwos(t) * 9)})`,
          writingMode: "vertical-rl",
          letterSpacing: -2,
        }}
      >
        キラッ
      </div>

      {/* episode title card */}
      <div style={{ position: "absolute", left: L.title.x, top: L.title.y, transform: "rotate(-3deg)", transformOrigin: "0 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: F.dela, fontSize: 24, color: "#fff", background: RED, border: `3px solid ${INK}`, padding: "1px 10px 3px", boxShadow: `3px 3px 0 ${INK}` }}>第1話</span>
          <span style={{ fontFamily: F.bangers, fontSize: 20, letterSpacing: 2, color: "#fff", WebkitTextStroke: `5px ${INK}`, paintOrder: "stroke fill" }}>EPISODE 1</span>
        </div>
        <div
          style={{
            fontFamily: F.dela,
            fontSize: tall ? 66 : 60,
            lineHeight: 1.08,
            marginTop: 6,
            color: YELLOW,
            WebkitTextStroke: `10px ${INK}`,
            paintOrder: "stroke fill",
            textShadow: `6px 6px 0 ${RED}`,
            letterSpacing: -1,
            fontFeatureSettings: '"palt"',
          }}
        >
          ステラ、変身!
        </div>
        <div style={{ fontFamily: F.bangers, fontSize: tall ? 27 : 25, letterSpacing: 2.5, color: "#fff", WebkitTextStroke: `6px ${INK}`, paintOrder: "stroke fill", marginTop: 4, marginLeft: 4 }}>
          STELLA TRANSFORMS!
        </div>
      </div>

      {/* the conversation, lettered */}
      <svg width={w} height={h} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
        {balloons.map((b, i) => (
          <Balloon key={i} b={herTail || b.me ? b : b} id={`an-b${i}`} tone={!b.me} />
        ))}
      </svg>

      {/* stamp as a narration caption box */}
      <div
        style={{
          position: "absolute",
          left: tall ? w / 2 - 110 : L.chatX + L.chatW / 2 - 100,
          top: stampY - 34,
          width: tall ? 220 : 200,
          height: 32,
          background: "#fffefa",
          border: `3px solid ${INK}`,
          boxShadow: `4px 4px 0 ${INK}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: F.comicI,
          fontSize: 16,
          color: INK,
          letterSpacing: 0.6,
          transform: "rotate(-1deg)",
        }}
      >
        {CHAT.stamp.toUpperCase()}
      </div>

      <Composer t={t} x={L.comp.x} y={L.comp.y} w={L.comp.w} h={L.comp.h} />

      <TopBar t={t} w={w} hBar={hBar} />

      {/* the warmth of painted cels shot on film */}
      <div style={{ position: "absolute", inset: 0, background: "#ffdcae", mixBlendMode: "multiply", opacity: 0.1, pointerEvents: "none" }} />
      {/* film grain, re-rolled on twos */}
      <svg width={w} height={h} style={{ position: "absolute", left: 0, top: 0, mixBlendMode: "overlay", opacity: 0.22, pointerEvents: "none" }}>
        <rect width={w} height={h} filter="url(#an-grain)" />
      </svg>
    </div>
  );
};
