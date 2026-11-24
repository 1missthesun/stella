import React from "react";
import { CHAT, type SkinProps } from "./content";
import { F, STAR, hash } from "./kit";

const PAPER = "#f3ead8";
const CONTOUR = "#d9c4a4";
const INDEX = "#c8ab84";
const INK = "#2d2721";
const SOFT = "#7b6e60";
const NOTE = "#fbf7ee";
const NOTE_LINE = "#d9ccb5";
const ORANGE = "#e4631c";
const RED = "#c63a2c";
const BLUE = "#3a62a6";
const GREEN = "#4f7a3a";

function vnoise(x: number, y: number, seed: number) {
  const xi = Math.floor(x),
    yi = Math.floor(y);
  const xf = x - xi,
    yf = y - yi;
  const u = xf * xf * (3 - 2 * xf),
    v = yf * yf * (3 - 2 * yf);
  const h = (i: number, j: number) => hash(i * 7919 + j * 104729, seed);
  const a = h(xi, yi),
    b = h(xi + 1, yi),
    c = h(xi, yi + 1),
    d = h(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function height(x: number, y: number) {
  let s = 0,
    amp = 1,
    f = 1 / 430,
    norm = 0;
  for (let o = 0; o < 3; o++) {
    s += vnoise(x * f + o * 3.7, y * f, 11 + o) * amp;
    norm += amp;
    amp *= 0.42;
    f *= 2.3;
  }
  return s / norm + 0.22 * Math.sin(x / 610 + y / 980);
}

const contourCache = new Map<string, [string, string]>();

export function trailContours(w: number, h: number): [string, string] {
  const key = `${w}x${h}`;
  let hit = contourCache.get(key);
  if (!hit) {
    hit = contours(w + MARGIN, h + 40, 9);
    contourCache.set(key, hit);
  }
  return hit;
}

const MARGIN = 360;

function contours(W: number, H: number, cell: number): [string, string] {
  const nx = Math.ceil(W / cell) + 1,
    ny = Math.ceil(H / cell) + 1;
  const g = new Float32Array(nx * ny);
  let lo = Infinity,
    hi = -Infinity;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const v = height(i * cell, j * cell);
      g[j * nx + i] = v;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  const step = 0.026;
  const norm: string[] = [];
  const idx: string[] = [];
  for (let L = Math.ceil(lo / step); L * step < hi; L++) {
    const iso = L * step;
    const out = L % 5 === 0 ? idx : norm;
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const a = g[j * nx + i],
          b = g[j * nx + i + 1],
          c = g[(j + 1) * nx + i + 1],
          d = g[(j + 1) * nx + i];
        const k = (a > iso ? 8 : 0) | (b > iso ? 4 : 0) | (c > iso ? 2 : 0) | (d > iso ? 1 : 0);
        if (k === 0 || k === 15) continue;
        const x0 = i * cell,
          y0 = j * cell;
        const top = (): [number, number] => [x0 + ((iso - a) / (b - a)) * cell, y0];
        const right = (): [number, number] => [x0 + cell, y0 + ((iso - b) / (c - b)) * cell];
        const bottom = (): [number, number] => [x0 + ((iso - d) / (c - d)) * cell, y0 + cell];
        const left = (): [number, number] => [x0, y0 + ((iso - a) / (d - a)) * cell];
        const seg = (p: [number, number], q: [number, number]) => out.push(`M${p[0].toFixed(1)} ${p[1].toFixed(1)}L${q[0].toFixed(1)} ${q[1].toFixed(1)}`);
        switch (k) {
          case 1:
          case 14:
            seg(left(), bottom());
            break;
          case 2:
          case 13:
            seg(bottom(), right());
            break;
          case 3:
          case 12:
            seg(left(), right());
            break;
          case 4:
          case 11:
            seg(top(), right());
            break;
          case 6:
          case 9:
            seg(top(), bottom());
            break;
          case 7:
          case 8:
            seg(left(), top());
            break;
          case 5:
            seg(left(), top());
            seg(bottom(), right());
            break;
          case 10:
            seg(top(), right());
            seg(left(), bottom());
            break;
        }
      }
  }
  return [norm.join(""), idx.join("")];
}

const ScaleBar: React.FC<{ w: number; h?: number; segs?: number }> = ({ w, h = 6, segs = 4 }) => (
  <svg width={w + 2} height={h + 2} style={{ display: "block" }}>
    <rect x={1} y={1} width={w} height={h} fill="#fff" stroke={INK} strokeWidth={1.2} />
    {Array.from({ length: segs }, (_, i) => (i % 2 ? null : <rect key={i} x={1 + (i * w) / segs} y={1} width={w / segs} height={h} fill={INK} />))}
  </svg>
);

const NorthArrow: React.FC<{ s?: number }> = ({ s = 22 }) => (
  <svg width={s * 0.8} height={s} viewBox="0 0 16 20">
    <path d="M8 1 L14 18 L8 14 Z" fill={INK} />
    <path d="M8 1 L2 18 L8 14 Z" fill="none" stroke={INK} strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
);

const Clock: React.FC<{ c: string; s?: number }> = ({ c, s = 16 }) => (
  <svg width={s} height={s} viewBox="0 0 16 16">
    <circle cx={8} cy={8} r={6.3} stroke={c} strokeWidth={1.5} fill="none" />
    <path d="M8 4.5 V8 L10.3 9.5" stroke={c} strokeWidth={1.5} fill="none" strokeLinecap="round" />
  </svg>
);

const Legend: React.FC<{ w: number }> = ({ w }) => (
  <div style={{ width: w, padding: 3, border: `1.5px solid ${INK}`, background: "#fbf8f1", boxShadow: "0 2px 0 rgba(45,39,33,.08)" }}>
    <div style={{ border: `1px solid ${INK}`, padding: "14px 16px 14px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", paddingBottom: 12, borderBottom: `1px solid ${INK}` }}>
        <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: 3.5, color: INK }}>TODAY</span>
        <span style={{ fontFamily: F.barlowI, fontStyle: "italic", fontSize: 16, color: BLUE }}>Thursday, May 6</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "12px -6px 0", padding: "10px 10px 10px 10px", background: "#f5e2d3", position: "relative" }}>
        <div style={{ position: "absolute", left: -1, top: 8, bottom: 8, width: 4, background: ORANGE }} />
        <Clock c={RED} />
        <span style={{ flex: 1, fontSize: 16, color: INK }}>Pick up the bike</span>
        <span style={{ fontWeight: 700, fontSize: 16, color: RED }}>Fri 9:00 AM</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 4px 4px" }}>
        <svg width={16} height={16} viewBox="0 0 16 16">
          <circle cx={8} cy={8} r={6.3} stroke={GREEN} strokeWidth={1.5} fill="none" />
          <path d="M5 8.3 L7.2 10.4 L11.2 5.8" stroke={GREEN} strokeWidth={1.7} fill="none" />
        </svg>
        <span style={{ flex: 1, fontSize: 16, color: SOFT, textDecoration: "line-through", textDecorationColor: "rgba(123,110,96,.6)" }}>File bike receipt</span>
        <span style={{ fontWeight: 600, fontSize: 15, color: SOFT }}>Row 41</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
        <ScaleBar w={110} h={5} segs={4} />
        <span style={{ fontSize: 12, color: SOFT, letterSpacing: 0.5 }}>0.5 mi</span>
      </div>
    </div>
  </div>
);

