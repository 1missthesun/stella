import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { createStellaMark, VIEWBOX, type StellaCharacterShape, type StellaCharacterState, type StellaMarkHandle } from "@/ui/stella-character/rig";
import { useTokens } from "../theme";

export type StellaCharacterProps = {
  size: number | null;
  state?: StellaCharacterState;
  shape?: StellaCharacterShape;
  ink?: "aurora" | "vivid";
  eyeColor?: string;
  glow?: boolean;
  paused?: boolean;
  followPointer?: boolean;
  handleRef?: MutableRefObject<StellaMarkHandle | null>;
};

type Node = {
  tagName: string;
  attributes: Map<string, string>;
  style: { getPropertyValue(name: string): string };
  childNodes: Node[];
  animate?: unknown;
};

const SVG_TAGS: Record<string, string> = { lineargradient: "linearGradient", radialgradient: "radialGradient", clippath: "clipPath" };
const SKIPPED_ATTRS = new Set(["style", "class", "aria-hidden", "pointer-events"]);
const [VIEW_X, VIEW_Y, VIEW_SPAN] = VIEWBOX.split(" ").map(Number) as [number, number, number, number];

type Running = { frames: Keyframe[]; duration: number; delay: number; iterations: number; start: number; pausedAt: number | null; done: boolean };

/** WAAPI on the rig's layer spans (the working dots' bounce), sampled when the frame is drawn. */
const animations = new WeakMap<Node, Running>();
const fakeAnimate = (el: Node) => (frames: Keyframe[], options: KeyframeAnimationOptions | number) => {
  const opts = typeof options === "number" ? { duration: options } : options;
  const run: Running = {
    frames,
    duration: Number(opts.duration) || 1,
    delay: opts.delay ?? 0,
    iterations: opts.iterations ?? 1,
    start: performance.now(),
    pausedAt: null,
    done: false,
  };
  animations.set(el, run);
  return {
    get playState() {
      return run.done ? "finished" : run.pausedAt !== null ? "paused" : "running";
    },
    pause() {
      if (run.pausedAt === null) run.pausedAt = performance.now();
    },
    play() {
      if (run.pausedAt === null) return;
      run.start += performance.now() - run.pausedAt;
      run.pausedAt = null;
    },
    cancel() {
      run.done = true;
      if (animations.get(el) === run) animations.delete(el);
    },
    finish() {
      this.cancel();
    },
    finished: Promise.resolve(),
    addEventListener() {},
  };
};

const sampleFrame = (run: Running): Keyframe | null => {
  if (run.done) return null;
  const now = run.pausedAt ?? performance.now();
  const local = now - run.start - run.delay;
  if (local < 0) return run.frames[0] ?? null;
  const iteration = Math.floor(local / run.duration);
  if (iteration >= run.iterations) return null;
  const u = (local % run.duration) / run.duration;
  const index = Math.min(run.frames.length - 1, Math.round(u * (run.frames.length - 1)));
  return run.frames[index] ?? null;
};

const pct = (value: string, axis: "x" | "y") => (axis === "x" ? VIEW_X : VIEW_Y) + (parseFloat(value) / 100) * VIEW_SPAN;

