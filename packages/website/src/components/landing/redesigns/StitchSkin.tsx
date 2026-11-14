import React, { useMemo } from "react";
import { CHAT, type SkinProps } from "./content";
import { STAR, hash, starEyes } from "./kit";
import { TINY5 } from "./tiny5Bitmap";

/**
 * A cross-stitcher's Stella. The whole window is aida cloth; every mark is an X stitch
 * of stranded floss on the cloth's grid (or a backstitch along it). Your messages are
 * worked solid in blue with the lettering left in cream; Stella's are backstitched
 * outlines with dark lettering. The needle, still threaded, is parked at the caret.
 */

type Floss =
  | "ink"
  | "cream"
  | "blue"
  | "blueDk"
  | "rose"
  | "sage"
  | "sageLt"
  | "star"
  | "starLt"
  | "starDk"
  | "white"
  | "red"
  | "gold"
  | "green"
  | "grey"
  | "pink";
const FLOSS: Record<Floss, string> = {
  ink: "#3a2c2a",
  cream: "#fbf6ea",
  blue: "#4b6db3",
  blueDk: "#36508c",
  rose: "#c8695c",
  sage: "#7c9a6c",
  sageLt: "#a8c294",
  star: "#6c74d8",
  starLt: "#a8b2f4",
  starDk: "#4b4fae",
  white: "#ffffff",
  red: "#d9544c",
  gold: "#e8b03c",
  green: "#5ea85a",
  grey: "#9d948a",
  pink: "#e79aa6",
};

class Cloth {
  cells = new Map<number, Floss>();
  back: { c: Floss; pts: [number, number][] }[] = [];
  constructor(
    public cols: number,
    public rows: number,
  ) {}
  set(x: number, y: number, c: Floss) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    this.cells.set(y * this.cols + x, c);
  }
  clear(x: number, y: number) {
    this.cells.delete(y * this.cols + x);
  }
  rect(x: number, y: number, w: number, h: number, c: Floss) {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  /** Rounded block, corners trimmed by r cells. */
  block(x: number, y: number, w: number, h: number, r: number, c: Floss) {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const dx = Math.max(0, r - i - 0.5, i - (w - 1 - r) - 0.5);
        const dy = Math.max(0, r - j - 0.5, j - (h - 1 - r) - 0.5);
        if (dx * dx + dy * dy <= r * r + 0.3) this.set(x + i, y + j, c);
      }
  }
  disc(cx: number, cy: number, r: number, c: Floss) {
    for (let j = -r; j <= r; j++)
      for (let i = -r; i <= r; i++)
        if (i * i + j * j <= r * r + r * 0.6) this.set(cx + i, cy + j, c);
  }
  /** Stitch a string; returns width in cells. */
  text(x: number, y: number, s: string, c: Floss | null) {
    let cx = x;
    for (const ch of s) {
      const g = TINY5[ch] ?? TINY5["?"];
      g.r.forEach((row, j) => {
        for (let i = 0; i < row.length; i++)
          if (row[i] === "1") {
            if (c) this.set(cx + i, y + j, c);
            else this.clear(cx + i, y + j);
          }
      });
      cx += g.a;
    }
    return cx - x;
  }
  /** Backstitch outline around a rounded rect (cell edges). */
  outline(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    c: Floss,
    tail?: "l" | "r",
  ) {
    const pts: [number, number][] = [];
    const arc = (cx: number, cy: number, a0: number) => {
      for (let k = 0; k <= 3; k++) {
        const a = a0 + (k / 3) * (Math.PI / 2);
        pts.push([
          Math.round(cx + Math.cos(a) * r),
          Math.round(cy + Math.sin(a) * r),
        ]);
      }
    };
    arc(x + r, y + r, Math.PI);
    arc(x + w - r, y + r, -Math.PI / 2);
    if (tail === "r") {
      pts.push([x + w, y + h - 2]);
      pts.push([x + w + 3, y + h + 1]);
      pts.push([x + w - 3, y + h]);
    } else arc(x + w - r, y + h - r, 0);
    if (tail === "l") {
      pts.push([x + 3, y + h]);
      pts.push([x - 3, y + h + 1]);
      pts.push([x, y + h - 2]);
    } else arc(x + r, y + h - r, Math.PI / 2);
    pts.push(pts[0]);
    this.back.push({ c, pts });
  }
}

const textWidth = (s: string) =>
  [...s].reduce((a, ch) => a + (TINY5[ch] ?? TINY5["?"]).a, 0);
