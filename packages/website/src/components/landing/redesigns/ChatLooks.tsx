import React, { memo, type CSSProperties, type ReactNode } from "react";
import { StellaCharacter } from "../stella-character";
import { windowThemeStyle } from "../window-theme";
import { CHAT, type SkinProps } from "./content";
import { F } from "./kit";

export type Tweaks = { accent?: boolean; paper?: boolean; serif?: boolean; letter?: boolean };

const TANGERINE = "#e19b6e";
const SERIF = "var(--l-serif), Georgia, serif";

const DARK = windowThemeStyle({ id: "default", dark: true }) as Record<string, string>;
const LIGHT = windowThemeStyle({ id: "default", dark: false }) as Record<string, string>;
const PAPER: Record<string, string> = {
  "--w-bg": "#f5efe4",
  "--w-fg": "#2b2117",
  "--w-sub": "#9a8b76",
  "--w-sub-strong": "#5d4f3e",
  "--w-her-top": "#ebe2d2",
  "--w-her-bot": "#e6dccb",
  "--w-composer-top": "#fbf7f0",
  "--w-composer-bot": "#f7f1e6",
  "--w-line": "rgba(70,48,20,0.14)",
  "--w-highlight": "rgba(255,255,255,0.8)",
  "--w-plus": "rgba(70,48,20,0.07)",
  "--w-edge": "rgba(70,48,20,0.12)",
};

function vars(tw: Tweaks): CSSProperties {
  const v: Record<string, string> = tw.paper ? { ...LIGHT, ...PAPER } : { ...DARK };
  if (tw.accent) {
    v["--w-send"] = TANGERINE;
    v["--w-me"] = TANGERINE;
    v["--w-me-fg"] = "#1c130d";
  }
  return v as CSSProperties;
}

function Icon({ d, size, color = "currentColor", sw = 1.8 }: { d: ReactNode; size: number; color?: string; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {d}
    </svg>
  );
}

export const PIN_ICON = <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v6" />;

function Lights({ s }: { s: number }) {
  return (
    <span style={{ display: "inline-flex", gap: s * 0.62 }}>
      {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
        <i key={c} style={{ width: s, height: s, borderRadius: "50%", background: c }} />
      ))}
    </span>
  );
}

