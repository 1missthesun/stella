import React from "react";
import { CHAT, type SkinProps } from "./content";
import { F, STAR } from "./kit";

/**
 * A glider pilot's glass cockpit (recreating the look a real Stella made for one).
 * Near-black, high contrast, set in B612. Cyan marks what you typed, magenta the active
 * item, green done, amber caution; corners are square. The top bar carries an LCL
 * local-time readout; a heading tape runs under it and a variometer strip runs down the
 * left edge. Replies carry a cyan rule; the TODAY panel lists the reminder in magenta.
 */

const BG = "#05080b";
const PANEL = "#0a0f13";
const LINE = "#1c2731";
const TXT = "#e8eef2";
const DIM = "#8592a0";
const CYAN = "#3cc8ef";
const MAG = "#f052d6";
const GREEN = "#3ddc84";
const AMBER = "#ffb020";

const Clock: React.FC<{ c: string; s?: number }> = ({ c, s = 16 }) => (
  <svg width={s} height={s} viewBox="0 0 16 16">
    <circle cx={8} cy={8} r={6.4} stroke={c} strokeWidth={1.6} fill="none" />
    <path d="M8 4.4 V8 L10.4 9.6" stroke={c} strokeWidth={1.6} fill="none" strokeLinecap="square" />
  </svg>
);

/** Heading tape: ticks every 5 degrees, cardinal labels, the lubber line in magenta. */
const HeadingTape: React.FC<{ w: number; t: number }> = ({ w, t }) => {
  const hdg = 38 + Math.sin(t * 0.5) * 3 + t * 1.5;
  const pxPerDeg = 7;
  const ticks: React.ReactNode[] = [];
  const span = Math.ceil(w / 2 / pxPerDeg) + 10;
  for (let d = Math.floor(hdg - span); d <= hdg + span; d++) {
    if (d % 5) continue;
    const x = w / 2 + (d - hdg) * pxPerDeg;
    const n = ((d % 360) + 360) % 360;
    const major = n % 30 === 0;
    ticks.push(<line key={d} x1={x} y1={0} x2={x} y2={major ? 8 : 4} stroke={major ? "#9aa7b3" : "#4a5866"} strokeWidth={1} />);
    if (major) {
      const lab = n === 0 ? "N" : n === 90 ? "E" : n === 180 ? "S" : n === 270 ? "W" : String(n / 10).padStart(2, "0");
      ticks.push(
        <text key={`l${d}`} x={x} y={19} textAnchor="middle" fontSize={11} fill={/[NESW]/.test(lab) ? TXT : DIM} style={{ fontFamily: F.b612mono }}>
          {lab}
        </text>,
      );
    }
  }
  return (
    <svg width={w} height={24} style={{ display: "block" }}>
      {ticks}
      <path d={`M ${w / 2 - 6} 0 L ${w / 2 + 6} 0 L ${w / 2} 8 Z`} fill={MAG} />
    </svg>
  );
};

/** Variometer strip: -5..+5 m/s, the climb as a green bar from zero, a pointer, the number. */
const Vario: React.FC<{ h: number; t: number }> = ({ h, t }) => {
  const v = 1.6 + Math.sin(t * 1.3) * 0.5 + Math.sin(t * 3.1) * 0.15;
  const top = 40,
    bot = h - 30;
  const y0 = (top + bot) / 2;
  const k = (bot - top) / 10;
  const yv = y0 - v * k;
  return (
    <svg width={44} height={h} style={{ display: "block" }}>
      <text x={22} y={18} textAnchor="middle" fontSize={13} fontWeight={700} fill={GREEN} style={{ fontFamily: F.b612 }}>
        {v >= 0 ? "+" : ""}
        {v.toFixed(1)}
      </text>
      <text x={22} y={32} textAnchor="middle" fontSize={8} letterSpacing={1} fill={DIM} style={{ fontFamily: F.b612 }}>
        M/S
      </text>
      {Array.from({ length: 11 }, (_, i) => {
        const val = 5 - i;
        const y = top + i * k;
        return (
          <g key={i}>
            <line x1={30} y1={y} x2={val === 0 ? 44 : 40} y2={y} stroke={val === 0 ? TXT : "#4a5866"} strokeWidth={1} />
            {Math.abs(val) % 2 === 1 ? null : (
              <text x={24} y={y + 4} textAnchor="end" fontSize={10} fill={DIM} style={{ fontFamily: F.b612mono }}>
                {Math.abs(val)}
              </text>
            )}
          </g>
        );
      })}
      {/* sink band in amber at the bottom of the scale */}
      <rect x={41} y={y0 + 3 * k} width={3} height={2 * k} fill={AMBER} opacity={0.8} />
      <rect x={41} y={Math.min(y0, yv)} width={3} height={Math.abs(y0 - yv)} fill={GREEN} />
      <path d={`M 30 ${yv} L 22 ${yv - 5} L 22 ${yv + 5} Z`} fill={GREEN} />
    </svg>
  );
};

