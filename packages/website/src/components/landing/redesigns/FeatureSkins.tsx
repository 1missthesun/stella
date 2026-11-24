import React, { type CSSProperties, type ReactNode } from "react";
import { ChatWindow, designScale, PIN_ICON } from "./ChatLooks";
import type { SkinProps } from "./content";
import { F, hash, lerp, STAR, starEyes } from "./kit";

const T0 = 1.2;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const out = (x: number) => 1 - (1 - x) ** 3;
const inOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const tap = (t: number, at: number) => (t > at - 0.02 && t < at + 0.16 ? Math.sin(((t - at + 0.02) / 0.18) * Math.PI) : 0);

type Pt = [number, number];
type Box = { x: number; y: number; w: number; h: number };

const WALLPAPER = "/landing/desktop-wallpaper.webp";

function Wallpaper() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={WALLPAPER} alt="" decoding="async" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: "brightness(0.82) saturate(0.92)" }} />
  );
}

function Arrow({ at, s, press = 0, style }: { at: Pt; s: number; press?: number; style?: CSSProperties }) {
  return (
    <div style={{ position: "absolute", left: at[0], top: at[1], transform: `scale(${s * (1 - press * 0.12)})`, transformOrigin: "3px 2px", ...style }}>
      <svg width={26} height={30} viewBox="0 0 26 30" style={{ display: "block", filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.35))" }}>
        <path d="M3 2 L3 23 L8.4 18.2 L12.2 27 L16 25.4 L12.3 16.8 L19.6 16.6 Z" fill="#111" stroke="#fff" strokeWidth={1.8} strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function AppWin({ box, title, children, z, serif = false, s }: { box: Box; title: string; children: ReactNode; z: number; serif?: boolean; s: number }) {
  return (
    <div
      style={{
        position: "absolute",
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        zIndex: z,
        borderRadius: 12 * s,
        overflow: "hidden",
        background: serif ? "#fbfaf7" : "#fff",
        color: "#1d1d1f",
        fontFamily: F.manrope,
        boxShadow: "0 0 0 1px rgba(0,0,0,0.12), 0 30px 70px -20px rgba(0,0,0,0.5)",
      }}
    >
      <div style={{ height: 40 * s, display: "flex", alignItems: "center", gap: 14 * s, padding: `0 ${14 * s}px`, background: serif ? "#f1efe9" : "#f3f3f5", borderBottom: "1px solid #e2e2e6" }}>
        <span style={{ display: "inline-flex", gap: 7 * s }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <i key={c} style={{ width: 11 * s, height: 11 * s, borderRadius: "50%", background: c }} />
          ))}
        </span>
        <span style={{ fontSize: 14 * s, fontWeight: 600 }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

const SHEET_ROWS = [
  ["38", "Apr 24", "Phone", "$45.00"],
  ["39", "Apr 28", "Books", "$31.50"],
  ["40", "May 1", "Rent", "$1,450.00"],
  ["41", "May 3", "Bike repair", "$186.00"],
  ["42", "May 6", "Train pass", "$96.00"],
  ["43", "May 9", "Internet", "$60.00"],
  ["44", "May 12", "Dentist", "$120.00"],
  ["45", "May 15", "Gym", "$39.00"],
  ["46", "May 18", "Groceries", "$71.80"],
  ["47", "May 21", "Haircut", "$28.00"],
  ["48", "May 24", "Coffee beans", "$18.50"],
];

function Sheet({ box, z, s }: { box: Box; z: number; s: number }) {
  return (
    <AppWin box={box} title="Taxes 2025" z={z} s={s}>
      <div style={{ display: "grid", gridTemplateColumns: `${44 * s}px ${88 * s}px 1fr ${110 * s}px`, fontSize: 14 * s }}>
        {["", "Date", "What", "Amount"].map((c) => (
          <div key={c} style={{ padding: `${8 * s}px ${10 * s}px`, background: "#fafafa", borderBottom: "1px solid #e8e8ec", color: "#6e6e73", fontWeight: 600 }}>
            {c}
          </div>
        ))}
        {SHEET_ROWS.flatMap((r) =>
          r.map((c, i) => (
            <div
              key={r[0] + i}
              style={{
                padding: `${8 * s}px ${10 * s}px`,
                borderBottom: "1px solid #efeff2",
                background: r[0] === "41" ? "rgba(10,132,255,0.08)" : undefined,
                color: i === 0 ? "#8e8e93" : undefined,
                textAlign: i === 3 ? "right" : "left",
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              {c}
            </div>
          )),
        )}
      </div>
    </AppWin>
  );
}

function Notes({ box, z, s }: { box: Box; z: number; s: number }) {
  return (
    <AppWin box={box} title="Ride notes" z={z} serif s={s}>
      <div style={{ padding: `${24 * s}px ${30 * s}px`, fontFamily: "var(--l-serif), Georgia, serif", fontSize: 18 * s, lineHeight: 1.55, color: "#2a2a2a" }}>
        <div style={{ fontSize: 28 * s, fontWeight: 600, marginBottom: 10 * s }}>Coast loop, Saturday</div>
        Out at six before the wind picks up. Coffee at the harbour, then the long climb back over the headland.
      </div>
    </AppWin>
  );
}

const move = (t: number, from: Pt, to: Pt, a: number, b: number): Pt => {
  const k = inOut(seg(t, a, b));
  return [lerp(from[0], to[0], k), lerp(from[1], to[1], k)];
};

export function PinSkin({ t: clock, w, h }: SkinProps) {
  const t = clock - T0;
  const tall = h > w;
  const s = tall ? 1.3 : 1;
  const sheet: Box = tall ? { x: 26, y: 760, w: 788, h: 560 } : { x: 40, y: 330, w: 720, h: 500 };
  const notes: Box = tall ? { x: 300, y: 70, w: 520, h: 360 } : { x: 990, y: 470, w: 460, h: 340 };
  const win: Box = tall ? { x: 60, y: 230, w: 720, h: 860 } : { x: 470, y: 70, w: 720, h: 600 };
  const ws = tall ? 1.18 : 0.86;
  const btn = 30 * ws;
  const pinPt: Pt = [win.x + win.w - 16 * ws - btn / 2, win.y + 26 * ws];

  const PIN = 0.75;
  const SHEET = 1.45;
  const HOVER = 2.35;
  const pinOn = t >= PIN + 0.04;
  const fade = out(seg(t, SHEET - 0.32, SHEET)) * (1 - out(seg(t, HOVER - 0.05, HOVER + 0.2)));
  const sheetPt: Pt = tall ? [180, 1230] : [180, 720];
  const overStella: Pt = [win.x + win.w * 0.6, win.y + win.h * 0.6];
  const start: Pt = [win.x + win.w * 0.7, win.y + win.h * 0.8];
  let cur = move(t, start, pinPt, 0.25, PIN - 0.03);
  if (t > PIN + 0.1) cur = move(t, pinPt, sheetPt, PIN + 0.2, SHEET - 0.03);
  if (t > SHEET + 0.1) cur = move(t, sheetPt, overStella, SHEET + 0.5, HOVER);
  const press = tap(t, PIN) + tap(t, SHEET);
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <Wallpaper />
      <Notes box={notes} z={1} s={s} />
      <Sheet box={sheet} z={t >= SHEET + 0.03 ? 3 : 2} s={s} />
      <ChatWindow
        w={win.w}
        h={win.h}
        scale={ws}
        account={false}
        style={{ left: win.x, top: win.y, zIndex: 5, opacity: 1 - 0.62 * (pinOn ? fade : 0), boxShadow: "0 0 0 1px rgba(255,255,255,0.12), 0 40px 90px -24px rgba(0,0,0,0.7)" }}
        barRight={
          <span
            style={{
              display: "grid",
              placeItems: "center",
              width: btn,
              height: btn,
              borderRadius: 8 * ws,
              background: pinOn ? "rgba(10,132,255,0.24)" : "rgba(255,255,255,0.07)",
              color: pinOn ? "#5eb0ff" : "var(--w-sub-strong)",
              transform: `scale(${1 - tap(t, PIN) * 0.14})`,
            }}
          >
            <svg width={16 * ws} height={16 * ws} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
              {PIN_ICON}
            </svg>
          </span>
        }
      />
      <Arrow at={cur} s={tall ? 2.1 : 1.5} press={press} style={{ zIndex: 9 }} />
    </div>
  );
}

const PET_INK = "#1b1630";

function Pet({ x, y, size, t }: { x: number; y: number; size: number; t: number }) {
  const WAKE = 1.2;
  const awake = t >= WAKE;
  const hopK = (a: number) => (t > a && t < a + 0.34 ? Math.sin(((t - a) / 0.34) * Math.PI) : 0);
  const hop = hopK(1.32) + hopK(1.74) * 0.7;
  const land = (a: number) => (t > a + 0.34 && t < a + 0.46 ? Math.sin(((t - a - 0.34) / 0.12) * Math.PI) : 0);
  const squash = land(1.32) + land(1.74) * 0.7;
  const breathe = awake ? 0 : Math.sin(t * 2.6) * 0.025;
  const C = STAR.C;
  const eyes = starEyes();
  const k = size / (2 * C);
  return (
    <div style={{ position: "absolute", left: x - size / 2, top: y - size, width: size, height: size }}>
      <div style={{ position: "absolute", left: "18%", right: "18%", bottom: -size * 0.04, height: size * 0.08, borderRadius: "50%", background: "rgba(0,0,0,0.35)", filter: `blur(${size * 0.04}px)`, transform: `scaleX(${1 - hop * 0.35})` }} />
      <svg
        viewBox={`0 0 ${2 * C} ${2 * C}`}
        width={size}
        height={size}
        style={{ position: "absolute", inset: 0, overflow: "visible", transform: `translateY(${-hop * size * 0.42}px) scale(${1 + squash * 0.1 + breathe}, ${1 - squash * 0.12 - breathe})`, transformOrigin: "50% 100%" }}
      >
        <defs>
          <linearGradient id="pet-ink" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#9b6bff" />
            <stop offset="0.5" stopColor="#5b7cff" />
            <stop offset="1" stopColor="#2fd0c4" />
          </linearGradient>
        </defs>
        <path d={STAR.path} fill="url(#pet-ink)" />
        {awake
          ? [eyes.l, eyes.r].map(([cx, cy], i) => <ellipse key={i} cx={cx} cy={cy} rx={eyes.ew * 0.32} ry={eyes.eh * (t < WAKE + 0.08 ? 0.12 : 0.42)} fill={PET_INK} />)
          : [eyes.l, eyes.r].map(([cx, cy], i) => (
              <path key={i} d={`M${cx - eyes.ew * 0.36} ${cy - 2} q${eyes.ew * 0.36} ${eyes.eh * 0.42} ${eyes.ew * 0.72} 0`} fill="none" stroke={PET_INK} strokeWidth={5 / Math.max(0.6, k)} strokeLinecap="round" />
            ))}
      </svg>
      {!awake
        ? [0, 1].map((i) => {
            const p = ((t * 0.55 + i * 0.5) % 1 + 1) % 1;
            return (
              <span
                key={i}
                style={{
                  position: "absolute",
                  left: size * (0.78 + p * 0.22),
                  top: size * (0.12 - p * 0.42),
                  fontFamily: F.manrope,
                  fontWeight: 700,
                  fontSize: size * (0.13 + i * 0.05),
                  color: "rgba(255,255,255,0.85)",
                  opacity: Math.sin(p * Math.PI),
                }}
              >
                z
              </span>
            );
          })
        : null}
    </div>
  );
}

export function PetSkin({ t: clock, w, h }: SkinProps) {
  const t = clock - T0;
  const tall = h > w;
  const win: Box = tall ? { x: 40, y: 50, w: 760, h: 760 } : { x: 70, y: 60, w: 760, h: 520 };
  const pet = tall ? { x: 430, y: 1250, size: 190 } : { x: 1040, y: 800, size: 130 };
  const toastK = out(seg(t, 2.0, 2.28));
  const fs = tall ? 30 : 21;
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <Wallpaper />
      <ChatWindow w={win.w} h={win.h} scale={tall ? 1.15 : 0.82} account={false} style={{ left: win.x, top: win.y, boxShadow: "0 0 0 1px rgba(255,255,255,0.12), 0 40px 90px -24px rgba(0,0,0,0.7)" }} />
      <Pet x={pet.x} y={pet.y} size={pet.size} t={t} />
      {toastK > 0.01 ? (
        <div
          style={{
            position: "absolute",
            left: pet.x,
            bottom: h - pet.y + pet.size * 1.12,
            transform: `translateX(-50%) translateY(${(1 - toastK) * 12}px) scale(${0.9 + 0.1 * toastK})`,
            transformOrigin: "50% 100%",
            opacity: toastK,
            width: "max-content",
            padding: `${fs * 0.6}px ${fs * 0.85}px`,
            borderRadius: fs * 0.6,
            background: "rgba(30,30,34,0.94)",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.1), 0 18px 40px -12px rgba(0,0,0,0.6)",
            fontFamily: F.manrope,
            fontSize: fs,
            lineHeight: 1.35,
            color: "#f2f2f5",
          }}
        >
          <div style={{ color: "#4ea3ff", fontWeight: 700 }}>Done!</div>
          <div style={{ fontWeight: 600 }}>Receipt added to Taxes 2025</div>
          <div style={{ color: "rgba(255,255,255,0.55)", fontSize: fs * 0.85 }}>Open in Stella</div>
        </div>
      ) : null}
    </div>
  );
}

const INK = "#ff5a4f";

function wobblyRect(x0: number, y0: number, x1: number, y1: number, seed: number): Pt[] {
  const pts: Pt[] = [];
  const side = (ax: number, ay: number, bx: number, by: number, sd: number) => {
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const bow = Math.sin(u * Math.PI) * (hash(seed + sd, 3) - 0.5) * 9;
      const jit = (hash(seed * 7 + sd * 13 + i, 5) - 0.5) * 1.6;
      const nx = -(by - ay);
      const ny = bx - ax;
      const L = Math.hypot(nx, ny) || 1;
      pts.push([lerp(ax, bx, u) + (nx / L) * (bow + jit), lerp(ay, by, u) + (ny / L) * (bow + jit)]);
    }
  };
  side(x0 + 6, y0 + 3, x1 - 2, y0 - 2, 1);
  side(x1 - 2, y0 - 2, x1 + 3, y1 - 4, 2);
  side(x1 + 3, y1 - 4, x0 + 2, y1 + 2, 3);
  side(x0 + 2, y1 + 2, x0 - 2, y0 + 14, 4);
  return pts;
}

function squiggle(x0: number, y: number, len: number, seed: number): Pt[] {
  return Array.from({ length: 19 }, (_, i) => {
    const u = i / 18;
    return [x0 + u * len, y + Math.sin(u * 9 + seed) * 3 + (hash(seed + i, 9) - 0.5) * 1.5] as Pt;
  });
}

function partial(p: Pt[], k: number): { pts: Pt[]; tip: Pt } {
  if (k >= 1) return { pts: p, tip: p[p.length - 1] };
  const total = p.reduce((sum, q, i) => (i ? sum + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);
  const L = total * clamp01(k);
  let acc = 0;
  const pts: Pt[] = [p[0]];
  for (let i = 1; i < p.length; i++) {
    const d = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    if (acc + d >= L) {
      const u = (L - acc) / (d || 1);
      const tip: Pt = [lerp(p[i - 1][0], p[i][0], u), lerp(p[i - 1][1], p[i][1], u)];
      pts.push(tip);
      return { pts, tip };
    }
    acc += d;
    pts.push(p[i]);
  }
  return { pts, tip: p[p.length - 1] };
}

const poly = (p: Pt[]) => p.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(" ");

function penBox(w: number, h: number) {
  const tall = h > w;
  const box = tall ? { x0: 70, y0: 190, x1: 600, y1: 590 } : { x0: 1150, y0: 110, x1: 1440, y1: 410 };
  const bw = box.x1 - box.x0;
  const row = tall ? 82 : 72;
  const top = box.y0 + (tall ? 150 : 128);
  const indent = tall ? 100 : 74;
  return {
    tall,
    box,
    rect: wobblyRect(box.x0, box.y0, box.x1, box.y1, 3),
    lines: [0, 1, 2].map((i) => squiggle(box.x0 + indent, top + i * row, bw * (0.6 - i * 0.09), i + 2)),
    checks: [0, 1, 2].map((i) => wobblyRect(box.x0 + indent - 46 * (tall ? 1.3 : 1), top - 14 * (tall ? 1.3 : 1) + i * row, box.x0 + indent - 18 * (tall ? 1.3 : 1), top + 12 * (tall ? 1.3 : 1) + i * row, 10 + i)),
  };
}

function PenTip({ at, s }: { at: Pt; s: number }) {
  return (
    <div style={{ position: "absolute", left: at[0] - 2 * s, top: at[1] - 30 * s, transform: `scale(${s})`, transformOrigin: "2px 30px", filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.4))" }}>
      <svg width={32} height={32} viewBox="0 0 24 24" fill="none" style={{ display: "block" }}>
        <path d="M3 21l1.2-4.6L16.5 4.1a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L7.6 19.8z" fill="#fff" stroke="#111" strokeWidth={1.4} strokeLinejoin="round" />
        <path d="M3 21l1.2-4.6 3.4 3.4z" fill={INK} />
      </svg>
    </div>
  );
}

export function PenSkin({ t: clock, w, h }: SkinProps) {
  const t = clock - T0;
  const { tall, box, rect, lines, checks } = penBox(w, h);
  const s = designScale(w, h);
  const kRect = inOut(seg(t, 0.5, 1.05));
  const kWrite = seg(t, 1.1, 1.4);
  const kLines = [0, 1, 2].map((i) => inOut(seg(t, 1.45 + i * 0.16, 1.59 + i * 0.16)));
  let tip: Pt = [w * 0.62, h * 0.55];
  if (t < 0.5) tip = move(t, tip, rect[0], 0.15, 0.5);
  else if (t < 1.1) tip = partial(rect, kRect).tip;
  else if (t < 1.45) tip = [lerp(box.x0 + (tall ? 96 : 72), box.x0 + (tall ? 330 : 240), kWrite), box.y0 + (tall ? 90 : 72)];
  else {
    const i = Math.min(2, Math.floor((t - 1.45) / 0.16));
    tip = partial(lines[i], kLines[i]).tip;
  }
  const toolW = 380 * s;
  const toolH = 40 * s;
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <ChatWindow w={w} h={h} scale={s} style={{ left: 0, top: 0 }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: 14 * s, boxShadow: `inset 0 0 0 ${2.5 * s}px rgba(255,90,79,0.6)`, pointerEvents: "none" }} />
        <div
          style={{
            position: "absolute",
            left: (w - toolW) / 2,
            top: 62 * s,
            width: toolW,
            height: toolH,
            borderRadius: toolH / 2,
            display: "flex",
            alignItems: "center",
            gap: 11 * s,
            padding: `0 ${8 * s}px 0 ${14 * s}px`,
            boxSizing: "border-box",
            background: "rgba(40,40,44,0.94)",
            border: "1px solid rgba(255,255,255,0.12)",
            boxShadow: "0 10px 30px -8px rgba(0,0,0,0.6)",
            fontSize: 14 * s,
            color: "rgba(255,255,255,0.86)",
          }}
        >
          {[INK, "#ffd60a", "#30d158", "#0a84ff"].map((c, i) => (
            <span key={c} style={{ width: 17 * s, height: 17 * s, borderRadius: "50%", background: c, boxShadow: i === 0 ? `0 0 0 ${2 * s}px rgba(40,40,44,1), 0 0 0 ${3.5 * s}px rgba(255,255,255,0.85)` : undefined }} />
          ))}
          <span style={{ width: 1, height: 18 * s, background: "rgba(255,255,255,0.16)" }} />
          <span>Undo</span>
          <span>Clear</span>
          <span style={{ marginLeft: "auto", padding: `${5 * s}px ${11 * s}px`, borderRadius: 13 * s, background: "rgba(10,132,255,0.9)", color: "#fff", fontWeight: 600 }}>Add to chat</span>
        </div>
        <svg width={w} height={h} style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}>
          <polyline points={poly(partial(rect, kRect).pts)} fill="none" stroke={INK} strokeWidth={4.5 * s} strokeLinecap="round" strokeLinejoin="round" />
          {checks.map((c, i) => (kLines[i] > 0 ? <polyline key={`c${i}`} points={poly(partial(c, clamp01(kLines[i] * 2.2)).pts)} fill="none" stroke={INK} strokeWidth={3.5 * s} strokeLinecap="round" strokeLinejoin="round" /> : null))}
          {lines.map((l, i) => (kLines[i] > 0 ? <polyline key={`l${i}`} points={poly(partial(l, clamp01(kLines[i] * 1.6 - 0.6)).pts)} fill="none" stroke={INK} strokeWidth={4 * s} strokeLinecap="round" strokeLinejoin="round" /> : null))}
        </svg>
        {kWrite > 0 ? (
          <div style={{ position: "absolute", left: box.x0 + 30 * s, top: box.y0 + 22 * s, fontFamily: F.kid, fontSize: 54 * s, color: INK, clipPath: `inset(0 ${(1 - kWrite) * 100}% 0 0)`, transform: "rotate(-3deg)", lineHeight: 1 }}>Today</div>
        ) : null}
        <PenTip at={tip} s={s * 1.2} />
      </ChatWindow>
    </div>
  );
}

