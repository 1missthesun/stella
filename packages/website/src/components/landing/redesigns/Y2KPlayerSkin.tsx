import React from "react";
import { CHAT, type SkinProps } from "./content";
import { F, STAR } from "./kit";

/**
 * An early-2000s media-player skin, made by someone nostalgic for them: an organic
 * chrome deck (glossy silver plastic, hard bevels), aqua gel buttons, a porthole
 * visualiser with Stella floating in it, a scrolling marquee, and a playlist drawer
 * hinged to the side. The chat is the playlist; the newest line is "now playing".
 * The composer sits under the playlist with a big gel send button.
 */

const UI = F.nunito;
const NAVY = "#0a1830";

const gel = (a = "#e8fcff", b = "#38b8ef", c = "#0b6fb8") =>
  `radial-gradient(120% 90% at 50% 105%, ${a}cc 0%, rgba(255,255,255,0) 55%), linear-gradient(180deg, ${b} 0%, ${c} 100%)`;

const GelButton: React.FC<{ x: number; y: number; w: number; h: number; children?: React.ReactNode; tint?: [string, string, string]; round?: boolean }> = ({ x, y, w, h, children, tint, round }) => (
  <div style={{ position: "absolute", left: x, top: y, width: w, height: h }}>
    <div style={{ position: "absolute", inset: -3, borderRadius: round ? "50%" : h, background: "linear-gradient(180deg, #8a96a4, #f2f5f8)", boxShadow: "0 2px 4px rgba(0,0,0,.35)" }} />
    <div style={{ position: "absolute", inset: 0, borderRadius: round ? "50%" : h, background: gel(...(tint ?? ["#e8fcff", "#38b8ef", "#0b6fb8"])), boxShadow: "inset 0 -2px 3px rgba(0,30,60,.4), inset 0 0 0 1px rgba(0,40,80,.35)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
      {children}
    </div>
    {/* the glossy cap */}
    <div style={{ position: "absolute", left: "12%", right: "12%", top: 2, height: "44%", borderRadius: round ? "50% 50% 45% 45%" : h, background: "linear-gradient(180deg, rgba(255,255,255,.95), rgba(255,255,255,.15))", pointerEvents: "none" }} />
  </div>
);

const Chrome: React.FC<{ d: string; w: number; h: number; id: string; x?: number; y?: number }> = ({ d, w, h, id, x = 0, y = 0 }) => (
  <svg width={w} height={h} style={{ position: "absolute", left: x, top: y, overflow: "visible" }}>
    <defs>
      <linearGradient id={`${id}-metal`} x1={0} y1={0} x2={0} y2={1}>
        <stop offset={0} stopColor="#fbfcfd" />
        <stop offset={0.08} stopColor="#dfe5eb" />
        <stop offset={0.45} stopColor="#b7c1cc" />
        <stop offset={0.52} stopColor="#cfd7df" />
        <stop offset={0.9} stopColor="#9aa6b3" />
        <stop offset={1} stopColor="#c4ccd5" />
      </linearGradient>
      <linearGradient id={`${id}-gloss`} x1={0} y1={0} x2={0} y2={1}>
        <stop offset={0} stopColor="#fff" stopOpacity={0.9} />
        <stop offset={1} stopColor="#fff" stopOpacity={0} />
      </linearGradient>
      <clipPath id={`${id}-clip`}>
        <path d={d} />
      </clipPath>
      <filter id={`${id}-shadow`} x="-10%" y="-10%" width="120%" height="130%">
        <feDropShadow dx={0} dy={14} stdDeviation={14} floodColor="#000" floodOpacity={0.45} />
      </filter>
    </defs>
    <path d={d} fill={`url(#${id}-metal)`} filter={`url(#${id}-shadow)`} />
    <g clipPath={`url(#${id}-clip)`}>
      {/* brushed horizontal grain and a big top gloss */}
      {Array.from({ length: Math.ceil(h / 3) }, (_, i) => (
        <rect key={i} x={0} y={i * 3} width={w} height={1} fill="#fff" opacity={i % 4 === 0 ? 0.12 : 0.04} />
      ))}
      <ellipse cx={w * 0.45} cy={-h * 0.18} rx={w * 0.75} ry={h * 0.42} fill={`url(#${id}-gloss)`} opacity={0.75} />
      {/* bevel: light inner edge top-left, dark bottom-right */}
      <path d={d} fill="none" stroke="#fff" strokeWidth={6} transform="translate(2 2)" opacity={0.8} />
      <path d={d} fill="none" stroke="#56606c" strokeWidth={6} transform="translate(-2 -3)" opacity={0.55} />
    </g>
    <path d={d} fill="none" stroke="#4a5562" strokeWidth={1.5} />
  </svg>
);

const Visualiser: React.FC<{ cx: number; cy: number; r: number; t: number }> = ({ cx, cy, r, t }) => {
  const n = 40;
  return (
    <div style={{ position: "absolute", left: cx - r - 10, top: cy - r - 10, width: (r + 10) * 2, height: (r + 10) * 2 }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "linear-gradient(180deg, #7d8a98, #f4f7fa)", boxShadow: "0 2px 4px rgba(0,0,0,.35)" }} />
      <div style={{ position: "absolute", inset: 10, borderRadius: "50%", background: "radial-gradient(circle at 50% 45%, #0f3a6a 0%, #071428 70%)", overflow: "hidden", boxShadow: "inset 0 4px 12px rgba(0,0,0,.8)" }}>
        <svg width={r * 2} height={r * 2}>
          <defs>
            <linearGradient id="y2-bar" x1={0} y1={0} x2={0} y2={1}>
              <stop offset={0} stopColor="#b8ff5a" />
              <stop offset={1} stopColor="#22c8ff" />
            </linearGradient>
            <linearGradient id="y2-star" x1={0} y1={1} x2={0} y2={0}>
              <stop offset={0} stopColor="#29d2ff" />
              <stop offset={0.55} stopColor="#4f7dff" />
              <stop offset={1} stopColor="#c35bd8" />
            </linearGradient>
          </defs>
          {Array.from({ length: n }, (_, i) => {
            const a = (i / n) * Math.PI * 2;
            const lvl = 0.35 + 0.3 * Math.abs(Math.sin(t * 5.3 + i * 0.7)) + 0.25 * Math.abs(Math.sin(t * 2.9 + i * 1.9)) * Math.abs(Math.cos(i * 0.4));
            const r0 = r * 0.5;
            const r1 = r0 + lvl * r * 0.42;
            return <line key={i} x1={r + Math.cos(a) * r0} y1={r + Math.sin(a) * r0} x2={r + Math.cos(a) * r1} y2={r + Math.sin(a) * r1} stroke="url(#y2-bar)" strokeWidth={5} strokeLinecap="round" opacity={0.9} />;
          })}
          <g transform={`translate(${r - r * 0.42} ${r - r * 0.42 + Math.sin(t * 2) * 3}) scale(${(r * 0.84) / (STAR.C * 2)})`}>
            <path d={STAR.path} fill="url(#y2-star)" />
            <path d={STAR.path} fill="none" stroke="#e8fbff" strokeWidth={6} opacity={0.6} />
            <rect x={STAR.C - 30} y={STAR.C - 24} width={17} height={38} rx={8.5} fill="#fff" />
            <rect x={STAR.C + 12} y={STAR.C - 24} width={17} height={38} rx={8.5} fill="#fff" />
          </g>
        </svg>
        <div style={{ position: "absolute", left: "8%", right: "8%", top: 4, height: "40%", borderRadius: "50%", background: "linear-gradient(180deg, rgba(255,255,255,.35), rgba(255,255,255,0))" }} />
      </div>
    </div>
  );
};

const Marquee: React.FC<{ x: number; y: number; w: number; h: number; t: number }> = ({ x, y, w, h, t }) => {
  const text = `Stella  ·  ${CHAT.stamp}  ·  ${CHAT.her2}  ·  `;
  const cw = 10.2;
  const span = text.length * cw;
  const off = -((t * 60) % span);
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, borderRadius: 10, background: "linear-gradient(180deg, #06223c, #0b3358)", boxShadow: "inset 0 2px 6px rgba(0,0,0,.8), 0 1px 0 rgba(255,255,255,.7)", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 14, top: 8, fontFamily: F.mono, fontSize: 30, fontWeight: 300, color: "#9ff3ff", letterSpacing: 1 }}>04:10</div>
      <div style={{ position: "absolute", left: 14, right: 14, bottom: 9, height: 22, overflow: "hidden" }}>
        <div style={{ position: "absolute", left: off, top: 0, whiteSpace: "nowrap", fontFamily: F.mono, fontSize: 15, color: "#9ff3ff" }}>
          {text}
          {text}
          {text}
        </div>
      </div>
      <div style={{ position: "absolute", right: 14, top: 12, fontFamily: UI, fontWeight: 800, fontSize: 12, color: "#5fd2ff", letterSpacing: 1.5 }}>NOW PLAYING</div>
    </div>
  );
};

