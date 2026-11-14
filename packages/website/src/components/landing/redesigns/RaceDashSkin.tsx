import React from "react";
import { CHAT, type SkinProps } from "./content";
import { F, STAR, hash } from "./kit";

/**
 * A sim racer's wheel display. The window is the face of a formula-style wheel:
 * clear-coated carbon, suede grips, a shift-light strip as the top bar, a sunlight-bright
 * dash screen with a huge gear digit, lap delta and tyre temps, and the conversation
 * as the team-radio transcript. The composer is push-to-talk.
 */

const LED_G = "#27f26a";
const LED_A = "#ffb300";
const LED_R = "#ff2b2b";
const LED_B = "#2f8bff";
const CYAN = "#3fd4ff";
const DIM = "#6d7480";

const CARBON: React.CSSProperties = {
  backgroundColor: "#131416",
  backgroundImage: [
    "linear-gradient(27deg, #0c0d0f 5px, transparent 5px)",
    "linear-gradient(207deg, #0c0d0f 5px, transparent 5px)",
    "linear-gradient(27deg, #1d1f22 5px, transparent 5px)",
    "linear-gradient(207deg, #1d1f22 5px, transparent 5px)",
    "linear-gradient(90deg, #17181b 10px, transparent 10px)",
    "linear-gradient(#18191c 25%, #141517 25%, #141517 50%, transparent 50%, transparent 75%, #222428 75%, #222428)",
  ].join(","),
  backgroundSize: "20px 20px",
  backgroundPosition: "0 5px, 10px 0, 0 10px, 10px 5px, 0 0, 0 0",
};

/** Engine state: revs climb, an upshift drops them, gear counts up. */
function engine(t: number) {
  const u = t * 0.95 + 0.62;
  const k = u - Math.floor(u);
  const rpm = 0.5 + 0.5 * Math.pow(k, 0.8);
  const gear = 3 + (Math.floor(u) % 4);
  const speed = Math.round(150 + gear * 14 + rpm * 22);
  return { rpm, gear, speed };
}

const ShiftLights: React.FC<{ t: number; n: number; w: number; h: number }> = ({ t, n, w, h }) => {
  const { rpm } = engine(t);
  const half = Math.floor(n / 2);
  const lit = Math.floor(((rpm - 0.5) / 0.5) * (half + 1));
  const limiter = rpm > 0.965;
  const flash = limiter && Math.floor(t * 16) % 2 === 0;
  const gap = w / (n + 2);
  const d = Math.min(gap * 0.72, h * 0.62);
  const led = (i: number, x: number) => {
    const col = i < half * 0.4 ? LED_G : i < half * 0.75 ? LED_A : LED_R;
    const on = limiter ? flash : i < lit;
    const c = limiter ? LED_B : col;
    return (
      <div
        key={x}
        style={{
          position: "absolute",
          left: x - d / 2,
          top: (h - d) / 2,
          width: d,
          height: d,
          borderRadius: "50%",
          background: on ? `radial-gradient(circle at 45% 40%, #fff 0%, ${c} 38%, ${c} 70%, rgba(0,0,0,.4) 100%)` : `radial-gradient(circle at 45% 40%, #3a3d42, #111214 75%)`,
          boxShadow: on ? `0 0 ${d * 0.45}px ${c}99` : "inset 0 1px 2px rgba(0,0,0,.8), 0 1px 0 rgba(255,255,255,.06)",
        }}
      />
    );
  };
  const out: React.ReactNode[] = [];
  for (let i = 0; i < half; i++) {
    out.push(led(i, gap * (i + 0.5)));
    out.push(led(i, w - gap * (i + 0.5)));
  }
  return (
    <div style={{ position: "relative", width: w, height: h }}>
      {out}
      <svg width={h * 0.62} height={h * 0.62} viewBox={`0 0 ${STAR.C * 2} ${STAR.C * 2}`} style={{ position: "absolute", left: w / 2 - h * 0.31, top: h * 0.19 }}>
        <path d={STAR.path} fill={CYAN} />
        <rect x={STAR.C - 28} y={STAR.C - 22} width={16} height={34} rx={8} fill="#04131a" />
        <rect x={STAR.C + 12} y={STAR.C - 22} width={16} height={34} rx={8} fill="#04131a" />
      </svg>
    </div>
  );
};

