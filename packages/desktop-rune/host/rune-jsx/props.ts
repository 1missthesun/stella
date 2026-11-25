// Props of the Rune host elements. Each maps onto a Rune builder in engine/src (style.rs,
// text.rs, input.rs, media.rs, webview.rs, windows.rs); host/ELEMENTS.md documents them.
import type {} from "react";
import type { Mods } from "../bridge";

export type Color = string;
export type Size = number | "full" | "fit" | `${number}%`;
export type Run = {
  t: string; w?: number; c?: Color; m?: boolean; bg?: Color; i?: boolean; u?: Color; s?: number; st?: boolean;
  /** A link: pressing it calls the text's `onLink(href)`. */
  href?: string;
};
export type Shadow = { x?: number; y?: number; blur?: number; spread?: number; color: Color; inset?: boolean };
export type Gradient = { angle?: number; stops: [number, Color][] };
export type Radial = { center?: [number, number]; radius: number | [number, number]; stops: [number, Color][] };
export type Insets = { left?: number; top?: number; right?: number; bottom?: number };
export type Side = "top" | "bottom" | "left" | "right";
export type Effect = { opacity?: number; scale?: number; x?: number; y?: number; blur?: number; dur?: number; bounce?: number };
export type Presence = "fade" | "rise" | "drop" | "blur" | "scale" | "pop" | "slide" | Effect;
export type Frame = { at: number; x?: number; y?: number; scale?: number; scaleX?: number; scaleY?: number; opacity?: number; rotate?: number };
/** `opacity` pulses low↔high, `rotation` spins, `slide` moves from→to, `sequence` plays `frames`. */
export type Loop = {
  kind: "opacity" | "rotation" | "slide" | "sequence"; period: number; delay?: number; times?: number;
  low?: number; high?: number; from?: number | [number, number]; to?: number | [number, number]; frames?: Frame[]; origin?: [number, number];
};
export type Cursor =
  | "default" | "pointer" | "text" | "grab" | "grabbing" | "notAllowed" | "move"
  | "colResize" | "rowResize" | "ewResize" | "nsResize" | "nwseResize" | "neswResize";
export type KeyEvent = { key: string; chord: string; mods: Mods };
export type InputKeyEvent = KeyEvent & { value: string; start: number; end: number; length: number };
export type Layout = { x: number; y: number; w: number; h: number };
export type ScrollPos = { x: number; y: number; maxX: number; maxY: number; viewport: [number, number] };
export type Drag = { phase: "start" | "move" | "end"; dx: number; dy: number; x: number; y: number };