function wrap(s: string, max: number) {
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const wd of words) {
    const nxt = cur ? cur + " " + wd : wd;
    if (textWidth(nxt) > max && cur) {
      lines.push(cur);
      cur = wd;
    } else cur = nxt;
  }
  if (cur) lines.push(cur);
  return lines;
}

const STAR_ROWS = [
  ".....###.....",
  ".....###.....",
  "....#####....",
  "##.#######.##",
  "#############",
  ".###a###a###.",
  "..##a###a##..",
  ".###########.",
  "#############",
  "##.#######.##",
  "....#####....",
  ".....###.....",
  ".....###.....",
];

function composeUncached(cols: number, rows: number, tall: boolean) {
  const cl = new Cloth(cols, rows);
  // ---- top bar
  const barY = 4;
  [FLOSS.red, FLOSS.gold, FLOSS.green].forEach((_, i) =>
    cl.disc(5 + i * 7, barY + 3, 2, (["red", "gold", "green"] as Floss[])[i]),
  );
  const brandW = 13 + 3 + textWidth("Stella");
  const bx = Math.floor((cols - brandW) / 2);
  STAR_ROWS.forEach((row, j) =>
    row.split("").forEach((ch, i) => {
      if (ch === ".") return;
      const shade: Floss =
        ch === "a"
          ? "white"
          : i + j < 9
            ? "starLt"
            : i + j > 16
              ? "starDk"
              : "star";
      cl.set(bx + i, barY - 3 + j, shade);
    }),
  );
  cl.text(bx + 16, barY, "Stella", "ink");
  const acc = "Account";
  cl.text(cols - 4 - textWidth(acc), barY, acc, "ink");
  // ---- sampler border under the bar: a sage vine with rose buds
  const by = barY + 11;
  for (let x = 2; x < cols - 2; x++) {
    const ph = x % 8;
    const yy =
      by +
      (ph < 4 ? (ph < 2 ? ph : 3 - ph) : 0) -
      (ph >= 4 ? (ph < 6 ? ph - 4 : 7 - ph) : 0);
    cl.set(x, yy, "sage");
    if (ph === 1) cl.set(x, yy - 2, "pink");
    if (ph === 5) cl.set(x, yy + 2, "pink");
    if (ph === 1) cl.set(x + 1, yy - 1, "sageLt");
    if (ph === 5) cl.set(x + 1, yy + 1, "sageLt");
  }

  // ---- composer
  const colW = tall ? cols - 10 : Math.min(140, cols - 40);
  const cx0 = Math.floor((cols - colW) / 2);
  const compH = 11;
  const compY = rows - 4 - compH;
  cl.outline(cx0, compY, colW, compH, 4, "grey");
  // + in a ring
  cl.disc(cx0 + 6, compY + 5, 3, "sageLt");
  cl.rect(cx0 + 5, compY + 5, 3, 1, "ink");
  cl.rect(cx0 + 6, compY + 4, 1, 3, "ink");
  const phW = cl.text(cx0 + 13, compY + 3, CHAT.placeholder, "grey");
  // send: solid blue disc with a cream arrow
  const sx = cx0 + colW - 7;
  cl.disc(sx, compY + 5, 4, "blue");
  cl.rect(sx, compY + 2, 1, 7, "cream");
  cl.set(sx - 1, compY + 3, "cream");
  cl.set(sx + 1, compY + 3, "cream");
  cl.set(sx - 2, compY + 4, "cream");
  cl.set(sx + 2, compY + 4, "cream");
  // mic
  const mx = sx - 11;
  [".###.", ".###.", ".###.", "#...#", ".###.", "..#..", ".###."].forEach(
    (row, j) =>
      row
        .split("")
        .forEach((ch, i) =>
          ch === "#" ? cl.set(mx + i, compY + 2 + j, "grey") : null,
        ),
  );

  // ---- messages, from the bottom up
  const maxText = tall ? colW - 14 : 128;
  const lh = 8;
  const msgs: [boolean, string][] = [
    [true, CHAT.me1],
    [false, CHAT.her1],
    [true, CHAT.me2],
    [false, CHAT.her2],
  ];
  let y = compY - 4;
  const placed: {
    me: boolean;
    lines: string[];
    x: number;
    y: number;
    bw: number;
    bh: number;
  }[] = [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const [me, s] = msgs[i];
    const lines = wrap(s, maxText);
    const tw = Math.max(...lines.map(textWidth));
    const bw = tw + 8;
    const bh = lines.length * lh + 4;
    y -= bh + 1;
    const x = me ? cx0 + colW - bw - 2 : cx0 + 2;
    placed.unshift({ me, lines, x, y, bw, bh });
    y -= 3;
  }
  for (const p of placed) {
    if (p.me) {
      cl.block(p.x, p.y, p.bw, p.bh, 3, "blue");
      // little tail
      cl.set(p.x + p.bw - 2, p.y + p.bh, "blue");
      cl.set(p.x + p.bw - 1, p.y + p.bh, "blue");
      cl.set(p.x + p.bw, p.y + p.bh + 1, "blue");
      p.lines.forEach((ln, k) => {
        const lw = textWidth(ln);
        cl.text(p.x + p.bw - 4 - lw, p.y + 2 + k * lh, ln, "cream");
      });
    } else {
      cl.outline(p.x, p.y, p.bw, p.bh, 3, "rose", "l");
      p.lines.forEach((ln, k) => cl.text(p.x + 4, p.y + 2 + k * lh, ln, "ink"));
    }
  }
  // stamp
  const sw = textWidth(CHAT.stamp);
  cl.text(Math.floor((cols - sw) / 2), y - 9, CHAT.stamp, "grey");
  // tall: the space above holds a sampler centrepiece, Stella herself, flanked by flowers
  if (tall) {
    const top = barY + 16;
    const room = y - 12 - top;
    const n = Math.min(41, room - 4);
    if (n > 20) {
      const sx0 = Math.floor((cols - n) / 2);
      const sy0 = top + Math.floor((room - n) / 2);
      const C = STAR.C;
      const ring = STAR.ring;
      const inside = (px: number, py: number) => {
        let ins = false;
        for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
          const [xi, yi] = ring[a],
            [xj, yj] = ring[b];
          if (
            yi > py !== yj > py &&
            px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
          )
            ins = !ins;
        }
        return ins;
      };
      const at = (i: number, j: number) =>
        i >= 0 &&
        j >= 0 &&
        i < n &&
        j < n &&
        inside(((i + 0.5) / n) * 2 * C, ((j + 0.5) / n) * 2 * C);
      const { l, r, ew, eh } = starEyes();
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          if (!at(i, j)) continue;
          let f: Floss = "star";
          if (!at(i - 2, j - 2)) f = "starLt";
          if (!at(i + 3, j + 3)) f = "starDk";
          const px = ((i + 0.5) / n) * 2 * C,
            py = ((j + 0.5) / n) * 2 * C;
          for (const [ex, ey] of [l, r])
            if (
              ((px - ex) / (ew * 0.32)) ** 2 + ((py - ey) / (eh * 0.52)) ** 2 <
              1
            )
              f = "white";
          cl.set(sx0 + i, sy0 + j, f);
        }
      // flowers
      const flower = (fx: number, fy: number, c: Floss) => {
        [
          [0, -2],
          [0, 2],
          [-2, 0],
          [2, 0],
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ].forEach(([dx, dy]) => cl.set(fx + dx, fy + dy, c));
        cl.set(fx, fy, "gold");
        for (let k = 3; k < 9; k++) cl.set(fx, fy + k, "sage");
        cl.set(fx + 1, fy + 5, "sageLt");
        cl.set(fx + 2, fy + 4, "sageLt");
        cl.set(fx - 1, fy + 7, "sageLt");
        cl.set(fx - 2, fy + 6, "sageLt");
      };
      const mid = sy0 + Math.floor(n / 2) - 3;
      flower(sx0 - 12, mid, "pink");
      flower(sx0 - 22, mid + 6, "rose");
      flower(sx0 + n + 11, mid, "pink");
      flower(sx0 + n + 21, mid + 6, "rose");
    }
  }
  return { cl, caret: { x: cx0 + 13 + phW + 2, y: compY + 3 } };
}

