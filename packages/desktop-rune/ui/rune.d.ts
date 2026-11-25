// Rune host elements for JSX. Every prop maps 1:1 onto an El builder in engine/src/props.rs.
import type {} from "react";

export type Size = number | "full" | `${number}%`;
export type Run = { t: string; w?: number; c?: string; m?: boolean; bg?: string; i?: boolean; u?: string };

export type BoxProps = {
  id?: string;
  children?: React.ReactNode;
  w?: Size; h?: Size; minW?: number; maxW?: number; minH?: number; maxH?: number;
  grow?: number; shrink?: boolean;
  pad?: number; px?: number; py?: number; pt?: number; pr?: number; pb?: number; pl?: number;
  mt?: number; mb?: number; ml?: number; mr?: number;
  gap?: number; align?: "start" | "center" | "end" | "stretch"; justify?: "start" | "center" | "end" | "between";
  center?: boolean; wrap?: boolean;
  fill?: string; hover?: string; press?: string; border?: string; borderWidth?: number; radius?: number; clip?: number;
  shadow?: [number, number, string];
  scrollY?: boolean; stickBottom?: boolean; edgeFade?: number;
  opacity?: number; enter?: "fade" | "rise" | "blur" | "scale"; layout?: number;
  role?: string; label?: string; focusable?: boolean; selectionGroup?: boolean;
  onPress?: () => void;
  /** Lazy OS WebView in this box's rect (engine built with --features webview). */
  webview?: string;
};

export type TextProps = BoxProps & {
  spans?: Run[]; size?: number; weight?: number; lineHeight?: number; tracking?: number; color?: string;
  mono?: boolean; selectable?: boolean; maxLines?: number; truncate?: boolean; textAlign?: "start" | "center" | "end";
};

export type InputProps = TextProps & {
  placeholder?: string; placeholderColor?: string; value?: string; autoFocus?: boolean;
  onInput?: (v: string) => void; onSubmit?: (v: string) => void;
};

declare global {
  // eslint-disable-next-line no-var
  var stella: {
    store: import("../host/store").Store;
    useStore: <T>(sel: (s: import("../host/store").AppState) => T) => T;
    command: (v: Record<string, unknown>) => void;
    now: () => number;
  };
}
