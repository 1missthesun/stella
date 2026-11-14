import React from "react";
import { CHAT, type SkinProps } from "./content";
import { F, STAR, hash } from "./kit";

/**
 * A fishkeeper's Stella: the window is a planted tank seen through the front glass.
 * The light bar and rim are the top bar (with the tank's temperature and pH, because
 * a fishkeeper always wants to see them), the messages are air bubbles drifting up
 * through the water, stem plants sway, a school of small tetras crosses behind them,
 * an airstone streams, light caustics play over the stones. The composer is a frosted
 * label on the front glass.
 */

const INK = "#0f2f2e";

type Leaf = { x: number; y: number; a: number; l: number; c: string };

function stem(i: number, x0: number, base: number, height: number, t: number, hue: number): { d: string; leaves: Leaf[] } {
  const n = 14;
  const sway = Math.sin(t * 0.9 + i * 1.7) * 10 + Math.sin(t * 2.1 + i) * 3;
  const pts: [number, number][] = [];
  for (let k = 0; k <= n; k++) {
    const u = k / n;
    pts.push([x0 + sway * u * u + (hash(i, 7) - 0.5) * 20 * u, base - height * u]);
  }
  const d = "M" + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L");
  const greens = [
    ["#3f9a3a", "#6cc04a", "#2f7a35"],
    ["#5aa83a", "#8fd04f", "#3c8a2e"],
    ["#b0542e", "#e07a3e", "#8a3a22"],
  ][hue];
  const leaves: Leaf[] = [];
  for (let k = 1; k <= n; k++) {
    const [x, y] = pts[k];
    const l = 14 + 10 * (1 - k / n) + hash(i * 31 + k, 2) * 5;
    leaves.push({ x, y, a: -35 - hash(k, i) * 20, l, c: greens[k % 3] });
    leaves.push({ x, y: y + 4, a: 180 + 35 + hash(k + 9, i) * 20, l, c: greens[(k + 1) % 3] });
  }
  return { d, leaves };
}

const Fish: React.FC<{ x: number; y: number; s: number; t: number; ph: number; dir: number }> = ({ x, y, s, t, ph, dir }) => {
  const wag = Math.sin(t * 11 + ph) * 0.25;
  return (
    <g transform={`translate(${x} ${y}) scale(${dir * s} ${s})`}>
      {/* tail */}
      <path d={`M 18 0 L 30 ${-7 + wag * 10} L 28 0 L 30 ${7 + wag * 10} Z`} fill="#d9c9b8" opacity={0.75} />
      {/* body */}
      <path d="M -20 0 C -14 -8, 10 -8, 20 -1 C 10 7, -14 8, -20 0 Z" fill="#cdd6d2" />
      {/* red belly to the tail */}
      <path d="M 0 1.5 C 6 1.5, 14 1, 20 -1 C 12 5, 4 6, 0 5.5 Z" fill="#e2382f" />
      {/* the iridescent stripe */}
      <path d="M -15 -1.6 C -5 -3.6, 8 -3, 19 -1.2 L 19 0.6 C 8 -0.8, -5 -1, -15 0.6 Z" fill="#33d9ff" />
      <circle cx={-14} cy={-1.5} r={1.9} fill="#111" />
      <circle cx={-14.5} cy={-2.1} r={0.6} fill="#fff" />
    </g>
  );
};

