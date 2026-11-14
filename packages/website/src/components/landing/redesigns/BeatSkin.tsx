import React from "react";
import { StellaCharacter } from "../stella-character";
import { windowThemeStyle } from "../window-theme";
import type { SkinProps } from "./content";
import { F } from "./kit";

const ROWS: { name: string; base: string; add: string; color: string }[] = [
  { name: "Kick", base: "x...x...x...x...", add: "x...x...x..xx...", color: "#ff9f0a" },
  { name: "Snare", base: "....x.......x...", add: "....x.......x..x", color: "#ff375f" },
  { name: "Clap", base: "................", add: "....x.......x...", color: "#bf5af2" },
  { name: "Hat", base: "x.x.x.x.x.x.x.x.", add: "xxx.xxx.xxx.xxx.", color: "#64d2ff" },
  { name: "Open hat", base: "................", add: "..x...x...x...x.", color: "#5ac8fa" },
  { name: "Perc", base: "......x.......x.", add: ".x....x..x....x.", color: "#30d158" },
];
const BASS = [0, -1, -1, 0, -1, -1, 7, -1, 5, -1, -1, 5, -1, 3, -1, -1];
const NOTE_COUNT = 12;
const BLACK_KEYS = [2, 4, 6, 9, 11];
const BPM = 117;
const STEP_S = 60 / BPM / 4;

const seg = (t: number, a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));
const out = (x: number) => 1 - (1 - x) ** 3;

const DARK = windowThemeStyle({ id: "default", dark: true });

function Icon({ d, size = 15 }: { d: React.ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      {d}
    </svg>
  );
}

const CHAT_ICON = <path d="M5 18.5V7a2.5 2.5 0 0 1 2.5-2.5h9A2.5 2.5 0 0 1 19 7v6a2.5 2.5 0 0 1-2.5 2.5H9z" />;
const BEAT_ICON = (
  <>
    <rect x="4" y="4" width="6" height="6" rx="1.5" />
    <rect x="14" y="4" width="6" height="6" rx="1.5" />
    <rect x="4" y="14" width="6" height="6" rx="1.5" />
    <rect x="14" y="14" width="6" height="6" rx="1.5" />
  </>
);

/**
 * A beat maker Stella added to itself, as its own tab: it fills in its first
 * pattern as it arrives, then plays it at 117 BPM.
 */