export type BoxProps = {
  /** Stable identity: Rune key, memo id, anchor target and command target. */
  id?: string;
  children?: React.ReactNode;
  // Layout
  w?: Size; h?: Size; minW?: Size; maxW?: Size; minH?: Size; maxH?: Size;
  grow?: number; shrink?: boolean; aspect?: number;
  pad?: number; px?: number; py?: number; pt?: number; pr?: number; pb?: number; pl?: number;
  mt?: number; mb?: number; ml?: number; mr?: number; mx?: number; my?: number;
  gap?: number; rowGap?: number;
  align?: "start" | "center" | "end" | "stretch";
  justify?: "start" | "center" | "end" | "between" | "around" | "evenly";
  selfAlign?: "start" | "center" | "end" | "stretch" | "auto";
  center?: boolean; wrap?: boolean;
  /** CSS grid with `columns` equal tracks; children pick one with `column` (0-based). */
  columns?: number; column?: number;
  /** position:absolute against the parent's padding box. */
  absolute?: Insets; inset?: number;
  /** position:fixed: against the window, painted in its top layer (scrims, dialogs, toasts). */
  fixed?: boolean;
  /** Paint above later siblings (`true`), or an explicit paint order. */
  raise?: boolean | number;
  dir?: "ltr" | "rtl";
  // Paint
  fill?: Color; gradient?: Gradient; radial?: Radial;
  border?: Color; borderWidth?: number;
  /** Per-side widths in CSS order: top, right, bottom, left. */
  borderSides?: [number, number, number, number]; borderDash?: number;
  /** Per-corner radii in CSS order: top-left, top-right, bottom-right, bottom-left. */
  radius?: number; corners?: [number, number, number, number];
  /** Clip children to the rounded box (overflow:hidden). */
  clip?: number;
  shadow?: [number, number, Color]; shadows?: Shadow[];
  opacity?: number; blur?: number; backdropBlur?: number;
  // States
  hover?: Color; press?: Color; hoverFill?: Color; pressFill?: Color; hoverBorder?: Color; pressBorder?: Color;
  /** This element's colour while its nearest hover group is hovered. */
  hoverColor?: Color; hoverOpacity?: [number, number]; hoverGroup?: boolean;
  pressScale?: number;
  focusRing?: { width?: number; offset?: number; color: Color; radius?: number };
  focusFill?: Color; focusBorder?: Color;
  disabled?: boolean;
  /** Laid out but not drawn, hit-tested or announced (visibility:hidden). */
  hidden?: boolean;
  // Transform and motion
  x?: number; y?: number; scale?: number; rotate?: number; origin?: [number, number];
  /** The spring every prop change on this element moves on. */
  motion?: { dur?: number; bounce?: number };
  /** Animate layout changes on a spring of this duration (s). */
  layout?: number;
  enter?: Presence; exit?: Presence;
  loop?: Loop;
  /** Changes inside land at once (search results). */
  instant?: boolean;
  // Interaction
  cursor?: Cursor;
  /** pointer-events:none for the whole subtree. */
  inert?: boolean;
  focusable?: boolean; tabIndex?: number; autoFocus?: boolean;
  /** Arrow-key roving and type-select among focusable children (menus, lists, tabs). */
  focusGroup?: boolean;
  /** Chords this element takes while it (or a child) has focus; each fires `onKey`. Others stay native. */
  keys?: string[];
  windowDrag?: boolean; noWindowDrag?: boolean;
  windowResize?: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
  /** Tooltip. */
  title?: string; titleSide?: Side;
  /** Dragging this element out drags files or text to other apps. */
  dragOut?: { paths?: string[]; text?: string };
  /** Restrict `onDropFiles` to these extensions. */
  dropExts?: string[];
  // Scroll
  scrollY?: boolean; scrollX?: boolean;
  /** Follow the end as content grows (chat). */
  stickBottom?: boolean;
  edgeFade?: number;
  /** Per-edge fades with the content hidden under them; `stops` are `[position, alpha]` pairs (CSS mask stops). */
  scrollFade?: { top?: FadeEdge; bottom?: FadeEdge };
  /** Opts a viewport, list or row out of scroll anchoring (CSS `overflow-anchor: none`). */
  noScrollAnchor?: boolean;
  /** Distance from the bottom past which `onFarFromBottom(true)` fires (default 180). */
  farFromBottom?: number;
  /** A list row whose content arrives complete (a sent message): its height glides on the growth spring alone. */
  arrivesWhole?: boolean;
  sticky?: "top" | "bottom"; stickyInset?: number;
  /** Selectable texts inside select as one (drag across paragraphs, Cmd+A). */
  selectionGroup?: boolean;
  // Accessibility
  role?: string; label?: string; checked?: boolean; expanded?: boolean; selected?: boolean;
  // Overlays
  anchor?: { to: string; side?: Side; align?: "start" | "center" | "end"; gap?: number; fit?: boolean };
  /** Escape and (optionally) an outside click call `onDismiss`; traps focus, makes the rest inert. */
  modal?: { clickOutside?: boolean; wheelOutside?: boolean };
  // Events
  onPress?: () => void;
  onDoublePress?: () => void;
  onContextMenu?: (at: { x: number; y: number }) => void;
  onHover?: (inside: boolean) => void;
  onFocus?: (focused: boolean, keyboard: boolean) => void;
  onFocusWithin?: (within: boolean) => void;
  onLayout?: (r: Layout) => void;
  onScroll?: (p: ScrollPos) => void;
  onAtBottom?: (atBottom: boolean) => void;
  onFarFromBottom?: (far: boolean) => void;
  onKey?: (e: KeyEvent) => void;
  onDismiss?: () => void;
  onDropFiles?: (paths: string[]) => void;
  onDropHover?: (over: boolean) => void;
  onDrag?: (d: Drag) => void;
  /** A ref gives the host instance; `nodeId(ref)` is its engine node. */
  ref?: React.Ref<unknown>;
};

export type TextProps = BoxProps & {
  spans?: Run[]; size?: number; weight?: number; lineHeight?: number; tracking?: number; color?: Color;
  mono?: boolean;
  /** A registered or installed family ("Manrope", "IBM Plex Mono"), or "sans" / "mono" / "system-mono". */
  family?: string;
  /** CSS `font-feature-settings`, e.g. `"'ss01' 1, 'tnum' 1"`. */
  features?: string;
  italic?: boolean; underline?: boolean; strike?: boolean;
  selectable?: boolean;
  selectionColor?: Color;
  maxLines?: number; truncate?: boolean | "end" | "middle" | "head" | "fade"; nowrap?: boolean;
  textAlign?: "start" | "center" | "end"; textCase?: "upper" | "lower";
  onLink?: (href: string) => void;
};

