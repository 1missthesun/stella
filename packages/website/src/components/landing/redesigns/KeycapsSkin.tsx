import React from "react";
import { CHAT, type SkinProps } from "./content";
import { F, STAR, hash } from "./kit";

/**
 * A mechanical-keyboard hobbyist's Stella. The window is a navy anodised aluminium case
 * and plate; the conversation is set in sculpted keycaps, one word per key (yours on cream
 * alphas, Stella's on lavender), the timestamp on a modifier, and the composer is the
 * bottom row: a novelty spacebar that says "Do anything", a coral Enter to send.
 * Lock LEDs are the traffic lights; Stella is a resin artisan cap; a rotary knob turns.
 */

const CASE = "#232a3d";
const PLATE = "#12151d";
const CAP = {
  cream: { top: "#f3ead7", skirt: "#d9cdb3", edge: "#b9ab8e", ink: "#2d2a26" },
  lav: { top: "#c9c2f2", skirt: "#a79fe0", edge: "#8178c4", ink: "#251f4a" },
  mod: { top: "#7c9497", skirt: "#647b7e", edge: "#4c6062", ink: "#f3ead7" },
  coral: { top: "#ef7656", skirt: "#d65b3c", edge: "#ad4228", ink: "#fff6ec" },
};
type CapC = keyof typeof CAP;

const Keycap: React.FC<{ x: number; y: number; w: number; h: number; c: CapC; children?: React.ReactNode; pressed?: number; fs?: number; align?: "center" | "left" }> = ({ x, y, w, h, c, children, pressed = 0, fs = 20, align = "center" }) => {
  const k = CAP[c];
  const dy = pressed * 4;
  return (
    <div style={{ position: "absolute", left: x, top: y + dy, width: w, height: h }}>
      {/* shadow on the plate */}
      <div style={{ position: "absolute", left: 2, right: 2, top: 8 - dy, bottom: -6 + dy, borderRadius: 9, background: "rgba(0,0,0,.55)", filter: "blur(4px)" }} />
      {/* skirt */}
      <div style={{ position: "absolute", inset: 0, borderRadius: 9, background: `linear-gradient(180deg, ${k.skirt} 0%, ${k.edge} 100%)`, boxShadow: `inset 0 1px 0 rgba(255,255,255,.35), inset 0 -2px 0 rgba(0,0,0,.18)` }} />
      {/* sculpted top: dished, lit from above */}
      <div
        style={{
          position: "absolute",
          left: 6,
          right: 6,
          top: 3,
          bottom: 11,
          borderRadius: 7,
          background: `radial-gradient(ellipse 80% 70% at 50% 62%, ${k.top} 0%, ${k.top} 55%, ${k.skirt} 140%), linear-gradient(180deg, rgba(255,255,255,.35), rgba(255,255,255,0) 40%)`,
          backgroundBlendMode: "normal, soft-light",
          boxShadow: `inset 0 2px 1px rgba(255,255,255,.55), inset 0 -1px 2px rgba(0,0,0,.12)`,
          display: "flex",
          alignItems: "center",
          justifyContent: align === "left" ? "flex-start" : "center",
          padding: align === "left" ? "0 12px" : 0,
          fontFamily: F.mona,
          fontWeight: 600,
          fontSize: fs,
          color: k.ink,
          whiteSpace: "nowrap",
          letterSpacing: 0.1,
        }}
      >
        {children}
      </div>
    </div>
  );
};

/** Resin artisan cap: clear tinted resin with Stella suspended inside. */
const Artisan: React.FC<{ x: number; y: number; s: number; t: number }> = ({ x, y, s, t }) => (
  <div style={{ position: "absolute", left: x, top: y, width: s, height: s }}>
    <div style={{ position: "absolute", left: 2, right: 2, top: 8, bottom: -6, borderRadius: 10, background: "rgba(0,0,0,.55)", filter: "blur(4px)" }} />
    <div style={{ position: "absolute", inset: 0, borderRadius: 10, background: "linear-gradient(180deg, rgba(190,200,255,.55), rgba(90,80,170,.75))", boxShadow: "inset 0 1px 0 rgba(255,255,255,.6), inset 0 0 0 1px rgba(255,255,255,.25)" }} />
    <div style={{ position: "absolute", left: 6, right: 6, top: 3, bottom: 11, borderRadius: 8, background: "linear-gradient(160deg, rgba(220,226,255,.75), rgba(120,110,210,.55))", overflow: "hidden" }}>
      <svg width={s - 12} height={s - 14} viewBox={`0 0 ${STAR.C * 2} ${STAR.C * 2}`} style={{ position: "absolute", left: 0, top: 0, transform: `rotate(${Math.sin(t * 0.8) * 3}deg)` }}>
        <defs>
          <linearGradient id="kc-star" x1={0} y1={1} x2={0} y2={0}>
            <stop offset={0} stopColor="#2ab6e6" />
            <stop offset={0.5} stopColor="#5b6ff0" />
            <stop offset={1} stopColor="#c45bb0" />
          </linearGradient>
        </defs>
        <g transform={`translate(${STAR.C * 0.18} ${STAR.C * 0.2}) scale(0.82)`}>
          <path d={STAR.path} fill="url(#kc-star)" />
          <rect x={STAR.C - 30} y={STAR.C - 22} width={16} height={36} rx={8} fill="#fff" />
          <rect x={STAR.C + 12} y={STAR.C - 22} width={16} height={36} rx={8} fill="#fff" />
        </g>
      </svg>
      {/* resin flecks and a top reflection */}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} style={{ position: "absolute", left: `${hash(i, 4) * 90}%`, top: `${hash(i, 5) * 90}%`, width: 2, height: 2, borderRadius: 1, background: "#fff", opacity: 0.8 }} />
      ))}
      <div style={{ position: "absolute", left: 4, right: 4, top: 2, height: "34%", borderRadius: 6, background: "linear-gradient(180deg, rgba(255,255,255,.55), rgba(255,255,255,0))" }} />
    </div>
  </div>
);