const Playlist: React.FC<{ x: number; y: number; w: number; h: number; t: number; fs: number }> = ({ x, y, w, h, t, fs }) => {
  const rows: [boolean, string][] = [
    [true, CHAT.me1],
    [false, CHAT.her1],
    [true, CHAT.me2],
    [false, CHAT.her2],
  ];
  const caret = Math.floor(t * 2.4) % 2 === 0;
  const compH = 66;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, borderRadius: 18, background: `linear-gradient(180deg, #0d2342, ${NAVY})`, boxShadow: "inset 0 3px 10px rgba(0,0,0,.8), 0 1px 0 rgba(255,255,255,.8)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", height: 40, padding: "0 18px", borderBottom: "1px solid #1d3a63", fontFamily: UI, fontWeight: 800, fontSize: 13, letterSpacing: 1.6, color: "#5fd2ff" }}>
        PLAYLIST
        <span style={{ marginLeft: "auto", color: "#7fa3c9", fontWeight: 700 }}>{CHAT.stamp}</span>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: compH + 18, display: "flex", flexDirection: "column" }}>
        {rows.map(([me, text], i) => {
          const now = i === rows.length - 1;
          return (
            <div
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: `${fs * 1.6}px 1fr ${fs * 3.4}px`,
                columnGap: 12,
                alignItems: "start",
                padding: `${fs * 0.75}px 18px`,
                background: now ? "linear-gradient(180deg, rgba(120,230,255,.55), rgba(20,140,220,.55))" : i % 2 ? "rgba(255,255,255,.035)" : "transparent",
                boxShadow: now ? "inset 0 1px 0 rgba(255,255,255,.6), inset 0 -1px 0 rgba(0,40,90,.6)" : "none",
                fontFamily: UI,
                fontWeight: 600,
                fontSize: fs,
                lineHeight: 1.3,
                color: now ? "#ffffff" : me ? "#d8ecff" : "#9ff3ff",
              }}
            >
              <span style={{ fontWeight: 800, color: now ? "#fff" : "#5f86b3" }}>{now ? "▶" : `${i + 1}.`}</span>
              <span>{text}</span>
              <span style={{ textAlign: "right", fontWeight: 700, fontSize: fs * 0.78, color: now ? "#e8fbff" : "#6f93bb", paddingTop: 2 }}>{me ? "You" : "Stella"}</span>
            </div>
          );
        })}
      </div>
      {/* composer */}
      <div style={{ position: "absolute", left: 14, right: 14, bottom: 14, height: compH, display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ position: "relative", width: 46, height: 46 }}>
          <GelButton x={0} y={0} w={46} h={46} round tint={["#e6fff0", "#59d98a", "#178a4a"]}>
            <span style={{ fontFamily: UI, fontWeight: 900, fontSize: 26, marginTop: -2 }}>+</span>
          </GelButton>
        </div>
        <div style={{ flex: 1, height: 48, borderRadius: 24, background: "linear-gradient(180deg, #e6edf4, #ffffff)", boxShadow: "inset 0 2px 4px rgba(0,0,0,.45), 0 1px 0 rgba(255,255,255,.25)", display: "flex", alignItems: "center", padding: "0 18px", fontFamily: UI, fontWeight: 600, fontSize: fs + 1, color: "#7b8796" }}>
          {CHAT.placeholder}
          <span style={{ display: "inline-block", width: 2, height: fs + 2, marginLeft: 3, background: caret ? NAVY : "transparent" }} />
          <svg width={16} height={22} viewBox="0 0 14 20" style={{ marginLeft: "auto" }}>
            <rect x={4} y={1} width={6} height={11} rx={3} fill="#5a6878" />
            <path d="M1.5 9 Q1.5 15 7 15 Q12.5 15 12.5 9 M7 15 V19" stroke="#5a6878" strokeWidth={1.8} fill="none" />
          </svg>
        </div>
        <div style={{ position: "relative", width: 58, height: 58 }}>
          <GelButton x={0} y={0} w={58} h={58} round>
            <svg width={22} height={22}>
              <path d="M11 18 V4 M4 10.5 L11 3.5 L18 10.5" stroke="#fff" strokeWidth={3.4} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
          </GelButton>
        </div>
      </div>
    </div>
  );
};