/** Attitude indicator: horizon, pitch ladder, roll scale; glider readouts in the corners. */
const Attitude: React.FC<{ t: number }> = ({ t }) => {
  const roll = 9 + Math.sin(t * 0.45) * 6;
  const pitch = 2 + Math.sin(t * 0.7 + 1) * 1.5;
  const k = 9;
  const R = 118;
  const ladder: React.ReactNode[] = [];
  for (let p = -25; p <= 25; p += 5) {
    if (!p) continue;
    const y = -p * k;
    const hw = p % 10 ? 18 : 40;
    ladder.push(<line key={p} x1={-hw} y1={y} x2={hw} y2={y} stroke={TXT} strokeWidth={1.4} opacity={0.85} />);
    if (!(p % 10))
      for (const sx of [-1, 1])
        ladder.push(
          <text key={`${p}${sx}`} x={sx * (hw + 14)} y={y + 4} textAnchor="middle" fontSize={11} fill={TXT} style={{ fontFamily: F.b612 }}>
            {Math.abs(p)}
          </text>,
        );
  }
  const rollTicks = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60].map((a) => {
    const big = a % 30 === 0;
    const r2 = R + (big ? 14 : 8);
    const s = Math.sin((a * Math.PI) / 180),
      c = Math.cos((a * Math.PI) / 180);
    return <line key={a} x1={s * R} y1={-c * R} x2={s * r2} y2={-c * r2} stroke={TXT} strokeWidth={1.4} />;
  });
  const alt = Math.round(1240 + t * 2.1);
  const ias = Math.round(92 + Math.sin(t * 0.9) * 3);
  const read = (lab: string, val: string, unit: string, pos: React.CSSProperties, col = TXT) => (
    <div style={{ position: "absolute", ...pos, background: "rgba(5,8,11,.82)", border: `1px solid ${LINE}`, padding: "6px 10px", fontFamily: F.b612 }}>
      <div style={{ fontSize: 10, letterSpacing: 2, color: DIM }}>{lab}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: col, lineHeight: 1.15 }}>
        {val}
        <span style={{ fontSize: 11, fontWeight: 400, color: DIM, marginLeft: 4 }}>{unit}</span>
      </div>
    </div>
  );
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", border: `1px solid ${LINE}`, overflow: "hidden" }}>
      <svg width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
        <svg x="50%" y="50%" overflow="visible">
          <defs>
            <clipPath id="ck-ladder">
              <rect x={-80} y={-86} width={160} height={150} />
            </clipPath>
          </defs>
          <g transform={`rotate(${-roll}) translate(0 ${pitch * k})`}>
            <rect x={-2000} y={-2000} width={4000} height={2000} fill="#0a1f2e" />
            <rect x={-2000} y={0} width={4000} height={2000} fill="#1a1209" />
            <line x1={-2000} y1={0} x2={2000} y2={0} stroke={TXT} strokeWidth={1.6} />
          </g>
          <g clipPath="url(#ck-ladder)">
            <g transform={`rotate(${-roll}) translate(0 ${pitch * k})`}>{ladder}</g>
          </g>
          <path d={`M ${-Math.sin(Math.PI / 3) * R} ${-Math.cos(Math.PI / 3) * R} A ${R} ${R} 0 0 1 ${Math.sin(Math.PI / 3) * R} ${-Math.cos(Math.PI / 3) * R}`} stroke={TXT} strokeWidth={1.2} fill="none" opacity={0.7} />
          {rollTicks}
          <path d={`M 0 ${-R - 1} L -8 ${-R - 14} L 8 ${-R - 14} Z`} fill={TXT} />
          <g transform={`rotate(${-roll})`}>
            <path d={`M 0 ${-R + 2} L -8 ${-R + 15} L 8 ${-R + 15} Z`} fill={MAG} />
          </g>
          {/* aircraft symbol: a glider's long wings */}
          <path d="M -120 0 H -34 L -22 10 M 120 0 H 34 L 22 10" stroke="#000" strokeWidth={7} fill="none" />
          <path d="M -120 0 H -34 L -22 10 M 120 0 H 34 L 22 10" stroke={TXT} strokeWidth={4} fill="none" />
          <rect x={-4} y={-4} width={8} height={8} fill={TXT} stroke="#000" strokeWidth={2} />
        </svg>
      </svg>
      {read("IAS", String(ias), "KM/H", { left: 10, top: 10 })}
      {read("ALT", alt.toLocaleString("en-US"), "M", { right: 10, top: 10 })}
      {read("WIND", "270/12", "KT", { left: 10, bottom: 10 })}
      {read("THERMAL", "+2.1", "M/S", { right: 10, bottom: 10 }, GREEN)}
    </div>
  );
};