const Knob: React.FC<{ x: number; y: number; d: number; t: number }> = ({ x, y, d, t }) => (
  <div style={{ position: "absolute", left: x - d / 2, top: y - d / 2, width: d, height: d }}>
    <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "rgba(0,0,0,.5)", filter: "blur(5px)", transform: "translateY(5px)" }} />
    <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: `repeating-conic-gradient(from ${t * 40}deg, #c9ccd4 0deg 3deg, #8e929c 3deg 6deg)` }} />
    <div style={{ position: "absolute", inset: d * 0.14, borderRadius: "50%", background: "conic-gradient(from 30deg, #f4f5f8, #9da1aa 20%, #e9ebef 40%, #8a8e97 60%, #f4f5f8 80%, #a5a9b2)", boxShadow: "inset 0 0 0 1px rgba(0,0,0,.2)" }} />
    <div style={{ position: "absolute", left: d / 2 - 2, top: d * 0.18, width: 4, height: d * 0.16, borderRadius: 2, background: "#3a3f4a", transformOrigin: `2px ${d * 0.32}px`, transform: `rotate(${t * 40}deg)` }} />
  </div>
);

export const KeycapsSkin: React.FC<SkinProps> = ({ t, w, h }) => {
  const tall = h > w;
  const u = tall ? 84 : 78; // one key unit
  const gap = 6;
  const fs = tall ? 29 : 26;
  const pad = tall ? 30 : 34;
  const top = 92;
  const plate = { x: pad, y: top, w: w - pad * 2, h: h - top - pad };
  const maxRow = plate.w - 40;
  const capW = (word: string) => {
    const raw = word.length * fs * 0.56 + 30;
    return Math.max(u, Math.ceil(raw / (u * 0.25)) * (u * 0.25));
  };

  type Key = { x: number; y: number; w: number; label: string; c: CapC };
  const keys: Key[] = [];
  const msgs: [boolean, string][] = [
    [true, CHAT.me1],
    [false, CHAT.her1],
    [true, CHAT.me2],
    [false, CHAT.her2],
  ];
  const rowH = u + gap;
  // rows of words per message
  const rowsOf = (text: string, first: number) => {
    // as few rows as fit, then balanced so no word sits alone on a row
    const words = text.split(" ");
    const ws = words.map(capW);
    const total = ws.reduce((a, v) => a + v + gap, first - gap);
    const n = Math.max(1, Math.ceil(total / maxRow));
    const target = total / n;
    const out: string[][] = [[]];
    let cur = first;
    words.forEach((wd, i) => {
      if (out[out.length - 1].length && out.length < n && cur + ws[i] / 2 > target) {
        out.push([]);
        cur = 0;
      }
      out[out.length - 1].push(wd);
      cur += ws[i] + gap;
    });
    return out;
  };
  // composer row at the bottom, messages stacked above it
  const compY = plate.y + plate.h - 22 - u;
  let y = compY - 26;
  const blocks = msgs.map(([me, text]) => ({ me, rows: rowsOf(text, me ? 0 : u + gap) }));
  const placed: { me: boolean; rows: string[][]; y: number }[] = [];
  for (let i = blocks.length - 1; i >= 0; i--) {
    y -= blocks[i].rows.length * rowH;
    placed.unshift({ ...blocks[i], y });
    y -= 10;
  }
  const left = plate.x + 20;
  const right = plate.x + plate.w - 20;
  for (const b of placed) {
    b.rows.forEach((row, r) => {
      const ws = row.map(capW);
      const total = ws.reduce((a, v) => a + v + gap, -gap) + (!b.me && r === 0 ? u + gap : 0);
      let x = b.me ? right - total : left;
      if (!b.me && r === 0) {
        keys.push({ x, y: b.y + r * rowH, w: u, label: "★", c: "lav" });
        x += u + gap;
      }
      row.forEach((wd, i) => {
        keys.push({ x, y: b.y + r * rowH, w: ws[i], label: wd, c: b.me ? "cream" : "lav" });
        x += ws[i] + gap;
      });
    });
  }
  const stampY = y - rowH;
  const stampW = u * 3;

  // composer row: + | spacebar | mic | enter
  const plusW = u * 1.25;
  const micW = u * 1.25;
  const entW = u * 2.25;
  const spaceW = plate.w - 40 - plusW - micW - entW - gap * 3;
  // someone is typing: keys go down on a seeded rhythm
  const beat = Math.floor(t * 9);
  const pressed = (i: number) => (hash(beat, i + 3) > 0.78 ? 1 : 0);
  const caret = Math.floor(t * 2.4) % 2 === 0;

  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, overflow: "hidden", background: CASE }}>
      {/* anodised case: bead-blasted texture and a long soft reflection */}
      <svg width={w} height={h} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id="kc-blast" x={0} y={0} width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency={0.95} numOctaves={2} seed={2} />
            <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.12 0" />
          </filter>
          <linearGradient id="kc-sheen" x1={0} y1={0} x2={1} y2={1}>
            <stop offset={0} stopColor="#fff" stopOpacity={0.1} />
            <stop offset={0.45} stopColor="#fff" stopOpacity={0.02} />
            <stop offset={1} stopColor="#000" stopOpacity={0.25} />
          </linearGradient>
        </defs>
        <rect width={w} height={h} fill="url(#kc-sheen)" />
        <rect width={w} height={h} filter="url(#kc-blast)" />
      </svg>
      {/* the plate the switches sit in */}
      <div style={{ position: "absolute", left: plate.x, top: plate.y, width: plate.w, height: plate.h, borderRadius: 12, background: PLATE, boxShadow: "inset 0 3px 8px rgba(0,0,0,.8), 0 1px 0 rgba(255,255,255,.12)" }} />

      {/* top of the case: lock LEDs as traffic lights, artisan, knob */}
      <div style={{ position: "absolute", left: 36, top: 30, display: "flex", gap: 16, alignItems: "center" }}>
        {["#ff5f57", "#febc2e", "#28c840"].map((c, i) => (
          <div key={c} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
            <div style={{ width: 12, height: 12, borderRadius: 6, background: `radial-gradient(circle at 40% 35%, #fff, ${c} 45%)`, boxShadow: `0 0 6px ${c}88, inset 0 0 0 1px rgba(0,0,0,.25)` }} />
            <div style={{ fontFamily: F.mona, fontWeight: 600, fontSize: 9, letterSpacing: 1, color: "#8c95ab" }}>{["CAPS", "NUM", "SCRL"][i]}</div>
          </div>
        ))}
      </div>
      <Artisan x={w / 2 - 110} y={18} s={56} t={t} />
      <div style={{ position: "absolute", left: w / 2 - 40, top: 22, height: 48, display: "flex", alignItems: "center", fontFamily: F.mona, fontWeight: 800, fontStretch: "125%", fontSize: 22, letterSpacing: 4, color: "#c9cfdd" }}>stella</div>
      <div style={{ position: "absolute", right: tall ? 108 : 130, top: 22, height: 48, display: "flex", alignItems: "center", fontFamily: F.mona, fontWeight: 600, fontSize: 15, letterSpacing: 1.5, color: "#c9cfdd" }}>ACCOUNT</div>
      <Knob x={w - (tall ? 62 : 74)} y={46} d={50} t={t} />

      {/* timestamp on a modifier */}
      <Keycap x={(left + right) / 2 - stampW / 2} y={stampY} w={stampW} h={u} c="mod" fs={fs - 3}>
        {CHAT.stamp}
      </Keycap>

      {keys.map((k, i) => (
        <Keycap key={i} x={k.x} y={k.y} w={k.w} h={u} c={k.c} fs={k.label === "★" ? fs + 6 : fs}>
          {k.label === "★" ? (
            <svg width={u * 0.45} height={u * 0.45} viewBox={`0 0 ${STAR.C * 2} ${STAR.C * 2}`}>
              <path d={STAR.path} fill={CAP.lav.ink} />
            </svg>
          ) : (
            k.label
          )}
        </Keycap>
      ))}

      {/* bottom row: the composer */}
      <Keycap x={left} y={compY} w={plusW} h={u} c="mod" fs={fs + 8} pressed={pressed(1)}>
        +
      </Keycap>
      <Keycap x={left + plusW + gap} y={compY} w={spaceW} h={u} c="cream" pressed={pressed(2)} fs={fs + 2}>
        <span style={{ color: "#8b8172" }}>{CHAT.placeholder}</span>
        <span style={{ display: "inline-block", width: 2, height: fs + 2, marginLeft: 4, background: caret ? CAP.cream.ink : "transparent" }} />
      </Keycap>
      <Keycap x={left + plusW + gap + spaceW + gap} y={compY} w={micW} h={u} c="mod" pressed={pressed(3)}>
        <svg width={16} height={22} viewBox="0 0 14 20">
          <rect x={4} y={1} width={6} height={11} rx={3} fill={CAP.mod.ink} />
          <path d="M1.5 9 Q1.5 15 7 15 Q12.5 15 12.5 9 M7 15 V19" stroke={CAP.mod.ink} strokeWidth={1.8} fill="none" />
        </svg>
      </Keycap>
      <Keycap x={right - entW} y={compY} w={entW} h={u} c="coral" fs={fs}>
        Send ↵
      </Keycap>
    </div>
  );
};