/** An original circuit, drawn from a few harmonics; the car runs it. */
const TrackMap: React.FC<{ t: number; w: number; h: number }> = ({ t, w, h }) => {
  const N = 160;
  const pts: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 1 + 0.22 * Math.sin(2 * a + 0.6) + 0.12 * Math.sin(3 * a + 2.1) + 0.08 * Math.cos(5 * a);
    pts.push([w / 2 + Math.cos(a) * r * w * 0.36, h / 2 + Math.sin(a) * r * h * 0.34]);
  }
  const d = "M" + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L") + "Z";
  const k = Math.floor((((t * 0.09 + 0.37) % 1) + 1) % 1 * N);
  const [cx, cy] = pts[k];
  const [ox, oy] = pts[(k + 40) % N];
  return (
    <svg width={w} height={h}>
      <path d={d} fill="none" stroke="#2a2f37" strokeWidth={12} strokeLinejoin="round" />
      <path d={d} fill="none" stroke="#6d7480" strokeWidth={4} strokeLinejoin="round" />
      <line x1={pts[0][0] - 9} y1={pts[0][1]} x2={pts[0][0] + 9} y2={pts[0][1]} stroke="#fff" strokeWidth={4} />
      <circle cx={ox} cy={oy} r={7} fill="#ff5a3c" />
      <circle cx={cx} cy={cy} r={9} fill="#ffd400" stroke="#050607" strokeWidth={3} />
    </svg>
  );
};

const Button: React.FC<{ x: number; y: number; d: number; color: string; label: string }> = ({ x, y, d, color, label }) => (
  <div style={{ position: "absolute", left: x - d / 2, top: y - d / 2, width: d, height: d }}>
    <div style={{ position: "absolute", inset: -4, borderRadius: "50%", background: "linear-gradient(180deg, #2b2d31, #0b0c0d)", boxShadow: "0 2px 3px rgba(0,0,0,.7)" }} />
    <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: `radial-gradient(circle at 40% 30%, rgba(255,255,255,.55) 0%, ${color} 34%, ${color} 62%, rgba(0,0,0,.55) 100%)`, boxShadow: "inset 0 -2px 3px rgba(0,0,0,.4)" }} />
    <div style={{ position: "absolute", left: -40, width: d + 80, top: d + 8, textAlign: "center", fontFamily: F.saira, fontWeight: 700, fontSize: 13, letterSpacing: 1.6, color: "#e9edf2" }}>{label}</div>
  </div>
);

const Rotary: React.FC<{ x: number; y: number; d: number; v: number; label: string }> = ({ x, y, d, v, label }) => {
  const R = d / 2;
  return (
    <div style={{ position: "absolute", left: x - R, top: y - R, width: d, height: d }}>
      <svg width={d * 2} height={d * 2} style={{ position: "absolute", left: -R, top: -R }}>
        {Array.from({ length: 12 }, (_, i) => {
          const a = ((i / 12) * 300 - 150 - 90) * (Math.PI / 180);
          return (
            <text key={i} x={d + Math.cos(a) * R * 1.4} y={d + Math.sin(a) * R * 1.4 + 4} textAnchor="middle" fontSize={10} fill={i === Math.round(v * 11) ? "#fff" : "#8b929c"} style={{ fontFamily: F.saira, fontWeight: 700 }}>
              {i + 1}
            </text>
          );
        })}
      </svg>
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "repeating-conic-gradient(#2a2c30 0deg 6deg, #0f1012 6deg 12deg)", boxShadow: "0 3px 4px rgba(0,0,0,.7)" }} />
      <div style={{ position: "absolute", inset: R * 0.22, borderRadius: "50%", background: "radial-gradient(circle at 40% 30%, #4a4d53, #151618 75%)" }} />
      <div style={{ position: "absolute", left: R - 2, top: R * 0.12, width: 4, height: R * 0.5, background: "#ff3b1f", borderRadius: 2, transformOrigin: `2px ${R * 0.88}px`, transform: `rotate(${v * 300 - 150}deg)` }} />
      <div style={{ position: "absolute", left: -50, width: d + 100, top: d + R * 0.75, textAlign: "center", fontFamily: F.saira, fontWeight: 700, fontSize: 13, letterSpacing: 1.6, color: "#e9edf2" }}>{label}</div>
    </div>
  );
};