const TODAY = [
  { what: "Pick up the bike", when: "Fri 9:00", hot: true },
  { what: "Coast loop", when: "Sat 6:00", hot: false },
  { what: "Taxes: bike receipt", when: "Done", hot: false },
];

export function PenRealSkin({ t: clock, w, h }: SkinProps) {
  const t = clock - T0;
  const { box } = penBox(w, h);
  const s = designScale(w, h);
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <ChatWindow w={w} h={h} scale={s} style={{ left: 0, top: 0 }}>
        <div
          style={{
            position: "absolute",
            left: box.x0,
            top: box.y0,
            width: box.x1 - box.x0,
            height: box.y1 - box.y0,
            borderRadius: 14 * s,
            border: "1px solid rgba(255,255,255,0.16)",
            background: "#26262a",
            boxShadow: "0 18px 40px -16px rgba(0,0,0,0.6)",
            padding: `${18 * s}px ${18 * s}px`,
            boxSizing: "border-box",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 * s, marginBottom: 14 * s }}>
            <span style={{ fontSize: 20 * s, fontWeight: 700 }}>Today</span>
            <span style={{ fontSize: 14 * s, color: "var(--w-sub)" }}>Thursday, May 6</span>
          </div>
          {TODAY.map((r, i) => (
            <div
              key={r.what}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12 * s,
                padding: `${10 * s}px ${10 * s}px`,
                marginBottom: 4 * s,
                borderRadius: 10 * s,
                background: r.hot ? "rgba(10,132,255,0.14)" : undefined,
                opacity: out(seg(t, 0.35 + i * 0.09, 0.6 + i * 0.09)),
                transform: `translateY(${(1 - out(seg(t, 0.35 + i * 0.09, 0.6 + i * 0.09))) * 6 * s}px)`,
              }}
            >
              <span style={{ width: 16 * s, height: 16 * s, borderRadius: 5 * s, border: `${1.6 * s}px solid ${r.when === "Done" ? "rgba(48,209,88,0.9)" : "var(--w-sub-strong)"}`, background: r.when === "Done" ? "rgba(48,209,88,0.2)" : undefined, flex: "none" }} />
              <span style={{ flex: 1, fontSize: 16 * s, fontWeight: r.hot ? 600 : 500, whiteSpace: "nowrap" }}>{r.what}</span>
              <span style={{ fontSize: 14 * s, color: r.hot ? "#5eb0ff" : "var(--w-sub)", fontVariantNumeric: "tabular-nums" }}>{r.when}</span>
            </div>
          ))}
        </div>
      </ChatWindow>
    </div>
  );
}