const composed = new Map<string, ReturnType<typeof composeUncached>>();
function compose(cols: number, rows: number, tall: boolean) {
  const key = `${cols}x${rows}${tall ? "t" : "w"}`;
  let hit = composed.get(key);
  if (!hit) {
    hit = composeUncached(cols, rows, tall);
    composed.set(key, hit);
  }
  return hit;
}

/** Lays out the stitched conversation for one design size ahead of its first frame. */
export function warmStitch(w: number, h: number) {
  compose(Math.floor(w / 7), Math.floor(h / 7), h > w);
}

export const StitchSkin: React.FC<SkinProps> = ({ t, w, h }) => {
  const tall = h > w;
  const c = 7;
  const cols = Math.floor(w / c);
  const rows = Math.floor(h / c);
  const ox = (w - cols * c) / 2;
  const oy = (h - rows * c) / 2;
  const fabric = useMemo(() => <Fabric w={w} h={h} />, [w, h]);
  const { caret } = compose(cols, rows, tall);
  // the needle parked at the caret, thread trailing to the edge
  const nx = ox + caret.x * c;
  const ny = oy + caret.y * c;
  const bob = Math.sin(t * 2.2) * 2;
  const sway = Math.sin(t * 1.3 + 0.5) * 10;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: w,
        height: h,
        overflow: "hidden",
        background: "#efe8da",
      }}
    >
      {fabric}
      <svg width={w} height={h} style={{ position: "absolute", inset: 0 }}>
        {/* the needle and its thread */}
        {(() => {
          // needle tip sits in a hole at the caret, lying up and to the right; thread runs from its eye
          const ang = -66 + bob;
          const L = 92;
          const th = (-ang * Math.PI) / 180;
          const exx = nx + L * Math.sin(th);
          const eyy = ny + c - L * Math.cos(th);
          const thread = `M ${exx} ${eyy} C ${exx + 60} ${eyy - 30 + sway}, ${exx + 120} ${eyy + 10}, ${exx + 150 + sway} ${h + 20}`;
          return (
            <>
              <path
                d={thread}
                stroke="rgba(60,40,20,.25)"
                strokeWidth={4}
                fill="none"
                transform="translate(2 4)"
              />
              <path
                d={thread}
                stroke={FLOSS.blue}
                strokeWidth={3.4}
                fill="none"
              />
              <path
                d={thread}
                stroke="rgba(0,0,0,.2)"
                strokeWidth={3}
                strokeDasharray="2 2"
                fill="none"
              />
              <g transform={`translate(${nx} ${ny + c}) rotate(${-ang})`}>
                <path
                  d={`M 0 0 L 3 ${-L * 0.25} L 2.6 ${-L} Q 0 ${-L - 5} -2.6 ${-L} L -3 ${-L * 0.25} Z`}
                  fill="url(#st-steel)"
                  stroke="#55585e"
                  strokeWidth={0.7}
                />
                <rect
                  x={-1}
                  y={-L + 3}
                  width={2}
                  height={11}
                  rx={1}
                  fill="#efe8da"
                  stroke="#55585e"
                  strokeWidth={0.5}
                />
              </g>
            </>
          );
        })()}
        <defs>
          <linearGradient id="st-steel" x1={0} y1={0} x2={1} y2={0}>
            <stop offset={0} stopColor="#7d8087" />
            <stop offset={0.4} stopColor="#f4f6f8" />
            <stop offset={1} stopColor="#8a8d93" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
};