const Label: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ fontFamily: F.saira, fontWeight: 700, fontSize: 15, letterSpacing: 2, color: DIM, ...style }}>{children}</div>
);

const Tyres: React.FC<{ t: number; s: number }> = ({ t, s }) => {
  const temps = [92, 95, 88, 90].map((v, i) => Math.round(v + Math.sin(t * 0.9 + i) * 1.2));
  const col = (v: number) => (v > 94 ? "#ffb300" : v < 89 ? "#2f8bff" : "#27f26a");
  return (
    <div style={{ display: "grid", gridTemplateColumns: `${s}px ${s}px`, gap: s * 0.18 }}>
      {temps.map((v, i) => (
        <div key={i} style={{ width: s, height: s * 1.3, borderRadius: s * 0.18, background: col(v), display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F.saira, fontWeight: 900, fontSize: s * 0.42, color: "#07110a" }}>
          {v}
        </div>
      ))}
    </div>
  );
};

const Radio: React.FC<{ fs: number; t: number }> = ({ fs, t }) => {
  const lines: [boolean, string][] = [
    [true, CHAT.me1],
    [false, CHAT.her1],
    [true, CHAT.me2],
    [false, CHAT.her2],
  ];
  const live = Math.floor(t * 3) % 2 === 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: fs * 0.7 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Label style={{ color: "#fff" }}>TEAM RADIO</Label>
        <div style={{ flex: 1, height: 2, background: "#2a2e35" }} />
        <Label>{CHAT.stamp.toUpperCase()}</Label>
      </div>
      {lines.map(([me, text], i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: `${fs * 4.6}px 1fr`, columnGap: fs * 0.6, alignItems: "baseline" }}>
          <div style={{ fontFamily: F.saira, fontWeight: 900, fontSize: fs * 0.78, letterSpacing: 1.4, color: me ? "#0a0b0d" : "#04131a", background: me ? "#ffd400" : CYAN, padding: "1px 6px 0", textAlign: "center", alignSelf: "start", marginTop: fs * 0.12 }}>
            {me ? "DRIVER" : "STELLA"}
          </div>
          <div style={{ fontFamily: F.saira, fontWeight: 500, fontSize: fs, lineHeight: 1.18, color: me ? "#f4f6f8" : "#c9f3ff" }}>
            {text}
            {i === 3 ? <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, marginLeft: 10, background: live ? LED_G : "transparent", transform: "translateY(-2px)" }} /> : null}
          </div>
        </div>
      ))}
    </div>
  );
};

const PTT: React.FC<{ t: number; w: number; h: number }> = ({ t, w, h }) => {
  const caret = Math.floor(t * 2.4) % 2 === 0;
  return (
    <div style={{ width: w, height: h, borderRadius: 8, background: "#0d0f12", boxShadow: "inset 0 0 0 2px #262a31", display: "flex", alignItems: "center", gap: 14, padding: "0 10px" }}>
      <div style={{ width: h - 16, height: h - 16, borderRadius: 6, background: "#22262d", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontFamily: F.saira, fontWeight: 700, fontSize: 26, lineHeight: 1 }}>+</div>
      <div style={{ flex: 1, fontFamily: F.saira, fontWeight: 500, fontSize: 22, color: "#7c8490" }}>
        {CHAT.placeholder}
        <span style={{ display: "inline-block", width: 3, height: 22, marginLeft: 4, background: caret ? "#fff" : "transparent", transform: "translateY(4px)" }} />
      </div>
      <div style={{ height: h - 16, borderRadius: 6, padding: "0 14px", background: "#3a0d0d", boxShadow: `inset 0 0 0 2px ${LED_R}`, display: "flex", alignItems: "center", gap: 8, fontFamily: F.saira, fontWeight: 900, fontSize: 17, letterSpacing: 1.6, color: "#ffb3b3" }}>
        <svg width={14} height={20} viewBox="0 0 14 20">
          <rect x={4} y={1} width={6} height={11} rx={3} fill="#ffb3b3" />
          <path d="M1.5 9 Q1.5 15 7 15 Q12.5 15 12.5 9 M7 15 V19" stroke="#ffb3b3" strokeWidth={1.8} fill="none" />
        </svg>
        PTT
      </div>
      <div style={{ height: h - 16, borderRadius: 6, padding: "0 18px", background: LED_G, display: "flex", alignItems: "center", fontFamily: F.saira, fontWeight: 900, fontSize: 18, letterSpacing: 2, color: "#04140a" }}>SEND</div>
    </div>
  );
};