export const TrailSkin: React.FC<SkinProps> = ({ t, w, h }) => {
  const tall = h > w;
  const barH = 58;
  const fs = tall ? 25 : 22;
  const sideW = tall ? 400 : 330;
  const colW = tall ? w - 70 : 860;
  const colX = tall ? 34 : Math.round((w - sideW - 40 - colW) / 2) + 6;
  const gut = 46;
  const caret = Math.floor(t * 2.4) % 2 === 0;

  const margin = MARGIN;
  const [cNorm, cIdx] = trailContours(w, h);
  const pan = Math.min(margin - 10, 40 + t * 7);

  const spots: [number, number, string][] = tall
    ? [
        [70, 150, "1,482"],
        [300, 250, "1,307"],
      ]
    : [
        [56, 190, "1,482"],
        [1180, 160, "1,307"],
        [60, 640, "1,215"],
      ];

  const creek = tall
    ? "M -10 560 C 120 500 240 640 400 590 S 650 440 850 480"
    : "M 1010 40 C 1110 150 1200 250 1300 238 S 1430 196 1490 226";

  let wp = 0;
  const row = (kind: "me" | "her" | "card" | "stamp", body: React.ReactNode, key: string) => {
    const mark =
      kind === "me" ? (
        <svg width={26} height={26} viewBox="0 0 26 26">
          <path d="M13 2 L24 22 H2 Z" fill={ORANGE} stroke={PAPER} strokeWidth={2} strokeLinejoin="round" />
          <text x={13} y={19.5} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff" style={{ fontFamily: F.barlow }}>
            {++wp}
          </text>
        </svg>
      ) : kind === "her" ? (
        <svg width={16} height={16}>
          <circle cx={8} cy={8} r={5} fill={PAPER} stroke={INK} strokeWidth={1.6} />
        </svg>
      ) : null;
    return (
      <div key={key} style={{ position: "relative", display: "flex", paddingLeft: gut }}>
        {mark ? <div style={{ position: "absolute", left: gut / 2 - (kind === "me" ? 13 : 8), top: "50%", transform: `translateY(-50%)`, zIndex: 2 }}>{mark}</div> : null}
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>{body}</div>
      </div>
    );
  };

  const me = (text: string) => (
    <div style={{ alignSelf: "flex-end", maxWidth: (colW - gut) * (tall ? 0.88 : 0.96), display: "flex", alignItems: "center", gap: 14, background: "#fffdf8", border: `1.5px solid ${INK}`, padding: `${fs * 0.5}px ${fs * 0.55}px ${fs * 0.5}px ${fs * 0.85}px`, fontSize: fs, lineHeight: 1.4, color: INK }}>
      <span>{text}</span>
      <span style={{ alignSelf: "center", width: 7, minWidth: 7, height: fs * 1.15, background: ORANGE }} />
    </div>
  );
  const her = (text: string) => (
    <div style={{ alignSelf: "stretch", background: NOTE, border: `1px solid ${NOTE_LINE}`, borderRadius: 2, padding: `${fs * 0.75}px ${fs * 1.1}px ${fs * 0.75}px ${fs * 1.75}px`, position: "relative", fontSize: fs, lineHeight: 1.45, color: INK, boxShadow: "0 1px 0 rgba(45,39,33,.06)" }}>
      <div style={{ position: "absolute", left: fs * 0.75, top: 12, bottom: 12, borderLeft: `2px dashed ${RED}` }} />
      {text}
    </div>
  );
  const card = (icon: React.ReactNode, title: string, sub: string) => (
    <div style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 16, background: NOTE, border: `1px solid ${NOTE_LINE}`, borderRadius: 2, padding: "12px 22px 12px 12px" }}>
      <div style={{ width: 44, height: 44, background: "#e3ead6", border: `1px solid #b9c7a6`, display: "flex", alignItems: "center", justifyContent: "center" }}>{icon}</div>
      <div>
        <div style={{ fontSize: fs * 0.95, fontWeight: 600, color: INK }}>{title}</div>
        <div style={{ fontSize: fs * 0.78, color: SOFT, marginTop: 2 }}>{sub}</div>
      </div>
    </div>
  );
  const check = (
    <svg width={20} height={20} viewBox="0 0 16 16">
      <path d="M3.4 8.3 L6.5 11.3 L12.6 4.9" stroke={GREEN} strokeWidth={1.9} fill="none" />
    </svg>
  );

  const chat = (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: tall ? 18 : 15 }}>
      <div style={{ position: "absolute", left: gut / 2 - 1, top: 40, bottom: 30, width: 3 }}>
        <svg width={3} height="100%" style={{ display: "block", overflow: "visible" }}>
          <line x1={1.5} y1={0} x2={1.5} y2="100%" stroke="#8a5a3c" strokeWidth={2.4} strokeLinecap="round" strokeDasharray="0.1 8" strokeDashoffset={-t * 14} />
        </svg>
      </div>
      {row(
        "stamp",
        <div style={{ alignSelf: "center", display: "flex", alignItems: "center", gap: 16, fontSize: 14, fontWeight: 600, letterSpacing: 2, color: SOFT, marginBottom: 2 }}>
          <ScaleBar w={70} h={4} segs={4} />
          {CHAT.stamp.toUpperCase()}
          <ScaleBar w={70} h={4} segs={4} />
        </div>,
        "s",
      )}
      {row("me", me(CHAT.me1), "m1")}
      {row("her", her(CHAT.her1), "h1")}
      {row("card", card(check, "Added to Taxes 2025", "Row 41 · $186 · Spoke & Wheel"), "c1")}
      {row("me", me(CHAT.me2), "m2")}
      {row("her", her(CHAT.her2), "h2")}
      {row("card", card(<Clock c={GREEN} s={20} />, "Pick up the bike", "Reminder set · Fri at 9:00 AM"), "c2")}
    </div>
  );

  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, overflow: "hidden", background: PAPER, fontFamily: F.barlow, fontWeight: 500 }}>
      <svg width={w} height={h} style={{ position: "absolute", left: 0, top: 0 }}>
        <g transform={`translate(${-pan} 0)`}>
          <path d={cNorm} stroke={CONTOUR} strokeWidth={1} fill="none" />
          <path d={cIdx} stroke={INDEX} strokeWidth={1.5} fill="none" />
        </g>
        {spots.map(([x, y, lab]) => (
          <g key={lab} transform={`translate(${x} ${y})`}>
            <path d="M0 -6 L6 4 H-6 Z" fill={INK} />
            <text x={10} y={4} fontSize={13} fill={SOFT} style={{ fontFamily: F.barlow, fontWeight: 600 }}>
              {lab}
            </text>
          </g>
        ))}
        <path id="tr-creek" d={creek} stroke="#6f97cf" strokeWidth={2.2} fill="none" strokeLinecap="round" />
        <text fontSize={16} fill={BLUE} letterSpacing={2} dy={-8} style={{ fontFamily: F.barlowI, fontStyle: "italic" }}>
          <textPath href="#tr-creek" startOffset={tall ? "44%" : "38%"}>
            Alder Creek
          </textPath>
        </text>
      </svg>

      <div style={{ position: "absolute", left: 0, top: 0, width: w, height: barH, background: "#f6f0e3", borderBottom: `1px solid ${INK}`, display: "flex", alignItems: "center", fontSize: 16, color: INK }}>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: -5, height: 2, background: INK }} />
        <div style={{ display: "flex", gap: 8, marginLeft: 20 }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <div key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />
          ))}
        </div>
        {tall ? null : (
          <div style={{ display: "flex", alignItems: "center", gap: 18, marginLeft: 30 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", borderRadius: 6, background: "#e9e0cd", fontSize: 16 }}>
              <svg width={16} height={16} viewBox="0 0 16 16">
                <path d="M8 2.5 C4.4 2.5 2 4.7 2 7.4 C2 8.8 2.6 10 3.7 10.9 L3 13.6 L6.2 12.1 C6.8 12.2 7.4 12.3 8 12.3 C11.6 12.3 14 10.1 14 7.4 C14 4.7 11.6 2.5 8 2.5 Z" stroke={INK} strokeWidth={1.3} fill="none" />
              </svg>
              Chat
            </div>
            <span style={{ fontSize: 24, color: SOFT, fontWeight: 400 }}>+</span>
          </div>
        )}
        <div style={{ position: "absolute", left: w / 2 - 15, top: barH / 2 - 15 }}>
          <svg width={30} height={30} viewBox={`0 0 ${STAR.C * 2} ${STAR.C * 2}`}>
            <path d={STAR.path} fill="#6b6ad8" />
            <rect x={STAR.C - 28} y={STAR.C - 22} width={16} height={34} rx={8} fill="#fff" />
            <rect x={STAR.C + 12} y={STAR.C - 22} width={16} height={34} rx={8} fill="#fff" />
          </svg>
        </div>
        <div style={{ position: "absolute", right: 22, top: 0, height: barH, display: "flex", alignItems: "center", gap: 14 }}>
          <NorthArrow />
          <ScaleBar w={tall ? 54 : 70} h={5} segs={3} />
          <span style={{ fontSize: 15, color: SOFT, marginLeft: -4 }}>1 mi</span>
          <span style={{ width: 1, height: 22, background: "#b8aa94" }} />
          <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: 0.3 }}>4:10 PM</span>
          {tall ? null : (
            <svg width={18} height={18} viewBox="0 0 18 18" style={{ marginLeft: 6 }}>
              <path d="M9 2.5 C5.8 2.5 4.5 5 4.5 7.5 V11 L3 13 H15 L13.5 11 V7.5 C13.5 5 12.2 2.5 9 2.5 Z M7.3 14.8 Q9 16.6 10.7 14.8" stroke={INK} strokeWidth={1.3} fill="none" />
            </svg>
          )}
          <span style={{ marginLeft: tall ? 4 : 0 }}>Account</span>
        </div>
      </div>

      <div style={{ position: "absolute", ...(tall ? { right: 34, top: barH + 34 } : { right: 34, top: 300 }) }}>
        <Legend w={sideW} />
      </div>

      <div style={{ position: "absolute", left: colX, width: colW, bottom: 118 }}>{chat}</div>

      <div style={{ position: "absolute", left: colX + gut - 6, width: colW - gut + 12, bottom: 22, height: 74, padding: 3, border: `1.5px solid ${INK}`, borderRadius: 8, background: "#fbf8f1" }}>
        <div style={{ height: "100%", border: `1px solid #cdbfa6`, borderRadius: 5, display: "flex", alignItems: "center", gap: 16, padding: "0 10px" }}>
          <div style={{ width: 42, height: 42, border: `1px solid ${INK}`, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, fontWeight: 400, color: INK }}>+</div>
          <div style={{ flex: 1, fontSize: fs, color: "#9a8d7c" }}>
            <span style={{ display: "inline-block", width: 2, height: fs + 2, marginRight: 2, background: caret ? ORANGE : "transparent", transform: "translateY(4px)" }} />
            {CHAT.placeholder}
          </div>
          <svg width={16} height={22} viewBox="0 0 14 20">
            <rect x={4} y={1} width={6} height={11} rx={3} fill="none" stroke={INK} strokeWidth={1.5} />
            <path d="M1.5 9 Q1.5 15 7 15 Q12.5 15 12.5 9 M7 15 V19" stroke={INK} strokeWidth={1.5} fill="none" />
          </svg>
          <div style={{ width: 42, height: 42, border: `1px solid #cdbfa6`, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width={16} height={16}>
              <path d="M8 14 V2 M3 7 L8 2 L13 7" stroke={SOFT} strokeWidth={1.6} fill="none" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
};