/** Everything stitched: the cloth, every X, the holes and the backstitch. */
function Fabric({ w, h }: { w: number; h: number }) {
  const tall = h > w;
  const c = 7;
  const cols = Math.floor(w / c);
  const rows = Math.floor(h / c);
  const ox = (w - cols * c) / 2;
  const oy = (h - rows * c) / 2;
  const { cl } = compose(cols, rows, tall);

  // build one path per floss for each leg of the X
  const ins = c * 0.16;
  const legA: Partial<Record<Floss, string[]>> = {};
  const legB: Partial<Record<Floss, string[]>> = {};
  cl.cells.forEach((f, k) => {
    const x = ox + (k % cols) * c;
    const y = oy + Math.floor(k / cols) * c;
    // tiny per-stitch irregularity: tension is never perfect
    const j = (hash(k, 3) - 0.5) * 0.5;
    (legA[f] ??= []).push(
      `M${(x + ins).toFixed(1)} ${(y + c - ins + j).toFixed(1)}L${(x + c - ins).toFixed(1)} ${(y + ins).toFixed(1)}`,
    );
    (legB[f] ??= []).push(
      `M${(x + ins).toFixed(1)} ${(y + ins).toFixed(1)}L${(x + c - ins + j).toFixed(1)} ${(y + c - ins).toFixed(1)}`,
    );
  });
  const sw = c * 0.46;
  const hs = new Set<number>();
  cl.cells.forEach((_, k) => {
    const x = k % cols,
      y = Math.floor(k / cols);
    hs.add(y * (cols + 1) + x)
      .add(y * (cols + 1) + x + 1)
      .add((y + 1) * (cols + 1) + x)
      .add((y + 1) * (cols + 1) + x + 1);
  });
  const hr = c * 0.13;
  let holes = "";
  hs.forEach((k) => {
    const x = ox + (k % (cols + 1)) * c,
      y = oy + Math.floor(k / (cols + 1)) * c;
    holes += `M${(x - hr).toFixed(1)} ${y.toFixed(1)}a${hr} ${hr} 0 1 0 ${2 * hr} 0a${hr} ${hr} 0 1 0 ${-2 * hr} 0`;
  });
  const layer = (legs: Partial<Record<Floss, string[]>>, key: string) =>
    (Object.keys(legs) as Floss[]).map((f) => {
      const d = legs[f]!.join("");
      return (
        <g key={key + f}>
          <path
            d={d}
            stroke="rgba(60,40,20,.35)"
            strokeWidth={sw + 0.6}
            strokeLinecap="round"
            fill="none"
            transform="translate(0.5 0.8)"
          />
          <path
            d={d}
            stroke={FLOSS[f]}
            strokeWidth={sw}
            strokeLinecap="round"
            fill="none"
          />
          {/* the twist of the strands */}
          <path
            d={d}
            stroke="rgba(0,0,0,.16)"
            strokeWidth={sw * 0.9}
            strokeLinecap="butt"
            strokeDasharray="1 1.4"
            fill="none"
          />
          <path
            d={d}
            stroke="rgba(255,255,255,.35)"
            strokeWidth={sw * 0.28}
            strokeLinecap="round"
            fill="none"
            transform="translate(-0.4 -0.4)"
          />
        </g>
      );
    });

  const toXY = ([x, y]: [number, number]) =>
    `${(ox + x * c).toFixed(1)} ${(oy + y * c).toFixed(1)}`;
  return (
    <svg width={w} height={h} style={{ position: "absolute", inset: 0 }}>
      <defs>
        <pattern
          id="st-aida"
          x={ox}
          y={oy}
          width={c}
          height={c}
          patternUnits="userSpaceOnUse"
        >
          <rect width={c} height={c} fill="#e9e1d0" />
          <rect
            x={0.7}
            y={0.7}
            width={c - 1.4}
            height={c - 1.4}
            rx={1.2}
            fill="#f6f1e6"
          />
          <rect
            x={1.5}
            y={1.6}
            width={c - 3}
            height={0.7}
            fill="#fffdf8"
            opacity={0.7}
          />
          <circle cx={0} cy={0} r={0.75} fill="#c9bea8" />
          <circle cx={c} cy={0} r={0.75} fill="#c9bea8" />
          <circle cx={0} cy={c} r={0.75} fill="#c9bea8" />
          <circle cx={c} cy={c} r={0.75} fill="#c9bea8" />
        </pattern>
        <filter id="st-slub" x={0} y={0} width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.004 0.03"
            numOctaves={2}
            seed={8}
          />
          <feColorMatrix values="0 0 0 0 0.55  0 0 0 0 0.45  0 0 0 0 0.3  0 0 0 0.22 0" />
        </filter>
      </defs>
      <rect width={w} height={h} fill="url(#st-aida)" />
      <rect width={w} height={h} filter="url(#st-slub)" opacity={0.6} />
      {layer(legA, "a")}
      {layer(legB, "b")}
      {/* the holes the floss goes down into: they separate every X */}
      <path d={holes} fill="rgba(70,50,35,.55)" />
      {/* backstitch: a slightly shiny single strand along the grid */}
      {cl.back.map((b, i) => {
        const d = "M" + b.pts.map(toXY).join("L");
        return (
          <g key={i}>
            <path
              d={d}
              stroke="rgba(60,40,20,.3)"
              strokeWidth={c * 0.38}
              fill="none"
              strokeLinejoin="round"
              transform="translate(0.5 0.8)"
            />
            <path
              d={d}
              stroke={FLOSS[b.c]}
              strokeWidth={c * 0.34}
              fill="none"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <path
              d={d}
              stroke="rgba(0,0,0,.18)"
              strokeWidth={c * 0.3}
              fill="none"
              strokeDasharray={`${c * 0.9} ${c * 0.1}`}
            />
          </g>
        );
      })}
    </svg>
  );
}