const Transport: React.FC<{ x: number; y: number }> = ({ x, y }) => {
  const icon = (k: string) =>
    k === "prev" ? (
      <svg width={18} height={14}>
        <path d="M2 1 V13 M16 1 L5 7 L16 13 Z" stroke="#fff" fill="#fff" strokeWidth={2.4} />
      </svg>
    ) : k === "play" ? (
      <svg width={22} height={22}>
        <path d="M6 3 L19 11 L6 19 Z" fill="#fff" />
      </svg>
    ) : k === "next" ? (
      <svg width={18} height={14}>
        <path d="M16 1 V13 M2 1 L13 7 L2 13 Z" stroke="#fff" fill="#fff" strokeWidth={2.4} />
      </svg>
    ) : (
      <svg width={14} height={14}>
        <rect x={1} y={1} width={12} height={12} rx={2} fill="#fff" />
      </svg>
    );
  return (
    <div style={{ position: "absolute", left: x, top: y, width: 330, height: 74 }}>
      <GelButton x={0} y={14} w={62} h={44}>
        {icon("prev")}
      </GelButton>
      <GelButton x={78} y={0} w={74} h={74} round>
        {icon("play")}
      </GelButton>
      <GelButton x={168} y={14} w={62} h={44}>
        {icon("next")}
      </GelButton>
      <GelButton x={246} y={14} w={62} h={44} tint={["#ffe9f0", "#ff7aa5", "#c42b62"]}>
        {icon("stop")}
      </GelButton>
    </div>
  );
};