/** An air bubble that carries a message: glassy rim, bright specular, text inside. */
const Bubble: React.FC<{ x: number; y: number; w: number; me: boolean; text: string; fs: number; t: number; i: number }> = ({ x, y, w, me, text, fs, t, i }) => {
  const rise = -((t * 4 + i * 1.3) % 6);
  const wob = Math.sin(t * 1.6 + i * 2) * 3;
  return (
    <div style={{ position: "absolute", left: x + wob, top: y + rise, width: w }}>
      <div
        style={{
          position: "relative",
          padding: `${fs * 0.62}px ${fs * 1.05}px`,
          borderRadius: 999,
          background: me
            ? "radial-gradient(120% 140% at 30% 20%, rgba(255,255,255,.95), rgba(236,252,250,.86) 55%, rgba(190,236,232,.8) 100%)"
            : "radial-gradient(120% 140% at 30% 20%, rgba(255,255,255,.92), rgba(220,246,226,.84) 55%, rgba(170,220,190,.8) 100%)",
          boxShadow: "inset 0 0 0 2px rgba(255,255,255,.85), inset 0 -6px 14px rgba(40,120,120,.25), 0 6px 14px rgba(10,50,50,.18)",
          fontFamily: F.nunito,
          fontWeight: 700,
          fontSize: fs,
          lineHeight: 1.3,
          color: INK,
          textAlign: me ? "right" : "left",
        }}
      >
        {/* specular */}
        <div style={{ position: "absolute", left: "7%", top: 6, width: "22%", height: 7, borderRadius: 6, background: "rgba(255,255,255,.95)" }} />
        <div style={{ position: "absolute", right: "6%", bottom: 7, width: 9, height: 9, borderRadius: 5, background: "rgba(255,255,255,.75)" }} />
        {text}
      </div>
    </div>
  );
};

