import type { CSSProperties, ReactNode } from "react";
import type { Frame } from "@/store/slides";
import { ICONS, type IconName } from "./icons";

export function Icon({ name, size = 22, color = "currentColor", stroke = 2, fill = "none" }: {
  name: IconName; size?: number; color?: string; stroke?: number; fill?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", flexShrink: 0 }}
      dangerouslySetInnerHTML={{ __html: ICONS[name] }} />
  );
}

/** Screen sizes in points, matching the layouts the app actually uses on each device. */
export const FRAMES = {
  iphone: { w: 402, h: 874, bezel: 11, radius: 56, tablet: false, ios: true },
  android: { w: 412, h: 892, bezel: 10, radius: 34, tablet: false, ios: false },
  ipad: { w: 780, h: 1040, bezel: 26, radius: 24, tablet: true, ios: true },
  androidTablet: { w: 780, h: 1180, bezel: 24, radius: 22, tablet: true, ios: false },
} as const satisfies Record<Frame, { w: number; h: number; bezel: number; radius: number; tablet: boolean; ios: boolean }>;

export const frameSize = (frame: Frame) => {
  const { w, h, bezel } = FRAMES[frame];
  return { w: w + bezel * 2, h: h + bezel * 2 };
};

export function StatusBar({ frame, light = false, locked = false }: { frame: Frame; light?: boolean; locked?: boolean }) {
  const { tablet, ios } = FRAMES[frame];
  return (
    <div className={`status-bar ${tablet ? "is-tablet" : ios ? "is-iphone" : "is-android"}`} style={{ color: light ? "#fff" : "#0b0b0c" }}>
      <span className="status-time">{locked ? "" : "9:41"}</span>
      <span className="status-icons">
        {!tablet && (
          <svg width="19" height="13" viewBox="0 0 19 13" fill="currentColor"><rect x="0" y="8.4" width="3.3" height="4.4" rx="1"/><rect x="5.1" y="5.8" width="3.3" height="7" rx="1"/><rect x="10.2" y="3" width="3.3" height="9.8" rx="1"/><rect x="15.3" y="0" width="3.3" height="12.8" rx="1"/></svg>
        )}
        <svg width="18" height="13" viewBox="0 0 18 13" fill="currentColor"><path d="M9 2.6c2.5 0 4.8 1 6.5 2.6.1.1.3.1.5 0l1.2-1.3c.1-.1.1-.4 0-.5C15 1.2 12.100 0 9 0S3 1.200.8 3.400c-.1.1-.1.4 0 .5L2 5.200c.2.1.4.1.5 0C4.200 3.600 6.500 2.600 9 2.600Zm0 4.200c1.400 0 2.600.5 3.600 1.400.1.1.3.1.5 0l1.200-1.300c.1-.2.1-.4 0-.5A7.700 7.700 0 0 0 9 4.200c-2 0-3.900.8-5.300 2.200-.1.1-.1.3 0 .5l1.200 1.300c.2.1.4.1.5 0 1-.9 2.200-1.400 3.600-1.400Zm2.500 2.900c.1.1.1.3 0 .5l-2.200 2.300c-.2.100-.400.100-.600 0L6.500 10.200c-.1-.2-.1-.4 0-.5a3.900 3.900 0 0 1 5 0Z"/></svg>
        <svg width="28" height="13" viewBox="0 0 28 13"><rect x=".5" y=".5" width="23.500" height="12" rx="3.800" fill="none" stroke="currentColor" opacity=".38"/><rect x="2" y="2" width="20.500" height="9" rx="2.500" fill="currentColor"/><path d="M25.500 4.300v4.400c.9-.4 1.500-1.200 1.500-2.200s-.6-1.800-1.500-2.200Z" fill="currentColor" opacity=".45"/></svg>
      </span>
    </div>
  );
}

export function DeviceFrame({ frame, scale = 1, style, screen, over, light, locked, darkHome, className = "" }: {
  frame: Frame; scale?: number; style?: CSSProperties; screen: ReactNode;
  /** Layers that leave the screen and float in front of the hardware, in screen points. */
  over?: ReactNode; light?: boolean; locked?: boolean; darkHome?: boolean; className?: string;
}) {
  const spec = FRAMES[frame];
  const size = frameSize(frame);
  return (
    <div className={`device ${className}`} style={{ width: size.w * scale, height: size.h * scale, ...style }}>
      <div className="device-inner" style={{ width: size.w, height: size.h, transform: `scale(${scale})` }}>
        <div className="device-shadow" style={{ borderRadius: spec.radius + spec.bezel }} />
        <div className="device-body" style={{ borderRadius: spec.radius + spec.bezel }}>
          {!spec.tablet && <><i className="device-key key-left" /><i className="device-key key-left second" /><i className="device-key key-right" /></>}
        </div>
        <div className={`device-screen ${spec.tablet ? "tablet" : "phone"}`} style={{ inset: spec.bezel, borderRadius: spec.radius }}>
          {screen}
          <StatusBar frame={frame} light={light} locked={locked} />
          {!spec.tablet && (spec.ios ? <i className="island" /> : <i className="punch" />)}
          <i className="home-bar" style={{ background: light && !darkHome ? "#fff" : "#0b0b0c" }} />
        </div>
        {over && <div className="device-over" style={{ left: spec.bezel, top: spec.bezel, width: spec.w, height: spec.h }}>{over}</div>}
      </div>
    </div>
  );
}

export function Laptop({ scale = 1, style, children }: { scale?: number; style?: CSSProperties; children: ReactNode }) {
  return (
    <div className="laptop" style={{ width: 1240 * scale, height: 790 * scale, ...style }}>
      <div style={{ width: 1240, height: 790, position: "relative", transform: `scale(${scale})`, transformOrigin: "0 0" }}>
        <div className="laptop-lid"><div className="laptop-screen">{children}</div></div>
        <div className="laptop-base"><i /></div>
      </div>
    </div>
  );
}