export const RaceDashSkin: React.FC<SkinProps> = ({ t, w, h }) => {
  const tall = h > w;
  const { gear, speed, rpm } = engine(t);
  const delta = -0.214 + Math.sin(t * 1.7) * 0.012 - t * 0.004;
  const barH = 74;
  const grip = tall ? 54 : 150;
  // wheel face silhouette: a flat top, grips dropping at the sides, a cut-away bottom
  const face = tall
    ? `M 14 30 Q 14 10 40 10 H ${w - 40} Q ${w - 14} 10 ${w - 14} 30 V ${h - 30} Q ${w - 14} ${h - 10} ${w - 40} ${h - 10} H 40 Q 14 ${h - 10} 14 ${h - 30} Z`
    : `M 60 12 H ${w - 60} Q ${w - 10} 12 ${w - 8} 70 L ${w - 4} ${h - 120} Q ${w - 8} ${h - 14} ${w - 110} ${h - 16} Q ${w - 170} ${h - 18} ${w - 230} ${h - 70} H 230 Q 170 ${h - 18} 110 ${h - 16} Q 8 ${h - 14} 4 ${h - 120} L 8 70 Q 10 12 60 12 Z`;
  const disp = tall ? { x: 70, y: 112, w: w - 140, h: h - 112 - 230 } : { x: 236, y: 96, w: w - 472, h: h - 96 - 116 };
  const gearFs = tall ? 250 : 300;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, overflow: "hidden", background: "linear-gradient(180deg, #1b1d21, #07080a)" }}>
      <svg width={w} height={h} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <clipPath id="rd-face">
            <path d={face} />
          </clipPath>
          <filter id="rd-suede" x={0} y={0} width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency={0.9} numOctaves={2} seed={5} />
            <feColorMatrix values="0 0 0 0 0.12  0 0 0 0 0.12  0 0 0 0 0.13  0 0 0 0.9 0" />
          </filter>
          <linearGradient id="rd-coat" x1={0} y1={0} x2={0} y2={1}>
            <stop offset={0} stopColor="#fff" stopOpacity={0.1} />
            <stop offset={0.18} stopColor="#fff" stopOpacity={0.02} />
            <stop offset={1} stopColor="#000" stopOpacity={0.35} />
          </linearGradient>
        </defs>
        <path d={face} fill="#000" transform="translate(0 6)" opacity={0.6} />
      </svg>
      <div style={{ position: "absolute", inset: 0, clipPath: `path("${face}")`, ...CARBON }} />
      <svg width={w} height={h} style={{ position: "absolute", inset: 0 }}>
        <g clipPath="url(#rd-face)">
          {/* suede grips */}
          <rect x={0} y={0} width={grip} height={h} fill="#17181a" />
          <rect x={0} y={0} width={grip} height={h} filter="url(#rd-suede)" />
          <rect x={w - grip} y={0} width={grip} height={h} fill="#17181a" />
          <rect x={w - grip} y={0} width={grip} height={h} filter="url(#rd-suede)" />
          {[grip, w - grip].map((x, i) => (
            <g key={i}>
              <rect x={x - 2} y={0} width={4} height={h} fill="#000" opacity={0.6} />
              {/* contrast stitching along the grip seam */}
              {Array.from({ length: Math.floor(h / 18) }, (_, k) => (
                <rect key={k} x={x + (i ? -12 : 8)} y={k * 18 + 6} width={3} height={9} rx={1.5} fill="#ff3b1f" opacity={0.85} />
              ))}
            </g>
          ))}
          <path d={face} fill="url(#rd-coat)" />
        </g>
        <path d={face} fill="none" stroke="#000" strokeWidth={3} opacity={0.8} />
      </svg>

      {/* ---- top bar: shift lights */}
      <div style={{ position: "absolute", left: 0, top: 18, width: w, height: barH }}>
        <div style={{ position: "absolute", left: tall ? 30 : 74, top: 14, display: "flex", gap: 9 }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <div key={c} style={{ width: 15, height: 15, borderRadius: "50%", background: `radial-gradient(circle at 40% 35%, #fff8, ${c} 45%, ${c})`, boxShadow: "0 1px 2px #000" }} />
          ))}
        </div>
        <div style={{ position: "absolute", left: tall ? w / 2 - 250 : w / 2 - 380, top: 0, width: tall ? 500 : 760, height: 54, borderRadius: 27, background: "#060607", boxShadow: "inset 0 2px 6px rgba(0,0,0,.9), 0 1px 0 rgba(255,255,255,.08)", padding: "0 20px" }}>
          <div style={{ position: "absolute", left: 22, right: 22, top: 0, height: 54 }}>
            <ShiftLights t={t} n={tall ? 12 : 18} w={(tall ? 500 : 760) - 44} h={54} />
          </div>
        </div>
        <div style={{ position: "absolute", right: tall ? 30 : 74, top: 8, display: "flex", alignItems: "center", gap: 12, fontFamily: F.saira, fontWeight: 700, fontSize: 16, letterSpacing: 1.6, color: "#e9edf2" }}>
          <span>ACCOUNT</span>
        </div>
      </div>

      {/* ---- the dash screen */}
      <div style={{ position: "absolute", left: disp.x - 10, top: disp.y - 10, width: disp.w + 20, height: disp.h + 20, borderRadius: 18, background: "linear-gradient(180deg, #2a2d33, #0b0c0e)", boxShadow: "0 6px 12px rgba(0,0,0,.6)" }} />
      <div style={{ position: "absolute", left: disp.x, top: disp.y, width: disp.w, height: disp.h, borderRadius: 10, background: "#050607", overflow: "hidden" }}>
        {/* RPM bar */}
        <div style={{ position: "absolute", left: 0, top: 0, width: disp.w, height: 10, background: "#14171b" }}>
          <div style={{ width: `${((rpm - 0.5) / 0.5) * 100}%`, height: 10, background: rpm > 0.9 ? LED_R : rpm > 0.75 ? LED_A : LED_G }} />
        </div>
        {/* delta strip */}
        <div style={{ position: "absolute", left: 0, top: 10, width: disp.w, height: 64, borderBottom: "2px solid #1d2026" }}>
          <Label style={{ position: "absolute", left: 22, top: 18, color: "#fff", fontSize: 22 }}>LAP 12/40</Label>
          <div style={{ position: "absolute", left: disp.w / 2 - 220, top: 16, width: 440, height: 32, background: "#101317", borderRadius: 4 }}>
            <div style={{ position: "absolute", right: 220, top: 0, width: Math.min(210, -delta * 800), height: 32, background: LED_G, borderRadius: "4px 0 0 4px" }} />
            <div style={{ position: "absolute", left: 219, top: -4, width: 2, height: 40, background: "#fff" }} />
            <div style={{ position: "absolute", left: 236, top: -2, fontFamily: F.saira, fontWeight: 900, fontSize: 30, color: LED_G, lineHeight: 1.2 }}>{delta.toFixed(3)}</div>
          </div>
          <Label style={{ position: "absolute", right: 22, top: 18, color: "#fff", fontSize: 22 }}>P3</Label>
        </div>

        {tall ? (
          <>
            <div style={{ position: "absolute", left: 22, top: 84, width: 240 }}>
              <div style={{ fontFamily: F.saira, fontWeight: 900, fontSize: gearFs, lineHeight: 0.86, color: "#fff" }}>{gear}</div>
              <Label>GEAR · {speed} KM/H</Label>
            </div>
            <div style={{ position: "absolute", right: 24, top: 96, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
              <Stat k="LAST" v="1:32.418" />
              <Stat k="BEST" v="1:31.902" c={LED_G} />
              <div style={{ display: "flex", gap: 18, alignItems: "flex-end", marginTop: 6 }}>
                <Fuel t={t} />
                <Tyres t={t} s={42} />
              </div>
            </div>
            <div style={{ position: "absolute", left: 22, top: 380 }}>
              <Label>SECTOR 2 · TURN 9</Label>
              <TrackMap t={t} w={disp.w - 44} h={270} />
            </div>
            <div style={{ position: "absolute", left: 22, right: 22, top: 410, bottom: 100 }}>
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
                <Radio fs={25} t={t} />
              </div>
            </div>
            <div style={{ position: "absolute", left: 14, bottom: 14 }}>
              <PTT t={t} w={disp.w - 28} h={72} />
            </div>
          </>
        ) : (
          <>
            <div style={{ position: "absolute", left: 22, top: 84, width: 250 }}>
              <div style={{ fontFamily: F.saira, fontWeight: 900, fontSize: gearFs, lineHeight: 0.86, color: "#fff", marginLeft: -6 }}>{gear}</div>
              <Label>GEAR</Label>
              <div style={{ fontFamily: F.saira, fontWeight: 900, fontSize: 64, lineHeight: 1, color: "#fff", marginTop: 18 }}>{speed}</div>
              <Label>KM/H</Label>
            </div>
            <div style={{ position: "absolute", left: 270, top: 74, bottom: 96, width: 2, background: "#1d2026" }} />
            <div style={{ position: "absolute", right: 22, top: 92, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12 }}>
              <Stat k="LAST" v="1:32.418" />
              <Stat k="BEST" v="1:31.902" c={LED_G} />
              <div style={{ height: 6 }} />
              <Tyres t={t} s={44} />
              <div style={{ height: 6 }} />
              <Fuel t={t} />
            </div>
            <div style={{ position: "absolute", right: 200, top: 74, bottom: 96, width: 2, background: "#1d2026" }} />
            <div style={{ position: "absolute", left: 296, top: 84 }}>
              <Label>SECTOR 2 · TURN 9</Label>
              <TrackMap t={t} w={disp.w - 296 - 226} h={200} />
            </div>
            <div style={{ position: "absolute", left: 296, right: 226, bottom: 108 }}>
              <Radio fs={21} t={t} />
            </div>
            <div style={{ position: "absolute", left: 14, bottom: 14 }}>
              <PTT t={t} w={disp.w - 28} h={66} />
            </div>
          </>
        )}
        {/* glass */}
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(160deg, rgba(255,255,255,.07), rgba(255,255,255,0) 30%)", pointerEvents: "none" }} />
      </div>

      {/* ---- controls on the wheel face */}
      {tall ? (
        <>
          <Button x={150} y={h - 160} d={46} color="#ff3b1f" label="PIT" />
          <Button x={260} y={h - 160} d={46} color="#ffd400" label="RADIO" />
          <Button x={w - 260} y={h - 160} d={46} color="#2f8bff" label="FLASH" />
          <Button x={w - 150} y={h - 160} d={46} color="#27c25a" label="OK" />
          <Rotary x={w / 2} y={h - 150} d={62} v={0.45} label="BRAKE BIAS" />
        </>
      ) : (
        <>
          <Button x={195} y={150} d={44} color="#ff3b1f" label="PIT" />
          <Button x={195} y={262} d={44} color="#ffd400" label="RADIO" />
          <Button x={w - 195} y={150} d={44} color="#2f8bff" label="FLASH" />
          <Button x={w - 195} y={262} d={44} color="#27c25a" label="OK" />
          <Rotary x={195} y={430} d={58} v={0.45} label="BIAS" />
          <Rotary x={w - 195} y={430} d={58} v={0.7} label="TC" />
          <div style={{ position: "absolute", left: w / 2 - 120, top: h - 92, width: 240, textAlign: "center", fontFamily: F.mona, fontWeight: 800, fontStretch: "125%", fontSize: 20, letterSpacing: 6, color: "#e9edf2", opacity: 0.85 }}>STELLA</div>
        </>
      )}
      {/* sprinkle of hash to keep carbon weave from looking tiled at the edges */}
      <div style={{ display: "none" }}>{hash(1)}</div>
    </div>
  );
};

const Stat: React.FC<{ k: string; v: string; c?: string }> = ({ k, v, c = "#fff" }) => (
  <div style={{ textAlign: "right" }}>
    <Label>{k}</Label>
    <div style={{ fontFamily: F.saira, fontWeight: 900, fontSize: 34, lineHeight: 1, color: c }}>{v}</div>
  </div>
);

const Fuel: React.FC<{ t: number }> = ({ t }) => {
  const f = 0.62 - t * 0.002;
  return (
    <div style={{ textAlign: "right" }}>
      <Label>FUEL · 8.4 LAPS</Label>
      <div style={{ width: 150, height: 14, background: "#14171b", marginTop: 4, marginLeft: "auto" }}>
        <div style={{ width: `${f * 100}%`, height: 14, background: "#e9edf2" }} />
      </div>
    </div>
  );
};
