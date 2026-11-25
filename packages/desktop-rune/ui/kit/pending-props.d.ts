// Host element props agreed with the engine track that its typings don't carry yet.
import type {} from "react";

export type KitShadow = { x: number; y: number; blur: number; spread?: number; color: string; inset?: boolean };
export type KitEffect = { opacity?: number; scale?: number; x?: number; y?: number; blur?: number; dur?: number };
export type KitFrame = { at: number; y?: number; x?: number; scaleX?: number; scaleY?: number; opacity?: number };
export type KitLoop = {
  kind: "opacity" | "rotation" | "slide" | "sequence";
  period: number;
  delay?: number;
  low?: number;
  high?: number;
  from?: [number, number];
  to?: [number, number];
  frames?: KitFrame[];
  origin?: [number, number];
};
export type KitKey = { key: string; mods: { shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean; mod?: boolean } };
export type KitRect = { x: number; y: number; w: number; h: number };

export type PendingBoxProps = {
  shadows?: KitShadow[];
  gradient?: { angle: number; stops: [number, string][] };
  absolute?: { left?: number; top?: number; right?: number; bottom?: number };
  inset?: number;
  inert?: boolean;
  raise?: number;
  anchor?: { to: string; side: "top" | "bottom" | "left" | "right"; align: "start" | "center" | "end"; gap?: number; fit?: boolean };
  modal?: { clickOutside: boolean };
  onDismiss?: () => void;
  hoverBorder?: string;
  hoverColor?: string;
  pressScale?: number;
  cursor?: "default" | "pointer" | "text" | "notAllowed" | "grab";
  focusRing?: { width: number; offset: number; color: string };
  tabIndex?: number;
  focusGroup?: boolean;
  keys?: string[];
  onKey?: (e: KitKey) => void;
  onFocus?: (focused: boolean) => void;
  onHover?: (inside: boolean) => void;
  onContextMenu?: (at: { x: number; y: number }) => void;
  onLayout?: (r: KitRect) => void;
  title?: string;
  titleSide?: "top" | "bottom" | "left" | "right";
  disabled?: boolean;
  checked?: boolean;
  expanded?: boolean;
  selected?: boolean;
  motion?: { dur: number; bounce?: number };
  enter?: "fade" | "rise" | "blur" | "scale" | KitEffect;
  exit?: KitEffect;
  loop?: KitLoop;
  rotate?: number;
  blur?: number;
  backdropBlur?: number;
  hidden?: boolean;
  fixed?: boolean;
  dir?: "ltr" | "rtl";
};

export type PendingTextProps = {
  family?: string;
  textCase?: "upper" | "lower";
  italic?: boolean;
  underline?: string;
  selectionColor?: string;
};

export type PendingInputProps = {
  multiline?: boolean;
  readOnly?: boolean;
  secure?: boolean;
  selectOnFocus?: boolean;
  spellcheck?: boolean;
};

export type PendingRun = { s?: number; f?: string; st?: boolean; href?: string };

export type IconProps = PendingBoxProps & {
  id?: string;
  svg: string;
  name: string;
  view?: number;
  size: number;
  color?: string;
  spin?: number;
  opacity?: number;
  mt?: number;
  ml?: number;
  mr?: number;
  key?: React.Key;
};

export type ImageProps = PendingBoxProps & {
  id?: string;
  src: string;
  fit?: "cover" | "contain" | "stretch";
  w?: number | "full" | `${number}%`;
  h?: number | "full" | `${number}%`;
  maxW?: number | `${number}%`;
  maxH?: number | `${number}%`;
  radius?: number;
  border?: string;
  opacity?: number;
  key?: React.Key;
};

export type MarkdownProps = {
  id?: string;
  src: string;
  streaming?: boolean;
  mdStyle?: Record<string, unknown>;
  onLink?: (url: string) => void;
  w?: number | "full" | `${number}%`;
  key?: React.Key;
};

declare module "rune-jsx/jsx-runtime" {
  namespace JSX {
    interface IntrinsicElements {
      icon: IconProps;
      image: ImageProps;
      markdown: MarkdownProps;
    }
  }
}
declare module "rune-jsx/jsx-dev-runtime" {
  namespace JSX {
    interface IntrinsicElements {
      icon: IconProps;
      image: ImageProps;
      markdown: MarkdownProps;
    }
  }
}
