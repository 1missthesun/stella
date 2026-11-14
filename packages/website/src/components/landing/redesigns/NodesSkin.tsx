import React from "react";
import { CHAT, type SkinProps } from "./content";
import { F, STAR } from "./kit";

/**
 * A 3D/VFX artist's Stella: the conversation is a node graph. Each message is a node
 * (yours are Prompt nodes, Stella's are Result nodes that expose what she found as typed
 * outputs), wired in order with noodles; data visibly flows along them. The session is a
 * Frame labelled with the timestamp, and the composer is a new node being wired in.
 */

const UI = F.manrope;
const MONO = F.mono;
const BG = "#1b1d22";
const NODE = "#2b2e35";
const FIELD = "#1d1f24";
const TXT = "#e6e8ec";
const SUB = "#9097a3";
const H_ME = "#2f5f8f";
const H_HER = "#6b4bb8";
const H_NEW = "#3d7a5a";
const W_TEXT = "#f0c454";
const W_DATA = "#5fd0b0";
const W_TIME = "#e48a5c";

type Row = { label: string; value?: string; color: string; side: "in" | "out" };
type NodeSpec = { x: number; y: number; w: number; title: string; kind: "me" | "her"; text: string; rows: Row[]; selected?: boolean; vert?: boolean };

const ROW_H = 30;
const HEAD_H = 36;

function nodeLayout(n: NodeSpec, fs: number) {
  // text field height from an estimate of wrapped lines
  const cpl = Math.max(10, Math.floor((n.w - 36) / (fs * 0.55)));
  const words = n.text.split(" ");
  let lines = 1,
    cur = 0;
  for (const wd of words) {
    if (cur + wd.length + (cur ? 1 : 0) > cpl) {
      lines++;
      cur = wd.length;
    } else cur += wd.length + (cur ? 1 : 0);
  }
  const fieldH = lines * fs * 1.36 + 18;
  const outs = n.rows.filter((r) => r.side === "out");
  const ins = n.rows.filter((r) => r.side === "in");
  const h = HEAD_H + 8 + outs.length * ROW_H + ins.length * ROW_H + fieldH + 14;
  const sock = (r: Row) => {
    const iOut = outs.indexOf(r);
    const iIn = ins.indexOf(r);
    if (n.vert) {
      // top-to-bottom flow: inputs on the top edge, outputs along the bottom edge
      if (r.side === "in") return { x: n.x + n.w * 0.5, y: n.y };
      return { x: n.x + n.w * (0.5 + iOut * 0.17), y: n.y + h };
    }
    const y = n.y + HEAD_H + 8 + (iOut >= 0 ? iOut : outs.length + iIn) * ROW_H + ROW_H / 2;
    return { x: r.side === "out" ? n.x + n.w : n.x, y };
  };
  return { h, fieldH, outs, ins, sock };
}

const Socket: React.FC<{ x: number; y: number; color: string; filled?: boolean }> = ({ x, y, color, filled = true }) => (
  <div style={{ position: "absolute", left: x - 7, top: y - 7, width: 14, height: 14, borderRadius: 7, background: filled ? color : NODE, boxShadow: `0 0 0 2px #121318, inset 0 0 0 ${filled ? 0 : 2}px ${color}` }} />
);

const Node: React.FC<{ n: NodeSpec; fs: number }> = ({ n, fs }) => {
  const L = nodeLayout(n, fs);
  const head = n.kind === "me" ? H_ME : H_HER;
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: n.x,
          top: n.y,
          width: n.w,
          height: L.h,
          borderRadius: 9,
          background: NODE,
          boxShadow: n.selected ? "0 0 0 2px #f2f3f5, 0 10px 24px rgba(0,0,0,.45)" : "0 0 0 1px #15161a, 0 10px 24px rgba(0,0,0,.45)",
          overflow: "hidden",
        }}
      >
        <div style={{ height: HEAD_H, background: head, display: "flex", alignItems: "center", gap: 9, padding: "0 12px", fontFamily: UI, fontWeight: 700, fontSize: 15, color: "#f4f6fa" }}>
          <svg width={10} height={10} viewBox="0 0 10 10">
            <path d="M1 3 L5 7 L9 3" stroke="#f4f6fa" strokeWidth={1.8} fill="none" />
          </svg>
          {n.kind === "her" ? (
            <svg width={18} height={18} viewBox={`0 0 ${STAR.C * 2} ${STAR.C * 2}`}>
              <path d={STAR.path} fill="#f4f6fa" />
            </svg>
          ) : null}
          {n.title}
        </div>
        <div style={{ padding: "8px 0 0" }}>
          {[...L.outs, ...L.ins].map((r, i) => (
            <div key={i} style={{ height: ROW_H, display: "flex", alignItems: "center", justifyContent: r.side === "out" ? "flex-end" : "flex-start", gap: 10, padding: "0 16px", fontFamily: UI, fontWeight: 500, fontSize: 14, color: SUB }}>
              {r.side === "out" && r.value ? <span style={{ fontFamily: MONO, fontSize: 13, color: TXT, background: FIELD, borderRadius: 4, padding: "2px 7px" }}>{r.value}</span> : null}
              <span>{r.label}</span>
            </div>
          ))}
          <div style={{ margin: "4px 12px 0", height: L.fieldH, borderRadius: 6, background: FIELD, boxShadow: "inset 0 0 0 1px #34373f", padding: "9px 11px", fontFamily: UI, fontWeight: 500, fontSize: fs, lineHeight: 1.36, color: TXT }}>{n.text}</div>
        </div>
      </div>
      {n.rows.map((r, i) => {
        const p = L.sock(r);
        return <Socket key={i} x={p.x} y={p.y} color={r.color} />;
      })}
    </>
  );
};

