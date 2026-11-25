import { Children, Fragment, createContext, isValidElement, useContext, type ReactElement, type ReactNode } from "react";
import type { Run, TextProps } from "../../rune";
import { useTokens, type Style } from "../../theme";
import { useTextBase } from "./scope";

const TEXT_KEYS = ["size", "weight", "lh", "lineHeight", "em", "tracking", "color", "family", "mono", "textAlign", "textCase", "italic", "nowrap"] as const;
type TextKey = (typeof TEXT_KEYS)[number];
export type TextStyle = Pick<Style, TextKey>;

/** The text props of `styles` merged in order: what nested text inherits, as CSS does. */
export function tx(...styles: (Style | null | undefined | false)[]): TextStyle {
  const out: Record<string, unknown> = {};
  for (const s of styles) if (s) for (const k of TEXT_KEYS) if (s[k] !== undefined) out[k] = s[k];
  return out as TextStyle;
}

/** The colour text and icons take inside a pressable or styled container (CSS `currentColor`). */
export const Ink = createContext<string | undefined>(undefined);
export const useInk = () => useContext(Ink);

export type TProps = Omit<TextProps, "children"> & { lh?: number; em?: number; children?: ReactNode; onPress?: (e?: unknown) => void };

type SpanStyle = { w?: number; c?: string; s?: number; m?: boolean; i?: boolean; u?: string; st?: boolean; bg?: string; href?: string };
type SpanSource = { props: TProps & { underline?: boolean | string; fill?: string; href?: string }; type: unknown };

/** Inline children (strings, nested `T`, `Br`, `Press` links) as engine text runs; links report their index through `onLink`. */
function flatten(children: ReactNode, inherited: SpanStyle, runs: Run[], links: ((e?: unknown) => void)[]) {
  Children.forEach(children, (child) => {
    if (child === null || child === undefined || child === false || child === true) return;
    if (typeof child === "string" || typeof child === "number") {
      runs.push({ t: String(child), ...inherited });
      return;
    }
    if (!isValidElement(child)) return;
    const el = child as ReactElement<SpanSource["props"]>;
    if (el.type === Br) {
      runs.push({ t: "\n", ...inherited });
      return;
    }
    if (el.type === Fragment) {
      flatten(el.props.children, inherited, runs, links);
      return;
    }
    const p = el.props;
    const next: SpanStyle = { ...inherited };
    if (p.weight !== undefined) next.w = p.weight;
    if (p.color !== undefined) next.c = p.color;
    if (p.size !== undefined) next.s = p.size;
    if (p.mono) next.m = true;
    if (p.italic) next.i = true;
    if (p.strike) next.st = true;
    if (p.fill) next.bg = p.fill;
    if (p.underline) next.u = typeof p.underline === "string" ? p.underline : (p.color ?? inherited.c);
    if (p.onPress) {
      links.push(p.onPress);
      next.href = `#${links.length - 1}`;
    }
    flatten(p.children, next, runs, links);
  });
}

const isPlain = (children: ReactNode) => {
  let plain = true;
  Children.forEach(children, (c) => {
    if (c !== null && c !== undefined && typeof c !== "boolean" && typeof c !== "string" && typeof c !== "number") plain = false;
  });
  return plain;
};

/** Text with CSS-style defaults: `lh` and `em` as multiples of `size`, shrinking like a flex item, inline children as runs. */
export function T({ size, weight, lh, em, lineHeight: lhPx, tracking, color, family, mono, children, onPress, shrink = true, ...rest }: TProps) {
  const t = useTokens();
  const ink = useInk();
  const inherited = useTextBase();
  const px = size ?? inherited.size;
  const base = {
    size: px,
    weight: weight ?? inherited.weight,
    lineHeight: lhPx ?? Math.round(px * (lh ?? inherited.lh) * 100) / 100,
    tracking: tracking ?? Math.round(px * (em ?? inherited.em) * 1000) / 1000,
    family: mono ? undefined : (family ?? inherited.family),
    mono,
    color: color ?? ink ?? t.c.foreground,
    shrink,
    ...rest,
  };
  if (isPlain(children)) {
    const text = Children.toArray(children).join("");
    return (
      <text {...base} onPress={onPress}>
        {text}
      </text>
    );
  }
  const runs: Run[] = [];
  const links: ((e?: unknown) => void)[] = [];
  flatten(children, {}, runs, links);
  return <text {...base} spans={runs} onPress={onPress} onLink={(href) => links[Number(href.slice(1))]?.()} />;
}

/** A line break inside `T`. */
export function Br() {
  return null;
}

export { TEXT_KEYS };
export type { TextKey };