const TodayPanel: React.FC<{ w: number }> = ({ w }) => (
  <div style={{ width: w, background: PANEL, border: `1px solid ${LINE}`, fontFamily: F.b612 }}>
    <div style={{ display: "flex", alignItems: "baseline", gap: 18, padding: "14px 18px 12px", borderBottom: `1px solid ${LINE}` }}>
      <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: 3, color: CYAN }}>TODAY</span>
      <span style={{ fontSize: 13, letterSpacing: 1.5, color: DIM }}>{CHAT.stamp.replace("Today ", "LCL ")}</span>
    </div>
    <div style={{ padding: "8px 10px 10px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 10px", background: "rgba(240,82,214,.08)", borderLeft: `3px solid ${MAG}` }}>
        <Clock c={MAG} />
        <span style={{ flex: 1, fontSize: 15, color: TXT }}>Pick up the bike</span>
        <span style={{ fontSize: 15, fontWeight: 700, color: MAG }}>FRI 09:00</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 10px 6px 13px" }}>
        <svg width={16} height={16} viewBox="0 0 16 16">
          <rect x={1.5} y={1.5} width={13} height={13} stroke={GREEN} strokeWidth={1.4} fill="none" />
          <path d="M4.5 8.2 L7 10.6 L11.6 5.4" stroke={GREEN} strokeWidth={1.8} fill="none" />
        </svg>
        <span style={{ flex: 1, fontSize: 15, color: DIM }}>Receipt to taxes, row 41</span>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.5, color: GREEN }}>DONE</span>
      </div>
    </div>
  </div>
);

