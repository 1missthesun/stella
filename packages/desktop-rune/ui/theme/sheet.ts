import type { BoxProps, TextProps } from "../rune";
import type { Tokens } from "./tokens";
import { useTokens } from "./ThemeProvider";

/** A translated CSS rule: box props, text props, and `lh` / `em` (line-height and letter-spacing as CSS multiples). */
type NoHandlers<P> = { [K in keyof P as K extends `on${string}` ? never : K]: P[K] };

/** The event props of a Rune box (`onPress`, `onHover`, `onLayout` …), which stylesheets never carry. */
export type BoxHandlers = { [K in keyof BoxProps as K extends `on${string}` ? K : never]: BoxProps[K] };

export type Style = NoHandlers<Omit<BoxProps, "children" | "ref"> & Omit<TextProps, keyof BoxProps | "spans">> & { lh?: number; em?: number };

/** A stylesheet: rules built once per token set from the theme's colours, read with the returned hook. */
export function sheet<K extends string>(make: (c: Tokens["c"], t: Tokens) => Record<K, Style>): () => Record<K, Style> {
  const built = new WeakMap<Tokens, Record<K, Style>>();
  return () => {
    const t = useTokens();
    let s = built.get(t);
    if (!s) built.set(t, (s = make(t.c, t)));
    return s;
  };
}