/** A layer span's CSS transform (`translateY(%) scale(sx, sy)` about a % origin) in viewBox units. */
const spanTransform = (span: Node): { transform: string; opacity: number } => {
  const frame = animations.has(span) ? sampleFrame(animations.get(span)!) : null;
  const css = String(frame?.transform ?? span.style.getPropertyValue("transform") ?? "");
  const opacity = frame?.opacity !== undefined ? Number(frame.opacity) : 1;
  if (!css || css === "none") return { transform: "", opacity };
  const [ox = "50%", oy = "50%"] = span.style.getPropertyValue("transform-origin").split(/\s+/);
  const lift = /translateY\(([-\d.]+)%\)/.exec(css);
  const scale = /scale\(([-\d.]+)(?:,\s*([-\d.]+))?\)/.exec(css);
  const x = pct(ox, "x");
  const y = pct(oy, "y");
  const ty = lift ? (parseFloat(lift[1]!) / 100) * VIEW_SPAN : 0;
  const sx = scale ? parseFloat(scale[1]!) : 1;
  const sy = scale ? parseFloat(scale[2] ?? scale[1]!) : 1;
  return { transform: `translate(${x} ${y + ty}) scale(${sx} ${sy}) translate(${-x} ${-y})`, opacity };
};

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const serialize = (el: Node, resolve: (value: string) => string): string => {
  if (el.style.getPropertyValue("display") === "none") return "";
  const raw = el.tagName.toLowerCase();
  const kids = el.childNodes.map((child) => serialize(child, resolve)).join("");
  if (raw === "svg") return kids;
  if (raw === "span") {
    const { transform, opacity } = spanTransform(el);
    if (!transform && opacity === 1) return kids;
    return `<g${transform ? ` transform="${transform}"` : ""}${opacity !== 1 ? ` opacity="${opacity}"` : ""}>${kids}</g>`;
  }
  const tag = SVG_TAGS[raw] ?? raw;
  let attrs = "";
  for (const [name, value] of el.attributes) if (!SKIPPED_ATTRS.has(name)) attrs += ` ${name}="${escape(resolve(value))}"`;
  const styled = el.style.getPropertyValue("opacity");
  if (styled && !el.attributes.has("opacity")) attrs += ` opacity="${styled}"`;
  return `<${tag}${attrs}>${kids}</${tag}>`;
};

/** desktop-ui's `StellaCharacter`: its rig runs unchanged on a detached DOM, and each frame it draws is handed to the engine as one SVG. */
export function StellaCharacter({ size, state = "idle", shape = "star", ink = "aurora", eyeColor, glow = false, paused = false, followPointer = false, handleRef }: StellaCharacterProps) {
  const t = useTokens();
  const [svg, setSvg] = useState("");
  const markRef = useRef<StellaMarkHandle | null>(null);
  const motion = useRef({ state, shape, paused });
  motion.current = { state, shape, paused };
  const colours = useRef<Record<string, string>>({});
  colours.current = { ...t.vars, "--fg": t.c.foreground };

  useLayoutEffect(() => {
    const host = document.createElement("span") as unknown as HTMLElement;
    const createElement = document.createElement.bind(document);
    const createElementNS = document.createElementNS.bind(document);
    document.createElement = ((tag: string) => {
      const el = createElement(tag) as unknown as Node;
      el.animate = fakeAnimate(el);
      return el;
    }) as typeof document.createElement;
    document.createElementNS = ((ns: string, tag: string) => {
      const el = createElementNS(ns, tag) as unknown as Node;
      el.animate = fakeAnimate(el);
      return el;
    }) as typeof document.createElementNS;
    let mark: StellaMarkHandle;
    try {
      mark = createStellaMark(host, { size, ink, glow, followPointer, visibilityGate: false, ...motion.current, ...(eyeColor ? { eyeColor } : {}) });
    } finally {
      document.createElement = createElement;
      document.createElementNS = createElementNS;
    }
    markRef.current = mark;
    if (handleRef) handleRef.current = mark;
    const resolve = (value: string) =>
      value.includes("var(")
        ? value.replace(/var\((--[\w-]+)(?:,\s*([^)]+))?\)/g, (_m, name: string, fallback?: string) => colours.current[name] ?? fallback?.trim() ?? "#000")
        : value;
    let last = "";
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const next = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX}">${serialize(mark.el as unknown as Node, resolve)}</svg>`;
      if (next !== last) {
        last = next;
        setSvg(next);
      }
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      markRef.current = null;
      if (handleRef?.current === mark) handleRef.current = null;
      mark.destroy();
    };
  }, [size, ink, glow, eyeColor, followPointer, handleRef]);

  useEffect(() => {
    markRef.current?.setState(state);
  }, [state]);

  useEffect(() => {
    markRef.current?.setShape(shape);
  }, [shape]);

  useEffect(() => {
    if (paused) markRef.current?.pause();
    else markRef.current?.resume();
  }, [paused]);

  const px = size ?? 22;
  return svg ? <vector svg={svg} w={px} h={px} shrink={false} inert /> : <box w={px} h={px} shrink={false} />;
}