export type InputProps = Omit<TextProps, "onKey"> & {
  placeholder?: string; placeholderColor?: Color;
  /** Controlled value. Echoes of what the engine reported are recognised, so typing never races. */
  value?: string;
  multiline?: boolean; secure?: boolean; spellcheck?: boolean; readOnly?: boolean; selectOnFocus?: boolean;
  caretColor?: Color;
  onInput?: (value: string) => void;
  /** Enter (Shift+Enter types a newline in a multiline field). */
  onSubmit?: (value: string) => void;
  onSelection?: (sel: { start: number; end: number }) => void;
  /** Files or an image pasted (text pastes natively). `image` is a PNG path. */
  onPaste?: (p: { files: string[]; image: string | null; text: string }) => void;
  onKey?: (e: InputKeyEvent) => void;
};

export type ImageProps = BoxProps & {
  /** A path, file:// URL, blob:<id>, data: URL or http(s) URL. SVG works too. */
  src: string;
  fit?: "cover" | "contain" | "stretch";
  tint?: Color;
};

/** One SVG path of a `<vector>`. Transforms and gradients aren't drawn: bake transforms into `d`. */
export type VectorPath = { d: string; fill?: string; stroke?: string; strokeWidth?: number; cap?: "round" | "butt"; opacity?: number; evenOdd?: boolean };

/** SVG paths drawn as shapes, for drawing that changes every frame (nothing is cached per body). */
export type VectorProps = BoxProps & { viewBox?: [number, number]; paths: VectorPath[] };

export type IconProps = BoxProps & {
  /** SVG body (paths inside the root <svg>, `currentColor` tinted by `color`). */
  svg: string; name?: string; view?: number; size?: number; color?: Color;
  /** Spin period in seconds (loaders). */
  spin?: number;
};

export type MarkdownProps = BoxProps & {
  src: string; streaming?: boolean; selectable?: boolean;
  /** MarkdownStyle builders by camelCase name, plus `codeFrame` (host/ELEMENTS.md). */
  mdStyle?: Record<string, unknown>;
  onLink?: (href: string) => void;
  /** A `mdStyle.codeFrame.actions` button was pressed on a code block. */
  onCodeAction?: (a: { action: string; index: number; language: string | null; source: string }) => void;
};

export type MediaProps = BoxProps & { src: string; fit?: "cover" | "contain"; autoplay?: boolean; muted?: boolean; loopMedia?: boolean };

export type FadeEdge = { size: number; stops?: [number, number][]; linear?: boolean; feather?: boolean; fullAt?: number };

export type ListProps = BoxProps & {
  /** Estimated row height; only rows near the viewport are built. Must sit inside a scrollY box. */
  estimate?: number; overscan?: [number, number];
  /** Rows ease their height changes (default on). `edge` is how a streaming row's bottom reveals. */
  growth?: boolean | { dur?: number; bounce?: number; edge?: "feather" | "fastFeather" | "none" | "wordFade"; clip?: boolean };
  /** Visible row indices (inclusive), on first layout and whenever they change. */
  onVisibleRows?: (r: { first: number; last: number; end: number }) => void;
};

export type WebviewMessage = { data: unknown; targetOrigin: string };
export type WebviewRequest = { rid: number; scheme: string; url: string; method: string; headers: Record<string, string>; body: string | null };

export type WebviewProps = BoxProps & {
  url?: string; html?: string; transparent?: boolean; devtools?: boolean; userAgent?: string;
  /** JS run before the page's own scripts. */
  preload?: string;
  /** Custom schemes answered by `onRequest` + `engine.webview.respond`. */
  protocols?: string[];
  onMessage?: (m: WebviewMessage) => void;
  /** Main-frame navigations only (Linux, Windows); on macOS `mainFrame` is absent and frames may arrive too. */
  onNavigate?: (e: { url: string; mainFrame?: boolean }) => void;
  onTitle?: (title: string) => void;
  onLoad?: (e: { phase: "started" | "finished"; url: string }) => void;
  onRequest?: (r: WebviewRequest) => void;
  onReady?: () => void;
  onError?: (error: string) => void;
};

export type WindowProps = {
  /** Window id: the name for engine.window.* ops and window events. */
  id: string;
  children?: React.ReactNode;
  kind?: "main" | "panel" | "overlay";
  title?: string;
  w?: number; h?: number; minSize?: [number, number]; maxSize?: [number, number];
  position?: [number, number];
  resizable?: boolean; frameless?: boolean; transparent?: boolean; alwaysOnTop?: boolean; clickThrough?: boolean;
  visible?: boolean;
  /** Window background (also `fill`). */
  bg?: Color; fill?: Color; gradient?: Gradient;
  /** Custom titlebar height: the app draws it, the window keeps its controls over it. */
  titlebar?: number;
  trafficLights?: [number, number];
  /** Native chrome colour scheme; unset follows the system. */
  dark?: boolean;
  dir?: "ltr" | "rtl";
  /** Window-level chords (fire `onKey` when nothing focused takes them). */
  keys?: string[];
  onKey?: (e: KeyEvent) => void;
};