const Seek: React.FC<{ x: number; y: number; w: number; t: number; label: string; v: number }> = ({ x, y, w, label, v }) => (
  <div style={{ position: "absolute", left: x, top: y, width: w, height: 30 }}>
    <div style={{ position: "absolute", left: 0, top: -2, fontFamily: UI, fontWeight: 800, fontSize: 11, letterSpacing: 1.6, color: "#3e4a58" }}>{label}</div>
    <div style={{ position: "absolute", left: 0, right: 0, top: 16, height: 10, borderRadius: 5, background: "linear-gradient(180deg, #5c6875, #c9d1da)", boxShadow: "inset 0 2px 3px rgba(0,0,0,.6)" }}>
      <div style={{ width: `${v * 100}%`, height: 10, borderRadius: 5, background: gel() }} />
    </div>
    <div style={{ position: "absolute", left: w * v - 13, top: 9, width: 26, height: 24 }}>
      <GelButton x={0} y={0} w={26} h={24} round />
    </div>
  </div>
);

export const Y2KPlayerSkin: React.FC<SkinProps> = ({ t, w, h }) => {
  const tall = h > w;
  const fs = tall ? 28 : 23;
  // the deck: an organic chrome body
  const deck = tall ? { x: 50, y: 70, w: 740, h: 470 } : { x: 46, y: 70, w: 560, h: 780 };
  const D = (fx: number, fy: number) => `${(deck.w * fx).toFixed(1)} ${(deck.h * fy).toFixed(1)}`;
  const deckPath = tall
    ? `M ${D(0.06, 0.2)} C ${D(0.04, 0.02)}, ${D(0.3, 0.0)}, ${D(0.42, 0.06)} C ${D(0.52, 0.11)}, ${D(0.6, 0.02)}, ${D(0.78, 0.03)} C ${D(0.98, 0.04)}, ${D(1.0, 0.25)}, ${D(0.98, 0.45)} L ${D(0.97, 0.82)} C ${D(0.96, 0.98)}, ${D(0.8, 1.0)}, ${D(0.6, 0.97)} C ${D(0.45, 0.95)}, ${D(0.32, 1.02)}, ${D(0.14, 0.97)} C ${D(0.02, 0.94)}, ${D(0.0, 0.78)}, ${D(0.02, 0.6)} C ${D(0.04, 0.45)}, ${D(0.08, 0.35)}, ${D(0.06, 0.2)} Z`
    : `M ${D(0.12, 0.1)} C ${D(0.12, 0.02)}, ${D(0.32, 0.0)}, ${D(0.48, 0.03)} C ${D(0.6, 0.05)}, ${D(0.7, 0.01)}, ${D(0.84, 0.03)} C ${D(0.98, 0.05)}, ${D(1.0, 0.14)}, ${D(0.98, 0.26)} L ${D(0.96, 0.84)} C ${D(0.95, 0.96)}, ${D(0.82, 1.0)}, ${D(0.66, 0.98)} C ${D(0.5, 0.96)}, ${D(0.4, 1.0)}, ${D(0.24, 0.99)} C ${D(0.06, 0.98)}, ${D(0.0, 0.88)}, ${D(0.03, 0.72)} C ${D(0.06, 0.58)}, ${D(0.0, 0.48)}, ${D(0.03, 0.34)} C ${D(0.05, 0.22)}, ${D(0.12, 0.18)}, ${D(0.12, 0.1)} Z`;
  const list = tall ? { x: 60, y: 610, w: 720, h: 660 } : { x: 650, y: 200, w: 780, h: 520 };
  const vis = tall ? { cx: deck.x + 150, cy: deck.y + 250, r: 130 } : { cx: deck.x + 200, cy: deck.y + 300, r: 160 };

  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, overflow: "hidden", background: "radial-gradient(120% 90% at 30% 20%, #4f7fb4 0%, #2a4f80 55%, #1a3358 100%)" }}>
      {/* playlist drawer housing, behind the deck, with a hinge */}
      <Chrome
        id="y2-drawer"
        x={list.x - 18}
        y={list.y - 18}
        w={list.w + 36}
        h={list.h + 36}
        d={`M 30 0 H ${list.w + 6} Q ${list.w + 36} 0 ${list.w + 36} 30 V ${list.h + 6} Q ${list.w + 36} ${list.h + 36} ${list.w + 6} ${list.h + 36} H 30 Q 0 ${list.h + 36} 0 ${list.h + 6} V 30 Q 0 0 30 0 Z`}
      />
      {tall ? (
        [200, 560].map((x) => <div key={x} style={{ position: "absolute", left: x, top: deck.y + deck.h - 30, width: 80, height: 90, borderRadius: 12, background: "linear-gradient(90deg, #7d8996, #f1f4f7 45%, #9aa6b3)", boxShadow: "0 2px 4px rgba(0,0,0,.4)" }} />)
      ) : (
        [list.y + 90, list.y + list.h - 170].map((y) => <div key={y} style={{ position: "absolute", left: deck.x + deck.w - 40, top: y, width: 90, height: 80, borderRadius: 12, background: "linear-gradient(180deg, #7d8996, #f1f4f7 45%, #9aa6b3)", boxShadow: "0 2px 4px rgba(0,0,0,.4)" }} />)
      )}
      <Playlist x={list.x} y={list.y} w={list.w} h={list.h} t={t} fs={fs} />

      {/* the deck */}
      <Chrome id="y2-deck" x={deck.x} y={deck.y} w={deck.w} h={deck.h} d={deckPath} />
      {/* the porthole bulges out of the deck */}
      <Chrome
        id="y2-ring"
        x={vis.cx - vis.r - 34}
        y={vis.cy - vis.r - 34}
        w={(vis.r + 34) * 2}
        h={(vis.r + 34) * 2}
        d={`M 0 ${vis.r + 34} A ${vis.r + 34} ${vis.r + 34} 0 1 0 ${(vis.r + 34) * 2} ${vis.r + 34} A ${vis.r + 34} ${vis.r + 34} 0 1 0 0 ${vis.r + 34} Z`}
      />
      {/* title strip on the chrome: traffic lights as gel beads, the name, account */}
      <div style={{ position: "absolute", left: deck.x + 60, top: deck.y + (tall ? 26 : 34), display: "flex", gap: 10 }}>
        {[
          ["#ffe3e0", "#ff6a5a", "#b8261a"],
          ["#fff6d8", "#ffcc33", "#c88a00"],
          ["#e3ffe6", "#4fdc6a", "#178a30"],
        ].map((tint, i) => (
          <div key={i} style={{ position: "relative", width: 18, height: 18 }}>
            <GelButton x={0} y={0} w={18} h={18} round tint={tint as [string, string, string]} />
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", left: deck.x + 160, top: deck.y + (tall ? 18 : 26), display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontFamily: UI, fontWeight: 900, fontStyle: "italic", fontSize: 30, letterSpacing: -0.5, color: "#1d2c3c", textShadow: "0 1px 0 #fff" }}>stella</span>
        <span style={{ fontFamily: UI, fontWeight: 800, fontSize: 12, letterSpacing: 2, color: "#5a6878" }}>PLAYER</span>
      </div>
      <div style={{ position: "absolute", left: deck.x + deck.w - (tall ? 150 : 140), top: deck.y + (tall ? 26 : 34), fontFamily: UI, fontWeight: 800, fontSize: 13, letterSpacing: 1.4, color: "#2a3846", textShadow: "0 1px 0 #fff" }}>ACCOUNT</div>

      <Visualiser cx={vis.cx} cy={vis.cy} r={vis.r} t={t} />
      {tall ? (
        <>
          <Marquee x={deck.x + 340} y={deck.y + 110} w={350} h={78} t={t} />
          <Seek x={deck.x + 340} y={deck.y + 210} w={350} t={t} label="POSITION" v={0.62} />
          <Seek x={deck.x + 340} y={deck.y + 262} w={200} t={t} label="VOLUME" v={0.74} />
          <div style={{ position: "absolute", left: deck.x + 350, top: deck.y + 330, transform: "scale(1.04)", transformOrigin: "0 0" }}>
            <Transport x={0} y={0} />
          </div>
        </>
      ) : (
        <>
          <Marquee x={deck.x + 70} y={deck.y + 500} w={deck.w - 130} h={78} t={t} />
          <Seek x={deck.x + 70} y={deck.y + 596} w={deck.w - 130} t={t} label="POSITION" v={0.62} />
          <Transport x={deck.x + 92} y={deck.y + 650} />
          <Seek x={deck.x + 400} y={deck.y + 130} w={110} t={t} label="VOLUME" v={0.74} />
        </>
      )}
    </div>
  );
};