export const BeatSkin: React.FC<SkinProps> = ({ t, w, h }) => {
  const tall = h > w;
  const more = seg(t, 0.15, 1.5);
  const step = Math.max(0, t - 0.4) / STEP_S;
  const playing = t > 0.4;
  const cur = Math.floor(step) % 16;
  const frac = step - Math.floor(step);
  const padL = tall ? 30 : 44;
  const labW = tall ? 104 : 128;
  const gridW = w - padL * 2 - labW;
  const cell = gridW / 16;
  const rowH = tall ? 74 : 56;
  const fs = tall ? 19 : 16;
  return (
    <div style={{ ...DARK, position: "absolute", inset: 0, display: "flex", flexDirection: "column", background: "var(--w-bg)", color: "var(--w-fg)", fontFamily: F.mona }}>
      <div style={{ position: "relative", display: "flex", alignItems: "center", height: tall ? 64 : 54, padding: "0 18px", flex: "none", borderBottom: "1px solid var(--w-line)" }}>
        <span style={{ display: "inline-flex", gap: 8 }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <i key={c} style={{ width: 13, height: 13, borderRadius: "50%", background: c }} />
          ))}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 24 }}>
          {[
            { label: "Chat", icon: CHAT_ICON, on: false },
            { label: "Beat Maker", icon: BEAT_ICON, on: true },
          ].map((tab) => (
            <span
              key={tab.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                height: tall ? 40 : 36,
                padding: "0 14px",
                borderRadius: 10,
                background: tab.on ? "rgba(255,255,255,0.08)" : undefined,
                color: tab.on ? "var(--w-fg)" : "var(--w-sub-strong)",
                fontSize: tall ? 18 : 15.5,
                fontWeight: tab.on ? 600 : 500,
                whiteSpace: "nowrap",
              }}
            >
              <Icon d={tab.icon} size={tall ? 18 : 16} />
              {tab.label}
            </span>
          ))}
        </span>
        {tall ? null : (
          <span style={{ position: "absolute", left: "50%", top: 0, height: "100%", display: "inline-flex", alignItems: "center", transform: "translateX(-50%)" }}>
            <StellaCharacter size={24} />
          </span>
        )}
        <span style={{ marginLeft: "auto", fontSize: tall ? 17 : 15, color: "var(--w-fg)" }}>Account</span>
      </div>

      <div style={{ position: "relative", flex: 1, minHeight: 0, padding: `${tall ? 34 : 28}px ${padL}px ${tall ? 40 : 30}px`, display: "flex", flexDirection: "column", gap: tall ? 30 : 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: tall ? 16 : 20, fontSize: fs }}>
          <span style={{ display: "grid", placeItems: "center", width: tall ? 52 : 44, height: tall ? 52 : 44, borderRadius: "50%", background: playing ? "#ff9f0a" : "var(--w-fg)", color: "#111" }}>
            {playing ? <Icon d={<path d="M9 7v10M15 7v10" />} size={tall ? 22 : 18} /> : <Icon d={<path d="M8 6l11 6-11 6z" fill="#111" />} size={tall ? 22 : 18} />}
          </span>
          <span style={{ fontWeight: 720, fontSize: tall ? 30 : 25, letterSpacing: "-0.03em" }}>Pattern A</span>
          <span style={{ fontFamily: F.mono, fontSize: fs * 0.88, color: "var(--w-sub-strong)" }}>{BPM} BPM</span>
          {tall ? null : <span style={{ color: "var(--w-sub)" }}>Swing {Math.round(8 + 14 * more)}%</span>}
          <span style={{ flex: 1 }} />
          {(tall ? ["A", "B"] : ["A", "B", "C", "D"]).map((p, i) => (
            <span key={p} style={{ display: "grid", placeItems: "center", width: tall ? 44 : 36, height: tall ? 44 : 36, borderRadius: 9, fontWeight: 600, background: i === 0 ? "rgba(255,255,255,0.1)" : undefined, color: i === 0 ? "var(--w-fg)" : "var(--w-sub)" }}>
              {p}
            </span>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: tall ? 8 : 6 }}>
          {ROWS.map((r, ri) => (
            <div key={r.name} style={{ display: "flex", alignItems: "center", height: rowH }}>
              <span style={{ width: labW, flex: "none", fontSize: fs, fontWeight: 600, color: "var(--w-sub-strong)", display: "flex", alignItems: "center", gap: 10 }}>
                <i style={{ width: 9, height: 9, borderRadius: "50%", background: r.color }} />
                {r.name}
              </span>
              <div style={{ display: "flex" }}>
                {r.base.split("").map((c, i) => {
                  const on = c === "x";
                  const add = r.add[i] === "x";
                  const at = (i / 16) * 0.55 + ri * 0.05;
                  const k = add && !on ? out(seg(more, at, at + 0.25)) : on && !add ? 1 - more : on ? 1 : 0;
                  const head = playing && i === cur;
                  const flash = head && k > 0.5 ? 1 - frac : 0;
                  return (
                    <div key={i} style={{ width: cell, height: rowH, paddingRight: i % 4 === 3 ? 10 : 4 }}>
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          borderRadius: 8,
                          background: k > 0.01 ? r.color : head ? "rgba(255,255,255,0.16)" : i % 8 < 4 ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.035)",
                          opacity: k > 0.01 ? 0.35 + 0.65 * k : 1,
                          transform: `scale(${0.86 + 0.14 * k + flash * 0.06})`,
                          filter: flash > 0 ? `brightness(${1 + flash * 0.7})` : undefined,
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          <div style={{ width: labW, flex: "none", display: "flex", flexDirection: "column", justifyContent: "space-between", paddingTop: 4 }}>
            <span style={{ fontSize: fs, fontWeight: 600, color: "var(--w-sub-strong)", display: "flex", alignItems: "center", gap: 10 }}>
              <i style={{ width: 9, height: 9, borderRadius: "50%", background: "#ffd60a" }} />
              Bass
            </span>
            <span style={{ fontFamily: F.mono, fontSize: fs * 0.72, color: "var(--w-sub)" }}>C1–C2</span>
          </div>
          <div style={{ position: "relative", width: gridW - 10, borderRadius: 12, background: "rgba(255,255,255,0.03)", boxShadow: "inset 0 0 0 1px var(--w-line)", overflow: "hidden" }}>
            {BLACK_KEYS.map((i) => (
              <div key={i} style={{ position: "absolute", left: 0, right: 0, top: `${(i / NOTE_COUNT) * 100}%`, height: `${100 / NOTE_COUNT}%`, background: "rgba(0,0,0,0.2)" }} />
            ))}
            {[4, 8, 12].map((i) => (
              <div key={i} style={{ position: "absolute", top: 0, bottom: 0, left: `${(i / 16) * 100}%`, borderLeft: "1px solid rgba(255,255,255,0.08)" }} />
            ))}
            {BASS.map((n, i) => {
              if (n < 0) return null;
              const len = i === 0 || i === 6 ? 2 : i === 8 ? 2.5 : 1.5;
              const k = out(seg(more, 0.3 + (i / 16) * 0.5, 0.5 + (i / 16) * 0.5));
              if (k <= 0) return null;
              const hit = playing && cur >= i && cur < i + len;
              return (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: `calc(${(i / 16) * 100}% + 2px)`,
                    top: `calc(${(n / NOTE_COUNT) * 100}% + 2px)`,
                    width: `calc(${(len / 16) * 100 * k}% - 4px)`,
                    height: `calc(${100 / NOTE_COUNT}% - 4px)`,
                    borderRadius: 5,
                    background: "#ffd60a",
                    opacity: 0.9,
                    filter: hit ? "brightness(1.35)" : undefined,
                  }}
                />
              );
            })}
            {playing ? <div style={{ position: "absolute", top: 0, bottom: 0, left: `${((step % 16) / 16) * 100}%`, width: 2, background: "rgba(255,255,255,0.75)" }} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
};