export const CockpitSkin: React.FC<SkinProps> = ({ t, w, h }) => {
  const tall = h > w;
  const barH = 56;
  const tapeH = 26;
  const fs = tall ? 24 : 24;
  const sideW = 380;
  const colX = tall ? 70 : 96;
  const colW = tall ? w - colX - 26 : w - 30 - sideW - 44 - colX;
  const caret = Math.floor(t * 2.4) % 2 === 0;

  const me = (text: string) => (
    <div style={{ alignSelf: "flex-end", maxWidth: colW * (tall ? 0.86 : 0.96), background: "#0b161c", border: `1px solid #2a8fb0`, padding: `${fs * 0.55}px ${fs * 0.9}px`, fontSize: fs, lineHeight: 1.45, color: TXT }}>{text}</div>
  );
  const her = (text: string) => (
    <div style={{ alignSelf: "flex-start", maxWidth: colW * 0.9, background: PANEL, border: `1px solid ${LINE}`, padding: `${fs * 0.7}px ${fs * 1.2}px ${fs * 0.7}px ${fs * 1.3}px`, position: "relative", fontSize: fs, lineHeight: 1.45, color: TXT }}>
      <div style={{ position: "absolute", left: 0, top: 14, bottom: 14, width: 3, background: CYAN }} />
      {text}
    </div>
  );
  const card = (icon: React.ReactNode, title: string, sub: string) => (
    <div style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 16, background: PANEL, border: `1px solid ${LINE}`, padding: "12px 22px 12px 14px" }}>
      <div style={{ width: 42, height: 42, border: `1px solid ${LINE}`, display: "flex", alignItems: "center", justifyContent: "center" }}>{icon}</div>
      <div>
        <div style={{ fontSize: fs, color: TXT }}>{title}</div>
        <div style={{ fontSize: fs * 0.82, color: DIM, marginTop: 3 }}>{sub}</div>
      </div>
    </div>
  );

  const chat = (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ alignSelf: "center", fontSize: 13, letterSpacing: 2, color: DIM, marginBottom: 4 }}>{CHAT.stamp.toUpperCase()}</div>
      {me(CHAT.me1)}
      {her(CHAT.her1)}
      {card(
        <svg width={18} height={18} viewBox="0 0 16 16">
          <path d="M3.5 8.2 L6.6 11.2 L12.6 4.8" stroke={GREEN} strokeWidth={2} fill="none" />
        </svg>,
        "Added to Taxes 2025",
        "Row 41 · $186 · Spoke & Wheel",
      )}
      {me(CHAT.me2)}
      {her(CHAT.her2)}
      {card(<Clock c={CYAN} s={18} />, "Pick up the bike", "Reminder set · Fri at 09:00")}
    </div>
  );

  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, overflow: "hidden", background: BG, fontFamily: F.b612 }}>
      {/* top bar */}
      <div style={{ position: "absolute", left: 0, top: 0, width: w, height: barH, borderBottom: `1px solid ${LINE}`, display: "flex", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 8, marginLeft: 20 }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <div key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />
          ))}
        </div>
        {tall ? null : (
          <div style={{ display: "flex", alignItems: "center", gap: 18, marginLeft: 30 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", background: "#121a21", fontSize: 15, color: TXT }}>
              <svg width={16} height={16} viewBox="0 0 16 16">
                <path d="M2 3 H14 V11 H6 L3 14 V11 H2 Z" stroke={TXT} strokeWidth={1.3} fill="none" />
              </svg>
              Chat
            </div>
            <span style={{ fontSize: 22, color: DIM, fontWeight: 400 }}>+</span>
          </div>
        )}
        <div style={{ position: "absolute", left: w / 2 - 14, top: barH / 2 - 14 }}>
          <svg width={28} height={28} viewBox={`0 0 ${STAR.C * 2} ${STAR.C * 2}`}>
            <path d={STAR.path} fill="#7d6cf0" />
            <rect x={STAR.C - 28} y={STAR.C - 22} width={16} height={34} rx={8} fill={BG} />
            <rect x={STAR.C + 12} y={STAR.C - 22} width={16} height={34} rx={8} fill={BG} />
          </svg>
        </div>
        <div style={{ position: "absolute", right: 20, top: 0, height: barH, display: "flex", alignItems: "center", gap: 18, fontSize: 15, color: TXT }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "6px 12px", border: `1px solid #2a3846` }}>
            <span style={{ fontSize: 11, letterSpacing: 2.5, color: CYAN }}>LCL</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: TXT }}>16:10</span>
          </div>
          {tall ? null : (
            <svg width={18} height={18} viewBox="0 0 18 18">
              <path d="M9 2.5 C5.8 2.5 4.5 5 4.5 7.5 V11 L3 13 H15 L13.5 11 V7.5 C13.5 5 12.2 2.5 9 2.5 Z M7.3 14.8 Q9 16.6 10.7 14.8" stroke={TXT} strokeWidth={1.3} fill="none" />
            </svg>
          )}
          <span>Account</span>
        </div>
      </div>
      {/* heading tape */}
      <div style={{ position: "absolute", left: 44, top: barH + 1, width: w - 44, height: tapeH, borderBottom: `1px solid ${LINE}` }}>
        <HeadingTape w={w - 44} t={t} />
      </div>
      {/* variometer along the left edge */}
      <div style={{ position: "absolute", left: 0, top: barH + 1, width: 44, height: h - barH - 1, borderRight: `1px solid ${LINE}` }}>
        <Vario h={h - barH - 1} t={t} />
      </div>

      {tall ? (
        <div style={{ position: "absolute", left: colX, width: colW, top: barH + tapeH + 26, bottom: 116, display: "flex", flexDirection: "column", gap: 20 }}>
          <TodayPanel w={colW} />
          <div style={{ flex: 1, minHeight: 0 }}>
            <Attitude t={t} />
          </div>
          {chat}
        </div>
      ) : (
        <>
          <div style={{ position: "absolute", right: 30, width: sideW, top: barH + tapeH + 26, bottom: 24, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 18 }}>
            <div style={{ height: 380 }}>
              <Attitude t={t} />
            </div>
            <TodayPanel w={sideW} />
          </div>
          <div style={{ position: "absolute", left: colX, width: colW, bottom: 116 }}>{chat}</div>
        </>
      )}

      {/* composer */}
      <div style={{ position: "absolute", left: colX, width: colW, bottom: 24, height: 70, border: `1px solid #2a8fb0`, background: "#070c10", display: "flex", alignItems: "center", gap: 16, padding: "0 12px" }}>
        <div style={{ width: 44, height: 44, border: `1px solid ${LINE}`, display: "flex", alignItems: "center", justifyContent: "center", color: CYAN, fontSize: 24 }}>+</div>
        <div style={{ flex: 1, fontSize: fs + 1, color: "#6f7c88" }}>
          <span style={{ display: "inline-block", width: 2, height: fs + 2, marginRight: 2, background: caret ? CYAN : "transparent", transform: "translateY(4px)" }} />
          {CHAT.placeholder}
        </div>
        <svg width={16} height={22} viewBox="0 0 14 20">
          <rect x={4} y={1} width={6} height={11} rx={3} fill="none" stroke={TXT} strokeWidth={1.5} />
          <path d="M1.5 9 Q1.5 15 7 15 Q12.5 15 12.5 9 M7 15 V19" stroke={TXT} strokeWidth={1.5} fill="none" />
        </svg>
        <div style={{ width: 44, height: 44, border: `1px solid ${LINE}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width={16} height={16}>
            <path d="M8 14 V2 M3 7 L8 2 L13 7" stroke={DIM} strokeWidth={1.6} fill="none" />
          </svg>
        </div>
      </div>
    </div>
  );
};