export function ChatWindow({
  w,
  h,
  tweaks = {},
  barRight,
  scale = 1,
  chat = true,
  account = true,
  children,
  style,
}: {
  w: number;
  h: number;
  tweaks?: Tweaks;
  barRight?: ReactNode;
  scale?: number;
  chat?: boolean;
  account?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  const tall = h > w * 1.2;
  const u = scale;
  const fs = 20 * u;
  const barH = 52 * u;
  const colW = tall ? w - 70 * u : Math.min(760 * u, w - 60 * u);
  const serif = tweaks.serif || tweaks.letter;
  const bubble = (me: boolean, text: string) => {
    if (tweaks.letter) {
      return (
        <p
          style={{
            margin: 0,
            alignSelf: me ? "flex-end" : "flex-start",
            maxWidth: me ? "74%" : "94%",
            color: me ? "var(--w-sub-strong)" : "var(--w-fg)",
            fontFamily: SERIF,
            fontStyle: me ? "italic" : "normal",
            fontSize: me ? fs * 1.02 : fs * 1.2,
            lineHeight: 1.5,
            textAlign: me ? "right" : "left",
          }}
        >
          {text}
        </p>
      );
    }
    return (
      <p
        style={{
          margin: 0,
          alignSelf: me ? "flex-end" : "flex-start",
          maxWidth: "80%",
          padding: me ? `${6 * u}px ${14 * u}px` : `${9 * u}px ${15 * u}px`,
          borderRadius: 20 * u,
          background: me ? "var(--w-me)" : "linear-gradient(to bottom, var(--w-her-top), var(--w-her-bot))",
          color: me ? "var(--w-me-fg)" : "var(--w-fg)",
          fontFamily: serif ? SERIF : undefined,
          fontSize: serif ? fs * 1.06 : fs,
          lineHeight: 1.42,
        }}
      >
        {text}
      </p>
    );
  };
  return (
    <div
      style={{
        ...vars(tweaks),
        position: "absolute",
        width: w,
        height: h,
        overflow: "hidden",
        borderRadius: 14 * u,
        background: "var(--w-bg)",
        color: "var(--w-fg)",
        fontFamily: F.manrope,
        fontSize: fs,
        ...style,
      }}
    >
      <div style={{ position: "relative", display: "flex", alignItems: "center", height: barH, padding: `0 ${16 * u}px` }}>
        <Lights s={12 * u} />
        <span style={{ position: "absolute", left: "50%", top: 0, height: "100%", display: "inline-flex", alignItems: "center", transform: "translateX(-50%)" }}>
          <StellaCharacter size={Math.round(24 * u)} />
        </span>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 14 * u, fontSize: 15 * u, color: "var(--w-fg)" }}>
          {barRight}
          {account ? <span>Account</span> : null}
        </span>
      </div>
      {chat ? (
        <div
          style={{
            position: "absolute",
            left: (w - colW) / 2,
            width: colW,
            bottom: 22 * u,
            display: "flex",
            flexDirection: "column",
            gap: (tweaks.letter ? 18 : 11) * u,
          }}
        >
          <p style={{ margin: `0 0 ${4 * u}px`, alignSelf: "center", fontSize: fs * 0.7, color: "var(--w-sub)", fontFamily: serif ? SERIF : undefined }}>{CHAT.stamp}</p>
          {bubble(true, CHAT.me1)}
          {bubble(false, CHAT.her1)}
          {bubble(true, CHAT.me2)}
          {bubble(false, CHAT.her2)}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10 * u,
              height: 54 * u,
              marginTop: 10 * u,
              padding: `0 ${8 * u}px`,
              borderRadius: tweaks.letter ? 14 * u : 30 * u,
              border: "1px solid var(--w-line)",
              background: "linear-gradient(to bottom, var(--w-composer-top), var(--w-composer-bot))",
              boxShadow: "inset 0 1px 0 var(--w-highlight)",
            }}
          >
            <span style={{ display: "grid", placeItems: "center", width: 38 * u, height: 38 * u, borderRadius: "50%", background: "var(--w-plus)", color: "var(--w-sub-strong)" }}>
              <Icon d={<path d="M12 5v14M5 12h14" />} size={17 * u} />
            </span>
            <span style={{ flex: 1, color: "var(--w-sub)", fontFamily: serif ? SERIF : undefined }}>{CHAT.placeholder}</span>
            <span style={{ color: "var(--w-sub-strong)", display: "grid", placeItems: "center" }}>
              <Icon d={<path d="M9 3h6v11H9zM5 11a7 7 0 0 0 14 0M12 18v3" />} size={17 * u} />
            </span>
            <span style={{ display: "grid", placeItems: "center", width: 38 * u, height: 38 * u, borderRadius: "50%", background: "var(--w-send)", color: tweaks.accent ? "#1c130d" : "#fff" }}>
              <Icon d={<path d="M12 19V5M6 11l6-6 6 6" />} size={17 * u} sw={2.2} />
            </span>
          </div>
        </div>
      ) : null}
      {children}
    </div>
  );
}

export const designScale = (w: number, h: number) => (h > w ? 1.42 : 1.22);

const sameSize = (a: SkinProps, b: SkinProps) => a.w === b.w && a.h === b.h;

function tweakSkin(tweaks: Tweaks) {
  return memo(function TweakSkin({ w, h }: SkinProps) {
    return <ChatWindow w={w} h={h} tweaks={tweaks} scale={designScale(w, h)} />;
  }, sameSize);
}

export const PlainSkin = tweakSkin({});
export const TangerineSkin = tweakSkin({ accent: true });
export const PaperSkin = tweakSkin({ accent: true, paper: true });
export const SerifSkin = tweakSkin({ accent: true, paper: true, serif: true });
export const LetterSkin = tweakSkin({ accent: true, paper: true, letter: true });