export const AquariumSkin: React.FC<SkinProps> = ({ t, w, h }) => {
  const tall = h > w;
  const barH = 64;
  const water = barH + 16;
  const subTop = h - (tall ? 190 : 150);
  const fs = tall ? 25 : 21;
  const colX = tall ? 50 : 360;
  const colW = tall ? w - 100 : 760;

  // plants: a soft back wall across the whole tank, crisp groups at the sides
  const tankH = subTop - water;
  const backStems = Array.from({ length: tall ? 26 : 40 }, (_, i) => {
    const x = (i / ((tall ? 26 : 40) - 1)) * w + (hash(i, 61) - 0.5) * 30;
    const height = tankH * (0.5 + 0.42 * hash(i, 62));
    return stem(i + 100, x, subTop + 30, height, t * 0.7, hash(i, 63) > 0.85 ? 2 : hash(i, 64) > 0.5 ? 1 : 0);
  });
  const stems = Array.from({ length: tall ? 18 : 30 }, (_, i) => {
    const n = tall ? 18 : 30;
    const side = i / n;
    const x = side < 0.5 ? side * 2 * (w * (tall ? 0.3 : 0.22)) : w * (tall ? 0.7 : 0.78) + (side - 0.5) * 2 * (w * (tall ? 0.3 : 0.22));
    const edge = side < 0.5 ? 1 - side * 2 : (side - 0.5) * 2; // taller toward the glass ends
    const height = tankH * (0.38 + 0.5 * edge * (0.6 + 0.4 * hash(i, 3)));
    return stem(i, x, subTop + 30, height, t, hash(i, 4) > 0.8 ? 2 : hash(i, 5) > 0.5 ? 1 : 0);
  });
  // a school of tetras crossing right-to-left behind the bubbles
  const school = Array.from({ length: 11 }, (_, i) => {
    const span = w + 300;
    const bx = ((w * 0.9 - t * 46 + i * 0) % span + span) % span - 150;
    const ox = (hash(i, 11) - 0.5) * 220 + Math.sin(t * 1.3 + i) * 8;
    const oy = (hash(i, 12) - 0.5) * 120 + Math.sin(t * 1.9 + i * 2) * 5;
    return { x: bx + ox, y: (tall ? h * 0.3 : h * 0.3) + oy, s: 1.5 + hash(i, 13) * 0.4, ph: i * 1.3 };
  });

  // airstone stream
  const stoneX = tall ? w - 120 : w - 230;
  const bubbles = Array.from({ length: 26 }, (_, i) => {
    const speed = 120 + hash(i, 21) * 60;
    const life = (subTop - water) / speed;
    const age = (((t + hash(i, 22) * life) % life) + life) % life;
    const y = subTop - 6 - age * speed;
    const x = stoneX + Math.sin(age * 6 + i) * (4 + age * 6) + (hash(i, 23) - 0.5) * 10;
    return { x, y, r: 2.5 + hash(i, 24) * 4.5 };
  });

  // messages, bottom up above the label
  const comp = { x: colX, y: h - (tall ? 118 : 104), w: colW, h: 70 };
  const msgs: [boolean, string][] = [
    [true, CHAT.me1],
    [false, CHAT.her1],
    [true, CHAT.me2],
    [false, CHAT.her2],
  ];
  const est = (s: string, bw: number) => Math.ceil((s.length * fs * 0.52) / (bw - fs * 2.1)) * fs * 1.3 + fs * 1.24;
  const widthOf = (s: string) => Math.min(colW * (tall ? 0.86 : 0.7), s.length * fs * 0.52 + fs * 2.3);
  let y = comp.y - 34;
  const placed: { me: boolean; text: string; x: number; y: number; bw: number }[] = [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const [me, s] = msgs[i];
    const bw = widthOf(s);
    y -= est(s, bw);
    placed.unshift({ me, text: s, x: me ? colX + colW - bw : colX, y, bw });
    y -= 16;
  }
  const caret = Math.floor(t * 2.4) % 2 === 0;
  const temp = (25.4 + Math.sin(t * 0.3) * 0.0).toFixed(1);

  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, overflow: "hidden", background: "#0e2b30" }}>
      <svg width={w} height={h} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <linearGradient id="aq-water" x1={0} y1={0} x2={0} y2={1}>
            <stop offset={0} stopColor="#d6f2ec" />
            <stop offset={0.35} stopColor="#96d3c6" />
            <stop offset={0.75} stopColor="#4f9e93" />
            <stop offset={1} stopColor="#2a6c66" />
          </linearGradient>
          <filter id="aq-caustic" x={0} y={0} width="100%" height="100%">
            <feTurbulence type="turbulence" baseFrequency="0.012 0.02" numOctaves={2} seed={6} />
            <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 0.92  -3.2 0 0 0 1.05" />
          </filter>
          <filter id="aq-soft">
            <feGaussianBlur stdDeviation={2.5} />
          </filter>
          <linearGradient id="aq-rock" x1={0} y1={0} x2={1} y2={1}>
            <stop offset={0} stopColor="#b9bdb6" />
            <stop offset={0.5} stopColor="#868c86" />
            <stop offset={1} stopColor="#4d544f" />
          </linearGradient>
          <filter id="aq-grain">
            <feTurbulence type="fractalNoise" baseFrequency={0.5} numOctaves={3} seed={9} />
            <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.45 -0.12" />
            <feComposite in2="SourceGraphic" operator="in" />
          </filter>
        </defs>
        <rect width={w} height={h} fill="url(#aq-water)" />
        {/* distant plant haze */}
        <g filter="url(#aq-soft)" opacity={0.55}>
          {Array.from({ length: 16 }, (_, i) => (
            <ellipse key={i} cx={(i / 15) * w} cy={subTop - 40} rx={70 + hash(i, 40) * 60} ry={110 + hash(i, 41) * 120} fill={hash(i, 42) > 0.5 ? "#5c9f6a" : "#4c8e60"} />
          ))}
        </g>
        {/* back wall of stems, softened by the water */}
        <g filter="url(#aq-soft)" opacity={0.6}>
          {backStems.map((s, i) => (
            <g key={i}>
              <path d={s.d} stroke="#3c7a3a" strokeWidth={2.4} fill="none" />
              {s.leaves.map((l, k) => (
                <ellipse key={k} cx={l.x} cy={l.y} rx={l.l / 2} ry={l.l / 5} fill={l.c} transform={`rotate(${l.a} ${l.x} ${l.y}) translate(${l.l / 2} 0)`} />
              ))}
            </g>
          ))}
        </g>
        <rect x={0} y={water} width={w} height={subTop - water} fill="#9fd8cc" opacity={0.28} />
        {/* stems */}
        {stems.map((s, i) => (
          <g key={i}>
            <path d={s.d} stroke="#3c7a3a" strokeWidth={2.4} fill="none" />
            {s.leaves.map((l, k) => (
              <ellipse key={k} cx={l.x} cy={l.y} rx={l.l / 2} ry={l.l / 6} fill={l.c} transform={`rotate(${l.a} ${l.x} ${l.y}) translate(${l.l / 2} 0)`} />
            ))}
          </g>
        ))}
        {/* fish */}
        {school.map((f, i) => (
          <Fish key={i} x={f.x} y={f.y} s={f.s} t={t} ph={f.ph} dir={1} />
        ))}
        {/* rocks */}
        {(tall
          ? [
              [w * 0.18, subTop + 40, 190, 150, -8],
              [w * 0.72, subTop + 50, 140, 110, 10],
            ]
          : [
              [w * 0.14, subTop + 30, 230, 170, -10],
              [w * 0.27, subTop + 60, 120, 80, 6],
              [w * 0.84, subTop + 40, 200, 140, 12],
            ]
        ).map(([x, y0, rw, rh, a], i) => {
          const P = (fx: number, fy: number) => `${x + rw * fx} ${y0 + rh * fy}`;
          const d = `M ${P(-0.5, 0.3)} L ${P(-0.36, -0.5)} L ${P(0.02, -0.82)} L ${P(0.3, -0.45)} L ${P(0.5, 0.3)} Z`;
          return (
            <g key={i} transform={`rotate(${a} ${x} ${y0})`}>
              <path d={d} fill="#7d837d" />
              <path d={`M ${P(-0.5, 0.3)} L ${P(-0.36, -0.5)} L ${P(0.02, -0.82)} L ${P(-0.04, 0.3)} Z`} fill="#a9aea6" />
              <path d={`M ${P(0.02, -0.82)} L ${P(0.3, -0.45)} L ${P(0.5, 0.3)} L ${P(0.12, 0.3)} Z`} fill="#5a615c" />
              <path d={d} fill="#000" filter="url(#aq-grain)" />
              <path d={`M ${P(-0.3, -0.42)} L ${P(-0.1, -0.2)} L ${P(-0.16, 0.1)}`} stroke="#3e4541" strokeWidth={2} fill="none" opacity={0.6} />
            </g>
          );
        })}
        {/* substrate: dark soil behind, pale sand in front, a carpet of tiny leaves */}
        <path d={`M 0 ${subTop + 20} Q ${w * 0.3} ${subTop - 10} ${w * 0.6} ${subTop + 14} T ${w} ${subTop + 6} V ${h} H 0 Z`} fill="#3a2a22" />
        {Array.from({ length: Math.floor(w / 7) }, (_, i) => {
          const x = i * 7 + hash(i, 50) * 6;
          const yy = subTop + 14 + Math.sin(x / w * 6) * 8 + hash(i, 51) * 10;
          return <ellipse key={i} cx={x} cy={yy} rx={5} ry={3} fill={hash(i, 52) > 0.5 ? "#6cc44a" : "#4fa53c"} transform={`rotate(${hash(i, 53) * 60 - 30} ${x} ${yy})`} />;
        })}
        <path d={`M 0 ${h - 60} Q ${w * 0.5} ${h - 90} ${w} ${h - 56} V ${h} H 0 Z`} fill="#e3d6bd" />
        <path d={`M 0 ${h - 60} Q ${w * 0.5} ${h - 90} ${w} ${h - 56} V ${h} H 0 Z`} fill="#000" filter="url(#aq-grain)" opacity={0.6} />
        {/* airstone and its stream */}
        <rect x={stoneX - 14} y={subTop + 2} width={28} height={12} rx={6} fill="#7d8a88" />
        {bubbles.map((b, i) => (
          <g key={i}>
            <circle cx={b.x} cy={b.y} r={b.r} fill="rgba(255,255,255,.25)" stroke="rgba(255,255,255,.85)" strokeWidth={1.2} />
            <circle cx={b.x - b.r * 0.35} cy={b.y - b.r * 0.35} r={b.r * 0.3} fill="#fff" />
          </g>
        ))}
        {/* caustics drifting over everything */}
        <g style={{ mixBlendMode: "soft-light" }} opacity={0.4}>
          <rect x={-200 + Math.sin(t * 0.4) * 40 - t * 14} y={-100 + t * 6} width={w + 400} height={h + 200} filter="url(#aq-caustic)" />
        </g>
        {/* water surface just under the rim */}
        <rect x={0} y={barH} width={w} height={water - barH} fill="#e9fbf7" opacity={0.75} />
        <path d={`M 0 ${water} ${Array.from({ length: 30 }, (_, i) => `L ${(i / 29) * w} ${water + Math.sin(i * 0.9 + t * 2.4) * 1.6}`).join(" ")}`} stroke="#ffffff" strokeWidth={2} fill="none" opacity={0.9} />
        {/* front glass edge highlight */}
        <rect x={3} y={barH} width={3} height={h} fill="#fff" opacity={0.35} />
        <rect x={w - 6} y={barH} width={3} height={h} fill="#fff" opacity={0.25} />
      </svg>

      {/* the conversation, rising */}
      <div style={{ position: "absolute", left: 0, width: w, top: placed[0].y - 44, textAlign: "center", fontFamily: F.nunito, fontWeight: 800, fontSize: 15, letterSpacing: 1, color: "#1d4e4a" }}>{CHAT.stamp}</div>
      {placed.map((p, i) => (
        <Bubble key={i} x={p.x} y={p.y} w={p.bw} me={p.me} text={p.text} fs={fs} t={t} i={i} />
      ))}

      {/* composer: a frosted label on the front glass */}
      <div style={{ position: "absolute", left: comp.x, top: comp.y, width: comp.w, height: comp.h, borderRadius: 18, background: "rgba(245,252,250,.78)", boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,.9), 0 6px 16px rgba(0,30,30,.2)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", gap: 14, padding: "0 14px" }}>
        <div style={{ width: 40, height: 40, borderRadius: 20, background: "#d4ece7", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F.nunito, fontWeight: 800, fontSize: 26, color: INK }}>+</div>
        <div style={{ flex: 1, fontFamily: F.nunito, fontWeight: 600, fontSize: fs + 1, color: "#5d7d7a" }}>
          {CHAT.placeholder}
          <span style={{ display: "inline-block", width: 2, height: fs + 2, marginLeft: 3, background: caret ? INK : "transparent", transform: "translateY(4px)" }} />
        </div>
        <svg width={16} height={24} viewBox="0 0 14 20">
          <rect x={4} y={1} width={6} height={11} rx={3} fill="#4d6d6a" />
          <path d="M1.5 9 Q1.5 15 7 15 Q12.5 15 12.5 9 M7 15 V19" stroke="#4d6d6a" strokeWidth={1.8} fill="none" />
        </svg>
        <div style={{ width: 44, height: 44, borderRadius: 22, background: "#1f8a7e", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width={18} height={18}>
            <path d="M9 15 V3 M3.5 8.5 L9 3 L14.5 8.5" stroke="#fff" strokeWidth={2.6} fill="none" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
        </div>
      </div>

      {/* rim + light bar: the top bar */}
      <div style={{ position: "absolute", left: 0, top: 0, width: w, height: barH, background: "linear-gradient(180deg, #2a2e30, #0f1112)", boxShadow: "0 2px 0 rgba(0,0,0,.4)" }}>
        <div style={{ position: "absolute", left: w * 0.18, right: w * 0.18, bottom: 0, height: 6, background: "linear-gradient(180deg, #fffdf2, #fff3c8)", boxShadow: "0 4px 16px rgba(255,248,220,.6)" }} />
        <div style={{ position: "absolute", left: 22, top: 0, height: barH - 6, display: "flex", alignItems: "center", gap: 8 }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <div key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c }} />
          ))}
        </div>
        <div style={{ position: "absolute", left: 0, width: w, top: 0, height: barH - 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, pointerEvents: "none" }}>
          <svg width={24} height={24} viewBox={`0 0 ${STAR.C * 2} ${STAR.C * 2}`}>
            <path d={STAR.path} fill="#7fe0d0" />
          </svg>
          <span style={{ fontFamily: F.nunito, fontWeight: 800, fontSize: 19, color: "#e8f4f2", letterSpacing: 0.5 }}>Stella</span>
        </div>
        <div style={{ position: "absolute", right: 22, top: 0, height: barH - 6, display: "flex", alignItems: "center", gap: 14, fontFamily: F.nunito, fontWeight: 700, fontSize: 15, color: "#cfdedc" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "4px 10px", borderRadius: 6, background: "#0a1d1a", boxShadow: "inset 0 0 0 1px #24413d", fontFamily: F.mono, fontSize: 14, color: "#7fe0d0" }}>
            {temp}°C {tall ? null : <span style={{ color: "#5f8f88", fontSize: 12 }}>pH 6.8</span>}
          </div>
          Account
        </div>
      </div>
    </div>
  );
};