/** Noodle: a horizontal-tangent cubic, with packets of data riding it. */
function noodle(a: { x: number; y: number }, b: { x: number; y: number }, vert = false) {
  if (vert) {
    const dy = Math.max(50, Math.abs(b.y - a.y) * 0.5);
    return { d: `M ${a.x} ${a.y} C ${a.x} ${a.y + dy}, ${b.x} ${b.y - dy}, ${b.x} ${b.y}`, p: (u: number) => bez(a, { x: a.x, y: a.y + dy }, { x: b.x, y: b.y - dy }, b, u) };
  }
  const dx = b.x < a.x ? 70 : Math.max(60, Math.abs(b.x - a.x) * 0.5);
  return { d: `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`, p: (u: number) => bez(a, { x: a.x + dx, y: a.y }, { x: b.x - dx, y: b.y }, b, u) };
}
function bez(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }, u: number) {
  const v = 1 - u;
  return {
    x: v * v * v * a.x + 3 * v * v * u * b.x + 3 * v * u * u * c.x + u * u * u * d.x,
    y: v * v * v * a.y + 3 * v * v * u * b.y + 3 * v * u * u * c.y + u * u * u * d.y,
  };
}

export const NodesSkin: React.FC<SkinProps> = ({ t, w, h }) => {
  const tall = h > w;
  const barH = 52;
  const fs = tall ? 18 : 15;
  const nw = tall ? 560 : 270;
  const mk = (i: number, x: number, y: number): NodeSpec => {
    const specs: Omit<NodeSpec, "x" | "y" | "w">[] = [
      { title: "Prompt", kind: "me", text: CHAT.me1, rows: [{ label: "Text", color: W_TEXT, side: "out" }] },
      {
        title: "Stella",
        kind: "her",
        text: CHAT.her1,
        rows: [
          { label: "Text", color: W_TEXT, side: "out" },
          { label: "Amount", value: "$186", color: W_DATA, side: "out" },
          { label: "Row", value: "41", color: W_DATA, side: "out" },
          { label: "Context", color: W_TEXT, side: "in" },
        ],
      },
      { title: "Prompt", kind: "me", text: CHAT.me2, rows: [{ label: "Text", color: W_TEXT, side: "out" }, { label: "Context", color: W_TEXT, side: "in" }] },
      {
        title: "Stella",
        kind: "her",
        text: CHAT.her2,
        rows: [
          { label: "Text", color: W_TEXT, side: "out" },
          { label: "Reminder", value: "Fri 09:00", color: W_TIME, side: "out" },
          { label: "Context", color: W_TEXT, side: "in" },
        ],
        selected: true,
      },
    ];
    return { ...specs[i], x, y, w: nw, vert: tall };
  };
  let nodes: NodeSpec[];
  if (tall) {
    nodes = [];
    let y = barH + 110;
    for (let i = 0; i < 4; i++) {
      const n = mk(i, i % 2 ? 230 : 50, y);
      nodes.push(n);
      y += nodeLayout(n, fs).h + 52;
    }
  } else nodes = [mk(0, 90, 150), mk(1, 445, 250), mk(2, 800, 165), mk(3, 1135, 290)];
  const lay = nodes.map((n) => nodeLayout(n, fs));
  const out = (i: number, label = "Text") => lay[i].sock(nodes[i].rows.find((r) => r.label === label && r.side === "out")!);
  const inn = (i: number) => lay[i].sock(nodes[i].rows.find((r) => r.side === "in")!);
  const links = [
    { a: out(0), b: inn(1), c: W_TEXT },
    { a: out(1), b: inn(2), c: W_TEXT },
    { a: out(2), b: inn(3), c: W_TEXT },
  ].map((l) => ({ ...l, ...noodle(l.a, l.b, tall) }));

  // the frame around the session
  const fx = tall ? 26 : 60;
  const fy = barH + (tall ? 40 : 46);
  const fw = w - fx * 2;
  const fh = Math.max(...nodes.map((n, i) => n.y + lay[i].h)) + 34 - fy;

  // composer node
  const comp = tall ? { x: 50, y: h - 190, w: w - 100, h: 150 } : { x: 560, y: h - 168, w: 680, h: 138 };
  const cIn = tall ? { x: comp.x + comp.w / 2, y: comp.y } : { x: comp.x, y: comp.y + HEAD_H + 26 };
  const lastOut = out(3);
  // the wire being dragged to the new node: its end sits just short of the socket and drifts
  const drift = Math.sin(t * 2.1) * 6;
  const dragEnd = tall ? { x: cIn.x + 26 + drift, y: cIn.y - 22 + Math.cos(t * 1.7) * 4 } : { x: cIn.x - 18 + drift, y: cIn.y + 10 + Math.cos(t * 1.7) * 4 };
  const drag = noodle(lastOut, dragEnd, tall);
  const caret = Math.floor(t * 2.4) % 2 === 0;

  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, overflow: "hidden", background: BG }}>
      {/* editor grid */}
      <svg width={w} height={h} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <pattern id="nd-grid" width={24} height={24} patternUnits="userSpaceOnUse">
            <rect width={24} height={24} fill={BG} />
            <path d="M24 0 H0 V24" fill="none" stroke="#23262c" strokeWidth={1} />
          </pattern>
          <pattern id="nd-grid5" width={120} height={120} patternUnits="userSpaceOnUse">
            <rect width={120} height={120} fill="url(#nd-grid)" />
            <path d="M120 0 H0 V120" fill="none" stroke="#2a2d34" strokeWidth={1.2} />
          </pattern>
        </defs>
        <rect width={w} height={h} fill="url(#nd-grid5)" />
      </svg>

      {/* frame node */}
      <div style={{ position: "absolute", left: fx, top: fy, width: fw, height: fh, borderRadius: 10, background: "rgba(120,130,150,.08)", boxShadow: "inset 0 0 0 1px rgba(140,150,170,.18)" }}>
        <div style={{ position: "absolute", left: 16, top: 10, fontFamily: UI, fontWeight: 700, fontSize: 15, color: "#b9c0cc", letterSpacing: 0.2 }}>{CHAT.stamp}</div>
      </div>

      {/* noodles */}
      <svg width={w} height={h} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        {links.map((l, i) => (
          <g key={i}>
            <path d={l.d} stroke="#0e0f12" strokeWidth={6} fill="none" />
            <path d={l.d} stroke={l.c} strokeWidth={3} fill="none" />
            {[0, 1, 2].map((k) => {
              const u = (((t * 0.55 + k / 3 + i * 0.21) % 1) + 1) % 1;
              const p = l.p(u);
              return <circle key={k} cx={p.x} cy={p.y} r={4} fill="#fff8e0" stroke={l.c} strokeWidth={2} />;
            })}
          </g>
        ))}
      </svg>

      {nodes.map((n, i) => (
        <Node key={i} n={n} fs={fs} />
      ))}

      {/* the new node: the composer */}
      <div style={{ position: "absolute", left: comp.x, top: comp.y, width: comp.w, height: comp.h, borderRadius: 9, background: NODE, boxShadow: "0 0 0 1px #15161a, 0 10px 24px rgba(0,0,0,.45)", overflow: "hidden" }}>
        <div style={{ height: HEAD_H, background: H_NEW, display: "flex", alignItems: "center", gap: 9, padding: "0 12px", fontFamily: UI, fontWeight: 700, fontSize: 15, color: "#f4f6fa" }}>
          <svg width={10} height={10} viewBox="0 0 10 10">
            <path d="M1 3 L5 7 L9 3" stroke="#f4f6fa" strokeWidth={1.8} fill="none" />
          </svg>
          New Prompt
        </div>
        <div style={{ display: "flex", alignItems: "center", height: ROW_H, padding: "0 16px", marginTop: 8, fontFamily: UI, fontWeight: 500, fontSize: 14, color: SUB }}>Context</div>
        <div style={{ position: "absolute", left: 12, right: 12, bottom: 12, height: comp.h - HEAD_H - ROW_H - 30, borderRadius: 6, background: FIELD, boxShadow: "inset 0 0 0 1px #4a7a63", display: "flex", alignItems: "center", gap: 12, padding: "0 10px" }}>
          <div style={{ width: 30, height: 30, borderRadius: 6, background: "#353944", color: TXT, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: UI, fontSize: 20, fontWeight: 600 }}>+</div>
          <div style={{ flex: 1, fontFamily: UI, fontSize: fs + 1, color: "#7c8390" }}>
            {CHAT.placeholder}
            <span style={{ display: "inline-block", width: 2, height: fs + 2, marginLeft: 3, background: caret ? TXT : "transparent", transform: "translateY(3px)" }} />
          </div>
          <svg width={16} height={22} viewBox="0 0 14 20">
            <rect x={4} y={1} width={6} height={11} rx={3} fill={SUB} />
            <path d="M1.5 9 Q1.5 15 7 15 Q12.5 15 12.5 9 M7 15 V19" stroke={SUB} strokeWidth={1.8} fill="none" />
          </svg>
          <div style={{ height: 30, borderRadius: 6, background: H_NEW, color: "#fff", display: "flex", alignItems: "center", padding: "0 12px", fontFamily: UI, fontWeight: 700, fontSize: 14, gap: 6 }}>
            Run
            <svg width={10} height={12} viewBox="0 0 10 12">
              <path d="M1 1 L9 6 L1 11 Z" fill="#fff" />
            </svg>
          </div>
        </div>
      </div>
      <Socket x={cIn.x} y={cIn.y} color={W_TEXT} filled={false} />
      {/* the dragged wire's end, held by the pointer */}
      <svg width={w} height={h} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <path d={drag.d} stroke="#0e0f12" strokeWidth={6} fill="none" />
        <path d={drag.d} stroke={W_TEXT} strokeWidth={3} fill="none" strokeDasharray="10 7" strokeDashoffset={-t * 30} />
        <circle cx={dragEnd.x} cy={dragEnd.y} r={5} fill={W_TEXT} />
        <path d={`M ${dragEnd.x + 4} ${dragEnd.y + 4} l 0 19 l 5 -5 l 4 9 l 3 -1.5 l -4 -8.5 l 7 0 Z`} fill="#fff" stroke="#111" strokeWidth={1.3} strokeLinejoin="round" />
      </svg>

      {/* header */}
      <div style={{ position: "absolute", left: 0, top: 0, width: w, height: barH, background: "#25282e", boxShadow: "0 1px 0 #15161a", display: "flex", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 8, marginLeft: 18 }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <div key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />
          ))}
        </div>
        {tall ? null : (
          <div style={{ display: "flex", gap: 4, marginLeft: 26 }}>
            {["Add", "Node", "View", "Select"].map((m) => (
              <div key={m} style={{ fontFamily: UI, fontWeight: 600, fontSize: 14, color: "#b8beca", padding: "5px 10px", borderRadius: 5 }}>
                {m}
              </div>
            ))}
          </div>
        )}
        <div style={{ position: "absolute", left: 0, width: w, top: 0, height: barH, display: "flex", alignItems: "center", justifyContent: "center", gap: 9, pointerEvents: "none" }}>
          <svg width={22} height={22} viewBox={`0 0 ${STAR.C * 2} ${STAR.C * 2}`}>
            <path d={STAR.path} fill="#9b86ff" />
          </svg>
          <span style={{ fontFamily: UI, fontWeight: 700, fontSize: 15, color: TXT }}>Stella</span>
          <span style={{ fontFamily: UI, fontWeight: 500, fontSize: 15, color: SUB }}>/ conversation.graph</span>
        </div>
        <div style={{ position: "absolute", right: 18, top: 0, height: barH, display: "flex", alignItems: "center", gap: 14, fontFamily: UI, fontWeight: 600, fontSize: 14, color: "#b8beca" }}>
          Account
          <svg width={26} height={26} viewBox="0 0 26 26">
            <circle cx={13} cy={13} r={13} fill={H_ME} />
            <circle cx={13} cy={10.5} r={4.2} fill="#dfe8f4" />
            <path d="M5.5 21.5 Q13 13.5 20.5 21.5" fill="#dfe8f4" />
          </svg>
        </div>
      </div>
    </div>
  );
};
